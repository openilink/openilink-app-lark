import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation, ToolResult } from "./types.js";

/** 同步响应的 deadline 时间（毫秒） */
const SYNC_DEADLINE_MS = 2500;

/** 超时标记 */
const TIMEOUT = Symbol("timeout");

/**
 * 从请求流中读取完整的 body
 */
export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** JSON 响应辅助 */
function jsonReply(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * 命令事件处理回调类型
 * 返回 ToolResult 或 null（不处理）
 */
export type CommandCallback = (
  event: HubEvent,
  installation: Installation,
) => Promise<string | ToolResult | null>;

/**
 * 异步推送回调类型 - 命令超时后通过 Bot API 推送结果
 */
export type AsyncPushCallback = (
  result: string | ToolResult,
  event: HubEvent,
  installation: Installation,
) => Promise<void>;

/** 普通事件回调类型（消息桥接等） */
export type EventCallback = (
  event: HubEvent,
  installation: Installation,
) => Promise<void> | void;

/**
 * 处理 Hub Webhook 请求
 * 路由: POST /webhook
 *
 * command 事件实现同步/异步响应模式：
 * - 2500ms 内完成 -> 同步返回结果
 * - 超时 -> 立即返回 {"reply_async": true}，后台继续执行并通过 Bot API 推送结果
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  callbacks: {
    onCommand: CommandCallback;
    onEvent: EventCallback;
    onAsyncPush: AsyncPushCallback;
  },
): Promise<void> {
  try {
    // 读取请求体
    const body = await readBody(req);
    let event: HubEvent;

    try {
      event = JSON.parse(body.toString("utf-8")) as HubEvent;
    } catch {
      jsonReply(res, 400, { error: "请求体 JSON 解析失败" });
      return;
    }

    // 1. URL 验证（在签名验证之前，因为此时可能还没有 installation）
    if (event.type === "url_verification") {
      jsonReply(res, 200, { challenge: event.challenge ?? "" });
      return;
    }

    // 2. 查找安装记录
    const installationId = event.installation_id;
    if (!installationId) {
      jsonReply(res, 400, { error: "缺少 installation_id" });
      return;
    }

    const installation = store.getInstallation(installationId);
    if (!installation) {
      console.warn("[webhook] 未找到安装记录:", installationId);
      jsonReply(res, 401, { error: "unauthorized" });
      return;
    }

    // 3. 签名验证
    const timestamp = (req.headers["x-timestamp"] as string) ?? "";
    const signature = (req.headers["x-signature"] as string) ?? "";

    if (!verifySignature(installation.webhookSecret, timestamp, body, signature)) {
      console.warn("[webhook] 签名验证失败, installation_id:", installationId);
      jsonReply(res, 401, { error: "invalid signature" });
      return;
    }

    // 4. 事件分发
    if (event.event?.type === "command") {
      // 同步/异步竞态
      const resultPromise = callbacks.onCommand(event, installation);
      const result = await Promise.race([
        resultPromise,
        new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), SYNC_DEADLINE_MS)),
      ]);

      if (result !== TIMEOUT) {
        // 同步返回
        if (result === null) {
          jsonReply(res, 200, { ok: true });
          return;
        }
        const payload = typeof result === "string"
          ? { reply: result }
          : {
              reply: result.reply,
              ...(result.type ? { reply_type: result.type } : {}),
              ...(result.url ? { reply_url: result.url } : {}),
              ...(result.base64 ? { reply_base64: result.base64 } : {}),
              ...(result.name ? { reply_name: result.name } : {}),
            };
        jsonReply(res, 200, payload);
      } else {
        // 异步
        jsonReply(res, 200, { reply_async: true });
        resultPromise
          .then((r) => {
            if (r) callbacks.onAsyncPush(r, event, installation);
          })
          .catch(console.error);
      }
      return;
    }

    // 非 command 事件
    try {
      await callbacks.onEvent(event, installation);
    } catch (e) {
      console.error("[webhook] 事件处理异常:", e);
    }
    jsonReply(res, 200, { ok: true });
  } catch (err) {
    console.error("[webhook] 请求处理异常:", err);
    if (!res.headersSent) {
      jsonReply(res, 500, { error: "内部服务器错误" });
    }
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation, ToolResult } from "./types.js";

/** 命令处理的 deadline 时间（毫秒） */
const COMMAND_DEADLINE_MS = 2500;

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

/**
 * 将 ToolHandler 的返回值标准化为 ToolResult
 */
function normalizeResult(raw: string | ToolResult): ToolResult {
  if (typeof raw === "string") {
    return { reply: raw };
  }
  return raw;
}

/**
 * 构建 webhook 同步响应 JSON - 支持纯文本和媒体回复
 */
function buildReplyPayload(result: ToolResult): Record<string, unknown> {
  if (result.type === "image") {
    const payload: Record<string, unknown> = {
      reply: result.reply,
      type: "image",
    };
    if (result.base64) {
      payload.base64 = result.base64;
    } else if (result.url) {
      payload.url = result.url;
    }
    return payload;
  }
  return { reply: result.reply };
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
  result: ToolResult,
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
 * - 2500ms 内完成 → HTTP 响应返回 {"reply": "结果"}
 * - 超时 → 立即返回 {"reply_async": true}，后台继续执行并通过 Bot API 推送结果
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
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "请求体 JSON 解析失败" }));
      return;
    }

    // URL 验证（Hub 首次注册 Webhook 时发送）
    if (event.type === "url_verification") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ challenge: event.challenge ?? "" }));
      return;
    }

    // 查找安装记录
    const installationId = event.installation_id;
    if (!installationId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少 installation_id" }));
      return;
    }

    const installation = store.getInstallation(installationId);
    if (!installation) {
      console.warn("[webhook] 未找到安装记录:", installationId);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "安装记录不存在" }));
      return;
    }

    // 验证签名
    const timestamp = (req.headers["x-timestamp"] as string) ?? "";
    const signature = (req.headers["x-signature"] as string) ?? "";

    if (!timestamp || !signature) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少签名头: X-Timestamp, X-Signature" }));
      return;
    }

    const valid = verifySignature(
      installation.webhookSecret,
      timestamp,
      body,
      signature,
    );

    if (!valid) {
      console.warn("[webhook] 签名验证失败, installation_id:", installationId);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "签名验证失败" }));
      return;
    }

    // 签名验证通过，根据事件类型分发处理
    const eventType = event.event?.type;

    if (eventType === "command") {
      // 命令事件 - 实现同步/异步响应模式
      await handleCommandWithDeadline(
        event,
        installation,
        res,
        callbacks.onCommand,
        callbacks.onAsyncPush,
      );
    } else {
      // 非命令事件（消息桥接等）- 先返回 200，再异步处理
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));

      try {
        await callbacks.onEvent(event, installation);
      } catch (err) {
        console.error("[webhook] 事件处理异常:", err);
      }
    }
  } catch (err) {
    console.error("[webhook] 请求处理异常:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "内部服务器错误" }));
    }
  }
}

/**
 * 带 deadline 的命令处理
 * 在 COMMAND_DEADLINE_MS 内完成则同步返回结果，否则立即返回 reply_async
 */
async function handleCommandWithDeadline(
  event: HubEvent,
  installation: Installation,
  res: ServerResponse,
  onCommand: CommandCallback,
  onAsyncPush: AsyncPushCallback,
): Promise<void> {
  let responded = false;

  // 启动命令处理
  const commandPromise = onCommand(event, installation);

  // 设置 deadline 定时器
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), COMMAND_DEADLINE_MS);
  });

  // 竞争：命令完成 vs 超时
  const raceResult = await Promise.race([
    commandPromise.then((r) => ({ kind: "done" as const, result: r })),
    timeoutPromise.then(() => ({ kind: "timeout" as const, result: null })),
  ]);

  if (raceResult.kind === "done") {
    // 命令在 deadline 内完成 - 同步返回结果
    responded = true;
    const raw = raceResult.result;
    if (raw) {
      const result = normalizeResult(raw);
      const payload = buildReplyPayload(result);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }
  } else {
    // 超时 - 立即返回 reply_async，后台继续执行
    responded = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reply_async: true }));

    // 后台等待命令完成，然后通过 Bot API 推送结果
    commandPromise
      .then(async (raw) => {
        if (raw) {
          const result = normalizeResult(raw);
          await onAsyncPush(result, event, installation);
        }
      })
      .catch((err) => {
        console.error("[webhook] 异步命令执行失败:", err);
      });
  }
}

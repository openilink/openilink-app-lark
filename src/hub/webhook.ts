import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation } from "./types.js";

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

/** 事件回调函数类型 */
export type EventCallback = (
  event: HubEvent,
  installation: Installation,
) => Promise<void> | void;

/**
 * 处理 Hub Webhook 请求
 * 路由: POST /webhook
 *
 * 1. 读取并解析 body 为 HubEvent
 * 2. url_verification 类型直接返回 challenge
 * 3. 查找对应 installation，验证签名
 * 4. 验证通过后调用 onEvent 回调
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  onEvent: EventCallback,
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

    // 签名验证通过，调用事件回调
    try {
      await onEvent(event, installation);
    } catch (err) {
      console.error("[webhook] 事件处理异常:", err);
    }

    // 返回成功
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } catch (err) {
    console.error("[webhook] 请求处理异常:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "内部服务器错误" }));
  }
}

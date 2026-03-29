import http from "node:http";
import crypto from "node:crypto";

/** Mock Hub 使用的常量 */
export const WEBHOOK_SECRET = "mock-webhook-secret";
export const APP_TOKEN = "mock_app_token";
export const INSTALLATION_ID = "mock-inst";
export const BOT_ID = "mock-bot";

// App 的 webhook URL（启动时传入）
let appWebhookUrl: string;

// 记录 App 发送的消息
let sentMessages: any[] = [];

/**
 * 创建 Mock Hub Server
 * 模拟 OpeniLink Hub 的核心行为：
 * - POST /mock/event — 注入模拟微信消息，构造 HubEvent 转发给 App
 * - POST /api/bot/send — 记录 App 通过 HubClient 发送的消息
 * - POST /bot/v1/message/send — 同上（兼容路径）
 * - GET /mock/messages — 返回记录的消息列表
 * - POST /mock/reset — 清空记录
 * - GET /health — 健康检查
 *
 * @param port Mock Server 监听端口
 * @param webhookUrl App 的 webhook URL（如 http://localhost:8081/hub/webhook）
 */
export function createMockHub(port: number, webhookUrl: string): http.Server {
  appWebhookUrl = webhookUrl;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);
    const body = await readBody(req);

    // POST /mock/event — 注入消息，然后转发给 App
    if (req.method === "POST" && url.pathname === "/mock/event") {
      try {
        const { sender, content } = JSON.parse(body.toString());

        // 构造 HubEvent
        const hubEvent = {
          v: 1,
          type: "event",
          trace_id: `tr_${Date.now()}`,
          installation_id: INSTALLATION_ID,
          bot: { id: BOT_ID },
          event: {
            type: "message.text",
            id: `evt_${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000),
            data: {
              from: sender,
              from_name: sender,
              content: content,
            },
          },
        };

        // 计算签名
        const timestamp = String(Math.floor(Date.now() / 1000));
        const eventBody = JSON.stringify(hubEvent);
        const sig = crypto
          .createHmac("sha256", WEBHOOK_SECRET)
          .update(timestamp + ":" + eventBody)
          .digest("hex");

        // 转发给 App 的 /hub/webhook
        const appResp = await fetch(appWebhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Timestamp": timestamp,
            "X-Signature": `sha256=${sig}`,
          },
          body: eventBody,
          signal: AbortSignal.timeout(10000),
        });
        const appResult = await appResp.text();
        jsonReply(res, 200, { ok: true, app_response: appResult });
      } catch (err: any) {
        jsonReply(res, 502, { ok: false, error: err.message });
      }
      return;
    }

    // POST /api/bot/send — 记录 App 通过 HubClient 发送的消息
    if (req.method === "POST" && url.pathname === "/api/bot/send") {
      const auth = req.headers.authorization;
      if (!auth) {
        jsonReply(res, 401, { ok: false, error: "missing authorization" });
        return;
      }
      const msg = JSON.parse(body.toString());
      sentMessages.push({ ...msg, received_at: new Date().toISOString() });
      jsonReply(res, 200, { ok: true, client_id: `msg_${Date.now()}` });
      return;
    }

    // POST /bot/v1/message/send — 兼容路径
    if (req.method === "POST" && url.pathname === "/bot/v1/message/send") {
      const auth = req.headers.authorization;
      if (!auth) {
        jsonReply(res, 401, { ok: false, error: "missing authorization" });
        return;
      }
      const msg = JSON.parse(body.toString());
      sentMessages.push({ ...msg, received_at: new Date().toISOString() });
      jsonReply(res, 200, { ok: true, client_id: `msg_${Date.now()}` });
      return;
    }

    // GET /mock/messages — 获取记录的消息列表
    if (req.method === "GET" && url.pathname === "/mock/messages") {
      jsonReply(res, 200, { messages: sentMessages });
      return;
    }

    // POST /mock/reset — 清空消息记录
    if (req.method === "POST" && url.pathname === "/mock/reset") {
      sentMessages = [];
      jsonReply(res, 200, { ok: true });
      return;
    }

    // GET /health — 健康检查
    if (url.pathname === "/health") {
      jsonReply(res, 200, { status: "ok" });
      return;
    }

    jsonReply(res, 404, { error: "not found" });
  });

  return server;
}

/** 获取当前记录的所有消息（供同进程调用） */
export function getSentMessages(): any[] {
  return sentMessages;
}

/** 清空消息记录（供同进程调用） */
export function resetSentMessages(): void {
  sentMessages = [];
}

/** 读取请求体 */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** 返回 JSON 响应 */
function jsonReply(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

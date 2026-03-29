/**
 * 集成测试工具类 - 与 Mock Hub Server 交互
 */
import http from "node:http";
import {
  createMockHub,
  getSentMessages,
  resetSentMessages,
  WEBHOOK_SECRET,
  APP_TOKEN,
  INSTALLATION_ID,
  BOT_ID,
} from "./mock-hub.js";

/** Mock Server 端口配置 */
export const MOCK_HUB_PORT = 9801;
export const MOCK_HUB_URL = `http://localhost:${MOCK_HUB_PORT}`;
export const MOCK_APP_TOKEN = APP_TOKEN;
export const MOCK_WEBHOOK_SECRET = WEBHOOK_SECRET;
export const MOCK_INSTALLATION_ID = INSTALLATION_ID;
export const MOCK_BOT_ID = BOT_ID;

/** App 的 webhook 端口和地址 */
export const APP_PORT = 9802;
export const APP_WEBHOOK_URL = `http://localhost:${APP_PORT}/hub/webhook`;

/**
 * 启动 Mock Hub Server 实例
 * 返回 server 和清理函数
 */
export function startMockHub(): Promise<{
  server: http.Server;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = createMockHub(MOCK_HUB_PORT, APP_WEBHOOK_URL);
    server.on("error", reject);
    server.listen(MOCK_HUB_PORT, () => {
      console.log(`[setup] Mock Hub Server 已启动，端口 ${MOCK_HUB_PORT}`);
      resolve({
        server,
        close: () =>
          new Promise<void>((res) =>
            server.close(() => {
              console.log("[setup] Mock Hub Server 已关闭");
              res();
            }),
          ),
      });
    });
  });
}

/**
 * 注入模拟微信消息到 Mock Server
 * Mock Server 会将该消息作为 Hub 事件推送给 App 的 webhook
 */
export async function injectMessage(
  sender: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${MOCK_HUB_URL}/mock/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, content }),
  });
  if (!res.ok) {
    throw new Error(`注入消息失败: ${res.status} ${await res.text()}`);
  }
}

/**
 * 获取 App 发送到 Mock Server 的消息列表
 * 优先从同进程直接获取，也支持通过 HTTP 获取
 */
export async function getMessages(): Promise<any[]> {
  // 同进程直接获取（更快更可靠）
  return getSentMessages();
}

/**
 * 通过 HTTP 获取消息（适用于跨进程场景）
 */
export async function getMessagesViaHttp(): Promise<any[]> {
  const res = await fetch(`${MOCK_HUB_URL}/mock/messages`);
  if (!res.ok) {
    throw new Error(`获取消息失败: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data as any).messages;
}

/**
 * 重置 Mock Server 状态
 * 每个测试用例前调用，确保测试隔离
 */
export async function resetMock(): Promise<void> {
  resetSentMessages();
}

/**
 * 等待条件满足（轮询）
 * @param fn - 条件判断函数，返回 true 表示条件满足
 * @param timeoutMs - 超时时间，默认 10 秒
 * @param intervalMs - 轮询间隔，默认 200 毫秒
 */
export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`等待超时：${timeoutMs}ms 内条件未满足`);
}

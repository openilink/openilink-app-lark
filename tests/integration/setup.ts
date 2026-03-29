/**
 * 集成测试工具类 - 与 Mock Hub Server 交互
 */

/** Mock Server 配置 */
export const MOCK_HUB_URL = "http://localhost:9801";
export const MOCK_APP_TOKEN = "mock_app_token";
export const MOCK_WEBHOOK_SECRET = "mock-webhook-secret";

/**
 * 注入模拟微信消息到 Mock Server
 * Mock Server 会将该消息作为 Hub 事件推送给 App 的 webhook
 */
export async function injectMessage(sender: string, content: string): Promise<void> {
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
 * 用于验证 App 是否正确转发了消息
 */
export async function getMessages(): Promise<any[]> {
  const res = await fetch(`${MOCK_HUB_URL}/mock/messages`);
  if (!res.ok) {
    throw new Error(`获取消息失败: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * 重置 Mock Server 状态
 * 每个测试用例前调用，确保测试隔离
 */
export async function resetMock(): Promise<void> {
  const res = await fetch(`${MOCK_HUB_URL}/mock/reset`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`重置 Mock Server 失败: ${res.status} ${await res.text()}`);
  }
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

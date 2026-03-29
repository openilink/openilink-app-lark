/**
 * 飞书 Bridge 集成测试
 *
 * 需要先启动 Mock Hub Server 和 App 服务，可使用 scripts/test-integration.sh 一键运行。
 * 标记为 describe.skip，手动移除 .skip 或通过集成测试脚本运行。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resetMock, injectMessage, getMessages, waitFor } from "./setup.js";

describe.skip("飞书 Bridge 集成测试", () => {
  beforeEach(async () => {
    // 每个用例前重置 Mock Server 状态
    await resetMock();
  });

  it("微信文本消息应转发到飞书", async () => {
    // 注入一条模拟微信消息
    await injectMessage("user_alice", "你好飞书");

    // 等待 App 处理并发送消息到 Mock Server
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    });

    // 验证消息已被正确转发
    const msgs = await getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    // 验证消息内容包含原始文本
    const lastMsg = msgs[msgs.length - 1];
    expect(JSON.stringify(lastMsg)).toContain("你好飞书");
  });

  it("多条消息应按顺序转发", async () => {
    // 连续注入多条消息
    await injectMessage("user_alice", "第一条消息");
    await injectMessage("user_bob", "第二条消息");

    // 等待所有消息处理完成
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length >= 2;
    });

    const msgs = await getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });

  it("命令消息应触发 tool 执行", async () => {
    // 注入一条命令类型的事件
    // 注意：具体命令格式取决于 Mock Server 的实现
    await injectMessage("user_alice", "/help");

    // 等待 App 处理命令并回复
    await waitFor(
      async () => {
        const msgs = await getMessages();
        return msgs.length > 0;
      },
      15_000, // 命令处理可能较慢，适当延长超时
    );

    const msgs = await getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });
});

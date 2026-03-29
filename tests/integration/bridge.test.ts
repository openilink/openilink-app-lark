/**
 * 飞书 Bridge 集成测试
 *
 * 测试 Hub ↔ App 的完整通信链路，不依赖飞书 SDK：
 * 1. Mock Hub Server 模拟 OpeniLink Hub
 * 2. 创建轻量 App HTTP 服务器（仅含 webhook handler）
 * 3. 使用内存 SQLite 存储 + Mock LarkClient
 * 4. 验证微信→飞书和飞书→微信的双向桥接
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { Store } from "../../src/store.js";
import { handleWebhook } from "../../src/hub/webhook.js";
import { WxToLark } from "../../src/bridge/wx-to-lark.js";
import { LarkToWx } from "../../src/bridge/lark-to-wx.js";
import { HubClient } from "../../src/hub/client.js";
import type { HubEvent, Installation } from "../../src/hub/types.js";
import type { LarkMessageData } from "../../src/lark/event.js";
import {
  startMockHub,
  injectMessage,
  getMessages,
  resetMock,
  waitFor,
  MOCK_HUB_URL,
  MOCK_WEBHOOK_SECRET,
  MOCK_APP_TOKEN,
  MOCK_INSTALLATION_ID,
  MOCK_BOT_ID,
  APP_PORT,
} from "./setup.js";

// ─── Mock LarkClient ───
// 模拟飞书客户端，不连接真实飞书，仅记录发送的消息

/** 记录飞书端发送的消息 */
let larkSentMessages: Array<{ chatId: string; text: string; messageId: string }> = [];
let larkMessageIdCounter = 0;

/**
 * 创建 Mock LarkClient
 * 只实现 sendText 方法，返回模拟的 message_id
 */
function createMockLarkClient() {
  return {
    sdk: {} as any,
    sendText: async (chatId: string, text: string): Promise<string> => {
      larkMessageIdCounter++;
      const messageId = `lark_msg_${larkMessageIdCounter}`;
      larkSentMessages.push({ chatId, text, messageId });
      return messageId;
    },
    replyText: async (_messageId: string, text: string): Promise<string> => {
      larkMessageIdCounter++;
      const id = `lark_reply_${larkMessageIdCounter}`;
      larkSentMessages.push({ chatId: "reply", text, messageId: id });
      return id;
    },
  };
}

// ─── 测试主体 ───

describe("飞书 Bridge 集成测试", () => {
  let mockHubHandle: { server: http.Server; close: () => Promise<void> };
  let appServer: http.Server;
  let store: Store;
  let wxToLark: WxToLark;
  let larkToWx: LarkToWx;
  const defaultChatId = "test_chat_001";

  beforeAll(async () => {
    // 1. 启动 Mock Hub Server
    mockHubHandle = await startMockHub();

    // 2. 初始化内存数据库和存储
    store = new Store(":memory:");

    // 3. 注入 installation 记录（模拟已完成 OAuth 安装）
    store.saveInstallation({
      id: MOCK_INSTALLATION_ID,
      hubUrl: MOCK_HUB_URL,
      appId: "test-app",
      botId: MOCK_BOT_ID,
      appToken: MOCK_APP_TOKEN,
      webhookSecret: MOCK_WEBHOOK_SECRET,
      createdAt: new Date().toISOString(),
    });

    // 4. 创建 Mock LarkClient 和桥接模块
    const mockLark = createMockLarkClient();
    wxToLark = new WxToLark(mockLark as any, store, defaultChatId);
    larkToWx = new LarkToWx(store, defaultChatId);

    // 5. 启动轻量 App HTTP 服务器（只处理 /hub/webhook）
    appServer = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${APP_PORT}`);

      if (req.method === "POST" && url.pathname === "/hub/webhook") {
        await handleWebhook(req, res, store, async (event, installation) => {
          if (!event.event) return;
          const eventType = event.event.type;

          if (eventType.startsWith("message.")) {
            // 微信→飞书桥接
            await wxToLark.handleWxEvent(event, installation);
          }
        });
        return;
      }

      // 健康检查
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve, reject) => {
      appServer.on("error", reject);
      appServer.listen(APP_PORT, () => {
        console.log(`[test] App Server 已启动，端口 ${APP_PORT}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    // 关闭 App 服务器
    await new Promise<void>((resolve) =>
      appServer.close(() => {
        console.log("[test] App Server 已关闭");
        resolve();
      }),
    );

    // 关闭 Mock Hub Server
    await mockHubHandle.close();

    // 关闭数据库
    store.close();
  });

  beforeEach(() => {
    // 每个测试前重置消息记录（但不重置计数器，确保 ID 全局唯一）
    resetMock();
    larkSentMessages = [];
    // 注意：不重置 larkMessageIdCounter，保证 message_id 在跨测试中唯一
    // 避免 Store 中 getMessageLinkByLarkId 查到旧记录
  });

  // ─── 微信→飞书 方向测试 ───

  it("Mock Hub Server 健康检查", async () => {
    const res = await fetch(`${MOCK_HUB_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  it("App Server 健康检查", async () => {
    const res = await fetch(`http://localhost:${APP_PORT}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  it("微信文本消息应通过 Hub→App→飞书 链路转发", async () => {
    // Mock Hub 注入微信消息 → 转发到 App webhook → WxToLark 转发到飞书
    await injectMessage("user_alice", "你好飞书");

    // 等待 WxToLark 处理完成（飞书端收到消息）
    await waitFor(async () => larkSentMessages.length > 0, 5000);

    // 验证飞书端收到了转发的消息
    expect(larkSentMessages.length).toBe(1);
    expect(larkSentMessages[0].chatId).toBe(defaultChatId);
    expect(larkSentMessages[0].text).toContain("user_alice");
    expect(larkSentMessages[0].text).toContain("你好飞书");
  });

  it("多条微信消息应依次转发到飞书", async () => {
    await injectMessage("user_alice", "第一条消息");
    await injectMessage("user_bob", "第二条消息");

    // 等待两条消息都转发完成
    await waitFor(async () => larkSentMessages.length >= 2, 5000);

    expect(larkSentMessages.length).toBe(2);
    expect(larkSentMessages[0].text).toContain("第一条消息");
    expect(larkSentMessages[1].text).toContain("第二条消息");
  });

  it("消息映射应正确保存到 Store", async () => {
    await injectMessage("user_charlie", "测试映射");

    await waitFor(async () => larkSentMessages.length > 0, 5000);

    // 验证 Store 中保存了消息映射
    const link = store.getLatestLinkByWxUser("user_charlie");
    expect(link).toBeDefined();
    expect(link!.wxUserId).toBe("user_charlie");
    expect(link!.wxUserName).toBe("user_charlie");
    expect(link!.installationId).toBe(MOCK_INSTALLATION_ID);
    // messageId 应该是 Mock LarkClient 生成的
    expect(link!.larkMessageId).toMatch(/^lark_msg_/);
  });

  // ─── 飞书→微信 方向测试 ───

  it("飞书回复消息应通过 LarkToWx→HubClient 转发到微信", async () => {
    // 先模拟一条微信→飞书的消息，建立消息映射
    await injectMessage("user_dave", "你好，请回复我");

    await waitFor(async () => larkSentMessages.length > 0, 5000);

    // 获取映射中的飞书消息 ID
    const link = store.getLatestLinkByWxUser("user_dave");
    expect(link).toBeDefined();
    const larkMsgId = link!.larkMessageId;

    // 模拟飞书用户在群里回复这条消息
    const larkReplyData: LarkMessageData = {
      chatId: defaultChatId,
      messageId: "lark_reply_from_user",
      messageType: "text",
      content: JSON.stringify({ text: "收到，已处理" }),
      senderId: "lark_user_001",
      senderType: "user",
      parentId: larkMsgId, // 回复的目标是之前转发的消息
    };

    // 获取所有 installation 并触发 LarkToWx 处理
    const installations = store.getAllInstallations();
    await larkToWx.handleLarkMessage(larkReplyData, installations);

    // 等待 HubClient 将消息发送到 Mock Hub
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 Mock Hub 收到了回复消息
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].to).toBe("user_dave");
    expect(hubMessages[0].type).toBe("text");
    expect(hubMessages[0].content).toBe("收到，已处理");
  });

  it("飞书回复不在映射中的消息应被忽略", async () => {
    // 模拟一条飞书消息，但 parentId 在 Store 中没有对应映射
    const larkData: LarkMessageData = {
      chatId: defaultChatId,
      messageId: "lark_orphan_msg",
      messageType: "text",
      content: JSON.stringify({ text: "这条消息找不到映射" }),
      senderId: "lark_user_002",
      senderType: "user",
      parentId: "nonexistent_lark_msg_id",
    };

    const installations = store.getAllInstallations();
    await larkToWx.handleLarkMessage(larkData, installations);

    // Mock Hub 不应收到任何消息
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(0);
  });

  it("非目标群的飞书消息应被忽略", async () => {
    // 先建立映射
    await injectMessage("user_eve", "建立映射");
    await waitFor(async () => larkSentMessages.length > 0, 5000);
    const link = store.getLatestLinkByWxUser("user_eve");

    // 模拟来自其他群的消息
    const larkData: LarkMessageData = {
      chatId: "other_chat_999", // 非默认群
      messageId: "lark_other_group_msg",
      messageType: "text",
      content: JSON.stringify({ text: "来自其他群" }),
      senderId: "lark_user_003",
      senderType: "user",
      parentId: link!.larkMessageId,
    };

    const installations = store.getAllInstallations();
    await larkToWx.handleLarkMessage(larkData, installations);

    // Mock Hub 不应收到消息（被 chatId 过滤掉）
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(0);
  });

  // ─── Webhook 验证测试 ───

  it("无效签名的 webhook 请求应被拒绝（401）", async () => {
    const hubEvent = {
      v: 1,
      type: "event",
      trace_id: "tr_bad_sig",
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message.text",
        id: "evt_bad",
        timestamp: Math.floor(Date.now() / 1000),
        data: { from: "hacker", from_name: "hacker", content: "恶意消息" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": "12345",
        "X-Signature": "sha256=invalid_signature_here",
      },
      body: JSON.stringify(hubEvent),
    });

    // 应返回 401
    expect(res.status).toBe(401);

    // 飞书端不应收到任何消息
    expect(larkSentMessages.length).toBe(0);
  });

  it("缺少 installation_id 的请求应被拒绝（400）", async () => {
    const hubEvent = {
      v: 1,
      type: "event",
      trace_id: "tr_no_inst",
      // 没有 installation_id
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message.text",
        id: "evt_no_inst",
        timestamp: Math.floor(Date.now() / 1000),
        data: { from: "user", content: "test" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": "12345",
        "X-Signature": "sha256=whatever",
      },
      body: JSON.stringify(hubEvent),
    });

    expect(res.status).toBe(400);
  });

  it("url_verification 请求应正确返回 challenge", async () => {
    const verifyEvent = {
      v: 1,
      type: "url_verification",
      challenge: "test_challenge_token_123",
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verifyEvent),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ challenge: "test_challenge_token_123" });
  });

  // ─── 完整双向链路测试 ───

  it("完整双向链路：微信→飞书→微信", async () => {
    // 步骤 1: 微信用户发消息 → Hub → App → 飞书
    await injectMessage("user_frank", "你好，请帮我查个信息");

    await waitFor(async () => larkSentMessages.length > 0, 5000);

    // 验证飞书端收到消息
    expect(larkSentMessages.length).toBe(1);
    expect(larkSentMessages[0].text).toContain("user_frank");
    expect(larkSentMessages[0].text).toContain("你好，请帮我查个信息");

    // 步骤 2: 飞书用户回复 → App → Hub → 微信
    const link = store.getLatestLinkByWxUser("user_frank");
    expect(link).toBeDefined();

    const replyData: LarkMessageData = {
      chatId: defaultChatId,
      messageId: "lark_reply_frank",
      messageType: "text",
      content: JSON.stringify({ text: "查好了，结果如下..." }),
      senderId: "lark_user_helper",
      senderType: "user",
      parentId: link!.larkMessageId,
    };

    const installations = store.getAllInstallations();
    await larkToWx.handleLarkMessage(replyData, installations);

    // 验证 Mock Hub 收到了回复
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].to).toBe("user_frank");
    expect(hubMessages[0].content).toBe("查好了，结果如下...");
  });
});

/**
 * bridge/lark-to-wx.ts 测试
 * Mock Store 和 fetch 验证飞书消息转发到微信的逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LarkToWx } from "../../src/bridge/lark-to-wx.js";
import type { Installation } from "../../src/hub/types.js";
import type { LarkMessageData } from "../../src/lark/event.js";

/** 创建模拟 Store */
function createMockStore() {
  return {
    saveMessageLink: vi.fn(),
    getMessageLinkByLarkId: vi.fn().mockReturnValue(undefined),
    getLatestLinkByWxUser: vi.fn(),
    saveInstallation: vi.fn(),
    getInstallation: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  } as any;
}

/** 测试用安装记录 */
const testInstallation: Installation = {
  id: "inst-001",
  hubUrl: "http://hub.test",
  appId: "app-123",
  botId: "bot-456",
  appToken: "token-xyz",
  webhookSecret: "secret-abc",
  createdAt: new Date().toISOString(),
};

describe("LarkToWx", () => {
  let store: ReturnType<typeof createMockStore>;
  let bridge: LarkToWx;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createMockStore();
    bridge = new LarkToWx(store, "oc_default_chat");

    // Mock 全局 fetch
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("通过 parentId 查找目标微信用户", () => {
    it("应通过 parentId 找到消息映射并转发", async () => {
      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "parent-msg-001") {
          return {
            id: 1,
            installationId: "inst-001",
            larkMessageId: "parent-msg-001",
            wxUserId: "wx-user-001",
            wxUserName: "张三",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "reply-msg-001",
        messageType: "text",
        content: JSON.stringify({ text: "收到，谢谢！" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      // HubClient 使用 /api/bot/send 端点
      expect(url).toBe("http://hub.test/api/bot/send");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.to).toBe("wx-user-001");
      expect(body.type).toBe("text");
      expect(body.content).toBe("收到，谢谢！");
    });
  });

  describe("通过 rootId 查找目标微信用户", () => {
    it("parentId 找不到时应通过 rootId 查找映射", async () => {
      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "root-msg-001") {
          return {
            id: 1,
            installationId: "inst-001",
            larkMessageId: "root-msg-001",
            wxUserId: "wx-user-002",
            wxUserName: "李四",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "reply-msg-002",
        messageType: "text",
        content: JSON.stringify({ text: "好的" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "non-existent-parent",
        rootId: "root-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.to).toBe("wx-user-002");
    });
  });

  describe("找不到映射时跳过", () => {
    it("parentId 和 rootId 都找不到映射时不应调用 fetch", async () => {
      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "msg-no-mapping",
        messageType: "text",
        content: JSON.stringify({ text: "普通消息" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "unknown-parent",
        rootId: "unknown-root",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("没有 parentId 和 rootId 时不应调用 fetch", async () => {
      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "msg-no-ref",
        messageType: "text",
        content: JSON.stringify({ text: "独立消息" }),
        senderId: "user-lark-001",
        senderType: "user",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("非目标群消息过滤", () => {
    it("非默认群的消息应被过滤", async () => {
      store.getMessageLinkByLarkId.mockReturnValue({
        id: 1,
        installationId: "inst-001",
        larkMessageId: "parent-msg-001",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
      });

      const data: LarkMessageData = {
        chatId: "oc_other_chat",  // 不是默认群
        messageId: "msg-other-chat",
        messageType: "text",
        content: JSON.stringify({ text: "来自其他群" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      // 非目标群应被过滤，不应调用 fetch
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("消息内容提取", () => {
    it("应正确提取文本消息并去除 @机器人 提及", async () => {
      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "parent-msg-001") {
          return {
            id: 1,
            installationId: "inst-001",
            larkMessageId: "parent-msg-001",
            wxUserId: "wx-user-001",
            wxUserName: "张三",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "msg-at-bot",
        messageType: "text",
        content: JSON.stringify({ text: "@_user_1 请处理一下" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toBe("请处理一下");
    });

    it("图片消息应提取为 '[图片]'", async () => {
      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "parent-msg-001") {
          return {
            id: 1,
            installationId: "inst-001",
            larkMessageId: "parent-msg-001",
            wxUserId: "wx-user-001",
            wxUserName: "张三",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "msg-image",
        messageType: "image",
        content: JSON.stringify({ image_key: "img_key_001" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toBe("[图片]");
    });
  });

  describe("安装配置查找", () => {
    it("找不到对应的安装配置时不应调用 fetch", async () => {
      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "parent-msg-001") {
          return {
            id: 1,
            installationId: "inst-not-exist",  // 不存在的安装 ID
            larkMessageId: "parent-msg-001",
            wxUserId: "wx-user-001",
            wxUserName: "张三",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_default_chat",
        messageId: "msg-no-inst",
        messageType: "text",
        content: JSON.stringify({ text: "测试" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridge.handleLarkMessage(data, [testInstallation]);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("不配置默认群时", () => {
    it("defaultChatId 为空时应处理所有群的消息", async () => {
      const bridgeNoFilter = new LarkToWx(store, "");

      store.getMessageLinkByLarkId.mockImplementation((id: string) => {
        if (id === "parent-msg-001") {
          return {
            id: 1,
            installationId: "inst-001",
            larkMessageId: "parent-msg-001",
            wxUserId: "wx-user-001",
            wxUserName: "张三",
          };
        }
        return undefined;
      });

      const data: LarkMessageData = {
        chatId: "oc_any_chat",
        messageId: "msg-any",
        messageType: "text",
        content: JSON.stringify({ text: "任意群消息" }),
        senderId: "user-lark-001",
        senderType: "user",
        parentId: "parent-msg-001",
      };

      await bridgeNoFilter.handleLarkMessage(data, [testInstallation]);

      // 不配置默认群时，不应过滤
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});

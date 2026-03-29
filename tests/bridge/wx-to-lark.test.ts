/**
 * bridge/wx-to-lark.ts 测试
 * Mock LarkClient 和 Store 验证微信消息转发到飞书的逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WxToLark } from "../../src/bridge/wx-to-lark.js";
import type { HubEvent, Installation } from "../../src/hub/types.js";

/** 创建模拟 LarkClient */
function createMockLarkClient() {
  return {
    sendText: vi.fn().mockResolvedValue("lark-msg-001"),
    sendImage: vi.fn().mockResolvedValue("lark-msg-002"),
    sendFile: vi.fn().mockResolvedValue("lark-msg-003"),
    replyText: vi.fn().mockResolvedValue("lark-msg-004"),
    sdk: {},
  } as any;
}

/** 创建模拟 Store */
function createMockStore() {
  return {
    saveMessageLink: vi.fn(),
    getMessageLinkByLarkId: vi.fn(),
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

/** 构建 HubEvent */
function makeEvent(type: string, data: Record<string, any>): HubEvent {
  return {
    v: 1,
    type: "event",
    trace_id: "trace-001",
    installation_id: "inst-001",
    bot: { id: "bot-456" },
    event: {
      type,
      id: "evt-001",
      timestamp: 1700000000,
      data,
    },
  };
}

describe("WxToLark", () => {
  let larkClient: ReturnType<typeof createMockLarkClient>;
  let store: ReturnType<typeof createMockStore>;
  let bridge: WxToLark;

  beforeEach(() => {
    larkClient = createMockLarkClient();
    store = createMockStore();
    bridge = new WxToLark(larkClient, store, "oc_default_chat");
  });

  describe("文本消息转发", () => {
    it("应以 '[微信] xxx: 消息内容' 格式发送到飞书", async () => {
      const event = makeEvent("message.text", {
        from: "wx-user-001",
        from_name: "张三",
        content: "你好，世界",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledWith(
        "oc_default_chat",
        "[微信] 张三: 你好，世界",
      );
    });

    it("应保存消息映射关系", async () => {
      const event = makeEvent("message.text", {
        from: "wx-user-001",
        from_name: "张三",
        content: "测试消息",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(store.saveMessageLink).toHaveBeenCalledWith({
        installationId: "inst-001",
        larkMessageId: "lark-msg-001",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
      });
    });
  });

  describe("图片消息", () => {
    it("应发送 '[发送了图片]' 提示文本", async () => {
      const event = makeEvent("message.image", {
        from: "wx-user-001",
        from_name: "李四",
        content: "image_data",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledWith(
        "oc_default_chat",
        "[微信] 李四: [发送了图片]",
      );
    });
  });

  describe("语音消息", () => {
    it("应发送 '[语音消息]' 提示文本", async () => {
      const event = makeEvent("message.voice", {
        from: "wx-user-001",
        from_name: "王五",
        content: "voice_data",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledWith(
        "oc_default_chat",
        "[微信] 王五: [语音消息]",
      );
    });
  });

  describe("视频消息", () => {
    it("应发送 '[视频消息]' 提示文本", async () => {
      const event = makeEvent("message.video", {
        from: "wx-user-001",
        from_name: "赵六",
        content: "video_data",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledWith(
        "oc_default_chat",
        "[微信] 赵六: [视频消息]",
      );
    });
  });

  describe("文件消息", () => {
    it("应发送 '[文件: 文件名]' 提示文本", async () => {
      const event = makeEvent("message.file", {
        from: "wx-user-001",
        from_name: "孙七",
        file_name: "报告.docx",
        content: "file_data",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledWith(
        "oc_default_chat",
        "[微信] 孙七: [文件: 报告.docx]",
      );
    });
  });

  describe("command 类型", () => {
    it("command 事件应被跳过，不发送也不保存映射", async () => {
      const event = makeEvent("command", {
        command: "test",
        args: {},
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).not.toHaveBeenCalled();
      expect(store.saveMessageLink).not.toHaveBeenCalled();
    });
  });

  describe("未知消息类型", () => {
    it("不支持的事件类型应发送占位提示", async () => {
      const event = makeEvent("message.location", {
        from: "wx-user-001",
        from_name: "测试",
      });

      await bridge.handleWxEvent(event, testInstallation);

      expect(larkClient.sendText).toHaveBeenCalledOnce();
      const text = larkClient.sendText.mock.calls[0][1];
      expect(text).toContain("[微信]");
      expect(text).toContain("message.location");
    });
  });

  describe("异常处理", () => {
    it("LarkClient 发送失败时不应保存映射", async () => {
      larkClient.sendText.mockRejectedValueOnce(new Error("发送失败"));

      const event = makeEvent("message.text", {
        from: "wx-user-001",
        from_name: "张三",
        content: "测试",
      });

      // 不应抛出异常（内部 try-catch）
      await bridge.handleWxEvent(event, testInstallation);

      expect(store.saveMessageLink).not.toHaveBeenCalled();
    });

    it("from 为空时不应保存映射", async () => {
      larkClient.sendText.mockResolvedValueOnce("lark-msg-001");

      const event = makeEvent("message.text", {
        from: "",
        from_name: "匿名",
        content: "测试",
      });

      await bridge.handleWxEvent(event, testInstallation);

      // sendText 会被调用，但不保存映射（fromUserId 为空）
      expect(larkClient.sendText).toHaveBeenCalled();
      expect(store.saveMessageLink).not.toHaveBeenCalled();
    });
  });
});

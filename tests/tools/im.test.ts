/**
 * tools/im.ts 测试
 * Mock lark.Client 验证 IM 工具的 handler 和定义
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { imTools } from "../../src/tools/im.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    im: {
      message: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { message_id: "msg-created-001" },
        }),
        reply: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { message_id: "msg-replied-001" },
        }),
        list: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            items: [
              {
                sender: { id: "user-001" },
                create_time: "1700000000",
                body: { content: JSON.stringify({ text: "你好" }) },
              },
              {
                sender: { id: "user-002" },
                create_time: "1700000100",
                body: { content: JSON.stringify({ text: "你好啊" }) },
              },
            ],
          },
        }),
      },
      chat: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { chat_id: "oc_new_chat_001" },
        }),
        search: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { items: [] },
        }),
        get: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            name: "测试群",
            description: "测试描述",
            owner_id: "owner-001",
            user_count: 5,
          },
        }),
      },
    },
  } as any;
}

/** 创建测试用 ToolContext */
function makeCtx(args: Record<string, any>): ToolContext {
  return {
    installationId: "inst-001",
    botId: "bot-456",
    userId: "user-001",
    traceId: "trace-001",
    args,
  };
}

describe("imTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有 IM 相关工具定义", () => {
      const { definitions } = imTools;
      const names = definitions.map((d) => d.name);

      expect(names).toContain("send_lark_message");
      expect(names).toContain("reply_lark_message");
      expect(names).toContain("list_chat_messages");
      expect(names).toContain("search_messages");
      expect(names).toContain("create_chat");
      expect(names).toContain("search_chat");
      expect(names).toContain("get_chat_info");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of imTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("send_lark_message 应要求 text 为必填参数", () => {
      const sendDef = imTools.definitions.find((d) => d.name === "send_lark_message");
      expect(sendDef?.parameters?.required).toContain("text");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = imTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of imTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("send_lark_message", () => {
      it("提供 chat_id 时应发送群聊消息", async () => {
        const handler = handlers.get("send_lark_message")!;
        const result = await handler(makeCtx({ chat_id: "oc_123", text: "你好" }));

        expect(client.im.message.create).toHaveBeenCalledOnce();
        const callArgs = client.im.message.create.mock.calls[0][0];
        expect(callArgs.params.receive_id_type).toBe("chat_id");
        expect(callArgs.data.receive_id).toBe("oc_123");
        expect(result).toContain("msg-created-001");
      });

      it("提供 user_id 时应发送私聊消息", async () => {
        const handler = handlers.get("send_lark_message")!;
        const result = await handler(makeCtx({ user_id: "ou_user123", text: "私聊你好" }));

        const callArgs = client.im.message.create.mock.calls[0][0];
        expect(callArgs.params.receive_id_type).toBe("open_id");
        expect(callArgs.data.receive_id).toBe("ou_user123");
      });

      it("chat_id 和 user_id 都不提供时应返回错误", async () => {
        const handler = handlers.get("send_lark_message")!;
        const result = await handler(makeCtx({ text: "缺少目标" }));

        expect(result).toContain("错误");
        expect(client.im.message.create).not.toHaveBeenCalled();
      });

      it("SDK 返回非 0 code 时应返回失败消息", async () => {
        client.im.message.create.mockResolvedValueOnce({
          code: 99999,
          msg: "权限不足",
          data: null,
        });

        const handler = handlers.get("send_lark_message")!;
        const result = await handler(makeCtx({ chat_id: "oc_123", text: "测试" }));

        expect(result).toContain("发送失败");
        expect(result).toContain("权限不足");
      });
    });

    describe("list_chat_messages", () => {
      it("应返回格式化的消息列表", async () => {
        const handler = handlers.get("list_chat_messages")!;
        const result = await handler(makeCtx({ chat_id: "oc_123" }));

        expect(client.im.message.list).toHaveBeenCalledOnce();
        expect(result).toContain("群聊消息");
        expect(result).toContain("2");  // 共 2 条
      });

      it("无消息时应返回提示", async () => {
        client.im.message.list.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { items: [] },
        });

        const handler = handlers.get("list_chat_messages")!;
        const result = await handler(makeCtx({ chat_id: "oc_empty" }));

        expect(result).toContain("暂无消息");
      });

      it("应限制最大请求数量为 50", async () => {
        const handler = handlers.get("list_chat_messages")!;
        await handler(makeCtx({ chat_id: "oc_123", count: 100 }));

        const callArgs = client.im.message.list.mock.calls[0][0];
        expect(callArgs.params.page_size).toBe(50);
      });
    });

    describe("reply_lark_message", () => {
      it("应调用 reply API 并返回结果", async () => {
        const handler = handlers.get("reply_lark_message")!;
        const result = await handler(makeCtx({ message_id: "msg-001", text: "回复内容" }));

        expect(client.im.message.reply).toHaveBeenCalledOnce();
        const callArgs = client.im.message.reply.mock.calls[0][0];
        expect(callArgs.path.message_id).toBe("msg-001");
        expect(result).toContain("msg-replied-001");
      });
    });
  });
});

/**
 * router.ts 测试
 * 验证命令路由分发逻辑
 */
import { describe, it, expect, vi } from "vitest";
import { Router } from "../src/router.js";
import type { HubEvent, Installation, ToolHandler } from "../src/hub/types.js";

/** 创建模拟 HubClient */
function createMockHubClient() {
  return {
    sendText: vi.fn(),
    sendImage: vi.fn(),
    sendFile: vi.fn(),
    sendMessage: vi.fn(),
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

/** 构建 command 类型的 HubEvent */
function makeCommandEvent(command: string, args: Record<string, any> = {}): HubEvent {
  return {
    v: 1,
    type: "event",
    trace_id: "trace-001",
    installation_id: "inst-001",
    bot: { id: "bot-456" },
    event: {
      type: "command",
      id: "evt-001",
      timestamp: 1700000000,
      data: {
        command,
        args,
        user_id: "user-001",
      },
    },
  };
}

describe("Router", () => {
  describe("命令路由分发", () => {
    it("应正确路由到已注册的 handler", async () => {
      const handler: ToolHandler = vi.fn().mockResolvedValue("执行成功");
      const handlers = new Map<string, ToolHandler>();
      handlers.set("test_command", handler);

      const router = new Router(handlers);
      const hubClient = createMockHubClient();
      const event = makeCommandEvent("test_command", { key: "value" });

      const result = await router.handleCommand(event, testInstallation, hubClient);

      expect(handler).toHaveBeenCalledOnce();
      expect(result).toBe("执行成功");

      // 验证 ToolContext 参数
      const ctx = (handler as any).mock.calls[0][0];
      expect(ctx.installationId).toBe("inst-001");
      expect(ctx.botId).toBe("bot-456");
      expect(ctx.traceId).toBe("trace-001");
      expect(ctx.args).toEqual({ key: "value" });
    });

    it("应支持带 / 前缀的命令名", async () => {
      const handler: ToolHandler = vi.fn().mockResolvedValue("带前缀的命令");
      const handlers = new Map<string, ToolHandler>();
      handlers.set("my_tool", handler);

      const router = new Router(handlers);
      const event = makeCommandEvent("/my_tool");

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());

      expect(handler).toHaveBeenCalledOnce();
      expect(result).toBe("带前缀的命令");
    });
  });

  describe("未知命令", () => {
    it("未注册的命令应返回错误提示", async () => {
      const handlers = new Map<string, ToolHandler>();
      const router = new Router(handlers);
      const event = makeCommandEvent("unknown_command");

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());

      expect(result).toContain("未知命令");
      expect(result).toContain("unknown_command");
    });

    it("空命令名应返回 null", async () => {
      const handlers = new Map<string, ToolHandler>();
      const router = new Router(handlers);

      const event: HubEvent = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "inst-001",
        bot: { id: "bot-456" },
        event: {
          type: "command",
          id: "evt-001",
          timestamp: 1700000000,
          data: {}, // 没有 command 字段
        },
      };

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());
      expect(result).toBeNull();
    });
  });

  describe("handler 执行结果", () => {
    it("handler 返回字符串时应原样返回", async () => {
      const handler: ToolHandler = vi.fn().mockResolvedValue("自定义结果消息");
      const handlers = new Map<string, ToolHandler>();
      handlers.set("result_test", handler);

      const router = new Router(handlers);
      const event = makeCommandEvent("result_test");

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());
      expect(result).toBe("自定义结果消息");
    });

    it("handler 抛出异常时应返回错误消息", async () => {
      const handler: ToolHandler = vi.fn().mockRejectedValue(new Error("处理出错了"));
      const handlers = new Map<string, ToolHandler>();
      handlers.set("error_test", handler);

      const router = new Router(handlers);
      const event = makeCommandEvent("error_test");

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());
      expect(result).toContain("命令执行失败");
      expect(result).toContain("处理出错了");
    });

    it("应支持从 data.name 读取命令名（兼容 AI tool call 格式）", async () => {
      const handler: ToolHandler = vi.fn().mockResolvedValue("OK");
      const handlers = new Map<string, ToolHandler>();
      handlers.set("ai_tool", handler);

      const router = new Router(handlers);
      const event: HubEvent = {
        v: 1,
        type: "event",
        trace_id: "trace-002",
        installation_id: "inst-001",
        bot: { id: "bot-456" },
        event: {
          type: "command",
          id: "evt-002",
          timestamp: 1700000000,
          data: {
            name: "ai_tool",          // 使用 name 而不是 command
            parameters: { foo: "bar" }, // 使用 parameters 而不是 args
          },
        },
      };

      const result = await router.handleCommand(event, testInstallation, createMockHubClient());
      expect(handler).toHaveBeenCalledOnce();
      expect(result).toBe("OK");

      // 验证 args 从 parameters 字段读取
      const ctx = (handler as any).mock.calls[0][0];
      expect(ctx.args).toEqual({ foo: "bar" });
    });
  });
});

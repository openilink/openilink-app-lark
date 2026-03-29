/**
 * tools/contact.ts 测试
 * Mock lark.Client 验证通讯录工具的 handler 和定义
 *
 * 注意: 源码中姓名搜索不调用 API，直接返回提示（需要 user_access_token）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { contactTools } from "../../src/tools/contact.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    contact: {
      user: {
        batchGetId: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            user_list: [
              { user_id: "ou_user_001" },
              { user_id: "ou_user_002" },
            ],
          },
        }),
        get: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            user: {
              name: "张三",
              open_id: "ou_zhangsan",
              email: "zhangsan@test.com",
              mobile: "+8613800138000",
              job_title: "工程师",
              department_ids: ["dep-001", "dep-002"],
              status: { is_activated: true },
            },
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

describe("contactTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有通讯录相关工具定义", () => {
      const { definitions } = contactTools;
      const names = definitions.map((d) => d.name);

      expect(names).toContain("search_contact");
      expect(names).toContain("get_user_info");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of contactTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("search_contact 应要求 query 为必填参数", () => {
      const def = contactTools.definitions.find((d) => d.name === "search_contact");
      expect(def?.parameters?.required).toContain("query");
    });

    it("get_user_info 应要求 user_id 为必填参数", () => {
      const def = contactTools.definitions.find((d) => d.name === "get_user_info");
      expect(def?.parameters?.required).toContain("user_id");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = contactTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of contactTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("search_contact", () => {
      it("通过邮箱搜索时应调用 batchGetId", async () => {
        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "zhangsan@test.com" }));

        expect(client.contact.user.batchGetId).toHaveBeenCalledOnce();
        const callArgs = client.contact.user.batchGetId.mock.calls[0][0];
        expect(callArgs.data.emails).toContain("zhangsan@test.com");
        expect(result).toContain("ou_user_001");
      });

      it("通过手机号搜索时应调用 batchGetId", async () => {
        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "+8613800138000" }));

        expect(client.contact.user.batchGetId).toHaveBeenCalledOnce();
        const callArgs = client.contact.user.batchGetId.mock.calls[0][0];
        expect(callArgs.data.mobiles).toContain("+8613800138000");
        expect(result).toContain("ou_user_001");
      });

      it("通过姓名搜索时应返回暂不支持提示", async () => {
        // 源码中姓名搜索直接返回提示，不调用 API
        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "张三" }));

        // 不应调用 batchGetId（因为不是邮箱也不是手机号）
        expect(client.contact.user.batchGetId).not.toHaveBeenCalled();
        // 应返回提示信息
        expect(result).toContain("user_access_token");
      });

      it("邮箱搜索无结果时应返回提示", async () => {
        client.contact.user.batchGetId.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { user_list: [] },
        });

        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "nobody@test.com" }));

        expect(result).toContain("未找到");
      });

      it("SDK 返回非 0 code 时应返回错误信息（邮箱搜索）", async () => {
        client.contact.user.batchGetId.mockResolvedValueOnce({
          code: 40003,
          msg: "权限不足",
          data: null,
        });

        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "user@test.com" }));

        expect(result).toContain("搜索联系人失败");
        expect(result).toContain("权限不足");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.contact.user.batchGetId.mockRejectedValueOnce(new Error("网络错误"));

        const handler = handlers.get("search_contact")!;
        const result = await handler(makeCtx({ query: "user@test.com" }));

        expect(result).toContain("搜索联系人出错");
        expect(result).toContain("网络错误");
      });
    });

    describe("get_user_info", () => {
      it("应调用 SDK 获取用户信息并返回格式化结果", async () => {
        const handler = handlers.get("get_user_info")!;
        const result = await handler(makeCtx({ user_id: "ou_zhangsan" }));

        expect(client.contact.user.get).toHaveBeenCalledOnce();
        const callArgs = client.contact.user.get.mock.calls[0][0];
        expect(callArgs.path.user_id).toBe("ou_zhangsan");

        expect(result).toContain("张三");
        expect(result).toContain("zhangsan@test.com");
        expect(result).toContain("+8613800138000");
        expect(result).toContain("工程师");
        expect(result).toContain("已激活");
      });

      it("用户不存在时应返回提示", async () => {
        client.contact.user.get.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { user: null },
        });

        const handler = handlers.get("get_user_info")!;
        const result = await handler(makeCtx({ user_id: "ou_invalid" }));

        expect(result).toContain("未找到该用户");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.contact.user.get.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
          data: null,
        });

        const handler = handlers.get("get_user_info")!;
        const result = await handler(makeCtx({ user_id: "ou_user" }));

        expect(result).toContain("获取用户信息失败");
        expect(result).toContain("无权限");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.contact.user.get.mockRejectedValueOnce(new Error("服务不可用"));

        const handler = handlers.get("get_user_info")!;
        const result = await handler(makeCtx({ user_id: "ou_user" }));

        expect(result).toContain("获取用户信息出错");
        expect(result).toContain("服务不可用");
      });
    });
  });
});

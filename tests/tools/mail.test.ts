/**
 * tools/mail.ts 测试
 * Mock lark.Client 验证邮箱工具的 handler 和定义
 *
 * 注意: 源码中邮箱 API 使用可选链调用，不可用时返回 "邮箱 API 不可用"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mailTools } from "../../src/tools/mail.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    mail: {
      userMailboxMessage: {
        list: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            items: [
              {
                subject: "周会通知",
                from: { email_address: "admin@test.com" },
                date: "2024-06-01",
              },
              {
                subject: "项目更新",
                from: { email_address: "pm@test.com" },
                date: "2024-06-02",
              },
            ],
          },
        }),
        create: vi.fn().mockResolvedValue({
          code: 0,
          data: {},
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

describe("mailTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有邮箱相关工具定义", () => {
      const names = mailTools.definitions.map((d) => d.name);

      expect(names).toContain("list_mails");
      expect(names).toContain("send_mail");
      expect(names).toContain("search_mail");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of mailTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("send_mail 应要求 to, subject, body 为必填参数", () => {
      const def = mailTools.definitions.find((d) => d.name === "send_mail");
      expect(def?.parameters?.required).toContain("to");
      expect(def?.parameters?.required).toContain("subject");
      expect(def?.parameters?.required).toContain("body");
    });

    it("search_mail 应要求 query 为必填参数", () => {
      const def = mailTools.definitions.find((d) => d.name === "search_mail");
      expect(def?.parameters?.required).toContain("query");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = mailTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of mailTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("list_mails", () => {
      it("应调用 SDK 获取邮件列表并返回格式化结果", async () => {
        const handler = handlers.get("list_mails")!;
        const result = await handler(makeCtx({}));

        expect(client.mail.userMailboxMessage.list).toHaveBeenCalledOnce();
        expect(result).toContain("周会通知");
        expect(result).toContain("admin@test.com");
        expect(result).toContain("项目更新");
        expect(result).toContain("2");
      });

      it("无邮件时应返回提示", async () => {
        client.mail.userMailboxMessage.list.mockResolvedValueOnce({
          code: 0,
          data: { items: [] },
        });

        const handler = handlers.get("list_mails")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("暂无邮件");
      });

      it("应传递 count 参数作为 page_size", async () => {
        const handler = handlers.get("list_mails")!;
        await handler(makeCtx({ count: 5 }));

        const callArgs = client.mail.userMailboxMessage.list.mock.calls[0][0];
        expect(callArgs.params.page_size).toBe(5);
      });

      it("API 不可用时应返回提示", async () => {
        // 模拟 mail 为 undefined（API 不可用）
        const clientNoMail = {} as any;
        const handlersNoMail = mailTools.createHandlers(clientNoMail);
        const handler = handlersNoMail.get("list_mails")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("查看邮件失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.mail.userMailboxMessage.list.mockRejectedValueOnce(
          new Error("邮箱服务不可用"),
        );

        const handler = handlers.get("list_mails")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("查看邮件失败");
        expect(result).toContain("邮箱服务不可用");
      });
    });

    describe("send_mail", () => {
      it("应调用 SDK 发送邮件并返回成功提示", async () => {
        const handler = handlers.get("send_mail")!;
        const result = await handler(
          makeCtx({
            to: "recipient@test.com",
            subject: "测试邮件",
            body: "这是邮件正文",
          }),
        );

        expect(client.mail.userMailboxMessage.create).toHaveBeenCalledOnce();
        const callArgs = client.mail.userMailboxMessage.create.mock.calls[0][0];
        expect(callArgs.data.subject).toBe("测试邮件");
        expect(callArgs.data.to[0].email_address).toBe("recipient@test.com");
        expect(callArgs.data.body.content).toBe("这是邮件正文");

        expect(result).toContain("已发送");
        expect(result).toContain("recipient@test.com");
        expect(result).toContain("测试邮件");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.mail.userMailboxMessage.create.mockResolvedValueOnce({
          code: 40003,
          msg: "权限不足",
        });

        const handler = handlers.get("send_mail")!;
        const result = await handler(
          makeCtx({
            to: "user@test.com",
            subject: "测试",
            body: "内容",
          }),
        );

        expect(result).toContain("发送邮件失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.mail.userMailboxMessage.create.mockRejectedValueOnce(
          new Error("发送配额已满"),
        );

        const handler = handlers.get("send_mail")!;
        const result = await handler(
          makeCtx({
            to: "user@test.com",
            subject: "测试",
            body: "内容",
          }),
        );

        expect(result).toContain("发送邮件失败");
        expect(result).toContain("发送配额已满");
      });
    });

    describe("search_mail", () => {
      it("应调用 SDK 搜索邮件并返回格式化结果", async () => {
        const handler = handlers.get("search_mail")!;
        const result = await handler(makeCtx({ query: "周会" }));

        expect(client.mail.userMailboxMessage.list).toHaveBeenCalled();
        const callArgs = client.mail.userMailboxMessage.list.mock.calls[0][0];
        expect(callArgs.params.search_key).toBe("周会");

        expect(result).toContain("2");
        expect(result).toContain("周会通知");
      });

      it("无搜索结果时应返回提示", async () => {
        client.mail.userMailboxMessage.list.mockResolvedValueOnce({
          code: 0,
          data: { items: [] },
        });

        const handler = handlers.get("search_mail")!;
        const result = await handler(makeCtx({ query: "不存在的邮件" }));

        expect(result).toContain("未找到");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.mail.userMailboxMessage.list.mockRejectedValueOnce(
          new Error("搜索超时"),
        );

        const handler = handlers.get("search_mail")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("搜索邮件失败");
        expect(result).toContain("搜索超时");
      });
    });
  });
});

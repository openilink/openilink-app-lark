/**
 * 邮箱 Tools
 * 提供飞书邮箱查看、发送、搜索邮件能力
 * 注意: SDK 中邮箱 API 路径不确定，当前使用 (client as any) 调用
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 邮箱模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "list_mails",
    description: "查看飞书邮箱中的最新邮件",
    command: "list_mails",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "返回邮件数量，默认 10" },
      },
    },
  },
  {
    name: "send_mail",
    description: "通过飞书邮箱发送邮件",
    command: "send_mail",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "收件人邮箱地址" },
        subject: { type: "string", description: "邮件主题" },
        body: { type: "string", description: "邮件正文内容" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "search_mail",
    description: "搜索飞书邮箱中的邮件",
    command: "search_mail",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
      },
      required: ["query"],
    },
  },
];

/** 创建邮箱模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 查看邮件
  // TODO: 待确认 SDK API 路径，当前为推测。可能是 client.mail.userMailboxMessage 或 client.mail.mailbox.message
  handlers.set("list_mails", async (ctx) => {
    const count: number = ctx.args.count ?? 10;

    try {
      const res = await (client as any).mail?.userMailboxMessage?.list?.({
        params: { page_size: count },
      });

      if (!res || res.code !== 0) {
        return `查看邮件失败: ${res?.msg || "邮箱 API 不可用，请确认权限配置"}`;
      }

      const messages = res?.data?.items ?? [];
      if (messages.length === 0) {
        return "邮箱中暂无邮件";
      }

      const lines = messages.map((m: any, i: number) => {
        const subject = m.subject ?? "（无主题）";
        const from = m.from?.email_address ?? "未知发件人";
        const date = m.date ?? "未知时间";
        return `${i + 1}. [${date}] ${from}: ${subject}`;
      });
      return `最新 ${messages.length} 封邮件:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `查看邮件失败: ${err.message ?? err}`;
    }
  });

  // 发送邮件
  // TODO: 待确认 SDK API 路径，当前为推测
  handlers.set("send_mail", async (ctx) => {
    const to: string = ctx.args.to ?? "";
    const subject: string = ctx.args.subject ?? "";
    const body: string = ctx.args.body ?? "";

    try {
      const res = await (client as any).mail?.userMailboxMessage?.create?.({
        data: {
          subject,
          body: {
            content: body,
          },
          to: [{ email_address: to }],
        },
      });

      if (!res || res.code !== 0) {
        return `发送邮件失败: ${res?.msg || "邮箱 API 不可用，请确认权限配置"}`;
      }

      return `邮件已发送至 ${to}，主题: ${subject}`;
    } catch (err: any) {
      return `发送邮件失败: ${err.message ?? err}`;
    }
  });

  // 搜索邮件
  // TODO: 待确认 SDK API 路径，当前为推测
  handlers.set("search_mail", async (ctx) => {
    const query: string = ctx.args.query ?? "";

    try {
      const res = await (client as any).mail?.userMailboxMessage?.list?.({
        params: { search_key: query },
      });

      if (!res || res.code !== 0) {
        return `搜索邮件失败: ${res?.msg || "邮箱 API 不可用，请确认权限配置"}`;
      }

      const messages = res?.data?.items ?? [];
      if (messages.length === 0) {
        return `未找到与"${query}"相关的邮件`;
      }

      const lines = messages.map((m: any, i: number) => {
        const subject = m.subject ?? "（无主题）";
        const from = m.from?.email_address ?? "未知发件人";
        const date = m.date ?? "未知时间";
        return `${i + 1}. [${date}] ${from}: ${subject}`;
      });
      return `搜索到 ${messages.length} 封相关邮件:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `搜索邮件失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 邮箱 Tool 模块 */
export const mailTools: ToolModule = { definitions, createHandlers };

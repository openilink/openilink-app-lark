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
        user_mailbox_id: {
          type: "string",
          description: "用户邮箱 ID，默认 'me'（可选）",
        },
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
        user_mailbox_id: {
          type: "string",
          description: "用户邮箱 ID，默认 'me'（可选）",
        },
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

  // 查看邮件 - 添加必填的 path.user_mailbox_id 和 params.folder_id
  handlers.set("list_mails", async (ctx) => {
    const count: number = ctx.args.count ?? 10;
    const userMailboxId: string = ctx.args.user_mailbox_id ?? "me";

    try {
      const res = await (client as any).mail?.userMailboxMessage?.list?.({
        path: { user_mailbox_id: userMailboxId },
        params: {
          page_size: count,
          folder_id: "INBOX", // 收件箱文件夹
        },
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

  // 发送邮件 - 使用 send 方法而非 create
  handlers.set("send_mail", async (ctx) => {
    const to: string = ctx.args.to ?? "";
    const subject: string = ctx.args.subject ?? "";
    const body: string = ctx.args.body ?? "";
    const userMailboxId: string = ctx.args.user_mailbox_id ?? "me";

    try {
      // 尝试使用 send 方法发送邮件
      const sendFn = (client as any).mail?.userMailboxMessage?.send;
      if (typeof sendFn === "function") {
        const res = await sendFn({
          path: { user_mailbox_id: userMailboxId },
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
      }

      // send 方法不可用时返回提示
      return "邮件发送功能当前不可用。飞书邮箱发送 API 在当前 SDK 版本中可能未直接暴露，请通过飞书客户端发送邮件。";
    } catch (err: any) {
      return `发送邮件失败: ${err.message ?? err}`;
    }
  });

  // 搜索邮件
  // 邮件搜索功能依赖特定 API，当前 SDK 可能不直接支持
  handlers.set("search_mail", async (ctx) => {
    const { query } = ctx.args;
    return `邮件搜索功能当前暂不支持。飞书邮箱搜索需要使用专用搜索 API，当前 SDK 未直接暴露该接口。请通过飞书客户端搜索关键词"${query}"。`;
  });

  return handlers;
}

/** 邮箱 Tool 模块 */
export const mailTools: ToolModule = { definitions, createHandlers };

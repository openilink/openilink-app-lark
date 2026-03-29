/**
 * IM 即时通讯 Tools
 * 提供飞书消息发送、回复、搜索、群聊管理等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** IM 模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "send_lark_message",
    description: "发送飞书消息到群聊或私聊",
    command: "send_lark_message",
    parameters: {
      type: "object",
      properties: {
        chat_id: { type: "string", description: "群聊 ID，与 user_id 二选一" },
        text: { type: "string", description: "消息内容" },
        user_id: {
          type: "string",
          description: "用户 open_id，与 chat_id 二选一，用于私聊",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "reply_lark_message",
    description: "回复飞书消息",
    command: "reply_lark_message",
    parameters: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "要回复的消息 ID" },
        text: { type: "string", description: "回复内容" },
      },
      required: ["message_id", "text"],
    },
  },
  {
    name: "list_chat_messages",
    description: "查看群聊的消息列表",
    command: "list_chat_messages",
    parameters: {
      type: "object",
      properties: {
        chat_id: { type: "string", description: "群聊 ID" },
        count: { type: "number", description: "获取消息数量，默认 20" },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "search_messages",
    description:
      "搜索飞书消息（注意：该功能需要 user_access_token，当前环境下可能不支持）",
    command: "search_messages",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        chat_id: { type: "string", description: "限定群聊范围（可选）" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_chat",
    description: "创建飞书群聊",
    command: "create_chat",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "群聊名称" },
        user_ids: {
          type: "string",
          description: "逗号分隔的用户 ID，邀请入群",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_chat",
    description: "搜索飞书群聊（按关键词匹配群名称）",
    command: "search_chat",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_chat_info",
    description: "获取群聊详细信息",
    command: "get_chat_info",
    parameters: {
      type: "object",
      properties: {
        chat_id: { type: "string", description: "群聊 ID" },
      },
      required: ["chat_id"],
    },
  },
];

/** 创建 IM 模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 发送飞书消息
  handlers.set("send_lark_message", async (ctx) => {
    try {
      const { chat_id, text, user_id } = ctx.args;
      if (!chat_id && !user_id) {
        return "错误: chat_id 和 user_id 必须提供其中一个";
      }

      // 根据目标类型确定 receive_id_type 和 receive_id
      const receiveIdType = user_id ? "open_id" : "chat_id";
      const receiveId = user_id || chat_id;

      const resp = await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });

      if (resp.code !== 0) {
        return `发送失败: ${resp.msg}`;
      }

      return `消息已发送，消息 ID: ${resp.data?.message_id}`;
    } catch (err: any) {
      return `发送消息出错: ${err.message || err}`;
    }
  });

  // 回复飞书消息
  handlers.set("reply_lark_message", async (ctx) => {
    try {
      const { message_id, text } = ctx.args;
      const resp = await client.im.message.reply({
        path: { message_id },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });

      if (resp.code !== 0) {
        return `回复失败: ${resp.msg}`;
      }

      return `消息已回复，消息 ID: ${resp.data?.message_id}`;
    } catch (err: any) {
      return `回复消息出错: ${err.message || err}`;
    }
  });

  // 查看群聊消息
  handlers.set("list_chat_messages", async (ctx) => {
    try {
      const { chat_id, count = 20 } = ctx.args;
      const resp = await client.im.message.list({
        params: {
          container_id_type: "chat",
          container_id: chat_id,
          page_size: Math.min(count, 50),
        },
      });

      if (resp.code !== 0) {
        return `获取消息失败: ${resp.msg}`;
      }

      const items = resp.data?.items ?? [];
      if (items.length === 0) {
        return "该群聊暂无消息";
      }

      // 格式化消息列表
      const lines = items.map((msg: any, i: number) => {
        const sender = msg.sender?.id || "未知";
        const time = msg.create_time
          ? new Date(Number(msg.create_time) * 1000).toLocaleString("zh-CN")
          : "未知时间";
        let content = "（非文本消息）";
        try {
          const body = JSON.parse(msg.body?.content || "{}");
          content = body.text || content;
        } catch {
          // 非文本消息忽略解析错误
        }
        return `${i + 1}. [${time}] ${sender}: ${content}`;
      });

      return `群聊消息（共 ${items.length} 条）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `获取群聊消息出错: ${err.message || err}`;
    }
  });

  // 搜索消息
  // 飞书 Node SDK 没有 im.message.search 接口，消息搜索需要 user_access_token，当前不支持
  handlers.set("search_messages", async (ctx) => {
    try {
      const { query, chat_id } = ctx.args;

      // 如果提供了 chat_id，可以通过 im.message.list 获取消息后本地过滤
      if (chat_id) {
        const resp = await client.im.message.list({
          params: {
            container_id_type: "chat",
            container_id: chat_id,
            page_size: 50,
          },
        });

        if (resp.code !== 0) {
          return `搜索失败: ${resp.msg}`;
        }

        const items = resp.data?.items ?? [];
        // 在本地过滤匹配关键词的消息
        const matched = items.filter((msg: any) => {
          try {
            const body = JSON.parse(msg.body?.content || "{}");
            return body.text?.includes(query);
          } catch {
            return false;
          }
        });

        if (matched.length === 0) {
          return `在该群聊中未找到包含"${query}"的消息`;
        }

        const lines = matched.map((msg: any, i: number) => {
          let content = "（内容不可读）";
          try {
            const body = JSON.parse(msg.body?.content || "{}");
            content = body.text || content;
          } catch {
            // 忽略解析错误
          }
          return `${i + 1}. ${content}`;
        });

        return `在群聊中搜索"${query}"的结果（共 ${matched.length} 条）:\n${lines.join("\n")}`;
      }

      // 未指定 chat_id 时，全局消息搜索需要 user_access_token，当前不支持
      return `消息搜索功能需要 user_access_token 授权，当前环境暂不支持全局消息搜索。请提供 chat_id 参数以在指定群聊中搜索消息。`;
    } catch (err: any) {
      return `搜索消息出错: ${err.message || err}`;
    }
  });

  // 创建群聊
  handlers.set("create_chat", async (ctx) => {
    try {
      const { name, user_ids } = ctx.args;
      const data: any = { name };

      if (user_ids) {
        const ids = user_ids
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
        data.user_id_list = ids;
      }

      const resp = await client.im.chat.create({
        params: { user_id_type: "open_id" },
        data,
      });

      if (resp.code !== 0) {
        return `创建群聊失败: ${resp.msg}`;
      }

      return `群聊"${name}"创建成功，群聊 ID: ${resp.data?.chat_id}`;
    } catch (err: any) {
      return `创建群聊出错: ${err.message || err}`;
    }
  });

  // 搜索群聊
  // SDK 中 im.chat.search 可能不存在，尝试使用 im.chat.list 配合关键词过滤
  handlers.set("search_chat", async (ctx) => {
    try {
      const { query } = ctx.args;

      // 优先尝试 im.chat.search（部分 SDK 版本支持）
      try {
        const resp = await (client.im.chat as any).search({
          params: { query, page_size: 20 },
        });

        if (resp && resp.code === 0) {
          const items = resp.data?.items ?? [];
          if (items.length === 0) {
            return `未找到包含"${query}"的群聊`;
          }

          const lines = items.map((chat: any, i: number) => {
            const chatName = chat.name || "未命名群聊";
            const memberCount = chat.user_count || "未知";
            return `${i + 1}. ${chatName}（${memberCount} 人） - ID: ${chat.chat_id}`;
          });

          return `搜索"${query}"的群聊结果（共 ${items.length} 个）:\n${lines.join("\n")}`;
        }
      } catch {
        // search 不可用，回退到 list
      }

      // 回退: 使用 im.chat.list 获取群聊列表，本地过滤
      const resp = await client.im.chat.list({
        params: { page_size: 100 },
      });

      if (resp.code !== 0) {
        return `搜索群聊失败: ${resp.msg}`;
      }

      const items = resp.data?.items ?? [];
      const matched = items.filter((chat: any) =>
        chat.name?.includes(query),
      );

      if (matched.length === 0) {
        return `未找到包含"${query}"的群聊`;
      }

      const lines = matched.map((chat: any, i: number) => {
        const chatName = chat.name || "未命名群聊";
        const memberCount = chat.user_count || "未知";
        return `${i + 1}. ${chatName}（${memberCount} 人） - ID: ${chat.chat_id}`;
      });

      return `搜索"${query}"的群聊结果（共 ${matched.length} 个）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `搜索群聊出错: ${err.message || err}`;
    }
  });

  // 获取群信息
  handlers.set("get_chat_info", async (ctx) => {
    try {
      const { chat_id } = ctx.args;
      const resp = await client.im.chat.get({
        path: { chat_id },
      });

      if (resp.code !== 0) {
        return `获取群信息失败: ${resp.msg}`;
      }

      const info = resp.data;
      const lines = [
        `群名称: ${info?.name || "未命名"}`,
        `群描述: ${info?.description || "无"}`,
        `群主 ID: ${info?.owner_id || "未知"}`,
        `成员数: ${info?.user_count ?? "未知"}`,
        `群聊 ID: ${chat_id}`,
      ];

      return lines.join("\n");
    } catch (err: any) {
      return `获取群信息出错: ${err.message || err}`;
    }
  });

  return handlers;
}

/** IM 即时通讯 Tool 模块 */
export const imTools: ToolModule = { definitions, createHandlers };

/**
 * 通讯录 Tools
 * 提供飞书联系人搜索、用户详情查询等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 通讯录模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "search_contact",
    description:
      "搜索飞书联系人。支持通过邮箱或手机号精确搜索，姓名搜索需要 user_access_token 可能不支持",
    command: "search_contact",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词（姓名/邮箱/手机号）",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_user_info",
    description: "获取飞书用户详细信息",
    command: "get_user_info",
    parameters: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "用户 open_id" },
      },
      required: ["user_id"],
    },
  },
];

/** 创建通讯录模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 搜索联系人
  handlers.set("search_contact", async (ctx) => {
    try {
      const { query } = ctx.args;

      // 判断查询类型：邮箱、手机号或姓名
      const isEmail = query.includes("@");
      const isPhone = /^\+?\d{7,}$/.test(query.replace(/\s/g, ""));

      if (isEmail || isPhone) {
        // 通过邮箱或手机号精确查找，使用 contact.user.batchGetId
        const data: any = {};
        if (isEmail) {
          data.emails = [query];
        } else {
          data.mobiles = [query.replace(/\s/g, "")];
        }

        const resp = await client.contact.user.batchGetId({
          params: { user_id_type: "open_id" },
          data,
        });

        if (resp.code !== 0) {
          return `搜索联系人失败: ${resp.msg}`;
        }

        const userList = resp.data?.user_list ?? [];
        if (userList.length === 0) {
          return `未找到匹配"${query}"的联系人`;
        }

        const lines = userList.map((user: any, i: number) => {
          const userId = user.user_id || "未知";
          return `${i + 1}. 用户 ID: ${userId}`;
        });

        return `搜索"${query}"的结果（共 ${userList.length} 个）:\n${lines.join("\n")}`;
      }

      // 通过姓名搜索：需要 user_access_token，当前环境可能不支持
      // 使用 batchGetId 无法做模糊搜索，返回提示信息
      return `姓名搜索需要 user_access_token 授权，当前环境暂不支持姓名模糊搜索。请使用邮箱或手机号精确搜索联系人。`;
    } catch (err: any) {
      return `搜索联系人出错: ${err.message || err}`;
    }
  });

  // 获取用户详情
  handlers.set("get_user_info", async (ctx) => {
    try {
      const { user_id } = ctx.args;
      const resp = await client.contact.user.get({
        path: { user_id },
        params: { user_id_type: "open_id" },
      });

      if (resp.code !== 0) {
        return `获取用户信息失败: ${resp.msg}`;
      }

      const user = resp.data?.user;
      if (!user) {
        return "未找到该用户";
      }

      const lines = [
        `姓名: ${user.name || "未知"}`,
        `open_id: ${user.open_id || "未知"}`,
        `邮箱: ${user.email || "未设置"}`,
        `手机: ${user.mobile || "未设置"}`,
        `职位: ${(user as any).job_title || "未设置"}`,
        `部门: ${user.department_ids?.join(", ") || "未知"}`,
        `状态: ${user.status?.is_activated ? "已激活" : "未激活"}`,
      ];

      return lines.join("\n");
    } catch (err: any) {
      return `获取用户信息出错: ${err.message || err}`;
    }
  });

  return handlers;
}

/** 通讯录 Tool 模块 */
export const contactTools: ToolModule = { definitions, createHandlers };

/**
 * 云空间 Tools
 * 提供飞书云空间文件搜索、信息获取等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 云空间模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "search_files",
    description:
      "搜索飞书云空间中的文件（注意：SDK 可能不直接支持文件搜索，会尝试通过 drive.file.list 获取）",
    command: "search_files",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        count: { type: "number", description: "返回结果数量，默认 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "upload_file",
    description:
      "上传文件到飞书云空间（当前 tool 不支持直接上传文件内容，仅返回操作指引）",
    command: "upload_file",
    parameters: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "文件名称" },
        parent_token: {
          type: "string",
          description: "父文件夹 token（可选）",
        },
      },
      required: ["file_name"],
    },
  },
  {
    name: "get_file_info",
    description: "获取飞书云空间文件的详细信息（通过文件 token 查询元数据）",
    command: "get_file_info",
    parameters: {
      type: "object",
      properties: {
        file_token: { type: "string", description: "文件 token" },
      },
      required: ["file_token"],
    },
  },
];

/** 创建云空间模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 搜索文件
  // SDK 中没有 drive.file.search，文件搜索可能需要通用搜索 API
  handlers.set("search_files", async (ctx) => {
    const query: string = ctx.args.query ?? "";
    const count: number = ctx.args.count ?? 10;

    try {
      // TODO: 待确认 SDK API 路径，当前为推测。飞书文件搜索可能在 client.search 命名空间下
      // 尝试使用 drive.file.list 获取文件列表
      const res = await (client as any).drive?.file?.list?.({
        params: {
          page_size: Math.min(count, 50),
        },
      });

      if (!res || res.code !== 0) {
        return `文件搜索功能当前暂不可用。请通过飞书客户端搜索关键词"${query}"。`;
      }

      const files = res?.data?.files ?? [];
      // 本地过滤匹配关键词的文件
      const matched = files.filter((f: any) =>
        f.name?.toLowerCase().includes(query.toLowerCase()),
      );

      if (matched.length === 0) {
        return `未找到与"${query}"相关的文件`;
      }

      const lines = matched.map((f: any, i: number) =>
        `${i + 1}. ${f.name ?? "未命名"} (token: ${f.token ?? "无"}, 类型: ${f.type ?? "未知"})`,
      );
      return `搜索到 ${matched.length} 个文件:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `搜索文件失败: ${err.message ?? err}`;
    }
  });

  // 上传文件
  // 文件上传需要实际的文件流，当前 tool 不支持直接上传文件内容
  handlers.set("upload_file", async (_ctx) => {
    return `文件上传需要通过其他方式完成，当前 tool 不支持直接上传文件内容。请使用飞书客户端或飞书 API 进行文件上传操作。`;
  });

  // 获取文件信息
  handlers.set("get_file_info", async (ctx) => {
    const fileToken: string = ctx.args.file_token ?? "";

    try {
      // TODO: 待确认 SDK API 路径，当前为推测。可能是 client.drive.meta.batchQuery
      const res = await (client as any).drive?.file?.get?.({
        path: { file_token: fileToken },
      });

      if (!res || res.code !== 0) {
        return `获取文件信息失败: ${res?.msg || "API 不可用，请确认权限和 file_token"}`;
      }

      const info = res?.data ?? {};
      const lines = [
        `文件名: ${info.name ?? "未知"}`,
        `类型: ${info.type ?? "未知"}`,
        `Token: ${fileToken}`,
        `创建者: ${info.owner_id ?? "未知"}`,
        `创建时间: ${info.created_time ?? "未知"}`,
        `修改时间: ${info.modified_time ?? "未知"}`,
      ];
      return lines.join("\n");
    } catch (err: any) {
      return `获取文件信息失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 云空间 Tool 模块 */
export const driveTools: ToolModule = { definitions, createHandlers };

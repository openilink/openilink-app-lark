/**
 * 云文档 Tools
 * 提供飞书文档创建、读取、搜索等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 云文档模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "create_doc",
    description: "创建飞书云文档",
    command: "create_doc",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "文档标题" },
        content: {
          type: "string",
          description: "文档内容，Markdown 格式（可选）",
        },
        folder_token: {
          type: "string",
          description: "目标文件夹 token（可选）",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "read_doc",
    description: "读取飞书云文档内容",
    command: "read_doc",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "文档 ID" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "search_doc",
    description:
      "搜索飞书云文档（注意：该功能依赖通用搜索 API，当前可能不完全支持）",
    command: "search_doc",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        count: { type: "number", description: "返回数量，默认 10" },
      },
      required: ["query"],
    },
  },
];

/** 创建云文档模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 创建文档
  handlers.set("create_doc", async (ctx) => {
    try {
      const { title, content, folder_token } = ctx.args;

      const data: any = { title };
      if (folder_token) {
        data.folder_token = folder_token;
      }

      const resp = await client.docx.document.create({
        data,
      });

      if (resp.code !== 0) {
        return `创建文档失败: ${resp.msg}`;
      }

      const docId = resp.data?.document?.document_id;
      const docUrl = (resp.data?.document as any)?.url || "";

      // 如果提供了内容，通过 documentBlock 创建文档正文 block
      if (content && docId) {
        try {
          await (client.docx.documentBlock as any).create({
            path: { document_id: docId },
            params: { document_revision_id: -1 },
            data: {
              block_type: 2, // text block
              text: {
                elements: [
                  {
                    text_run: { content },
                  },
                ],
              },
            },
          });
        } catch {
          // 添加内容失败不影响文档创建结果
        }
      }

      const parts = [`文档"${title}"创建成功`, `文档 ID: ${docId}`];
      if (docUrl) parts.push(`链接: ${docUrl}`);
      return parts.join("\n");
    } catch (err: any) {
      return `创建文档出错: ${err.message || err}`;
    }
  });

  // 读取文档
  handlers.set("read_doc", async (ctx) => {
    try {
      const { document_id } = ctx.args;

      // 使用 rawContent 获取文档纯文本内容
      const resp = await client.docx.document.rawContent({
        path: { document_id },
      });

      if (resp.code !== 0) {
        return `读取文档失败: ${resp.msg}`;
      }

      const content = resp.data?.content || "（文档内容为空）";
      return `文档内容:\n${content}`;
    } catch (err: any) {
      return `读取文档出错: ${err.message || err}`;
    }
  });

  // 搜索文档
  // TODO: 飞书搜索 API 在 SDK 中可能位于 client.search 命名空间，但 SDK 未直接暴露该接口
  handlers.set("search_doc", async (ctx) => {
    try {
      const { query, count = 10 } = ctx.args;

      // TODO: 待确认 SDK API 路径，当前为推测。搜索 API 可能在 client.search 下
      const resp = await (client as any).search?.message?.create?.({
        data: {
          query,
          page_size: Math.min(count, 50),
        },
      });

      if (!resp || resp.code !== 0) {
        return `文档搜索功能当前暂不可用（SDK 未直接暴露搜索接口）。请通过飞书客户端搜索关键词"${query}"。`;
      }

      const items = resp.data?.items ?? [];
      if (items.length === 0) {
        return `未找到包含"${query}"的文档`;
      }

      const lines = items.map((doc: any, i: number) => {
        const title = doc.title || "（无标题）";
        const docType = doc.docs_type || "unknown";
        const url = doc.url || "";
        return `${i + 1}. [${docType}] ${title}${url ? "\n   链接: " + url : ""}`;
      });

      return `搜索"${query}"的结果（共 ${items.length} 条）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `搜索文档出错: ${err.message || err}`;
    }
  });

  return handlers;
}

/** 云文档 Tool 模块 */
export const docTools: ToolModule = { definitions, createHandlers };

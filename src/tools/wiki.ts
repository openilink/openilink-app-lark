/**
 * 知识库 Tools
 * 提供飞书知识库搜索、节点读取能力
 * 注意: SDK 中知识库 API 路径不确定，当前使用 (client as any) 调用
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 知识库模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "search_wiki",
    description:
      "搜索飞书知识库中的文档（注意：搜索可能需要通用搜索 API，当前为推测实现）",
    command: "search_wiki",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        space_id: {
          type: "string",
          description: "知识空间 ID（可选，不填搜索所有空间）",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_wiki_node",
    description: "读取飞书知识库中的节点信息",
    command: "get_wiki_node",
    parameters: {
      type: "object",
      properties: {
        space_id: { type: "string", description: "知识空间 ID" },
        node_token: { type: "string", description: "节点 token" },
      },
      required: ["space_id", "node_token"],
    },
  },
];

/** 创建知识库模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 搜索知识库
  // TODO: 待确认 SDK API 路径，当前为推测。可能需要通用搜索 API
  handlers.set("search_wiki", async (ctx) => {
    const query: string = ctx.args.query ?? "";
    const spaceId: string = ctx.args.space_id ?? "";

    try {
      const params: Record<string, any> = { query };
      if (spaceId) {
        params.space_id = spaceId;
      }

      // 尝试 wiki.space.getNode 或 wiki.node 相关接口进行搜索
      const res = await (client as any).wiki?.space?.getNode?.({
        data: params,
      });

      if (!res || res.code !== 0) {
        return `知识库搜索功能当前暂不可用。请通过飞书客户端搜索关键词"${query}"。`;
      }

      const nodes = res?.data?.items ?? [];
      if (nodes.length === 0) {
        return `未找到与"${query}"相关的知识库文档`;
      }

      const lines = nodes.map((n: any, i: number) => {
        const title = n.title ?? "未命名";
        const nodeToken = n.node_token ?? "无";
        const nodeType = n.obj_type ?? "未知类型";
        return `${i + 1}. ${title} (token: ${nodeToken}, 类型: ${nodeType})`;
      });
      return `搜索到 ${nodes.length} 个知识库节点:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `搜索知识库失败: ${err.message ?? err}`;
    }
  });

  // 读取知识节点
  // TODO: 待确认 SDK API 路径，当前为推测。可能是 client.wiki.space.getNode 或 client.wiki.node.get
  handlers.set("get_wiki_node", async (ctx) => {
    const spaceId: string = ctx.args.space_id ?? "";
    const nodeToken: string = ctx.args.node_token ?? "";

    try {
      const res = await (client as any).wiki?.space?.getNode?.({
        path: { space_id: spaceId },
        params: { token: nodeToken },
      });

      if (!res || res.code !== 0) {
        return `读取知识节点失败: ${res?.msg || "API 不可用，请确认权限和参数"}`;
      }

      const node = res?.data?.node ?? {};
      const lines = [
        `标题: ${node.title ?? "未知"}`,
        `类型: ${node.obj_type ?? "未知"}`,
        `Token: ${nodeToken}`,
        `空间: ${spaceId}`,
        `创建者: ${node.creator ?? "未知"}`,
        `创建时间: ${node.create_time ?? "未知"}`,
        `更新时间: ${node.update_time ?? "未知"}`,
        `内容 Token: ${node.obj_token ?? "无"}`,
      ];
      return lines.join("\n");
    } catch (err: any) {
      return `读取知识节点失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 知识库 Tool 模块 */
export const wikiTools: ToolModule = { definitions, createHandlers };

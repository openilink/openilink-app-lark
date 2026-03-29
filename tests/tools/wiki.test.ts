/**
 * tools/wiki.ts 测试
 * Mock lark.Client 验证知识库工具的 handler 和定义
 *
 * 注意: 源码中使用 client.wiki?.space?.getNode 而非 wiki.spaceNode
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { wikiTools } from "../../src/tools/wiki.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    wiki: {
      space: {
        getNode: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            items: [
              {
                title: "开发规范",
                node_token: "node_001",
                obj_type: "docx",
              },
              {
                title: "接口文档",
                node_token: "node_002",
                obj_type: "doc",
              },
            ],
            // 也用于 get_wiki_node 的返回
            node: {
              title: "开发规范",
              obj_type: "docx",
              creator: "ou_creator_001",
              create_time: "2024-01-01",
              update_time: "2024-06-01",
              obj_token: "doc_token_001",
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

describe("wikiTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有知识库相关工具定义", () => {
      const names = wikiTools.definitions.map((d) => d.name);

      expect(names).toContain("search_wiki");
      expect(names).toContain("get_wiki_node");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of wikiTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("search_wiki 应要求 query 为必填参数", () => {
      const def = wikiTools.definitions.find((d) => d.name === "search_wiki");
      expect(def?.parameters?.required).toContain("query");
    });

    it("get_wiki_node 应要求 space_id 和 node_token 为必填参数", () => {
      const def = wikiTools.definitions.find((d) => d.name === "get_wiki_node");
      expect(def?.parameters?.required).toContain("space_id");
      expect(def?.parameters?.required).toContain("node_token");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = wikiTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of wikiTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("search_wiki", () => {
      it("应调用 wiki.space.getNode 搜索知识库并返回格式化结果", async () => {
        const handler = handlers.get("search_wiki")!;
        const result = await handler(makeCtx({ query: "开发" }));

        expect(client.wiki.space.getNode).toHaveBeenCalledOnce();
        expect(result).toContain("2");
        expect(result).toContain("开发规范");
        expect(result).toContain("接口文档");
        expect(result).toContain("node_001");
      });

      it("提供 space_id 时应传递给 SDK", async () => {
        const handler = handlers.get("search_wiki")!;
        await handler(makeCtx({ query: "开发", space_id: "space_001" }));

        const callArgs = client.wiki.space.getNode.mock.calls[0][0];
        expect(callArgs.data.space_id).toBe("space_001");
      });

      it("无搜索结果时应返回提示", async () => {
        client.wiki.space.getNode.mockResolvedValueOnce({
          code: 0,
          data: { items: [] },
        });

        const handler = handlers.get("search_wiki")!;
        const result = await handler(makeCtx({ query: "不存在的内容" }));

        expect(result).toContain("未找到");
      });

      it("API 不可用时应返回暂不可用提示", async () => {
        // 模拟 wiki 为 undefined
        const clientNoWiki = {} as any;
        const handlersNoWiki = wikiTools.createHandlers(clientNoWiki);
        const handler = handlersNoWiki.get("search_wiki")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("暂不可用");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.wiki.space.getNode.mockRejectedValueOnce(new Error("知识库不可用"));

        const handler = handlers.get("search_wiki")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("搜索知识库失败");
        expect(result).toContain("知识库不可用");
      });
    });

    describe("get_wiki_node", () => {
      it("应调用 wiki.space.getNode 获取节点信息并返回格式化结果", async () => {
        const handler = handlers.get("get_wiki_node")!;
        const result = await handler(
          makeCtx({ space_id: "space_001", node_token: "node_001" }),
        );

        expect(client.wiki.space.getNode).toHaveBeenCalled();
        const callArgs = client.wiki.space.getNode.mock.calls[0][0];
        expect(callArgs.path.space_id).toBe("space_001");

        expect(result).toContain("开发规范");
        expect(result).toContain("docx");
        expect(result).toContain("node_001");
        expect(result).toContain("space_001");
        expect(result).toContain("doc_token_001");
      });

      it("API 返回错误时应返回错误信息", async () => {
        client.wiki.space.getNode.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

        const handler = handlers.get("get_wiki_node")!;
        const result = await handler(
          makeCtx({ space_id: "space_001", node_token: "invalid" }),
        );

        expect(result).toContain("读取知识节点失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.wiki.space.getNode.mockRejectedValueOnce(new Error("节点不存在"));

        const handler = handlers.get("get_wiki_node")!;
        const result = await handler(
          makeCtx({ space_id: "space_001", node_token: "invalid" }),
        );

        expect(result).toContain("读取知识节点失败");
        expect(result).toContain("节点不存在");
      });
    });
  });
});

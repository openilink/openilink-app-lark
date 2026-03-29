/**
 * tools/doc.ts 测试
 * Mock lark.Client 验证云文档工具的 handler 和定义
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { docTools } from "../../src/tools/doc.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    docx: {
      document: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            document: {
              document_id: "doc-001",
              url: "https://lark.com/doc/doc-001",
            },
          },
        }),
        rawContent: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { content: "这是文档正文内容" },
        }),
      },
      documentBlock: {
        create: vi.fn().mockResolvedValue({ code: 0 }),
      },
    },
    // search_doc 实际使用 client.search?.message?.create
    search: {
      message: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            items: [
              {
                title: "测试文档",
                docs_type: "docx",
                url: "https://lark.com/doc/001",
              },
              {
                title: "另一个文档",
                docs_type: "doc",
                url: "https://lark.com/doc/002",
              },
            ],
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

describe("docTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有云文档相关工具定义", () => {
      const { definitions } = docTools;
      const names = definitions.map((d) => d.name);

      expect(names).toContain("create_doc");
      expect(names).toContain("read_doc");
      expect(names).toContain("search_doc");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of docTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("create_doc 应要求 title 为必填参数", () => {
      const def = docTools.definitions.find((d) => d.name === "create_doc");
      expect(def?.parameters?.required).toContain("title");
    });

    it("read_doc 应要求 document_id 为必填参数", () => {
      const def = docTools.definitions.find((d) => d.name === "read_doc");
      expect(def?.parameters?.required).toContain("document_id");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = docTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of docTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("create_doc", () => {
      it("应调用 SDK 创建文档并返回文档 ID", async () => {
        const handler = handlers.get("create_doc")!;
        const result = await handler(makeCtx({ title: "新建文档" }));

        expect(client.docx.document.create).toHaveBeenCalledOnce();
        expect(result).toContain("doc-001");
        expect(result).toContain("新建文档");
        expect(result).toContain("创建成功");
      });

      it("提供 content 时应同时创建文档正文 block", async () => {
        const handler = handlers.get("create_doc")!;
        await handler(makeCtx({ title: "带内容文档", content: "正文内容" }));

        expect(client.docx.document.create).toHaveBeenCalledOnce();
        expect(client.docx.documentBlock.create).toHaveBeenCalledOnce();
      });

      it("提供 folder_token 时应传递给 SDK", async () => {
        const handler = handlers.get("create_doc")!;
        await handler(makeCtx({ title: "文件夹中的文档", folder_token: "fld_001" }));

        const callArgs = client.docx.document.create.mock.calls[0][0];
        expect(callArgs.data.folder_token).toBe("fld_001");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.docx.document.create.mockResolvedValueOnce({
          code: 99999,
          msg: "无权限",
          data: null,
        });

        const handler = handlers.get("create_doc")!;
        const result = await handler(makeCtx({ title: "测试" }));

        expect(result).toContain("创建文档失败");
        expect(result).toContain("无权限");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.docx.document.create.mockRejectedValueOnce(new Error("网络错误"));

        const handler = handlers.get("create_doc")!;
        const result = await handler(makeCtx({ title: "测试" }));

        expect(result).toContain("创建文档出错");
        expect(result).toContain("网络错误");
      });

      it("返回结果应包含文档链接", async () => {
        const handler = handlers.get("create_doc")!;
        const result = await handler(makeCtx({ title: "有链接的文档" }));

        expect(result).toContain("https://lark.com/doc/doc-001");
      });
    });

    describe("read_doc", () => {
      it("应调用 SDK 读取文档内容并返回", async () => {
        const handler = handlers.get("read_doc")!;
        const result = await handler(makeCtx({ document_id: "doc-001" }));

        expect(client.docx.document.rawContent).toHaveBeenCalledOnce();
        const callArgs = client.docx.document.rawContent.mock.calls[0][0];
        expect(callArgs.path.document_id).toBe("doc-001");
        expect(result).toContain("这是文档正文内容");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.docx.document.rawContent.mockResolvedValueOnce({
          code: 40003,
          msg: "文档不存在",
          data: null,
        });

        const handler = handlers.get("read_doc")!;
        const result = await handler(makeCtx({ document_id: "doc-invalid" }));

        expect(result).toContain("读取文档失败");
        expect(result).toContain("文档不存在");
      });

      it("文档内容为空时应返回提示", async () => {
        client.docx.document.rawContent.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { content: "" },
        });

        const handler = handlers.get("read_doc")!;
        const result = await handler(makeCtx({ document_id: "doc-empty" }));

        expect(result).toContain("文档内容为空");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.docx.document.rawContent.mockRejectedValueOnce(new Error("超时"));

        const handler = handlers.get("read_doc")!;
        const result = await handler(makeCtx({ document_id: "doc-001" }));

        expect(result).toContain("读取文档出错");
        expect(result).toContain("超时");
      });
    });

    describe("search_doc", () => {
      it("搜索到结果时应返回格式化列表", async () => {
        const handler = handlers.get("search_doc")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(client.search.message.create).toHaveBeenCalledOnce();
        expect(result).toContain("测试文档");
        expect(result).toContain("另一个文档");
        expect(result).toContain("2");
      });

      it("无搜索结果时应返回提示", async () => {
        client.search.message.create.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { items: [] },
        });

        const handler = handlers.get("search_doc")!;
        const result = await handler(makeCtx({ query: "不存在的文档" }));

        expect(result).toContain("未找到");
      });

      it("API 不可用时应返回暂不可用提示", async () => {
        // 模拟 search 为 undefined（API 不可用）
        const clientNoSearch = { ...client, search: undefined } as any;
        const handlersNoSearch = docTools.createHandlers(clientNoSearch);
        const handler = handlersNoSearch.get("search_doc")!;
        const result = await handler(makeCtx({ query: "测试" }));

        // 源码中 client.search?.message?.create? 返回 undefined 时给出暂不可用提示
        expect(result).toContain("暂不可用");
      });

      it("count 应限制在 50 以内", async () => {
        const handler = handlers.get("search_doc")!;
        await handler(makeCtx({ query: "测试", count: 200 }));

        const callArgs = client.search.message.create.mock.calls[0][0];
        expect(callArgs.data.page_size).toBe(50);
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.search.message.create.mockRejectedValueOnce(new Error("搜索超时"));

        const handler = handlers.get("search_doc")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("搜索文档出错");
        expect(result).toContain("搜索超时");
      });
    });
  });
});

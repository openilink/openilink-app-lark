/**
 * tools/drive.ts 测试
 * Mock lark.Client 验证云空间工具的 handler 和定义
 *
 * 注意: 源码中 search_files 使用 drive.file.list 并本地过滤，
 * upload_file 不使用 ctx 参数，直接返回固定提示
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { driveTools } from "../../src/tools/drive.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    drive: {
      file: {
        list: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            files: [
              { name: "周报.xlsx", token: "file_001", type: "sheet" },
              { name: "设计稿.pdf", token: "file_002", type: "file" },
              { name: "月度总结.docx", token: "file_003", type: "docx" },
            ],
          },
        }),
        get: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            name: "周报.xlsx",
            type: "sheet",
            owner_id: "ou_owner_001",
            created_time: "2024-01-01",
            modified_time: "2024-06-01",
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

describe("driveTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有云空间相关工具定义", () => {
      const names = driveTools.definitions.map((d) => d.name);

      expect(names).toContain("search_files");
      expect(names).toContain("upload_file");
      expect(names).toContain("get_file_info");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of driveTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("search_files 应要求 query 为必填参数", () => {
      const def = driveTools.definitions.find((d) => d.name === "search_files");
      expect(def?.parameters?.required).toContain("query");
    });

    it("get_file_info 应要求 file_token 为必填参数", () => {
      const def = driveTools.definitions.find((d) => d.name === "get_file_info");
      expect(def?.parameters?.required).toContain("file_token");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = driveTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of driveTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("search_files", () => {
      it("应调用 drive.file.list 并本地过滤匹配文件", async () => {
        const handler = handlers.get("search_files")!;
        const result = await handler(makeCtx({ query: "周报" }));

        expect(client.drive.file.list).toHaveBeenCalledOnce();
        // 应只匹配包含"周报"的文件
        expect(result).toContain("周报.xlsx");
        expect(result).toContain("1"); // 只有 1 个匹配
      });

      it("无匹配文件时应返回提示", async () => {
        const handler = handlers.get("search_files")!;
        const result = await handler(makeCtx({ query: "不存在的文件名" }));

        expect(result).toContain("未找到");
      });

      it("API 不可用时应返回暂不可用提示", async () => {
        // 模拟 drive 为 undefined（API 不可用）
        const clientNoDrive = {} as any;
        const handlersNoDrive = driveTools.createHandlers(clientNoDrive);
        const handler = handlersNoDrive.get("search_files")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("暂不可用");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.drive.file.list.mockRejectedValueOnce(new Error("搜索失败"));

        const handler = handlers.get("search_files")!;
        const result = await handler(makeCtx({ query: "测试" }));

        expect(result).toContain("搜索文件失败");
        expect(result).toContain("搜索失败");
      });

      it("count 参数应限制 page_size 不超过 50", async () => {
        const handler = handlers.get("search_files")!;
        await handler(makeCtx({ query: "文件", count: 200 }));

        const callArgs = client.drive.file.list.mock.calls[0][0];
        expect(callArgs.params.page_size).toBe(50);
      });
    });

    describe("get_file_info", () => {
      it("应调用 SDK 获取文件信息并返回格式化结果", async () => {
        const handler = handlers.get("get_file_info")!;
        const result = await handler(makeCtx({ file_token: "file_001" }));

        expect(client.drive.file.get).toHaveBeenCalledOnce();
        const callArgs = client.drive.file.get.mock.calls[0][0];
        expect(callArgs.path.file_token).toBe("file_001");

        expect(result).toContain("周报.xlsx");
        expect(result).toContain("sheet");
        expect(result).toContain("file_001");
      });

      it("API 返回错误时应返回错误信息", async () => {
        client.drive.file.get.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

        const handler = handlers.get("get_file_info")!;
        const result = await handler(makeCtx({ file_token: "invalid" }));

        expect(result).toContain("获取文件信息失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.drive.file.get.mockRejectedValueOnce(new Error("文件不存在"));

        const handler = handlers.get("get_file_info")!;
        const result = await handler(makeCtx({ file_token: "invalid" }));

        expect(result).toContain("获取文件信息失败");
        expect(result).toContain("文件不存在");
      });
    });

    describe("upload_file", () => {
      it("应返回固定提示信息", async () => {
        const handler = handlers.get("upload_file")!;
        const result = await handler(makeCtx({ file_name: "report.pdf" }));

        // 源码中 upload_file 直接返回固定提示，不使用参数
        expect(result).toContain("文件上传");
      });
    });
  });
});

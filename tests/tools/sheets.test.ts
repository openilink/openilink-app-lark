/**
 * tools/sheets.ts 测试
 * 源码不再使用 SDK 的 spreadsheetSheetValue API，而是通过
 * client.tokenManager 获取 tenant_access_token 后直接 fetch 飞书 HTTP API。
 * 因此这里 mock tokenManager 和全局 fetch。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sheetsTools } from "../../src/tools/sheets.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client（仅含 tokenManager） */
function createMockLarkSdkClient() {
  return {
    tokenManager: {
      getTenantAccessToken: vi.fn().mockResolvedValue("t-access-token"),
    },
  } as any;
}

/** 设置全局 fetch mock，返回指定 JSON 响应 */
function mockFetchJson(json: any) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => json,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("sheetsTools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("tool definitions 结构", () => {
    it("应包含所有电子表格相关工具定义", () => {
      const names = sheetsTools.definitions.map((d) => d.name);

      expect(names).toContain("read_sheet");
      expect(names).toContain("write_sheet");
      expect(names).toContain("append_sheet");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of sheetsTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("read_sheet 应要求 spreadsheet_token 和 range 为必填参数", () => {
      const def = sheetsTools.definitions.find((d) => d.name === "read_sheet");
      expect(def?.parameters?.required).toContain("spreadsheet_token");
      expect(def?.parameters?.required).toContain("range");
    });

    it("write_sheet 应要求 spreadsheet_token, range, values 为必填参数", () => {
      const def = sheetsTools.definitions.find((d) => d.name === "write_sheet");
      expect(def?.parameters?.required).toContain("spreadsheet_token");
      expect(def?.parameters?.required).toContain("range");
      expect(def?.parameters?.required).toContain("values");
    });

    it("append_sheet 应要求 spreadsheet_token, range, values 为必填参数", () => {
      const def = sheetsTools.definitions.find((d) => d.name === "append_sheet");
      expect(def?.parameters?.required).toContain("spreadsheet_token");
      expect(def?.parameters?.required).toContain("range");
      expect(def?.parameters?.required).toContain("values");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = sheetsTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of sheetsTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("read_sheet", () => {
      it("应调用飞书 HTTP API 读取表格数据并返回格式化结果", async () => {
        const fetchMock = mockFetchJson({
          code: 0,
          data: {
            valueRange: {
              values: [
                ["姓名", "年龄", "部门"],
                ["张三", 28, "研发"],
                ["李四", 32, "产品"],
              ],
            },
          },
        });

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "sheet_001", range: "Sheet1!A1:C3" }),
        );

        expect(client.tokenManager.getTenantAccessToken).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain("sheet_001");
        expect(url).toContain(encodeURIComponent("Sheet1!A1:C3"));
        expect(init.method).toBe("GET");
        expect(init.headers.Authorization).toBe("Bearer t-access-token");

        expect(result).toContain("3"); // 3 行
        expect(result).toContain("姓名");
        expect(result).toContain("张三");
      });

      it("无数据时应返回提示", async () => {
        mockFetchJson({ code: 0, data: { valueRange: { values: [] } } });

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "sheet_001", range: "Sheet1!A1:A1" }),
        );

        expect(result).toContain("无数据");
      });

      it("API 返回非 0 code 时应返回错误信息", async () => {
        mockFetchJson({ code: 40003, msg: "无权限" });

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "invalid", range: "Sheet1!A1:C3" }),
        );

        expect(result).toContain("读取表格失败");
      });

      it("fetch 抛出异常时应返回错误信息", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("表格不存在"));
        vi.stubGlobal("fetch", fetchMock);

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "invalid", range: "Sheet1!A1:C3" }),
        );

        expect(result).toContain("读取表格失败");
        expect(result).toContain("表格不存在");
      });
    });

    describe("write_sheet", () => {
      it("应调用飞书 HTTP API 写入数据并返回成功提示", async () => {
        const fetchMock = mockFetchJson({ code: 0, data: {} });

        const values = JSON.stringify([
          ["王五", 25, "设计"],
          ["赵六", 30, "运营"],
        ]);
        const handler = handlers.get("write_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A4:C5",
            values,
          }),
        );

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain("sheet_001");
        expect(init.method).toBe("PUT");
        const body = JSON.parse(init.body);
        expect(body.valueRange.range).toBe("Sheet1!A4:C5");
        expect(body.valueRange.values).toEqual([
          ["王五", 25, "设计"],
          ["赵六", 30, "运营"],
        ]);

        expect(result).toContain("成功写入");
        expect(result).toContain("2"); // 2 行
      });

      it("values 格式错误时应返回提示且不发起请求", async () => {
        const fetchMock = mockFetchJson({ code: 0, data: {} });

        const handler = handlers.get("write_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: "not-json{{{",
          }),
        );

        expect(result).toContain("数据格式错误");
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("API 返回非 0 code 时应返回错误信息", async () => {
        mockFetchJson({ code: 40003, msg: "范围无效" });

        const handler = handlers.get("write_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: '[["测试"]]',
          }),
        );

        expect(result).toContain("写入表格失败");
      });

      it("fetch 抛出异常时应返回错误信息", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("范围超限"));
        vi.stubGlobal("fetch", fetchMock);

        const handler = handlers.get("write_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: '[["测试"]]',
          }),
        );

        expect(result).toContain("写入表格失败");
        expect(result).toContain("范围超限");
      });
    });

    describe("append_sheet", () => {
      it("应调用飞书 HTTP API 追加数据并返回成功提示", async () => {
        const fetchMock = mockFetchJson({ code: 0, data: {} });

        const values = JSON.stringify([["新数据", 100, "新部门"]]);
        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values,
          }),
        );

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain("values_append");
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body);
        expect(body.valueRange.values).toEqual([["新数据", 100, "新部门"]]);

        expect(result).toContain("成功追加");
        expect(result).toContain("1"); // 1 行
      });

      it("values 格式错误时应返回提示且不发起请求", async () => {
        const fetchMock = mockFetchJson({ code: 0, data: {} });

        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: "{invalid}",
          }),
        );

        expect(result).toContain("数据格式错误");
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("API 返回非 0 code 时应返回错误信息", async () => {
        mockFetchJson({ code: 40003, msg: "无权限" });

        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: '[["数据"]]',
          }),
        );

        expect(result).toContain("追加数据失败");
      });

      it("fetch 抛出异常时应返回错误信息", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("追加失败"));
        vi.stubGlobal("fetch", fetchMock);

        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: '[["数据"]]',
          }),
        );

        expect(result).toContain("追加数据失败");
        expect(result).toContain("追加失败");
      });
    });
  });
});

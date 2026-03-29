/**
 * tools/sheets.ts 测试
 * Mock lark.Client 验证电子表格工具的 handler 和定义
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sheetsTools } from "../../src/tools/sheets.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    sheets: {
      spreadsheetSheetValue: {
        get: vi.fn().mockResolvedValue({
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
        }),
        update: vi.fn().mockResolvedValue({
          code: 0,
          data: {},
        }),
        append: vi.fn().mockResolvedValue({
          code: 0,
          data: {},
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

describe("sheetsTools", () => {
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
      it("应调用 SDK 读取表格数据并返回格式化结果", async () => {
        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "sheet_001", range: "Sheet1!A1:C3" }),
        );

        expect(client.sheets.spreadsheetSheetValue.get).toHaveBeenCalledOnce();
        const callArgs = client.sheets.spreadsheetSheetValue.get.mock.calls[0][0];
        expect(callArgs.path.spreadsheet_token).toBe("sheet_001");
        expect(callArgs.params.range).toBe("Sheet1!A1:C3");

        expect(result).toContain("3"); // 3 行
        expect(result).toContain("姓名");
        expect(result).toContain("张三");
      });

      it("无数据时应返回提示", async () => {
        client.sheets.spreadsheetSheetValue.get.mockResolvedValueOnce({
          code: 0,
          data: { valueRange: { values: [] } },
        });

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "sheet_001", range: "Sheet1!A1:A1" }),
        );

        expect(result).toContain("无数据");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.get.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "invalid", range: "Sheet1!A1:C3" }),
        );

        expect(result).toContain("读取表格失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.get.mockRejectedValueOnce(
          new Error("表格不存在"),
        );

        const handler = handlers.get("read_sheet")!;
        const result = await handler(
          makeCtx({ spreadsheet_token: "invalid", range: "Sheet1!A1:C3" }),
        );

        expect(result).toContain("读取表格失败");
        expect(result).toContain("表格不存在");
      });
    });

    describe("write_sheet", () => {
      it("应调用 SDK 写入数据并返回成功提示", async () => {
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

        expect(client.sheets.spreadsheetSheetValue.update).toHaveBeenCalledOnce();
        const callArgs = client.sheets.spreadsheetSheetValue.update.mock.calls[0][0];
        expect(callArgs.data.valueRange.values).toEqual([
          ["王五", 25, "设计"],
          ["赵六", 30, "运营"],
        ]);

        expect(result).toContain("成功写入");
        expect(result).toContain("2"); // 2 行
      });

      it("values 格式错误时应返回提示", async () => {
        const handler = handlers.get("write_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: "not-json{{{",
          }),
        );

        expect(result).toContain("数据格式错误");
        expect(client.sheets.spreadsheetSheetValue.update).not.toHaveBeenCalled();
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.update.mockResolvedValueOnce({
          code: 40003,
          msg: "范围无效",
        });

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

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.update.mockRejectedValueOnce(
          new Error("范围超限"),
        );

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
      it("应调用 SDK 追加数据并返回成功提示", async () => {
        const values = JSON.stringify([["新数据", 100, "新部门"]]);
        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values,
          }),
        );

        expect(client.sheets.spreadsheetSheetValue.append).toHaveBeenCalledOnce();
        const callArgs = client.sheets.spreadsheetSheetValue.append.mock.calls[0][0];
        expect(callArgs.data.valueRange.values).toEqual([["新数据", 100, "新部门"]]);

        expect(result).toContain("成功追加");
        expect(result).toContain("1"); // 1 行
      });

      it("values 格式错误时应返回提示", async () => {
        const handler = handlers.get("append_sheet")!;
        const result = await handler(
          makeCtx({
            spreadsheet_token: "sheet_001",
            range: "Sheet1!A1:C1",
            values: "{invalid}",
          }),
        );

        expect(result).toContain("数据格式错误");
        expect(client.sheets.spreadsheetSheetValue.append).not.toHaveBeenCalled();
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.append.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

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

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.sheets.spreadsheetSheetValue.append.mockRejectedValueOnce(
          new Error("追加失败"),
        );

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

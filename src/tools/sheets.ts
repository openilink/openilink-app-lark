/**
 * 电子表格 Tools
 * 提供飞书电子表格（Sheets）数据读取、写入、追加能力
 * 注意: SDK 中 sheets 的 API 路径不确定，当前使用 (client as any) 调用
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 电子表格模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "read_sheet",
    description:
      "读取飞书电子表格指定范围的数据。range 格式为 'Sheet1!A1:C10'，spreadsheet_token 可从电子表格 URL 中获取",
    command: "read_sheet",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_token: {
          type: "string",
          description: "电子表格 token，可从 URL 中获取",
        },
        range: {
          type: "string",
          description: "读取范围，如 Sheet1!A1:C10",
        },
      },
      required: ["spreadsheet_token", "range"],
    },
  },
  {
    name: "write_sheet",
    description:
      "向飞书电子表格指定范围写入数据。values 为 JSON 二维数组格式，如 [[\"A\",\"B\"],[1,2]]",
    command: "write_sheet",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_token: {
          type: "string",
          description: "电子表格 token",
        },
        range: {
          type: "string",
          description: "写入范围，如 Sheet1!A1:C10",
        },
        values: {
          type: "string",
          description:
            '写入数据，JSON 二维数组格式，如 [["姓名","年龄"],["张三",25]]',
        },
      },
      required: ["spreadsheet_token", "range", "values"],
    },
  },
  {
    name: "append_sheet",
    description:
      "向飞书电子表格追加数据。在指定范围的末尾追加新行，values 为 JSON 二维数组格式",
    command: "append_sheet",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_token: {
          type: "string",
          description: "电子表格 token",
        },
        range: {
          type: "string",
          description: "追加范围，如 Sheet1!A1:C1",
        },
        values: {
          type: "string",
          description:
            '追加数据，JSON 二维数组格式，如 [["李四",30]]',
        },
      },
      required: ["spreadsheet_token", "range", "values"],
    },
  },
];

/** 创建电子表格模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 读取表格
  // TODO: 待确认 SDK API 路径，当前为推测。可能是 client.sheets.spreadsheetSheetValue 或其他路径
  handlers.set("read_sheet", async (ctx) => {
    const token: string = ctx.args.spreadsheet_token ?? "";
    const range: string = ctx.args.range ?? "";

    try {
      const res = await (client as any).sheets.spreadsheetSheetValue.get({
        path: { spreadsheet_token: token },
        params: { range },
      });

      if (res?.code !== 0) {
        return `读取表格失败: ${res?.msg || "API 调用失败"}`;
      }

      const values = res?.data?.valueRange?.values ?? [];
      if (values.length === 0) {
        return `表格 ${token} 范围 ${range} 无数据`;
      }

      // 格式化为可读表格文本
      const lines = values.map((row: any[], i: number) =>
        `${i + 1}行: ${row.map((cell) => String(cell ?? "")).join(" | ")}`,
      );
      return `读取 ${range}（共 ${values.length} 行）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `读取表格失败: ${err.message ?? err}`;
    }
  });

  // 写入表格
  // TODO: 待确认 SDK API 路径，当前为推测
  handlers.set("write_sheet", async (ctx) => {
    const token: string = ctx.args.spreadsheet_token ?? "";
    const range: string = ctx.args.range ?? "";
    const valuesRaw: string = ctx.args.values ?? "[]";

    let values: any[][];
    try {
      values = JSON.parse(valuesRaw);
    } catch {
      return "数据格式错误，请提供合法的 JSON 二维数组";
    }

    try {
      const res = await (client as any).sheets.spreadsheetSheetValue.update({
        path: { spreadsheet_token: token },
        data: {
          valueRange: { range, values },
        },
      });

      if (res?.code !== 0) {
        return `写入表格失败: ${res?.msg || "API 调用失败"}`;
      }

      return `成功写入 ${values.length} 行数据到 ${range}`;
    } catch (err: any) {
      return `写入表格失败: ${err.message ?? err}`;
    }
  });

  // 追加数据
  // TODO: 待确认 SDK API 路径，当前为推测
  handlers.set("append_sheet", async (ctx) => {
    const token: string = ctx.args.spreadsheet_token ?? "";
    const range: string = ctx.args.range ?? "";
    const valuesRaw: string = ctx.args.values ?? "[]";

    let values: any[][];
    try {
      values = JSON.parse(valuesRaw);
    } catch {
      return "数据格式错误，请提供合法的 JSON 二维数组";
    }

    try {
      const res = await (client as any).sheets.spreadsheetSheetValue.append({
        path: { spreadsheet_token: token },
        data: {
          valueRange: { range, values },
        },
      });

      if (res?.code !== 0) {
        return `追加数据失败: ${res?.msg || "API 调用失败"}`;
      }

      return `成功追加 ${values.length} 行数据到 ${range}`;
    } catch (err: any) {
      return `追加数据失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 电子表格 Tool 模块 */
export const sheetsTools: ToolModule = { definitions, createHandlers };

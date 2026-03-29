/**
 * 多维表格 Tools
 * 提供飞书多维表格（Bitable）记录的查看、创建、更新能力
 * 注意: SDK 路径为 client.bitable（不是 client.base）
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 多维表格模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "list_base_records",
    description:
      "查看飞书多维表格中的记录。需要提供多维表格的 app_token 和数据表的 table_id，可从多维表格 URL 中获取",
    command: "list_base_records",
    parameters: {
      type: "object",
      properties: {
        app_token: {
          type: "string",
          description: "多维表格 app_token，可从 URL 中获取",
        },
        table_id: {
          type: "string",
          description: "数据表 ID，可从 URL 或表格元信息中获取",
        },
        page_size: { type: "number", description: "每页记录数，默认 20" },
      },
      required: ["app_token", "table_id"],
    },
  },
  {
    name: "create_base_record",
    description:
      "在飞书多维表格中创建一条记录。fields 参数为 JSON 字符串，key 是字段名，value 是字段值",
    command: "create_base_record",
    parameters: {
      type: "object",
      properties: {
        app_token: {
          type: "string",
          description: "多维表格 app_token",
        },
        table_id: { type: "string", description: "数据表 ID" },
        fields: {
          type: "string",
          description:
            '记录字段，JSON 格式。例如: {"姓名": "张三", "年龄": 25}',
        },
      },
      required: ["app_token", "table_id", "fields"],
    },
  },
  {
    name: "update_base_record",
    description:
      "更新飞书多维表格中的一条记录。需要提供 record_id，fields 为需要更新的字段 JSON",
    command: "update_base_record",
    parameters: {
      type: "object",
      properties: {
        app_token: {
          type: "string",
          description: "多维表格 app_token",
        },
        table_id: { type: "string", description: "数据表 ID" },
        record_id: { type: "string", description: "记录 ID" },
        fields: {
          type: "string",
          description:
            '需要更新的字段，JSON 格式。例如: {"状态": "已完成"}',
        },
      },
      required: ["app_token", "table_id", "record_id", "fields"],
    },
  },
];

/** 创建多维表格模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 查看记录 - 使用 client.bitable.appTableRecord.list
  handlers.set("list_base_records", async (ctx) => {
    const appToken: string = ctx.args.app_token ?? "";
    const tableId: string = ctx.args.table_id ?? "";
    const pageSize: number = ctx.args.page_size ?? 20;

    try {
      const res = await (client as any).bitable.appTableRecord.list({
        path: { app_token: appToken, table_id: tableId },
        params: { page_size: pageSize },
      });

      if (res?.code !== 0) {
        return `查看记录失败: ${res?.msg || "API 调用失败"}`;
      }

      const records = res?.data?.items ?? [];
      if (records.length === 0) {
        return "该表格暂无记录";
      }

      const total = res?.data?.total ?? records.length;
      const lines = records.map((r: any, i: number) => {
        const fieldsStr = JSON.stringify(r.fields ?? {}, null, 2);
        return `${i + 1}. [${r.record_id}]\n${fieldsStr}`;
      });
      return `共 ${total} 条记录（当前显示 ${records.length} 条）:\n\n${lines.join("\n\n")}`;
    } catch (err: any) {
      return `查看记录失败: ${err.message ?? err}`;
    }
  });

  // 创建记录 - 使用 client.bitable.appTableRecord.create
  handlers.set("create_base_record", async (ctx) => {
    const appToken: string = ctx.args.app_token ?? "";
    const tableId: string = ctx.args.table_id ?? "";
    const fieldsRaw: string = ctx.args.fields ?? "{}";

    let fields: Record<string, any>;
    try {
      fields = JSON.parse(fieldsRaw);
    } catch {
      return "字段格式错误，请提供合法的 JSON 字符串";
    }

    try {
      const res = await (client as any).bitable.appTableRecord.create({
        path: { app_token: appToken, table_id: tableId },
        data: { fields },
      });

      if (res?.code !== 0) {
        return `创建记录失败: ${res?.msg || "API 调用失败"}`;
      }

      const recordId = res?.data?.record?.record_id ?? "未知";
      return `记录创建成功，record_id: ${recordId}`;
    } catch (err: any) {
      return `创建记录失败: ${err.message ?? err}`;
    }
  });

  // 更新记录 - 使用 client.bitable.appTableRecord.update
  handlers.set("update_base_record", async (ctx) => {
    const appToken: string = ctx.args.app_token ?? "";
    const tableId: string = ctx.args.table_id ?? "";
    const recordId: string = ctx.args.record_id ?? "";
    const fieldsRaw: string = ctx.args.fields ?? "{}";

    let fields: Record<string, any>;
    try {
      fields = JSON.parse(fieldsRaw);
    } catch {
      return "字段格式错误，请提供合法的 JSON 字符串";
    }

    try {
      const res = await (client as any).bitable.appTableRecord.update({
        path: {
          app_token: appToken,
          table_id: tableId,
          record_id: recordId,
        },
        data: { fields },
      });

      if (res?.code !== 0) {
        return `更新记录失败: ${res?.msg || "API 调用失败"}`;
      }

      return `记录 ${recordId} 更新成功`;
    } catch (err: any) {
      return `更新记录失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 多维表格 Tool 模块 */
export const baseTools: ToolModule = { definitions, createHandlers };

/**
 * tools/base.ts 测试
 * Mock lark.Client 验证多维表格工具的 handler 和定义
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseTools } from "../../src/tools/base.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    bitable: {
      appTableRecord: {
        list: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            total: 2,
            items: [
              { record_id: "rec_001", fields: { "姓名": "张三", "年龄": 28 } },
              { record_id: "rec_002", fields: { "姓名": "李四", "年龄": 32 } },
            ],
          },
        }),
        create: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            record: { record_id: "rec_new_001" },
          },
        }),
        update: vi.fn().mockResolvedValue({
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

describe("baseTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有多维表格相关工具定义", () => {
      const names = baseTools.definitions.map((d) => d.name);

      expect(names).toContain("list_base_records");
      expect(names).toContain("create_base_record");
      expect(names).toContain("update_base_record");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of baseTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("list_base_records 应要求 app_token 和 table_id 为必填参数", () => {
      const def = baseTools.definitions.find((d) => d.name === "list_base_records");
      expect(def?.parameters?.required).toContain("app_token");
      expect(def?.parameters?.required).toContain("table_id");
    });

    it("create_base_record 应要求 app_token, table_id, fields 为必填参数", () => {
      const def = baseTools.definitions.find((d) => d.name === "create_base_record");
      expect(def?.parameters?.required).toContain("app_token");
      expect(def?.parameters?.required).toContain("table_id");
      expect(def?.parameters?.required).toContain("fields");
    });

    it("update_base_record 应要求 app_token, table_id, record_id, fields 为必填参数", () => {
      const def = baseTools.definitions.find((d) => d.name === "update_base_record");
      expect(def?.parameters?.required).toContain("app_token");
      expect(def?.parameters?.required).toContain("table_id");
      expect(def?.parameters?.required).toContain("record_id");
      expect(def?.parameters?.required).toContain("fields");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = baseTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of baseTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("list_base_records", () => {
      it("应调用 SDK 查看记录并返回格式化列表", async () => {
        const handler = handlers.get("list_base_records")!;
        const result = await handler(
          makeCtx({ app_token: "bitable_001", table_id: "tbl_001" }),
        );

        expect(client.bitable.appTableRecord.list).toHaveBeenCalledOnce();
        const callArgs = client.bitable.appTableRecord.list.mock.calls[0][0];
        expect(callArgs.path.app_token).toBe("bitable_001");
        expect(callArgs.path.table_id).toBe("tbl_001");

        expect(result).toContain("rec_001");
        expect(result).toContain("rec_002");
        expect(result).toContain("张三");
      });

      it("无记录时应返回提示", async () => {
        client.bitable.appTableRecord.list.mockResolvedValueOnce({
          code: 0,
          data: { items: [], total: 0 },
        });

        const handler = handlers.get("list_base_records")!;
        const result = await handler(
          makeCtx({ app_token: "bitable_001", table_id: "tbl_empty" }),
        );

        expect(result).toContain("暂无记录");
      });

      it("应传递 page_size 参数", async () => {
        const handler = handlers.get("list_base_records")!;
        await handler(
          makeCtx({ app_token: "bitable_001", table_id: "tbl_001", page_size: 50 }),
        );

        const callArgs = client.bitable.appTableRecord.list.mock.calls[0][0];
        expect(callArgs.params.page_size).toBe(50);
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.bitable.appTableRecord.list.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

        const handler = handlers.get("list_base_records")!;
        const result = await handler(
          makeCtx({ app_token: "bitable_001", table_id: "tbl_001" }),
        );

        expect(result).toContain("查看记录失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.bitable.appTableRecord.list.mockRejectedValueOnce(new Error("表格不存在"));

        const handler = handlers.get("list_base_records")!;
        const result = await handler(
          makeCtx({ app_token: "bitable_001", table_id: "tbl_invalid" }),
        );

        expect(result).toContain("查看记录失败");
        expect(result).toContain("表格不存在");
      });
    });

    describe("create_base_record", () => {
      it("应调用 SDK 创建记录并返回 record_id", async () => {
        const handler = handlers.get("create_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            fields: '{"姓名":"王五","年龄":25}',
          }),
        );

        expect(client.bitable.appTableRecord.create).toHaveBeenCalledOnce();
        const callArgs = client.bitable.appTableRecord.create.mock.calls[0][0];
        expect(callArgs.data.fields).toEqual({ "姓名": "王五", "年龄": 25 });

        expect(result).toContain("创建成功");
        expect(result).toContain("rec_new_001");
      });

      it("fields 格式错误时应返回提示", async () => {
        const handler = handlers.get("create_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            fields: "not-valid-json{{{",
          }),
        );

        expect(result).toContain("字段格式错误");
        expect(client.bitable.appTableRecord.create).not.toHaveBeenCalled();
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.bitable.appTableRecord.create.mockResolvedValueOnce({
          code: 40003,
          msg: "字段不存在",
        });

        const handler = handlers.get("create_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            fields: '{"姓名":"测试"}',
          }),
        );

        expect(result).toContain("创建记录失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.bitable.appTableRecord.create.mockRejectedValueOnce(
          new Error("字段不匹配"),
        );

        const handler = handlers.get("create_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            fields: '{"姓名":"测试"}',
          }),
        );

        expect(result).toContain("创建记录失败");
        expect(result).toContain("字段不匹配");
      });
    });

    describe("update_base_record", () => {
      it("应调用 SDK 更新记录并返回成功提示", async () => {
        const handler = handlers.get("update_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            record_id: "rec_001",
            fields: '{"年龄":29}',
          }),
        );

        expect(client.bitable.appTableRecord.update).toHaveBeenCalledOnce();
        const callArgs = client.bitable.appTableRecord.update.mock.calls[0][0];
        expect(callArgs.path.record_id).toBe("rec_001");
        expect(callArgs.data.fields).toEqual({ "年龄": 29 });

        expect(result).toContain("rec_001");
        expect(result).toContain("更新成功");
      });

      it("fields 格式错误时应返回提示", async () => {
        const handler = handlers.get("update_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            record_id: "rec_001",
            fields: "invalid",
          }),
        );

        expect(result).toContain("字段格式错误");
        expect(client.bitable.appTableRecord.update).not.toHaveBeenCalled();
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.bitable.appTableRecord.update.mockResolvedValueOnce({
          code: 40003,
          msg: "记录不存在",
        });

        const handler = handlers.get("update_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            record_id: "rec_invalid",
            fields: '{"年龄":30}',
          }),
        );

        expect(result).toContain("更新记录失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.bitable.appTableRecord.update.mockRejectedValueOnce(
          new Error("记录不存在"),
        );

        const handler = handlers.get("update_base_record")!;
        const result = await handler(
          makeCtx({
            app_token: "bitable_001",
            table_id: "tbl_001",
            record_id: "rec_invalid",
            fields: '{"年龄":30}',
          }),
        );

        expect(result).toContain("更新记录失败");
        expect(result).toContain("记录不存在");
      });
    });
  });
});

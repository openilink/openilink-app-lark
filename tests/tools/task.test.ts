/**
 * tools/task.ts 测试
 * Mock lark.Client 验证任务工具的 handler 和定义
 *
 * 注意: 源码中任务 API 的调用顺序是先尝试 task.task.xxx，再回退到 task.v2.task.xxx
 * 两个路径都在 try-catch 中，如果都抛异常则返回 "API 不可用"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskTools } from "../../src/tools/task.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client（task.task 路径优先） */
function createMockLarkSdkClient() {
  return {
    task: {
      // 优先路径: client.task.task
      task: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { task: { id: "task-001" } },
        }),
        list: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            items: [
              {
                summary: "完成测试",
                due: { timestamp: "1700000000" },
                completed_at: null,
              },
              {
                summary: "已完成的任务",
                due: { timestamp: "1699900000" },
                completed_at: "1699950000",
              },
            ],
          },
        }),
        complete: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
        }),
      },
      // 备用路径: client.task.v2.task
      v2: {
        task: {
          create: vi.fn(),
          list: vi.fn(),
          complete: vi.fn(),
        },
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

describe("taskTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有任务相关工具定义", () => {
      const { definitions } = taskTools;
      const names = definitions.map((d) => d.name);

      expect(names).toContain("create_task");
      expect(names).toContain("list_tasks");
      expect(names).toContain("complete_task");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of taskTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("create_task 应要求 summary 为必填参数", () => {
      const def = taskTools.definitions.find((d) => d.name === "create_task");
      expect(def?.parameters?.required).toContain("summary");
    });

    it("complete_task 应要求 task_id 为必填参数", () => {
      const def = taskTools.definitions.find((d) => d.name === "complete_task");
      expect(def?.parameters?.required).toContain("task_id");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = taskTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of taskTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("create_task", () => {
      it("应调用 task.task.create 创建任务并返回任务 ID", async () => {
        const handler = handlers.get("create_task")!;
        const result = await handler(makeCtx({ summary: "新任务" }));

        expect(client.task.task.create).toHaveBeenCalledOnce();
        expect(result).toContain("新任务");
        expect(result).toContain("创建成功");
        expect(result).toContain("task-001");
      });

      it("提供 due 时应转换为时间戳格式", async () => {
        const handler = handlers.get("create_task")!;
        await handler(makeCtx({ summary: "有截止日期的任务", due: "2024-12-31" }));

        const callArgs = client.task.task.create.mock.calls[0][0];
        expect(callArgs.data.due).toBeDefined();
        expect(callArgs.data.due.timestamp).toBeDefined();
        expect(callArgs.data.due.is_all_day).toBe(false);
      });

      it("提供 description 时应传递给 SDK", async () => {
        const handler = handlers.get("create_task")!;
        await handler(makeCtx({ summary: "带描述的任务", description: "详细说明" }));

        const callArgs = client.task.task.create.mock.calls[0][0];
        expect(callArgs.data.description).toBe("详细说明");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.task.task.create.mockResolvedValueOnce({
          code: 99999,
          msg: "无权限",
          data: null,
        });

        const handler = handlers.get("create_task")!;
        const result = await handler(makeCtx({ summary: "测试" }));

        expect(result).toContain("创建任务失败");
        expect(result).toContain("无权限");
      });

      it("task.task 路径不可用时应回退到 v2 路径", async () => {
        // task.task.create 返回 undefined（不可用）
        client.task.task.create.mockResolvedValueOnce(undefined);
        client.task.v2.task.create.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { task: { id: "task-v2-001" } },
        });

        const handler = handlers.get("create_task")!;
        const result = await handler(makeCtx({ summary: "V2 任务" }));

        expect(result).toContain("创建成功");
        expect(result).toContain("task-v2-001");
      });

      it("两个 API 路径都不可用时应返回 API 不可用提示", async () => {
        client.task.task.create.mockResolvedValueOnce(undefined);
        client.task.v2.task.create.mockResolvedValueOnce(undefined);

        const handler = handlers.get("create_task")!;
        const result = await handler(makeCtx({ summary: "测试" }));

        expect(result).toContain("创建任务失败");
        expect(result).toContain("API 不可用");
      });

      it("SDK 抛出异常时应被 catch 并尝试备用路径", async () => {
        // task.task.create 抛异常，被 catch
        client.task.task.create.mockRejectedValueOnce(new Error("网络错误"));
        // 回退到 v2 也返回 undefined
        client.task.v2.task.create.mockResolvedValueOnce(undefined);

        const handler = handlers.get("create_task")!;
        const result = await handler(makeCtx({ summary: "测试" }));

        // 两个路径都失败后返回 API 不可用
        expect(result).toContain("创建任务失败");
      });
    });

    describe("list_tasks", () => {
      it("应返回格式化的任务列表", async () => {
        const handler = handlers.get("list_tasks")!;
        const result = await handler(makeCtx({}));

        expect(client.task.task.list).toHaveBeenCalledOnce();
        expect(result).toContain("任务列表");
        expect(result).toContain("2");
        expect(result).toContain("完成测试");
        expect(result).toContain("已完成的任务");
      });

      it("无任务时应返回提示", async () => {
        client.task.task.list.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { items: [] },
        });

        const handler = handlers.get("list_tasks")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("暂无任务");
      });

      it("应限制 page_size 不超过 100", async () => {
        const handler = handlers.get("list_tasks")!;
        await handler(makeCtx({ count: 500 }));

        const callArgs = client.task.task.list.mock.calls[0][0];
        expect(callArgs.params.page_size).toBe(100);
      });

      it("task.task 路径不可用时应回退到 v2 路径", async () => {
        client.task.task.list.mockResolvedValueOnce(undefined);
        client.task.v2.task.list.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: {
            items: [
              { summary: "V2 任务", due: { time: "1700000000" }, completed_at: null },
            ],
          },
        });

        const handler = handlers.get("list_tasks")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("任务列表");
        expect(result).toContain("V2 任务");
      });

      it("两个路径都不可用时应返回 API 不可用提示", async () => {
        client.task.task.list.mockResolvedValueOnce(undefined);
        client.task.v2.task.list.mockResolvedValueOnce(undefined);

        const handler = handlers.get("list_tasks")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("获取任务列表失败");
        expect(result).toContain("API 不可用");
      });
    });

    describe("complete_task", () => {
      it("应调用 task.task.complete 完成任务并返回成功提示", async () => {
        const handler = handlers.get("complete_task")!;
        const result = await handler(makeCtx({ task_id: "task-001" }));

        expect(client.task.task.complete).toHaveBeenCalledOnce();
        const callArgs = client.task.task.complete.mock.calls[0][0];
        expect(callArgs.path.task_id).toBe("task-001");
        expect(result).toContain("task-001");
        expect(result).toContain("完成");
      });

      it("SDK 返回非 0 code 时应返回错误信息", async () => {
        client.task.task.complete.mockResolvedValueOnce({
          code: 40004,
          msg: "任务不存在",
        });

        const handler = handlers.get("complete_task")!;
        const result = await handler(makeCtx({ task_id: "invalid-id" }));

        expect(result).toContain("完成任务失败");
        expect(result).toContain("任务不存在");
      });

      it("task.task 路径不可用时应回退到 v2 路径", async () => {
        client.task.task.complete.mockResolvedValueOnce(undefined);
        client.task.v2.task.complete.mockResolvedValueOnce({
          code: 0,
          msg: "success",
        });

        const handler = handlers.get("complete_task")!;
        const result = await handler(makeCtx({ task_id: "task-v2-001" }));

        expect(result).toContain("task-v2-001");
        expect(result).toContain("完成");
      });

      it("两个路径都不可用时应返回 API 不可用提示", async () => {
        client.task.task.complete.mockResolvedValueOnce(undefined);
        client.task.v2.task.complete.mockResolvedValueOnce(undefined);

        const handler = handlers.get("complete_task")!;
        const result = await handler(makeCtx({ task_id: "task-001" }));

        expect(result).toContain("完成任务失败");
        expect(result).toContain("API 不可用");
      });
    });
  });
});

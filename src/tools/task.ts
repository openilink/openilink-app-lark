/**
 * 任务 Tools
 * 提供飞书任务创建、列表、完成等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 任务模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "create_task",
    description: "创建飞书任务",
    command: "create_task",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "任务标题" },
        due: { type: "string", description: "截止日期，ISO 日期格式（可选）" },
        description: { type: "string", description: "任务描述（可选）" },
      },
      required: ["summary"],
    },
  },
  {
    name: "list_tasks",
    description: "查看飞书任务列表",
    command: "list_tasks",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "获取数量，默认 20" },
      },
    },
  },
  {
    name: "complete_task",
    description: "完成飞书任务",
    command: "complete_task",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "任务 ID" },
      },
      required: ["task_id"],
    },
  },
];

/** 格式化截止时间 */
function formatDue(ts: string | number | undefined): string {
  if (!ts) return "无截止日期";
  const num = typeof ts === "string" ? Number(ts) : ts;
  return new Date(num * 1000).toLocaleString("zh-CN");
}

/** 创建任务模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 创建任务
  handlers.set("create_task", async (ctx) => {
    try {
      const { summary, due, description } = ctx.args;

      const data: any = {
        summary,
        // origin 为创建任务的必填参数，标识任务来源
        origin: {
          platform_i18n_name: "OpeniLink",
        },
      };
      if (description) {
        data.description = description;
      }
      if (due) {
        // 飞书 Task API 截止时间字段为 time（而非 timestamp），格式为秒级时间戳字符串
        data.due = {
          time: String(
            Math.floor(new Date(due).getTime() / 1000),
          ),
          is_all_day: false,
        };
      }

      // 优先尝试 Task API: client.task.task.create
      let resp: any = null;
      try {
        resp = await (client.task as any).task?.create?.({
          data,
          params: { user_id_type: "open_id" },
        });
      } catch {
        // task.task.create 不可用
      }

      // 如果上面的不可用，尝试 v2 路径
      if (!resp) {
        try {
          resp = await (client.task as any).v2?.task?.create?.({
            data,
            params: { user_id_type: "open_id" },
          });
        } catch {
          // v2 路径也不可用
        }
      }

      if (!resp || resp.code !== 0) {
        return `创建任务失败: ${resp?.msg || "Task API 不可用，请确认 SDK 版本和权限"}`;
      }

      return `任务"${summary}"创建成功，任务 ID: ${resp.data?.task?.id}`;
    } catch (err: any) {
      return `创建任务出错: ${err.message || err}`;
    }
  });

  // 查看任务列表
  handlers.set("list_tasks", async (ctx) => {
    try {
      const { count = 20 } = ctx.args;

      // 优先尝试 client.task.task.list
      let resp: any = null;
      try {
        resp = await (client.task as any).task?.list?.({
          params: {
            page_size: Math.min(count, 100),
            user_id_type: "open_id",
          },
        });
      } catch {
        // task.task.list 不可用
      }

      // 回退到 v2 路径
      if (!resp) {
        try {
          resp = await (client.task as any).v2?.task?.list?.({
            params: {
              page_size: Math.min(count, 100),
              user_id_type: "open_id",
            },
          });
        } catch {
          // v2 路径也不可用
        }
      }

      if (!resp || resp.code !== 0) {
        return `获取任务列表失败: ${resp?.msg || "Task API 不可用，请确认 SDK 版本和权限"}`;
      }

      const items = resp.data?.items ?? [];
      if (items.length === 0) {
        return "暂无任务";
      }

      const lines = items.map((task: any, i: number) => {
        const title = task.summary || "（无标题）";
        // 兼容 v1（due.time）和 v2（due.timestamp）两种格式
        const dueStr = formatDue(task.due?.timestamp || task.due?.time);
        const completed = task.completed_at ? "✓ 已完成" : "○ 进行中";
        return `${i + 1}. ${completed} ${title}\n   截止: ${dueStr}`;
      });

      return `任务列表（共 ${items.length} 条）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `获取任务列表出错: ${err.message || err}`;
    }
  });

  // 完成任务
  handlers.set("complete_task", async (ctx) => {
    try {
      const { task_id } = ctx.args;

      // 优先尝试 client.task.task.complete
      let resp: any = null;
      try {
        resp = await (client.task as any).task?.complete?.({
          path: { task_id },
        });
      } catch {
        // task.task.complete 不可用
      }

      // 回退到 v2 路径
      if (!resp) {
        try {
          resp = await (client.task as any).v2?.task?.complete?.({
            path: { task_id },
          });
        } catch {
          // v2 路径也不可用
        }
      }

      if (!resp || resp.code !== 0) {
        return `完成任务失败: ${resp?.msg || "Task API 不可用，请确认 SDK 版本和权限"}`;
      }

      return `任务 ${task_id} 已标记为完成`;
    } catch (err: any) {
      return `完成任务出错: ${err.message || err}`;
    }
  });

  return handlers;
}

/** 任务 Tool 模块 */
export const taskTools: ToolModule = { definitions, createHandlers };

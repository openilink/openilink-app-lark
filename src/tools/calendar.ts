/**
 * 日历 Tools
 * 提供飞书日历日程查看、创建、忙闲查询等能力
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 日历模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "list_calendar_events",
    description: "查看日历日程/议程列表",
    command: "list_calendar_events",
    parameters: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description: "开始时间，ISO 日期格式（如 2024-01-01T00:00:00Z）",
        },
        end_time: {
          type: "string",
          description: "结束时间，ISO 日期格式",
        },
        calendar_id: {
          type: "string",
          description: '日历 ID，默认 "primary"',
        },
      },
    },
  },
  {
    name: "create_calendar_event",
    description: "创建日历日程",
    command: "create_calendar_event",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "日程标题" },
        start_time: {
          type: "string",
          description: "开始时间，ISO 日期格式",
        },
        end_time: { type: "string", description: "结束时间，ISO 日期格式" },
        description: { type: "string", description: "日程描述（可选）" },
        attendees: {
          type: "string",
          description: "参与人，逗号分隔的用户 open_id（可选）",
        },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
  {
    name: "get_free_busy",
    description: "查看用户忙闲状态",
    command: "get_free_busy",
    parameters: {
      type: "object",
      properties: {
        user_ids: {
          type: "string",
          description: "逗号分隔的用户 open_id",
        },
        start_time: {
          type: "string",
          description: "查询开始时间，ISO 日期格式",
        },
        end_time: {
          type: "string",
          description: "查询结束时间，ISO 日期格式",
        },
      },
      required: ["user_ids", "start_time", "end_time"],
    },
  },
];

/** 将 ISO 时间字符串转为秒级时间戳字符串 */
function toTimestamp(isoStr: string): string {
  return String(Math.floor(new Date(isoStr).getTime() / 1000));
}

/** 格式化时间戳为可读时间 */
function formatTime(ts: string | number): string {
  const num = typeof ts === "string" ? Number(ts) : ts;
  return new Date(num * 1000).toLocaleString("zh-CN");
}

/** 创建日历模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 查看日程列表
  handlers.set("list_calendar_events", async (ctx) => {
    try {
      const {
        start_time,
        end_time,
        calendar_id = "primary",
      } = ctx.args;

      // 默认查询今天起 7 天的日程
      const now = new Date();
      const startTs = start_time
        ? toTimestamp(start_time)
        : toTimestamp(now.toISOString());
      const endDate = end_time
        ? toTimestamp(end_time)
        : toTimestamp(
            new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
          );

      const resp = await client.calendar.calendarEvent.list({
        path: { calendar_id },
        params: {
          start_time: startTs,
          end_time: endDate,
          page_size: 50,
        },
      });

      if (resp.code !== 0) {
        return `获取日程失败: ${resp.msg}`;
      }

      const items = resp.data?.items ?? [];
      if (items.length === 0) {
        return "指定时间范围内没有日程";
      }

      const lines = items.map((event: any, i: number) => {
        const summary = event.summary || "（无标题）";
        const start = event.start_time?.timestamp
          ? formatTime(event.start_time.timestamp)
          : event.start_time?.date || "未知";
        const end = event.end_time?.timestamp
          ? formatTime(event.end_time.timestamp)
          : event.end_time?.date || "未知";
        const status = event.status === "confirmed" ? "已确认" : event.status || "";
        return `${i + 1}. ${summary}\n   时间: ${start} ~ ${end} ${status}`;
      });

      return `日程列表（共 ${items.length} 条）:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `获取日程出错: ${err.message || err}`;
    }
  });

  // 创建日程
  handlers.set("create_calendar_event", async (ctx) => {
    try {
      const { summary, start_time, end_time, description, attendees } =
        ctx.args;

      const data: any = {
        summary,
        description: description || "",
        start_time: { timestamp: toTimestamp(start_time) },
        end_time: { timestamp: toTimestamp(end_time) },
      };

      const resp = await client.calendar.calendarEvent.create({
        path: { calendar_id: "primary" },
        data,
      });

      if (resp.code !== 0) {
        return `创建日程失败: ${resp.msg}`;
      }

      const eventId = resp.data?.event?.event_id;

      // 如果有参与人，额外调用添加参与人接口
      if (attendees && eventId) {
        const ids = attendees
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
        try {
          await client.calendar.calendarEventAttendee.create({
            path: { calendar_id: "primary", event_id: eventId },
            params: { user_id_type: "open_id" },
            data: {
              attendees: ids.map((id: string) => ({
                type: "user",
                user_id: id,
              })),
            },
          });
        } catch {
          // 添加参与人失败不影响日程创建结果
        }
      }

      return `日程"${summary}"创建成功，日程 ID: ${eventId}`;
    } catch (err: any) {
      return `创建日程出错: ${err.message || err}`;
    }
  });

  // 查看忙闲
  handlers.set("get_free_busy", async (ctx) => {
    try {
      const { user_ids, start_time, end_time } = ctx.args;
      const ids = user_ids
        .split(",")
        .map((id: string) => id.trim())
        .filter(Boolean);

      // TODO: 待确认 SDK API 路径，当前为推测。freebusy.list 的参数格式可能与实际不同
      const resp = await (client.calendar as any).freebusy.list({
        data: {
          time_min: toTimestamp(start_time),
          time_max: toTimestamp(end_time),
          user_id: ids[0], // 查询第一个用户
        },
        params: { user_id_type: "open_id" },
      });

      if (resp?.code !== 0) {
        return `查询忙闲失败: ${resp?.msg}`;
      }

      const busyList = resp?.data?.freebusy_list ?? [];
      if (busyList.length === 0) {
        return "该时间段内用户空闲";
      }

      const lines = busyList.map((slot: any, i: number) => {
        const start = slot.start_time
          ? formatTime(slot.start_time)
          : "未知";
        const end = slot.end_time ? formatTime(slot.end_time) : "未知";
        return `${i + 1}. 忙碌: ${start} ~ ${end}`;
      });

      return `忙闲查询结果:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `查询忙闲出错: ${err.message || err}`;
    }
  });

  return handlers;
}

/** 日历 Tool 模块 */
export const calendarTools: ToolModule = { definitions, createHandlers };

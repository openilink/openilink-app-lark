/**
 * 视频会议 Tools
 * 提供飞书视频会议记录查看、会议纪要获取能力
 * 注意: SDK 中视频会议 API 路径不确定，当前使用 (client as any) 调用
 */
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ToolDefinition, ToolHandler } from "../hub/types.js";
import type { ToolModule } from "./index.js";

/** 视频会议模块 tool 定义列表 */
const definitions: ToolDefinition[] = [
  {
    name: "list_meetings",
    description: "查看飞书视频会议记录",
    command: "list_meetings",
    parameters: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description: "开始时间（可选，ISO 格式）",
        },
        end_time: {
          type: "string",
          description: "结束时间（可选，ISO 格式）",
        },
      },
    },
  },
  {
    name: "get_meeting_summary",
    description: "获取飞书视频会议的纪要内容",
    command: "get_meeting_summary",
    parameters: {
      type: "object",
      properties: {
        meeting_id: { type: "string", description: "会议 ID" },
      },
      required: ["meeting_id"],
    },
  },
];

/** 创建视频会议模块的 handler 映射 */
function createHandlers(client: lark.Client): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 查看会议记录
  // TODO: 待确认 SDK API 路径，当前为推测。可能是 client.vc.meeting.list 或 client.vc.meetingList.get
  handlers.set("list_meetings", async (ctx) => {
    const startTime: string = ctx.args.start_time ?? "";
    const endTime: string = ctx.args.end_time ?? "";

    try {
      const params: Record<string, any> = {};
      if (startTime) params.start_time = startTime;
      if (endTime) params.end_time = endTime;

      const res = await (client as any).vc?.meeting?.list?.({
        params,
      });

      if (!res || res.code !== 0) {
        return `查看会议记录失败: ${res?.msg || "视频会议 API 不可用，请确认权限配置"}`;
      }

      const meetings = res?.data?.meeting_list ?? [];
      if (meetings.length === 0) {
        return "暂无会议记录";
      }

      const lines = meetings.map((m: any, i: number) => {
        const topic = m.topic ?? "无主题";
        const meetingId = m.meeting_id ?? "未知";
        const start = m.start_time ?? "未知";
        const end = m.end_time ?? "进行中";
        return `${i + 1}. ${topic} (ID: ${meetingId})\n   时间: ${start} ~ ${end}`;
      });
      return `共 ${meetings.length} 场会议:\n${lines.join("\n")}`;
    } catch (err: any) {
      return `查看会议记录失败: ${err.message ?? err}`;
    }
  });

  // 获取会议纪要
  // TODO: 待确认 SDK API 路径，当前为推测。会议信息和纪要可能分别在不同接口
  handlers.set("get_meeting_summary", async (ctx) => {
    const meetingId: string = ctx.args.meeting_id ?? "";

    try {
      const res = await (client as any).vc?.meeting?.get?.({
        path: { meeting_id: meetingId },
      });

      if (!res || res.code !== 0) {
        return `获取会议纪要失败: ${res?.msg || "视频会议 API 不可用，请确认权限配置"}`;
      }

      const meeting = res?.data?.meeting ?? {};
      const topic = meeting.topic ?? "未知主题";
      const startTime = meeting.start_time ?? "未知";
      const endTime = meeting.end_time ?? "未知";

      // 尝试获取纪要内容
      // TODO: 待确认 SDK API 路径，会议纪要可能在 client.vc.meetingMinute 下
      let summaryText = "暂无会议纪要";
      try {
        const summaryRes = await (client as any).vc?.meetingMinute?.get?.({
          path: { meeting_id: meetingId },
        });
        if (summaryRes?.code === 0) {
          summaryText =
            summaryRes?.data?.minute?.content ?? "暂无会议纪要";
        }
      } catch {
        // 纪要接口可能不可用，使用默认值
      }

      const lines = [
        `会议主题: ${topic}`,
        `会议 ID: ${meetingId}`,
        `开始时间: ${startTime}`,
        `结束时间: ${endTime}`,
        `---`,
        `会议纪要:`,
        summaryText,
      ];
      return lines.join("\n");
    } catch (err: any) {
      return `获取会议纪要失败: ${err.message ?? err}`;
    }
  });

  return handlers;
}

/** 视频会议 Tool 模块 */
export const vcTools: ToolModule = { definitions, createHandlers };

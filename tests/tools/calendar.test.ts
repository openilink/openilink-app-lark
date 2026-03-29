/**
 * tools/calendar.ts 测试
 * Mock lark.Client 验证日历工具的 handler 和定义
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { calendarTools } from "../../src/tools/calendar.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    calendar: {
      calendarEvent: {
        list: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            items: [
              {
                summary: "周会",
                start_time: { timestamp: "1700000000" },
                end_time: { timestamp: "1700003600" },
                status: "confirmed",
              },
              {
                summary: "一对一",
                start_time: { timestamp: "1700010000" },
                end_time: { timestamp: "1700013600" },
                status: "confirmed",
              },
            ],
          },
        }),
        create: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: {
            event: { event_id: "evt-new-001" },
          },
        }),
      },
      calendarEventAttendee: {
        create: vi.fn().mockResolvedValue({ code: 0, msg: "success" }),
      },
      freebusy: {
        list: vi.fn().mockResolvedValue({
          code: 0,
          msg: "success",
          data: { freebusy_list: [] },
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

describe("calendarTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有日历相关工具定义", () => {
      const { definitions } = calendarTools;
      const names = definitions.map((d) => d.name);

      expect(names).toContain("list_calendar_events");
      expect(names).toContain("create_calendar_event");
      expect(names).toContain("get_free_busy");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of calendarTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("create_calendar_event 应要求 summary, start_time, end_time 为必填", () => {
      const createDef = calendarTools.definitions.find(
        (d) => d.name === "create_calendar_event",
      );
      expect(createDef?.parameters?.required).toContain("summary");
      expect(createDef?.parameters?.required).toContain("start_time");
      expect(createDef?.parameters?.required).toContain("end_time");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = calendarTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of calendarTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("list_calendar_events", () => {
      it("应返回格式化的日程列表", async () => {
        const handler = handlers.get("list_calendar_events")!;
        const result = await handler(
          makeCtx({
            start_time: "2024-01-01T00:00:00Z",
            end_time: "2024-01-07T23:59:59Z",
          }),
        );

        expect(client.calendar.calendarEvent.list).toHaveBeenCalledOnce();
        expect(result).toContain("日程列表");
        expect(result).toContain("周会");
        expect(result).toContain("一对一");
        expect(result).toContain("2");  // 共 2 条
      });

      it("无日程时应返回提示", async () => {
        client.calendar.calendarEvent.list.mockResolvedValueOnce({
          code: 0,
          msg: "success",
          data: { items: [] },
        });

        const handler = handlers.get("list_calendar_events")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("没有日程");
      });

      it("不传时间参数时应使用默认时间范围", async () => {
        const handler = handlers.get("list_calendar_events")!;
        await handler(makeCtx({}));

        // 应该已被调用（使用默认时间）
        expect(client.calendar.calendarEvent.list).toHaveBeenCalledOnce();
        const callArgs = client.calendar.calendarEvent.list.mock.calls[0][0];
        // 默认 calendar_id 应为 "primary"
        expect(callArgs.path.calendar_id).toBe("primary");
      });

      it("SDK 返回非 0 code 时应返回失败消息", async () => {
        client.calendar.calendarEvent.list.mockResolvedValueOnce({
          code: 99999,
          msg: "无权限",
          data: null,
        });

        const handler = handlers.get("list_calendar_events")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("获取日程失败");
        expect(result).toContain("无权限");
      });
    });

    describe("create_calendar_event", () => {
      it("应创建日程并返回日程 ID", async () => {
        const handler = handlers.get("create_calendar_event")!;
        const result = await handler(
          makeCtx({
            summary: "新日程",
            start_time: "2024-06-01T10:00:00Z",
            end_time: "2024-06-01T11:00:00Z",
          }),
        );

        expect(client.calendar.calendarEvent.create).toHaveBeenCalledOnce();
        const callArgs = client.calendar.calendarEvent.create.mock.calls[0][0];
        expect(callArgs.data.summary).toBe("新日程");
        expect(callArgs.path.calendar_id).toBe("primary");
        expect(result).toContain("创建成功");
        expect(result).toContain("evt-new-001");
      });

      it("包含描述参数时应传递到 API", async () => {
        const handler = handlers.get("create_calendar_event")!;
        await handler(
          makeCtx({
            summary: "带描述的日程",
            start_time: "2024-06-01T10:00:00Z",
            end_time: "2024-06-01T11:00:00Z",
            description: "这是一个测试日程",
          }),
        );

        const callArgs = client.calendar.calendarEvent.create.mock.calls[0][0];
        expect(callArgs.data.description).toBe("这是一个测试日程");
      });

      it("包含 attendees 时应额外调用添加参与人接口", async () => {
        const handler = handlers.get("create_calendar_event")!;
        await handler(
          makeCtx({
            summary: "团队会议",
            start_time: "2024-06-01T10:00:00Z",
            end_time: "2024-06-01T11:00:00Z",
            attendees: "ou_user1,ou_user2",
          }),
        );

        // 应调用创建日程和添加参与人
        expect(client.calendar.calendarEvent.create).toHaveBeenCalledOnce();
        expect(client.calendar.calendarEventAttendee.create).toHaveBeenCalledOnce();

        const attendeeArgs =
          client.calendar.calendarEventAttendee.create.mock.calls[0][0];
        expect(attendeeArgs.path.event_id).toBe("evt-new-001");
        expect(attendeeArgs.data.attendees).toHaveLength(2);
      });

      it("SDK 返回非 0 code 时应返回失败消息", async () => {
        client.calendar.calendarEvent.create.mockResolvedValueOnce({
          code: 99999,
          msg: "创建日程出错",
          data: null,
        });

        const handler = handlers.get("create_calendar_event")!;
        const result = await handler(
          makeCtx({
            summary: "失败测试",
            start_time: "2024-06-01T10:00:00Z",
            end_time: "2024-06-01T11:00:00Z",
          }),
        );

        expect(result).toContain("创建日程失败");
      });
    });
  });
});

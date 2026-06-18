/**
 * tools/vc.ts 测试
 * Mock lark.Client 验证视频会议工具的 handler 和定义
 *
 * 注意: 源码使用 client.vc?.meetingList?.get 获取会议列表，
 * 使用 client.vc?.meeting?.get 获取单场会议信息；会议纪要不再单独请求，
 * 而是返回引导用户通过文档 API（read_doc）获取纪要的提示。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { vcTools } from "../../src/tools/vc.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的飞书 SDK Client */
function createMockLarkSdkClient() {
  return {
    vc: {
      meetingList: {
        get: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            meeting_list: [
              {
                topic: "周一例会",
                meeting_id: "meeting_001",
                start_time: "2024-06-01 09:00",
                end_time: "2024-06-01 10:00",
              },
              {
                topic: "项目评审",
                meeting_id: "meeting_002",
                start_time: "2024-06-02 14:00",
                end_time: "2024-06-02 15:00",
              },
            ],
          },
        }),
      },
      meeting: {
        get: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            meeting: {
              topic: "周一例会",
              start_time: "2024-06-01 09:00",
              end_time: "2024-06-01 10:00",
            },
          },
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

describe("vcTools", () => {
  describe("tool definitions 结构", () => {
    it("应包含所有视频会议相关工具定义", () => {
      const names = vcTools.definitions.map((d) => d.name);

      expect(names).toContain("list_meetings");
      expect(names).toContain("get_meeting_summary");
    });

    it("每个定义应包含 name, description, command 字段", () => {
      for (const def of vcTools.definitions) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.command).toBeTruthy();
      }
    });

    it("get_meeting_summary 应要求 meeting_id 为必填参数", () => {
      const def = vcTools.definitions.find((d) => d.name === "get_meeting_summary");
      expect(def?.parameters?.required).toContain("meeting_id");
    });
  });

  describe("createHandlers", () => {
    let client: ReturnType<typeof createMockLarkSdkClient>;
    let handlers: Map<string, any>;

    beforeEach(() => {
      client = createMockLarkSdkClient();
      handlers = vcTools.createHandlers(client);
    });

    it("应创建与 definitions 对应的 handler", () => {
      for (const def of vcTools.definitions) {
        expect(handlers.has(def.command)).toBe(true);
      }
    });

    describe("list_meetings", () => {
      it("应调用 SDK 获取会议列表并返回格式化结果", async () => {
        const handler = handlers.get("list_meetings")!;
        const result = await handler(makeCtx({}));

        expect(client.vc.meetingList.get).toHaveBeenCalledOnce();
        expect(result).toContain("2");
        expect(result).toContain("周一例会");
        expect(result).toContain("项目评审");
        expect(result).toContain("meeting_001");
      });

      it("传入时间范围时应传递给 SDK", async () => {
        const handler = handlers.get("list_meetings")!;
        await handler(
          makeCtx({
            start_time: "2024-06-01",
            end_time: "2024-06-30",
          }),
        );

        const callArgs = client.vc.meetingList.get.mock.calls[0][0];
        expect(callArgs.params.start_time).toBe("2024-06-01");
        expect(callArgs.params.end_time).toBe("2024-06-30");
      });

      it("无会议记录时应返回提示", async () => {
        client.vc.meetingList.get.mockResolvedValueOnce({
          code: 0,
          data: { meeting_list: [] },
        });

        const handler = handlers.get("list_meetings")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("暂无会议记录");
      });

      it("API 不可用时应返回错误提示", async () => {
        // 模拟 vc 为 undefined
        const clientNoVc = {} as any;
        const handlersNoVc = vcTools.createHandlers(clientNoVc);
        const handler = handlersNoVc.get("list_meetings")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("查看会议记录失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.vc.meetingList.get.mockRejectedValueOnce(new Error("会议服务不可用"));

        const handler = handlers.get("list_meetings")!;
        const result = await handler(makeCtx({}));

        expect(result).toContain("查看会议记录失败");
        expect(result).toContain("会议服务不可用");
      });
    });

    describe("get_meeting_summary", () => {
      it("应调用 SDK 获取会议信息并返回格式化结果及纪要获取指引", async () => {
        const handler = handlers.get("get_meeting_summary")!;
        const result = await handler(makeCtx({ meeting_id: "meeting_001" }));

        expect(client.vc.meeting.get).toHaveBeenCalledOnce();
        const callArgs = client.vc.meeting.get.mock.calls[0][0];
        expect(callArgs.path.meeting_id).toBe("meeting_001");

        expect(result).toContain("周一例会");
        expect(result).toContain("meeting_001");
        // 纪要通过文档 API 获取，应给出 read_doc 指引
        expect(result).toContain("read_doc");
      });

      it("会议信息 API 不可用时应返回错误提示", async () => {
        // 模拟 vc 为 undefined
        const clientNoVc = {} as any;
        const handlersNoVc = vcTools.createHandlers(clientNoVc);
        const handler = handlersNoVc.get("get_meeting_summary")!;
        const result = await handler(makeCtx({ meeting_id: "meeting_001" }));

        expect(result).toContain("获取会议信息失败");
      });

      it("SDK 返回非 0 code 时应返回错误提示", async () => {
        client.vc.meeting.get.mockResolvedValueOnce({
          code: 40003,
          msg: "无权限",
        });

        const handler = handlers.get("get_meeting_summary")!;
        const result = await handler(makeCtx({ meeting_id: "meeting_001" }));

        expect(result).toContain("获取会议信息失败");
      });

      it("SDK 抛出异常时应返回错误信息", async () => {
        client.vc.meeting.get.mockRejectedValueOnce(new Error("会议不存在"));

        const handler = handlers.get("get_meeting_summary")!;
        const result = await handler(makeCtx({ meeting_id: "invalid" }));

        expect(result).toContain("获取会议信息失败");
        expect(result).toContain("会议不存在");
      });
    });
  });
});

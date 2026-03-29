/**
 * tools/index.ts 测试
 * 验证 collectAllTools 收集所有模块的定义和处理函数
 */
import { describe, it, expect, vi } from "vitest";
import { collectAllTools } from "../../src/tools/index.js";

/** 创建包含所有模块所需方法的模拟 SDK Client */
function createMockLarkSdkClient() {
  return {
    // IM 模块
    im: {
      message: {
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        reply: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
      },
      chat: {
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        search: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 日历模块
    calendar: {
      calendarEvent: {
        list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
      calendarFreeBusy: {
        list: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
      calendar: {
        list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        primary: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 文档模块
    docx: {
      document: {
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        rawContent: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
      documentBlock: {
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 任务模块
    task: {
      v2: {
        task: {
          create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
          list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
          complete: vi.fn().mockResolvedValue({ code: 0 }),
        },
      },
      task: {
        create: vi.fn(),
        list: vi.fn(),
        complete: vi.fn(),
      },
    },
    // 通讯录模块
    contact: {
      user: {
        batchGetId: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        search: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 云空间模块
    drive: {
      file: {
        search: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 多维表格模块
    bitable: {
      appTableRecord: {
        list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        update: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 电子表格模块
    sheets: {
      spreadsheetSheetValue: {
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        update: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        append: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 邮箱模块
    mail: {
      userMailboxMessage: {
        list: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        create: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 知识库模块
    wiki: {
      spaceNode: {
        search: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 视频会议模块
    vc: {
      meeting: {
        list: vi.fn().mockResolvedValue({ code: 0, data: {} }),
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
      meetingMinute: {
        get: vi.fn().mockResolvedValue({ code: 0, data: {} }),
      },
    },
    // 搜索 API（文档搜索用）
    suite: {
      search: vi.fn().mockResolvedValue({ code: 0, data: {} }),
    },
  } as any;
}

describe("collectAllTools", () => {
  it("应返回所有模块的 definitions", () => {
    const client = createMockLarkSdkClient();
    const { definitions } = collectAllTools(client);

    // 应包含来自各模块的定义
    expect(definitions.length).toBeGreaterThan(0);

    // 检查各模块的关键 tool 是否存在
    const names = definitions.map((d) => d.name);
    // IM 模块
    expect(names).toContain("send_lark_message");
    // 文档模块
    expect(names).toContain("create_doc");
    // 任务模块
    expect(names).toContain("create_task");
    // 通讯录模块
    expect(names).toContain("search_contact");
    // 云空间模块
    expect(names).toContain("search_files");
    // 多维表格模块
    expect(names).toContain("list_base_records");
    // 电子表格模块
    expect(names).toContain("read_sheet");
    // 邮箱模块
    expect(names).toContain("send_mail");
    // 知识库模块
    expect(names).toContain("search_wiki");
    // 视频会议模块
    expect(names).toContain("list_meetings");
  });

  it("应返回所有模块的 handlers", () => {
    const client = createMockLarkSdkClient();
    const { handlers } = collectAllTools(client);

    expect(handlers.size).toBeGreaterThan(0);

    // 检查关键 handler 是否存在
    expect(handlers.has("send_lark_message")).toBe(true);
    expect(handlers.has("create_doc")).toBe(true);
    expect(handlers.has("create_task")).toBe(true);
    expect(handlers.has("search_contact")).toBe(true);
  });

  it("所有 definitions 中的 command 都应有对应 handler", () => {
    const client = createMockLarkSdkClient();
    const { definitions, handlers } = collectAllTools(client);

    for (const def of definitions) {
      expect(
        handlers.has(def.command) || handlers.has(def.name),
        `tool "${def.name}" (command: ${def.command}) 缺少对应的 handler`,
      ).toBe(true);
    }
  });

  it("不应存在重名的 tool 定义", () => {
    const client = createMockLarkSdkClient();
    const { definitions } = collectAllTools(client);

    const names = definitions.map((d) => d.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it("每个 definition 都应有 name, description, command 字段", () => {
    const client = createMockLarkSdkClient();
    const { definitions } = collectAllTools(client);

    for (const def of definitions) {
      expect(def.name, `定义缺少 name`).toBeTruthy();
      expect(def.description, `工具 "${def.name}" 缺少 description`).toBeTruthy();
      expect(def.command, `工具 "${def.name}" 缺少 command`).toBeTruthy();
    }
  });

  it("每个 handler 应是一个函数", () => {
    const client = createMockLarkSdkClient();
    const { handlers } = collectAllTools(client);

    for (const [name, handler] of handlers) {
      expect(typeof handler, `handler "${name}" 不是函数`).toBe("function");
    }
  });
});

/**
 * config.ts 测试
 * 验证配置加载、默认值和必填项校验
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  /** 保存原始环境变量，测试结束后恢复 */
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 每个测试前清理相关环境变量
    delete process.env.PORT;
    delete process.env.HUB_URL;
    delete process.env.BASE_URL;
    delete process.env.DB_PATH;
    delete process.env.LARK_APP_ID;
    delete process.env.LARK_APP_SECRET;
    delete process.env.LARK_CHAT_ID;
  });

  afterEach(() => {
    // 恢复原始环境变量
    process.env = { ...originalEnv };
  });

  it("缺少所有必填项时应抛出错误，并列出全部缺失项", () => {
    expect(() => loadConfig()).toThrowError("缺少必填环境变量: HUB_URL, BASE_URL, LARK_APP_ID, LARK_APP_SECRET");
  });

  it("缺少 HUB_URL 时应抛出错误", () => {
    process.env.LARK_APP_ID = "test-id";
    process.env.LARK_APP_SECRET = "test-secret";
    expect(() => loadConfig()).toThrowError("HUB_URL");
  });

  it("缺少 LARK_APP_ID 时应抛出错误", () => {
    process.env.HUB_URL = "http://hub.test";
    process.env.LARK_APP_SECRET = "test-secret";
    expect(() => loadConfig()).toThrowError("LARK_APP_ID");
  });

  it("缺少 LARK_APP_SECRET 时应抛出错误", () => {
    process.env.HUB_URL = "http://hub.test";
    process.env.LARK_APP_ID = "test-id";
    expect(() => loadConfig()).toThrowError("LARK_APP_SECRET");
  });

  it("提供所有必填项后应正确加载默认值", () => {
    process.env.HUB_URL = "http://hub.test";
    process.env.BASE_URL = "http://app.test";
    process.env.LARK_APP_ID = "test-id";
    process.env.LARK_APP_SECRET = "test-secret";

    const cfg = loadConfig();
    // 验证默认值
    expect(cfg.port).toBe("8081");
    expect(cfg.dbPath).toBe("data/lark.db");
    expect(cfg.baseUrl).toBe("http://app.test");
    expect(cfg.larkChatId).toBe("");
  });

  it("所有环境变量应正确映射到配置对象", () => {
    process.env.PORT = "3000";
    process.env.HUB_URL = "http://hub.example.com";
    process.env.BASE_URL = "http://app.example.com";
    process.env.DB_PATH = "/tmp/test.db";
    process.env.LARK_APP_ID = "lark-app-123";
    process.env.LARK_APP_SECRET = "lark-secret-456";
    process.env.LARK_CHAT_ID = "oc_abc123";

    const cfg = loadConfig();

    expect(cfg.port).toBe("3000");
    expect(cfg.hubUrl).toBe("http://hub.example.com");
    expect(cfg.baseUrl).toBe("http://app.example.com");
    expect(cfg.dbPath).toBe("/tmp/test.db");
    expect(cfg.larkAppId).toBe("lark-app-123");
    expect(cfg.larkAppSecret).toBe("lark-secret-456");
    expect(cfg.larkChatId).toBe("oc_abc123");
  });
});

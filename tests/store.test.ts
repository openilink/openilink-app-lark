/**
 * store.ts 测试
 * 使用临时文件数据库验证安装管理和消息映射功能
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Store", () => {
  let store: Store;
  let tmpDir: string;

  beforeEach(() => {
    // 每个测试使用独立的临时目录
    tmpDir = mkdtempSync(join(tmpdir(), "store-test-"));
    store = new Store(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    // 清理临时目录
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 安装管理 ───

  describe("saveInstallation / getInstallation", () => {
    it("保存后应能正确读取安装记录", () => {
      const inst = {
        id: "inst-001",
        hubUrl: "http://hub.test",
        appId: "app-123",
        botId: "bot-456",
        appToken: "token-xyz",
        webhookSecret: "secret-abc",
        createdAt: new Date().toISOString(),
      };

      store.saveInstallation(inst);
      const result = store.getInstallation("inst-001");

      expect(result).toBeDefined();
      expect(result!.id).toBe("inst-001");
      expect(result!.hubUrl).toBe("http://hub.test");
      expect(result!.appId).toBe("app-123");
      expect(result!.botId).toBe("bot-456");
      expect(result!.appToken).toBe("token-xyz");
      expect(result!.webhookSecret).toBe("secret-abc");
    });

    it("相同 ID 的安装记录应被更新（INSERT OR REPLACE）", () => {
      store.saveInstallation({
        id: "inst-001",
        hubUrl: "http://hub.test",
        appId: "app-old",
        botId: "bot-old",
        appToken: "token-old",
        webhookSecret: "secret-old",
        createdAt: new Date().toISOString(),
      });

      store.saveInstallation({
        id: "inst-001",
        hubUrl: "http://hub.test",
        appId: "app-new",
        botId: "bot-new",
        appToken: "token-new",
        webhookSecret: "secret-new",
        createdAt: new Date().toISOString(),
      });

      const result = store.getInstallation("inst-001");
      expect(result!.appId).toBe("app-new");
      expect(result!.appToken).toBe("token-new");
    });

    it("不存在的安装记录应返回 undefined", () => {
      const result = store.getInstallation("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("getAllInstallations", () => {
    it("无记录时应返回空数组", () => {
      const all = store.getAllInstallations();
      expect(all).toEqual([]);
    });

    it("应返回所有安装记录", () => {
      store.saveInstallation({
        id: "inst-001",
        hubUrl: "http://hub.test",
        appId: "app-1",
        botId: "bot-1",
        appToken: "token-1",
        webhookSecret: "secret-1",
        createdAt: new Date().toISOString(),
      });
      store.saveInstallation({
        id: "inst-002",
        hubUrl: "http://hub.test",
        appId: "app-2",
        botId: "bot-2",
        appToken: "token-2",
        webhookSecret: "secret-2",
        createdAt: new Date().toISOString(),
      });

      const all = store.getAllInstallations();
      expect(all).toHaveLength(2);
      expect(all.map((i) => i.id).sort()).toEqual(["inst-001", "inst-002"]);
    });
  });

  // ─── 消息映射 ───

  describe("saveMessageLink / getMessageLinkByLarkId", () => {
    it("保存后应能通过飞书消息 ID 查询到映射", () => {
      store.saveMessageLink({
        installationId: "inst-001",
        larkMessageId: "lark-msg-001",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
      });

      const link = store.getMessageLinkByLarkId("lark-msg-001");
      expect(link).toBeDefined();
      expect(link!.installationId).toBe("inst-001");
      expect(link!.larkMessageId).toBe("lark-msg-001");
      expect(link!.wxUserId).toBe("wx-user-001");
      expect(link!.wxUserName).toBe("张三");
      expect(link!.id).toBeDefined();
    });

    it("不存在的飞书消息 ID 应返回 undefined", () => {
      const link = store.getMessageLinkByLarkId("non-existent");
      expect(link).toBeUndefined();
    });
  });

  describe("getLatestLinkByWxUser", () => {
    it("应返回该微信用户最近一条消息映射", () => {
      store.saveMessageLink({
        installationId: "inst-001",
        larkMessageId: "lark-msg-001",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
      });
      store.saveMessageLink({
        installationId: "inst-001",
        larkMessageId: "lark-msg-002",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
      });

      const link = store.getLatestLinkByWxUser("wx-user-001");
      expect(link).toBeDefined();
      // 最新的一条应该是 lark-msg-002（ID 更大）
      expect(link!.larkMessageId).toBe("lark-msg-002");
    });

    it("不存在的微信用户应返回 undefined", () => {
      const link = store.getLatestLinkByWxUser("non-existent");
      expect(link).toBeUndefined();
    });
  });
});

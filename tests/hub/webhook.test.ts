/**
 * hub/webhook.ts 测试
 * 模拟 HTTP 请求验证 Webhook 处理逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { EventEmitter, Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleWebhook, type EventCallback } from "../../src/hub/webhook.js";
import type { Installation } from "../../src/hub/types.js";

/**
 * 创建模拟的 IncomingMessage
 * @param body 请求体内容
 * @param headers 请求头
 */
function createMockReq(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const readable = new Readable({
    read() {
      this.push(Buffer.from(body));
      this.push(null);
    },
  });
  (readable as any).headers = headers;
  (readable as any).url = "/webhook";
  return readable as unknown as IncomingMessage;
}

/**
 * 创建模拟的 ServerResponse，捕获状态码和响应体
 */
function createMockRes(): ServerResponse & { _statusCode: number; _body: string } {
  const res: any = {
    _statusCode: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) {
      res._statusCode = code;
      if (headers) res._headers = headers;
    },
    end(data?: string) {
      res._body = data ?? "";
    },
  };
  return res;
}

/** 创建模拟的 Store */
function createMockStore(installation?: Installation) {
  return {
    getInstallation: vi.fn().mockReturnValue(installation),
    saveInstallation: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue(installation ? [installation] : []),
    saveMessageLink: vi.fn(),
    getMessageLinkByLarkId: vi.fn(),
    getLatestLinkByWxUser: vi.fn(),
    close: vi.fn(),
  } as any;
}

/** 计算正确签名 */
function computeSignature(secret: string, timestamp: string, body: Buffer): string {
  const mac = createHmac("sha256", secret);
  mac.update(timestamp + ":");
  mac.update(body);
  return "sha256=" + mac.digest("hex");
}

describe("handleWebhook", () => {
  const testInstallation: Installation = {
    id: "inst-001",
    hubUrl: "http://hub.test",
    appId: "app-123",
    botId: "bot-456",
    appToken: "token-xyz",
    webhookSecret: "test-secret",
    createdAt: new Date().toISOString(),
  };

  describe("url_verification 事件", () => {
    it("应直接返回 challenge", async () => {
      const body = JSON.stringify({
        v: 1,
        type: "url_verification",
        challenge: "test-challenge-string",
      });
      const req = createMockReq(body);
      const res = createMockRes();
      const store = createMockStore();
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(200);
      const parsed = JSON.parse(res._body);
      expect(parsed.challenge).toBe("test-challenge-string");
      // url_verification 不应调用 onEvent
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("签名验证", () => {
    it("签名验证成功时应调用 onEvent", async () => {
      const bodyObj = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "inst-001",
        bot: { id: "bot-456" },
        event: { type: "message.text", id: "evt-001", timestamp: 1700000000, data: {} },
      };
      const bodyStr = JSON.stringify(bodyObj);
      const bodyBuf = Buffer.from(bodyStr);
      const timestamp = "1700000000";
      const signature = computeSignature("test-secret", timestamp, bodyBuf);

      const req = createMockReq(bodyStr, {
        "x-timestamp": timestamp,
        "x-signature": signature,
      });
      const res = createMockRes();
      const store = createMockStore(testInstallation);
      const onEvent: EventCallback = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(200);
      expect(onEvent).toHaveBeenCalledOnce();
      // 验证 onEvent 接收到的参数
      const [receivedEvent, receivedInst] = (onEvent as any).mock.calls[0];
      expect(receivedEvent.installation_id).toBe("inst-001");
      expect(receivedInst.id).toBe("inst-001");
    });

    it("签名验证失败时应返回 401", async () => {
      const bodyObj = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "inst-001",
        bot: { id: "bot-456" },
        event: { type: "message.text", id: "evt-001", timestamp: 1700000000, data: {} },
      };
      const bodyStr = JSON.stringify(bodyObj);

      const req = createMockReq(bodyStr, {
        "x-timestamp": "1700000000",
        "x-signature": "sha256=invalid-signature-value-that-is-definitely-wrong!!",
      });
      const res = createMockRes();
      const store = createMockStore(testInstallation);
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(401);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("缺少签名头时应返回 401", async () => {
      const bodyObj = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "inst-001",
        bot: { id: "bot-456" },
        event: { type: "message.text", id: "evt-001", timestamp: 1700000000, data: {} },
      };
      const bodyStr = JSON.stringify(bodyObj);

      // 不传签名头
      const req = createMockReq(bodyStr);
      const res = createMockRes();
      const store = createMockStore(testInstallation);
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(401);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("安装记录查找", () => {
    it("找不到 installation 时应返回 404", async () => {
      const bodyObj = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "non-existent",
        bot: { id: "bot-456" },
        event: { type: "message.text", id: "evt-001", timestamp: 1700000000, data: {} },
      };
      const bodyStr = JSON.stringify(bodyObj);

      const req = createMockReq(bodyStr, {
        "x-timestamp": "1700000000",
        "x-signature": "sha256=something",
      });
      const res = createMockRes();
      // Store 返回 undefined（找不到安装记录）
      const store = createMockStore(undefined);
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(404);
      const parsed = JSON.parse(res._body);
      expect(parsed.error).toContain("安装记录不存在");
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("缺少 installation_id 时应返回 400", async () => {
      const bodyObj = {
        v: 1,
        type: "event",
        trace_id: "trace-001",
        installation_id: "",
        bot: { id: "bot-456" },
        event: { type: "message.text", id: "evt-001", timestamp: 1700000000, data: {} },
      };
      const bodyStr = JSON.stringify(bodyObj);

      const req = createMockReq(bodyStr, {
        "x-timestamp": "1700000000",
        "x-signature": "sha256=something",
      });
      const res = createMockRes();
      const store = createMockStore();
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(400);
    });
  });

  describe("异常处理", () => {
    it("无效 JSON 请求体应返回 400", async () => {
      const req = createMockReq("not-valid-json{{{");
      const res = createMockRes();
      const store = createMockStore();
      const onEvent = vi.fn();

      await handleWebhook(req, res, store, onEvent);

      expect(res._statusCode).toBe(400);
      const parsed = JSON.parse(res._body);
      expect(parsed.error).toContain("JSON");
    });
  });
});

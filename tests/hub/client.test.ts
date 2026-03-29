/**
 * hub/client.ts 测试
 * Mock fetch 验证 HubClient 的消息发送逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HubClient } from "../../src/hub/client.js";

describe("HubClient", () => {
  const hubUrl = "http://hub.test";
  const appToken = "test-app-token";
  let client: HubClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new HubClient(hubUrl, appToken);
    // Mock 全局 fetch
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendText", () => {
    it("应发送正确格式的文本消息请求", async () => {
      await client.sendText("wx-user-001", "你好");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${hubUrl}/api/bot/send`);
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["Authorization"]).toBe(`Bearer ${appToken}`);

      const body = JSON.parse(options.body);
      expect(body.to).toBe("wx-user-001");
      expect(body.type).toBe("text");
      expect(body.content).toBe("你好");
    });

    it("传入 traceId 时应包含在请求体中", async () => {
      await client.sendText("wx-user-001", "你好", "trace-123");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.trace_id).toBe("trace-123");
    });

    it("不传 traceId 时请求体不应包含 trace_id 字段", async () => {
      await client.sendText("wx-user-001", "你好");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.trace_id).toBeUndefined();
    });
  });

  describe("sendImage", () => {
    it("应发送 image 类型的消息", async () => {
      await client.sendImage("wx-user-001", "https://example.com/photo.jpg");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("image");
      expect(body.content).toBe("https://example.com/photo.jpg");
      expect(body.to).toBe("wx-user-001");
    });
  });

  describe("sendFile", () => {
    it("应发送 file 类型的消息，content 为 JSON 字符串", async () => {
      await client.sendFile("wx-user-001", "https://example.com/doc.pdf", "文档.pdf");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("file");
      const content = JSON.parse(body.content);
      expect(content.url).toBe("https://example.com/doc.pdf");
      expect(content.name).toBe("文档.pdf");
    });
  });

  describe("sendMessage", () => {
    it("应发送通用类型消息", async () => {
      await client.sendMessage("wx-user-001", "custom", "自定义内容");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("custom");
      expect(body.content).toBe("自定义内容");
    });

    it("fetch 返回非 ok 状态时应抛出错误", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("server error"),
      });

      await expect(
        client.sendMessage("wx-user-001", "text", "测试"),
      ).rejects.toThrowError(/发送消息失败.*500/);
    });

    it("fetch 网络异常时应抛出错误", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        client.sendMessage("wx-user-001", "text", "测试"),
      ).rejects.toThrowError("Network error");
    });
  });
});

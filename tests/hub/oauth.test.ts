/**
 * hub/oauth.ts 测试
 * Mock HTTP 请求和 Store 验证 OAuth PKCE 流程
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOAuthSetup, handleOAuthRedirect } from "../../src/hub/oauth.js";
import type { Config } from "../../src/config.js";

/** 创建模拟的 IncomingMessage */
function createMockReq(
  urlPath: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const readable = new Readable({
    read() {
      this.push(null);
    },
  });
  (readable as any).headers = { host: "localhost:8081", ...headers };
  (readable as any).url = urlPath;
  return readable as unknown as IncomingMessage;
}

/** 创建模拟的 ServerResponse，捕获状态码和响应体 */
function createMockRes(): ServerResponse & {
  _statusCode: number;
  _body: string;
  _headers: Record<string, string>;
} {
  const res: any = {
    _statusCode: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) {
      res._statusCode = code;
      if (headers) Object.assign(res._headers, headers);
    },
    end(data?: string) {
      res._body = data ?? "";
    },
  };
  return res;
}

/** 创建模拟 Store */
function createMockStore() {
  return {
    saveInstallation: vi.fn(),
    getInstallation: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue([]),
    saveMessageLink: vi.fn(),
    getMessageLinkByLarkId: vi.fn(),
    getLatestLinkByWxUser: vi.fn(),
    close: vi.fn(),
  } as any;
}

/** 测试用配置 */
const testConfig: Config = {
  port: "8081",
  hubUrl: "http://hub.test",
  baseUrl: "http://app.test",
  dbPath: ":memory:",
  larkAppId: "cli_test_app",
  larkAppSecret: "test_secret",
  larkChatId: "oc_test",
};

describe("handleOAuthSetup", () => {
  it("参数完整时应生成 PKCE 并重定向到 Hub 授权页", () => {
    const req = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=test-state-001",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    // 应返回 302 重定向
    expect(res._statusCode).toBe(302);
    // Location 应指向 Hub 的授权地址
    const location = res._headers["Location"] ?? res._headers["location"] ?? "";
    expect(location).toContain("http://hub.test/api/oauth/authorize");
    expect(location).toContain("app_id=app-123");
    expect(location).toContain("bot_id=bot-456");
    expect(location).toContain("state=test-state-001");
    // 应包含 code_challenge
    expect(location).toContain("code_challenge=");
    // 应包含 redirect_uri
    expect(location).toContain("redirect_uri=");
  });

  it("提供 return_url 时应传递给 Hub", () => {
    const req = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=st-002&return_url=http://mysite.com/done",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    expect(res._statusCode).toBe(302);
    const location = res._headers["Location"] ?? "";
    expect(location).toContain("return_url=");
  });

  it("缺少 app_id 参数时应返回 400", () => {
    const req = createMockReq(
      "/oauth/setup?hub=http://hub.test&bot_id=bot-456&state=st-003",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    expect(res._statusCode).toBe(400);
    const parsed = JSON.parse(res._body);
    expect(parsed.error).toContain("缺少必填参数");
  });

  it("缺少 bot_id 参数时应返回 400", () => {
    const req = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&state=st-004",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    expect(res._statusCode).toBe(400);
  });

  it("缺少 state 参数时应返回 400", () => {
    const req = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    expect(res._statusCode).toBe(400);
  });

  it("hub 参数缺失时应使用 config.hubUrl 作为后备", () => {
    const req = createMockReq(
      "/oauth/setup?app_id=app-123&bot_id=bot-456&state=st-005",
    );
    const res = createMockRes();

    handleOAuthSetup(req, res, testConfig);

    expect(res._statusCode).toBe(302);
    const location = res._headers["Location"] ?? "";
    // 应使用 config 中的 hubUrl
    expect(location).toContain("http://hub.test/api/oauth/authorize");
  });
});

describe("handleOAuthRedirect", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("缺少 code 参数时应返回 400", async () => {
    const req = createMockReq("/oauth/redirect?state=st-001");
    const res = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(req, res, testConfig, store);

    expect(res._statusCode).toBe(400);
    const parsed = JSON.parse(res._body);
    expect(parsed.error).toContain("缺少必填参数");
  });

  it("缺少 state 参数时应返回 400", async () => {
    const req = createMockReq("/oauth/redirect?code=auth-code-001");
    const res = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(req, res, testConfig, store);

    expect(res._statusCode).toBe(400);
    const parsed = JSON.parse(res._body);
    expect(parsed.error).toContain("缺少必填参数");
  });

  it("PKCE 状态不存在时应返回 400", async () => {
    const req = createMockReq(
      "/oauth/redirect?code=auth-code-001&state=non-existent-state",
    );
    const res = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(req, res, testConfig, store);

    expect(res._statusCode).toBe(400);
    const parsed = JSON.parse(res._body);
    expect(parsed.error).toContain("PKCE");
  });

  it("成功换取凭证时应保存安装信息并返回 200", async () => {
    // 先通过 setup 生成 PKCE 缓存
    const setupReq = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=valid-state-001",
    );
    const setupRes = createMockRes();
    handleOAuthSetup(setupReq, setupRes, testConfig);
    expect(setupRes._statusCode).toBe(302);

    // Mock fetch 返回成功
    const mockExchangeResult = {
      installation_id: "inst-new-001",
      app_token: "token-new-xyz",
      webhook_secret: "secret-new-abc",
      bot_id: "bot-new-456",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockExchangeResult),
    } as any);

    const redirectReq = createMockReq(
      "/oauth/redirect?code=auth-code-001&state=valid-state-001",
    );
    const redirectRes = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(redirectReq, redirectRes, testConfig, store);

    expect(redirectRes._statusCode).toBe(200);
    // 应调用 store.saveInstallation
    expect(store.saveInstallation).toHaveBeenCalledOnce();
    const savedInst = store.saveInstallation.mock.calls[0][0];
    expect(savedInst.id).toBe("inst-new-001");
    expect(savedInst.appToken).toBe("token-new-xyz");
    expect(savedInst.webhookSecret).toBe("secret-new-abc");
    expect(savedInst.botId).toBe("bot-new-456");
    // 返回的 HTML 应包含安装成功的提示
    expect(redirectRes._body).toContain("安装成功");
    expect(redirectRes._body).toContain("inst-new-001");
  });

  it("Hub 返回错误时应返回 502", async () => {
    // 先生成 PKCE 缓存
    const setupReq = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=valid-state-502",
    );
    const setupRes = createMockRes();
    handleOAuthSetup(setupReq, setupRes, testConfig);

    // Mock fetch 返回 HTTP 错误
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as any);

    const redirectReq = createMockReq(
      "/oauth/redirect?code=bad-code&state=valid-state-502",
    );
    const redirectRes = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(redirectReq, redirectRes, testConfig, store);

    expect(redirectRes._statusCode).toBe(502);
    const parsed = JSON.parse(redirectRes._body);
    expect(parsed.error).toContain("凭证交换失败");
    // 不应保存安装信息
    expect(store.saveInstallation).not.toHaveBeenCalled();
  });

  it("fetch 抛出异常时应返回 500", async () => {
    // 先生成 PKCE 缓存
    const setupReq = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=valid-state-500",
    );
    const setupRes = createMockRes();
    handleOAuthSetup(setupReq, setupRes, testConfig);

    // Mock fetch 抛出网络异常
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("网络连接失败"));

    const redirectReq = createMockReq(
      "/oauth/redirect?code=some-code&state=valid-state-500",
    );
    const redirectRes = createMockRes();
    const store = createMockStore();

    await handleOAuthRedirect(redirectReq, redirectRes, testConfig, store);

    expect(redirectRes._statusCode).toBe(500);
    const parsed = JSON.parse(redirectRes._body);
    expect(parsed.error).toContain("异常");
    expect(store.saveInstallation).not.toHaveBeenCalled();
  });

  it("同一 state 不可重复使用（PKCE 一次性）", async () => {
    // 生成 PKCE 缓存
    const setupReq = createMockReq(
      "/oauth/setup?hub=http://hub.test&app_id=app-123&bot_id=bot-456&state=one-time-state",
    );
    const setupRes = createMockRes();
    handleOAuthSetup(setupReq, setupRes, testConfig);

    // 第一次使用 - 成功
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          installation_id: "inst-001",
          app_token: "tok",
          webhook_secret: "sec",
          bot_id: "bot",
        }),
    } as any);

    const req1 = createMockReq(
      "/oauth/redirect?code=code1&state=one-time-state",
    );
    const res1 = createMockRes();
    const store = createMockStore();
    await handleOAuthRedirect(req1, res1, testConfig, store);
    expect(res1._statusCode).toBe(200);

    // 第二次使用同一 state - 应失败
    const req2 = createMockReq(
      "/oauth/redirect?code=code2&state=one-time-state",
    );
    const res2 = createMockRes();
    await handleOAuthRedirect(req2, res2, testConfig, store);
    expect(res2._statusCode).toBe(400);
    const parsed = JSON.parse(res2._body);
    expect(parsed.error).toContain("PKCE");
  });
});

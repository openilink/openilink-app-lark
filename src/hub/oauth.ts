import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { generatePKCE } from "../utils/crypto.js";
import type { Config } from "../config.js";
import type { Store } from "../store.js";
import type { OAuthExchangeResult, ToolDefinition } from "./types.js";
import { HubClient } from "./client.js";
import { readBody } from "./webhook.js";

/** PKCE 缓存条目 */
interface PKCEEntry {
  verifier: string;
  hub: string;
  appId: string;
  returnUrl: string;
  expiresAt: number;
}

/** PKCE 缓存，key 为 localState，10 分钟过期 */
const pkceCache = new Map<string, PKCEEntry>();

/** 缓存过期时间：10 分钟 */
const PKCE_TTL_MS = 10 * 60 * 1000;

/** 清理过期的 PKCE 条目 */
function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pkceCache) {
    if (entry.expiresAt < now) {
      pkceCache.delete(key);
    }
  }
}

/**
 * 处理 OAuth 安装流程第一步：生成 PKCE 并重定向到 Hub 授权页
 * 路由: GET /oauth/setup
 */
export function handleOAuthSetup(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const hub = params.get("hub") ?? config.hubUrl;
  const appId = params.get("app_id") ?? "";
  const botId = params.get("bot_id") ?? "";
  const state = params.get("state") ?? "";
  const returnUrl = params.get("return_url") ?? "";

  if (!hub || !appId || !botId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少必填参数: hub, app_id, bot_id" }));
    return;
  }

  // 清理过期缓存
  cleanExpired();

  // 生成 PKCE
  const { verifier, challenge } = generatePKCE();
  const localState = randomBytes(16).toString("hex");

  // 缓存（含 hub, appId, returnUrl）
  pkceCache.set(localState, {
    verifier,
    hub,
    appId,
    returnUrl,
    expiresAt: Date.now() + PKCE_TTL_MS,
  });

  // 重定向到 Hub 授权页
  const authUrl = `${hub}/api/apps/${appId}/oauth/authorize?bot_id=${encodeURIComponent(botId)}&state=${encodeURIComponent(localState)}&code_challenge=${encodeURIComponent(challenge)}&hub_state=${encodeURIComponent(state)}`;
  res.writeHead(302, { Location: authUrl });
  res.end();
}

/**
 * 处理 Hub 模式 2 直接安装通知（POST /oauth/redirect）
 * Hub 直接创建安装后 POST 凭证过来，App 保存凭证并返回 webhook_url
 */
export async function handleOAuthNotify(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  store: Store,
  toolDefinitions?: ToolDefinition[],
): Promise<void> {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body.toString()) as {
      installation_id?: string;
      app_token?: string;
      webhook_secret?: string;
      bot_id?: string;
      handle?: string;
      hub_url?: string;
    };

    const { installation_id, app_token, webhook_secret, bot_id, hub_url } = payload;

    // 校验必填字段
    if (!installation_id || !app_token || !webhook_secret) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必填字段: installation_id, app_token, webhook_secret" }));
      return;
    }

    // 保存安装信息
    store.saveInstallation({
      id: installation_id,
      hubUrl: hub_url || config.hubUrl,
      appId: "",
      botId: bot_id || "",
      appToken: app_token,
      webhookSecret: webhook_secret,
      createdAt: new Date().toISOString(),
    });

    // 异步同步 tools 到 Hub
    const hubClient = new HubClient(hub_url || config.hubUrl, app_token);
    if (toolDefinitions && toolDefinitions.length > 0) {
      hubClient.syncTools(toolDefinitions).catch((err) => {
        console.error("[notify] 工具定义同步失败:", err);
      });
    }

    // 异步拉取用户配置并加密存储到本地
    hubClient.fetchConfig().then((cfg) => {
      if (Object.keys(cfg).length > 0) {
        store.saveConfig(installation_id, cfg);
        console.log("[notify] 用户配置已拉取并加密存储");
      }
    }).catch((e) => console.error("[notify] 拉取用户配置失败:", e));

    console.log(`[notify] 模式 2 安装成功: installation_id=${installation_id}`);

    // 返回 webhook_url
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ webhook_url: `${config.baseUrl}/hub/webhook` }));
  } catch (err) {
    console.error("[notify] 处理安装通知异常:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "处理安装通知失败" }));
    }
  }
}

/**
 * 处理 OAuth 安装流程第二步：用授权码 + code_verifier 换取凭证并保存
 * 拿到 app_token 后，会自动将所有工具定义同步注册到 Hub
 * 路由: GET /oauth/redirect
 */
export async function handleOAuthRedirect(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  store: Store,
  toolDefinitions?: ToolDefinition[],
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";

  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少必填参数: code, state" }));
    return;
  }

  // 清理过期缓存
  cleanExpired();

  // 从缓存取出 PKCE verifier
  const pkceEntry = pkceCache.get(state);
  if (!pkceEntry) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PKCE 状态无效或已过期" }));
    return;
  }
  pkceCache.delete(state);

  const { verifier, hub, appId, returnUrl } = pkceEntry;

  try {
    // 向 Hub 交换凭证
    const exchangeUrl = `${hub}/api/apps/${appId}/oauth/exchange`;
    const exchangeRes = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
      }),
    });

    if (!exchangeRes.ok) {
      const errText = await exchangeRes.text();
      console.error("[oauth] 凭证交换失败:", exchangeRes.status, errText);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "凭证交换失败", detail: errText }));
      return;
    }

    const result = (await exchangeRes.json()) as OAuthExchangeResult;

    // 保存安装信息
    store.saveInstallation({
      id: result.installation_id,
      hubUrl: hub,
      appId,
      botId: result.bot_id,
      appToken: result.app_token,
      webhookSecret: result.webhook_secret,
      createdAt: new Date().toISOString(),
    });

    console.log("[oauth] 安装成功, installation_id:", result.installation_id);

    // OAuth 成功后，同步工具定义到 Hub
    const hubClient = new HubClient(hub, result.app_token);
    if (toolDefinitions && toolDefinitions.length > 0) {
      try {
        await hubClient.syncTools(toolDefinitions);
        console.log("[oauth] 工具定义同步完成");
      } catch (err) {
        console.error("[oauth] 工具定义同步失败:", err);
      }
    }

    // 安装成功后异步拉取用户配置并加密存储到本地
    hubClient.fetchConfig().then((cfg) => {
      if (Object.keys(cfg).length > 0) {
        store.saveConfig(result.installation_id, cfg);
        console.log("[oauth] 用户配置已拉取并加密存储");
      }
    }).catch((e) => console.error("[oauth] 拉取用户配置失败:", e));

    // 重定向到 returnUrl（如果有）
    if (returnUrl) {
      res.writeHead(302, { Location: returnUrl });
      res.end();
    } else {
      // 返回成功页面
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"><title>安装成功</title></head>
          <body>
            <h1>飞书 Bridge 安装成功!</h1>
            <p>Installation ID: ${result.installation_id}</p>
            <p>你可以关闭此页面。</p>
          </body>
        </html>
      `);
    }
  } catch (err) {
    console.error("[oauth] 凭证交换异常:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "凭证交换过程发生异常" }));
  }
}

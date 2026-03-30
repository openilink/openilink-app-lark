/**
 * /settings 页面 — 允许用户通过 app_token 验证身份后查看和修改飞书 Key 配置
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.js";
import type { Store } from "../store.js";
import { readBody } from "./webhook.js";

/** 对敏感值做脱敏处理，只显示前4位和后4位 */
function maskValue(val: string): string {
  if (!val) return "";
  if (val.length <= 8) return val.slice(0, 2) + "***" + val.slice(-2);
  return val.slice(0, 4) + "***" + val.slice(-4);
}

/** 通用 CSS 样式（与 setup 页面保持一致） */
const COMMON_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: white; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .desc { color: #666; font-size: 14px; margin-bottom: 24px; }
  label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #333; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
  input:focus { outline: none; border-color: #3370ff; }
  .required::after { content: " *"; color: red; }
  button { width: 100%; padding: 12px; background: #3370ff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
  button:hover { background: #2860e0; }
  .hint { font-size: 12px; color: #999; margin-top: -12px; margin-bottom: 16px; }
  a { color: #3370ff; }
  .success { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px; margin-bottom: 16px; color: #166534; font-size: 14px; }
  .error { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px; margin-bottom: 16px; color: #991b1b; font-size: 14px; }
  .current-config { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  .current-config dt { font-size: 12px; color: #6b7280; margin-bottom: 2px; }
  .current-config dd { font-size: 14px; color: #111827; margin-bottom: 12px; font-family: monospace; }
  .current-config dd:last-child { margin-bottom: 0; }
`;

/**
 * GET /settings — 显示身份验证页面，要求输入 app_token
 */
export function handleSettingsPage(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>飞书 Bridge — 设置</title>
  <style>${COMMON_STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>飞书 Bridge 设置</h1>
    <p class="desc">请输入您的 App Token 验证身份后修改配置</p>
    <form method="POST" action="/settings/verify">
      <label class="required">App Token</label>
      <input name="app_token" type="password" placeholder="安装时获得的 App Token" required />
      <p class="hint">可在 Hub 的安装详情中查看</p>
      <button type="submit">验证身份</button>
    </form>
  </div>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * POST /settings/verify — 验证 app_token，成功则显示配置编辑表单
 */
export async function handleSettingsVerify(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  store: Store,
): Promise<void> {
  const body = await readBody(req);
  const formData = new URLSearchParams(body.toString());
  const appToken = formData.get("app_token") || "";

  if (!appToken) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderError("请输入 App Token"));
    return;
  }

  // 调 Hub 验证 token 有效性
  try {
    const infoRes = await fetch(`${config.hubUrl}/bot/v1/info`, {
      headers: { Authorization: `Bearer ${appToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!infoRes.ok) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderError("App Token 无效或已过期，请检查后重试"));
      return;
    }

    // 从响应中获取 installation 信息
    const info = (await infoRes.json()) as { installation_id?: string };
    const installationId = info.installation_id || "";

    if (!installationId) {
      // 如果 Hub 没返回 installation_id，尝试在本地数据库按 token 查找
      const installations = store.getAllInstallations();
      const matched = installations.find((inst) => inst.appToken === appToken);
      if (!matched) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderError("未找到对应的安装记录"));
        return;
      }
      renderConfigForm(res, matched.id, appToken, store);
      return;
    }

    renderConfigForm(res, installationId, appToken, store);
  } catch (err) {
    console.error("[settings] 验证 token 失败:", err);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderError("验证失败，请稍后重试"));
  }
}

/**
 * POST /settings/save — 保存修改后的飞书 Key 配置
 */
export async function handleSettingsSave(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  store: Store,
): Promise<void> {
  const body = await readBody(req);
  const formData = new URLSearchParams(body.toString());
  const appToken = formData.get("app_token") || "";
  const installationId = formData.get("installation_id") || "";
  const larkAppId = formData.get("lark_app_id") || "";
  const larkAppSecret = formData.get("lark_app_secret") || "";
  const larkChatId = formData.get("lark_chat_id") || "";

  if (!appToken || !installationId) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderError("缺少必填参数"));
    return;
  }

  // 再次验证 token 有效性
  try {
    const infoRes = await fetch(`${config.hubUrl}/bot/v1/info`, {
      headers: { Authorization: `Bearer ${appToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!infoRes.ok) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderError("App Token 无效，保存失败"));
      return;
    }
  } catch {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderError("验证失败，请稍后重试"));
    return;
  }

  // 读取现有配置，仅更新用户填写了的字段（空值表示不修改）
  const existingConfig = store.getConfig(installationId);
  const newConfig: Record<string, string> = { ...existingConfig };

  if (larkAppId) newConfig.lark_app_id = larkAppId;
  if (larkAppSecret) newConfig.lark_app_secret = larkAppSecret;
  // lark_chat_id 允许清空，所以特殊处理：如果表单中有该字段则始终更新
  newConfig.lark_chat_id = larkChatId;

  // 加密保存
  store.saveConfig(installationId, newConfig);
  console.log(`[settings] 用户配置已更新: installation_id=${installationId}`);

  // 显示成功页面，带配置表单
  renderConfigForm(res, installationId, appToken, store, "配置已保存成功");
}

/** 渲染配置编辑表单 */
function renderConfigForm(
  res: ServerResponse,
  installationId: string,
  appToken: string,
  store: Store,
  successMsg?: string,
): void {
  const cfg = store.getConfig(installationId);
  const maskedAppId = maskValue(cfg.lark_app_id || "");
  const maskedSecret = maskValue(cfg.lark_app_secret || "");
  const maskedChatId = maskValue(cfg.lark_chat_id || "");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>飞书 Bridge — 修改配置</title>
  <style>${COMMON_STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>飞书 Bridge 设置</h1>
    <p class="desc">修改您的飞书应用凭证配置</p>
    ${successMsg ? `<div class="success">${successMsg}</div>` : ""}

    <div class="current-config">
      <dt>当前 App ID</dt>
      <dd>${maskedAppId || "（未配置）"}</dd>
      <dt>当前 App Secret</dt>
      <dd>${maskedSecret || "（未配置）"}</dd>
      <dt>当前群聊 ID</dt>
      <dd>${maskedChatId || "（未配置）"}</dd>
    </div>

    <form method="POST" action="/settings/save">
      <input type="hidden" name="app_token" value="${escapeHtml(appToken)}" />
      <input type="hidden" name="installation_id" value="${escapeHtml(installationId)}" />

      <label>飞书 App ID</label>
      <input name="lark_app_id" placeholder="留空则不修改" />
      <p class="hint">在 <a href="https://open.feishu.cn/app" target="_blank">飞书开发者后台</a> 查看</p>

      <label>飞书 App Secret</label>
      <input name="lark_app_secret" type="password" placeholder="留空则不修改" />

      <label>飞书群聊 ID</label>
      <input name="lark_chat_id" placeholder="留空则清除" value="${escapeHtml(cfg.lark_chat_id || "")}" />
      <p class="hint">默认转发到的飞书群，可在群设置中查看</p>

      <button type="submit">保存配置</button>
    </form>
  </div>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** 渲染错误页面 */
function renderError(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>飞书 Bridge — 设置</title>
  <style>${COMMON_STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>飞书 Bridge 设置</h1>
    <div class="error">${message}</div>
    <a href="/settings">返回重试</a>
  </div>
</body>
</html>`;
}

/** HTML 转义，防止 XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

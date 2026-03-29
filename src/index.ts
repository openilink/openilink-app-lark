/**
 * 主入口文件 - 启动 HTTP 服务器和飞书事件订阅
 */
import http from "node:http";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { LarkClient } from "./lark/client.js";
import { startLarkEventSubscription } from "./lark/event.js";
import { WxToLark } from "./bridge/wx-to-lark.js";
import { LarkToWx } from "./bridge/lark-to-wx.js";
import { HubClient } from "./hub/client.js";
import { Router } from "./router.js";
import { handleWebhook } from "./hub/webhook.js";
import { handleOAuthSetup, handleOAuthRedirect } from "./hub/oauth.js";
import { getManifest } from "./hub/manifest.js";
import { collectAllTools } from "./tools/index.js";

/** 解析请求 URL 的路径和方法 */
function parseRequest(req: http.IncomingMessage): { method: string; pathname: string } {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return { method, pathname: url.pathname };
}

async function main(): Promise<void> {
  // 1. 加载配置
  const config = loadConfig();
  console.log("[main] 配置加载完成");

  // 2. 初始化存储
  const store = new Store(config.dbPath);
  console.log("[main] 数据库初始化完成");

  // 3. 初始化飞书客户端
  const larkClient = new LarkClient(config.larkAppId, config.larkAppSecret, config.larkChatId);
  console.log("[main] 飞书客户端初始化完成");

  // 4. 收集所有 tools
  const { definitions, handlers } = collectAllTools(larkClient.sdk);
  console.log(`[main] 已注册 ${definitions.length} 个工具`);

  // 5. 初始化路由器
  const router = new Router(handlers);

  // 6. 初始化桥接模块
  const wxToLark = new WxToLark(larkClient, store, config.larkChatId);
  const larkToWx = new LarkToWx(store, config.larkChatId);

  // 7. 创建 HTTP 服务器
  const server = http.createServer(async (req, res) => {
    const { method, pathname } = parseRequest(req);

    try {
      // POST /hub/webhook - Hub 事件推送
      if (method === "POST" && pathname === "/hub/webhook") {
        await handleWebhook(req, res, store, {
          // 命令事件 - 路由到 tool handler，支持同步/异步响应
          onCommand: async (event, installation) => {
            if (!event.event) return null;
            const hubClient = new HubClient(installation.hubUrl, installation.appToken);
            return router.handleCommand(event, installation, hubClient);
          },
          // 非命令事件（消息桥接等）
          onEvent: async (event, installation) => {
            if (!event.event) return;
            if (event.event.type.startsWith("message.")) {
              await wxToLark.handleWxEvent(event, installation);
            }
          },
          // 异步推送回调 - 命令超时后通过 Bot API 推送结果
          onAsyncPush: async (result, event, installation) => {
            const hubClient = new HubClient(installation.hubUrl, installation.appToken);
            const data = event.event?.data ?? {};
            const to = (data.group?.id ?? data.sender?.id ?? data.user_id ?? data.from ?? "") as string;
            if (!to) return;
            const traceId = event.trace_id;
            try {
              if (typeof result === "string") {
                await hubClient.sendText(to, result, traceId);
              } else {
                await hubClient.sendMessage(to, result.type ?? "text", result.reply, {
                  url: result.url,
                  base64: result.base64,
                  filename: result.name,
                  traceId,
                });
              }
            } catch (err) {
              console.error("[main] 异步推送命令结果失败:", err);
            }
          },
        });
        return;
      }

      // GET /oauth/setup - OAuth 安装流程
      if (method === "GET" && pathname === "/oauth/setup") {
        handleOAuthSetup(req, res, config);
        return;
      }

      // GET /oauth/redirect - OAuth 回调（完成后自动同步工具定义到 Hub）
      if (method === "GET" && pathname === "/oauth/redirect") {
        await handleOAuthRedirect(req, res, config, store, definitions);
        return;
      }

      // GET /manifest.json - App Manifest
      if (method === "GET" && pathname === "/manifest.json") {
        const manifest = getManifest(config, definitions);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(manifest, null, 2));
        return;
      }

      // GET /health - 健康检查
      if (method === "GET" && pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error("[main] 请求处理异常:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  });

  // 8. 启动飞书 WebSocket 事件订阅（后台）
  const wsClient = startLarkEventSubscription(config.larkAppId, config.larkAppSecret, (data) => {
    console.log(`[main] 飞书消息: type=${data.messageType}, chat=${data.chatId}`);
    // 飞书 → 微信 反向桥接
    const installations = store.getAllInstallations();
    larkToWx.handleLarkMessage(data, installations).catch((err) => {
      console.error("[main] LarkToWx 处理消息失败:", err);
    });
  });

  // 9. 启动 HTTP 服务器
  const port = parseInt(config.port, 10);
  server.listen(port, () => {
    console.log(`[main] HTTP 服务器已启动，监听端口 ${port}`);
    console.log(`[main] Manifest: http://localhost:${port}/manifest.json`);
    console.log(`[main] Health: http://localhost:${port}/health`);
  });

  // 10. 优雅关闭
  const shutdown = (signal: string) => {
    console.log(`\n[main] 收到 ${signal} 信号，开始优雅关闭...`);
    wsClient.close();
    console.log("[main] 飞书 WebSocket 连接已关闭");
    server.close(() => {
      console.log("[main] HTTP 服务器已关闭");
      store.close();
      console.log("[main] 数据库连接已关闭");
      process.exit(0);
    });

    // 超时强制退出
    setTimeout(() => {
      console.error("[main] 优雅关闭超时，强制退出");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// 启动应用
main().catch((err) => {
  console.error("[main] 启动失败:", err);
  process.exit(1);
});

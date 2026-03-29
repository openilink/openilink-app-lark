import type { Config } from "../config.js";
import type { ToolDefinition } from "./types.js";

/** Manifest 结构（注册到 Hub 的 App 描述） */
export interface Manifest {
  slug: string;
  name: string;
  description: string;
  icon: string;
  events: string[];
  scopes: string[];
  tools: ToolDefinition[];
  oauth_setup_url: string;
  oauth_redirect_url: string;
  webhook_url: string;
}

/**
 * 生成完整的 App Manifest，用于向 Hub 注册
 * @param config 应用配置
 * @param toolDefinitions 工具定义列表
 */
export function getManifest(
  config: Config,
  toolDefinitions: ToolDefinition[] = [],
): Manifest {
  const baseUrl = config.baseUrl;

  return {
    slug: "lark-bridge",
    name: "飞书 Bridge",
    description: "微信 ↔ 飞书双向桥接 + 飞书全平台操作",
    icon: "🔗",
    events: ["message", "command"],
    scopes: ["message:read", "message:write", "tools:write"],
    tools: toolDefinitions,
    oauth_setup_url: `${baseUrl}/oauth/setup`,
    oauth_redirect_url: `${baseUrl}/oauth/redirect`,
    webhook_url: `${baseUrl}/hub/webhook`,
  };
}

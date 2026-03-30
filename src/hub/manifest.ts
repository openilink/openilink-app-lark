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
  /** Hub 应用市场一键安装时自动生成配置表单的 JSON Schema */
  config_schema?: Record<string, unknown>;
  /** 安装指南，Markdown 格式 */
  guide?: string;
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
    scopes: ["message:read", "message:write", "tools:write", "config:read"],
    tools: toolDefinitions,
    oauth_setup_url: `${baseUrl}/oauth/setup`,
    oauth_redirect_url: `${baseUrl}/oauth/redirect`,
    webhook_url: `${baseUrl}/hub/webhook`,
    config_schema: {
      type: "object",
      properties: {
        lark_app_id: {
          type: "string",
          title: "飞书 App ID",
          description: "在飞书开发者后台创建应用后获取",
        },
        lark_app_secret: {
          type: "string",
          title: "飞书 App Secret",
          description: "应用凭证密钥",
        },
        lark_chat_id: {
          type: "string",
          title: "飞书群聊 ID",
          description: "默认转发到的飞书群 chat_id（可选）",
        },
      },
      required: ["lark_app_id", "lark_app_secret"],
    },
    guide: `## 飞书 Bridge 安装指南

### 第 1 步：创建飞书应用
1. 访问 [飞书开发者后台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 获取 **App ID** 和 **App Secret**

### 第 2 步：配置权限
在应用的「权限管理」中添加：
- \`im:message\` — 消息读写
- \`im:chat\` — 群聊管理
- \`calendar:calendar\` — 日历（可选）

### 第 3 步：启用事件订阅
在「事件与回调」中选择 **长连接** 模式。

### 第 4 步：获取群聊 ID
在飞书群设置中找到群聊链接，提取 \`oc_\` 开头的 ID。

### 第 5 步：填写上方配置并安装
`,
  };
}

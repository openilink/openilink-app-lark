/**
 * Hub 事件和 API 相关类型
 */

/** Hub 推送的 Webhook 事件 */
export interface HubEvent {
  v: number;
  type: "event" | "url_verification";
  trace_id: string;
  challenge?: string;
  installation_id: string;
  bot: { id: string };
  event?: {
    type: string; // "command" | "message.text" | "message.image" | ...
    id: string;
    timestamp: number;
    data: Record<string, any>;
  };
}

/** Hub OAuth 凭证交换响应 */
export interface OAuthExchangeResult {
  installation_id: string;
  app_token: string;
  webhook_secret: string;
  bot_id: string;
}

/** 安装记录 */
export interface Installation {
  id: string;
  hubUrl: string;
  appId: string;
  botId: string;
  appToken: string;
  webhookSecret: string;
  createdAt: string;
}

/** 消息映射（飞书消息 → 微信用户） */
export interface MessageLink {
  id?: number;
  installationId: string;
  larkMessageId: string;
  wxUserId: string;
  wxUserName: string;
  createdAt?: string;
}

/** Tool 定义（注册到 Hub manifest） */
export interface ToolDefinition {
  name: string;
  description: string;
  command: string;
  parameters?: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/** Tool 执行上下文 */
export interface ToolContext {
  installationId: string;
  botId: string;
  userId: string;
  traceId: string;
  args: Record<string, any>;
}

/** Tool 执行结果 - 支持纯文本和媒体类型 */
export interface ToolResult {
  /** 回复文本 */
  reply: string;
  /** 媒体类型，不传表示纯文本 */
  type?: "image";
  /** 媒体 URL */
  url?: string;
  /** 媒体 base64 数据 (data:image/png;base64,...) */
  base64?: string;
}

/** Tool 处理函数 - 返回字符串（纯文本）或 ToolResult（支持媒体） */
export type ToolHandler = (ctx: ToolContext) => Promise<string | ToolResult>;

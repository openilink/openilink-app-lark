import type { ToolDefinition } from "./types.js";

/**
 * Hub Bot API 客户端 - 用于通过 Hub 向用户发送消息、同步工具定义
 */
export class HubClient {
  private hubUrl: string;
  private appToken: string;

  constructor(hubUrl: string, appToken: string) {
    this.hubUrl = hubUrl;
    this.appToken = appToken;
  }

  /**
   * 将工具定义同步注册到 Hub
   * PUT {hubUrl}/bot/v1/app/tools
   */
  async syncTools(tools: ToolDefinition[]): Promise<void> {
    const url = `${this.hubUrl}/bot/v1/app/tools`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
      },
      body: JSON.stringify({ tools }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `[hub-client] 同步工具定义失败: ${res.status} ${res.statusText} - ${errText}`,
      );
    }
    console.log(`[hub-client] 工具定义同步成功, 共 ${tools.length} 个工具`);
  }

  /**
   * 发送消息（通用方法）
   * POST {hubUrl}/bot/v1/message/send
   */
  async sendMessage(
    to: string,
    type: string,
    content: string,
    options?: { url?: string; base64?: string; filename?: string; traceId?: string },
  ): Promise<void> {
    const url = `${this.hubUrl}/bot/v1/message/send`;

    const body: Record<string, string> = { to, type, content };
    if (options?.url) body.url = options.url;
    if (options?.base64) body.base64 = options.base64;
    if (options?.filename) body.filename = options.filename;
    if (options?.traceId) body.trace_id = options.traceId;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
        ...(options?.traceId ? { "X-Trace-Id": options.traceId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `[hub-client] 发送消息失败: ${res.status} ${res.statusText} - ${errText}`,
      );
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(to: string, text: string, traceId?: string): Promise<void> {
    await this.sendMessage(to, "text", text, { traceId });
  }

  /**
   * 发送图片消息
   */
  async sendImage(to: string, url: string, traceId?: string): Promise<void> {
    await this.sendMessage(to, "image", "", { url, traceId });
  }

  /**
   * 发送文件消息
   */
  async sendFile(
    to: string,
    fileUrl: string,
    fileName: string,
    traceId?: string,
  ): Promise<void> {
    await this.sendMessage(to, "file", "", { url: fileUrl, filename: fileName, traceId });
  }

  /**
   * 从 Hub 拉取用户配置
   * GET {hubUrl}/bot/v1/config
   */
  async fetchConfig(): Promise<Record<string, string>> {
    const url = `${this.hubUrl}/bot/v1/config`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.appToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { config?: Record<string, string> };
    return data.config || {};
  }
}

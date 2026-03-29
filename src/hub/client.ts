import type { ToolDefinition } from "./types.js";

/**
 * Hub Bot API 客户端 - 用于通过 Hub 向微信用户发送消息、同步工具定义
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
   * 发送文本消息
   * @param to 目标微信用户 ID
   * @param text 文本内容
   * @param traceId 可选的追踪 ID
   */
  async sendText(to: string, text: string, traceId?: string): Promise<void> {
    await this.sendMessage(to, "text", text, traceId);
  }

  /**
   * 发送图片消息（base64 或 URL）
   * @param to 目标微信用户 ID
   * @param imageUrl 图片 URL 或 base64 数据
   * @param traceId 可选的追踪 ID
   */
  async sendImage(to: string, imageUrl: string, traceId?: string): Promise<void> {
    await this.sendMessage(to, "image", imageUrl, traceId);
  }

  /**
   * 发送文件消息
   * @param to 目标微信用户 ID
   * @param fileUrl 文件 URL
   * @param fileName 文件名
   * @param traceId 可选的追踪 ID
   */
  async sendFile(
    to: string,
    fileUrl: string,
    fileName: string,
    traceId?: string,
  ): Promise<void> {
    const content = JSON.stringify({ url: fileUrl, name: fileName });
    await this.sendMessage(to, "file", content, traceId);
  }

  /**
   * 通用消息发送方法
   * @param to 目标微信用户 ID
   * @param type 消息类型（text / image / file 等）
   * @param content 消息内容
   * @param traceId 可选的追踪 ID
   */
  async sendMessage(
    to: string,
    type: string,
    content: string,
    traceId?: string,
  ): Promise<void> {
    const url = `${this.hubUrl}/api/bot/send`;

    const payload: Record<string, string> = {
      to,
      type,
      content,
    };
    if (traceId) {
      payload.trace_id = traceId;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `[hub-client] 发送消息失败: ${res.status} ${res.statusText} - ${errText}`,
      );
    }
  }
}

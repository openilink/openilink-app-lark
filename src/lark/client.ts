/**
 * 飞书 SDK 封装 - 提供统一的飞书操作接口
 */
import * as lark from "@larksuiteoapi/node-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export class LarkClient {
  /** 暴露原始 SDK 供 tools 使用 */
  public sdk: lark.Client;
  /** 默认群聊 ID */
  private chatId: string;

  constructor(appId: string, appSecret: string, defaultChatId = "") {
    this.sdk = new lark.Client({ appId, appSecret });
    this.chatId = defaultChatId;
  }

  // ─── IM 消息发送 ───

  /** 发送文本消息，返回 message_id */
  async sendText(chatId: string, text: string): Promise<string> {
    const content = JSON.stringify({ text });
    return this.createMessage(chatId, "text", content);
  }

  /** 回复文本消息，返回 message_id */
  async replyText(messageId: string, text: string): Promise<string> {
    try {
      const res = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
      const msgId = res?.data?.message_id ?? "";
      console.log(`[LarkClient] 回复消息成功: ${msgId}`);
      return msgId;
    } catch (err) {
      console.error(`[LarkClient] 回复消息失败 (replyTo=${messageId}):`, err);
      throw err;
    }
  }

  /** 发送图片消息，先上传再发送，返回 message_id */
  async sendImage(chatId: string, imageBuffer: Buffer): Promise<string> {
    const imageKey = await this.uploadImage(imageBuffer);
    const content = JSON.stringify({ image_key: imageKey });
    return this.createMessage(chatId, "image", content);
  }

  /** 发送文件消息，先上传再发送，返回 message_id */
  async sendFile(
    chatId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileType: string,
  ): Promise<string> {
    const fileKey = await this.uploadFile(fileBuffer, fileName, fileType);
    const content = JSON.stringify({ file_key: fileKey });
    return this.createMessage(chatId, "file", content);
  }

  /** 发送富文本消息，返回 message_id */
  async sendRichText(chatId: string, content: object): Promise<string> {
    return this.createMessage(chatId, "post", JSON.stringify(content));
  }

  /** 发送卡片消息，返回 message_id */
  async sendCard(chatId: string, card: object): Promise<string> {
    return this.createMessage(chatId, "interactive", JSON.stringify(card));
  }

  /** 发送音频消息，先上传再发送，返回 message_id */
  async sendAudio(chatId: string, audioBuffer: Buffer): Promise<string> {
    const fileKey = await this.uploadFile(audioBuffer, "audio.opus", "opus");
    const content = JSON.stringify({ file_key: fileKey });
    return this.createMessage(chatId, "audio", content);
  }

  /** 发送视频消息，先上传再发送，返回 message_id */
  async sendVideo(
    chatId: string,
    videoBuffer: Buffer,
    coverBuffer?: Buffer,
  ): Promise<string> {
    const fileKey = await this.uploadFile(videoBuffer, "video.mp4", "mp4");
    const mediaContent: Record<string, string> = { file_key: fileKey };
    if (coverBuffer) {
      const imageKey = await this.uploadImage(coverBuffer);
      mediaContent.image_key = imageKey;
    }
    const content = JSON.stringify(mediaContent);
    return this.createMessage(chatId, "media", content);
  }

  // ─── 媒体上传 ───

  /** 上传图片，返回 image_key */
  async uploadImage(imageBuffer: Buffer): Promise<string> {
    try {
      const res = await this.sdk.im.image.create({
        data: {
          image_type: "message",
          image: imageBuffer,
        },
      });
      const imageKey = (res as any)?.data?.image_key ?? res?.image_key ?? "";
      if (!imageKey) {
        throw new Error(`[LarkClient] 上传图片成功但 image_key 为空，响应: ${JSON.stringify(res)}`);
      }
      console.log(`[LarkClient] 上传图片成功: ${imageKey}`);
      return imageKey;
    } catch (err) {
      console.error("[LarkClient] 上传图片失败:", err);
      throw err;
    }
  }

  /** 上传文件，返回 file_key */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    fileType: string,
  ): Promise<string> {
    try {
      const res = await this.sdk.im.file.create({
        data: {
          file_type: fileType as any,
          file_name: fileName,
          file: fileBuffer,
        },
      });
      const fileKey = (res as any)?.data?.file_key ?? res?.file_key ?? "";
      if (!fileKey) {
        throw new Error(`[LarkClient] 上传文件成功但 file_key 为空，响应: ${JSON.stringify(res)}`);
      }
      console.log(`[LarkClient] 上传文件成功: ${fileKey} (${fileName})`);
      return fileKey;
    } catch (err) {
      console.error(`[LarkClient] 上传文件失败 (${fileName}):`, err);
      throw err;
    }
  }

  // ─── 媒体下载 ───

  /** 下载图片，返回 Buffer */
  async downloadImage(imageKey: string): Promise<Buffer> {
    try {
      const res = await this.sdk.im.image.get({
        path: { image_key: imageKey },
      });
      const buf = await this.responseToBuffer(res, `image_${imageKey}`);
      console.log(`[LarkClient] 下载图片成功: ${imageKey}`);
      return buf;
    } catch (err) {
      console.error(`[LarkClient] 下载图片失败 (${imageKey}):`, err);
      throw err;
    }
  }

  /** 下载文件，返回 Buffer */
  async downloadFile(fileKey: string): Promise<Buffer> {
    try {
      const res = await this.sdk.im.file.get({
        path: { file_key: fileKey },
      });
      const buf = await this.responseToBuffer(res, `file_${fileKey}`);
      console.log(`[LarkClient] 下载文件成功: ${fileKey}`);
      return buf;
    } catch (err) {
      console.error(`[LarkClient] 下载文件失败 (${fileKey}):`, err);
      throw err;
    }
  }

  // ─── 消息操作 ───

  /** 获取消息详情 */
  async getMessage(messageId: string): Promise<any> {
    try {
      const res = await this.sdk.im.message.get({
        path: { message_id: messageId },
      });
      return res?.data;
    } catch (err) {
      console.error(`[LarkClient] 获取消息失败 (${messageId}):`, err);
      throw err;
    }
  }

  /** 转发消息到指定群，返回新消息的 message_id */
  async forwardMessage(messageId: string, chatId: string): Promise<string> {
    try {
      const res = await this.sdk.im.message.forward({
        path: { message_id: messageId },
        data: { receive_id: chatId || this.chatId },
        params: { receive_id_type: "chat_id" },
      });
      const newMsgId = res?.data?.message_id ?? "";
      console.log(`[LarkClient] 转发消息成功: ${messageId} → ${newMsgId}`);
      return newMsgId;
    } catch (err) {
      console.error(`[LarkClient] 转发消息失败 (${messageId}):`, err);
      throw err;
    }
  }

  // ─── 内部辅助 ───

  /**
   * 将 SDK 下载响应转为 Buffer
   * 优先使用 writeFile 写入临时文件再读取，兼容不同 SDK 版本
   */
  private async responseToBuffer(res: any, prefix: string): Promise<Buffer> {
    // 方式 1: SDK 提供 writeFile 方法，写到临时文件后读取
    if (typeof res?.writeFile === "function") {
      const tmpPath = join(tmpdir(), `lark_${prefix}_${randomUUID()}`);
      try {
        await res.writeFile(tmpPath);
        const buf = await readFile(tmpPath);
        return buf;
      } finally {
        // 清理临时文件
        await unlink(tmpPath).catch(() => {});
      }
    }

    // 方式 2: 响应本身是可异步迭代的流
    if (res && typeof res[Symbol.asyncIterator] === "function") {
      const chunks: Buffer[] = [];
      for await (const chunk of res) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    // 方式 3: 响应包含 getReadableStream 方法
    if (typeof res?.getReadableStream === "function") {
      const stream = res.getReadableStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    throw new Error("[LarkClient] 无法从 SDK 响应中读取数据流");
  }

  /** 创建消息的通用方法 */
  private async createMessage(
    chatId: string,
    msgType: string,
    content: string,
  ): Promise<string> {
    const targetChatId = chatId || this.chatId;
    if (!targetChatId) {
      throw new Error("[LarkClient] 未指定 chatId 且无默认 chatId");
    }
    try {
      const res = await this.sdk.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: targetChatId,
          msg_type: msgType as any,
          content,
        },
      });
      const msgId = res?.data?.message_id ?? "";
      console.log(`[LarkClient] 发送消息成功: type=${msgType}, id=${msgId}`);
      return msgId;
    } catch (err) {
      console.error(`[LarkClient] 发送消息失败 (type=${msgType}, chat=${targetChatId}):`, err);
      throw err;
    }
  }
}

/**
 * 微信 → 飞书 转发桥接
 * 将 Hub 推送的微信消息事件转发到飞书群
 */
import type { LarkClient } from "../lark/client.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation } from "../hub/types.js";

export class WxToLark {
  private larkClient: LarkClient;
  private store: Store;
  private defaultChatId: string;

  constructor(larkClient: LarkClient, store: Store, defaultChatId: string) {
    this.larkClient = larkClient;
    this.store = store;
    this.defaultChatId = defaultChatId;
  }

  /**
   * 处理 Hub 推送的微信消息事件
   * 根据消息类型转发到飞书群，并保存消息映射
   */
  async handleWxEvent(event: HubEvent, installation: Installation): Promise<void> {
    // event.event 在回调链路中一定存在（url_verification 已提前处理）
    if (!event.event) return;

    const eventType = event.event.type;
    const data = event.event.data;

    // command 类型由 tools 系统处理，此处不转发
    if (eventType === "command") {
      return;
    }

    const fromUserId: string = data.from ?? "";
    const fromName: string = data.from_name ?? "未知用户";
    const content: string = data.content ?? "";

    let text: string;

    switch (eventType) {
      case "message.text":
        text = `[微信] ${fromName}: ${content}`;
        break;

      case "message.image":
        text = `[微信] ${fromName}: [发送了图片]`;
        break;

      case "message.voice":
        text = `[微信] ${fromName}: [语音消息]`;
        break;

      case "message.video":
        text = `[微信] ${fromName}: [视频消息]`;
        break;

      case "message.file": {
        const fileName = data.file_name ?? "未知文件";
        text = `[微信] ${fromName}: [文件: ${fileName}]`;
        break;
      }

      default:
        text = `[微信] ${fromName}: [${eventType}消息]`;
        break;
    }

    try {
      const messageId = await this.larkClient.sendText(this.defaultChatId, text);

      // 保存消息映射，用于飞书回复时路由到正确的微信用户
      if (messageId && fromUserId) {
        this.store.saveMessageLink({
          installationId: installation.id,
          larkMessageId: messageId,
          wxUserId: fromUserId,
          wxUserName: fromName,
        });
        console.log(
          `[WxToLark] 转发成功并保存映射: lark=${messageId} → wx=${fromUserId} (${fromName})`,
        );
      }
    } catch (err) {
      console.error(`[WxToLark] 转发微信消息到飞书失败 (type=${eventType}, from=${fromName}):`, err);
    }
  }
}

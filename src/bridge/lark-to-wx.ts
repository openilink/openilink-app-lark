/**
 * 飞书 → 微信 转发桥接
 * 将飞书群消息转发回对应的微信用户
 */
import type { Store } from "../store.js";
import type { Installation } from "../hub/types.js";
import type { LarkMessageData } from "../lark/event.js";
import { HubClient } from "../hub/client.js";

export class LarkToWx {
  private store: Store;
  private defaultChatId: string;

  constructor(store: Store, defaultChatId: string) {
    this.store = store;
    this.defaultChatId = defaultChatId;
  }

  /**
   * 处理飞书消息事件，转发到微信
   * 通过消息的 parentId / rootId 查找消息映射，确定目标微信用户
   */
  async handleLarkMessage(
    data: LarkMessageData,
    installations: Installation[],
  ): Promise<void> {
    // 如果配置了默认群 ID，只处理该群的消息
    if (this.defaultChatId && data.chatId !== this.defaultChatId) {
      return;
    }

    // 通过 parentId 或 rootId 查找消息映射，确定目标微信用户
    // 遍历所有安装实例，在对应的 installation_id 下查找消息映射
    let link: import("../hub/types.js").MessageLink | undefined;
    for (const inst of installations) {
      link =
        (data.parentId ? this.store.getMessageLinkByLarkId(data.parentId, inst.id) : undefined) ??
        (data.rootId ? this.store.getMessageLinkByLarkId(data.rootId, inst.id) : undefined);
      if (link) break;
    }

    if (!link) {
      console.log(
        `[LarkToWx] 无法找到消息映射，跳过转发 (messageId=${data.messageId}, parentId=${data.parentId}, rootId=${data.rootId})`,
      );
      return;
    }

    // 获取对应的安装配置
    const installation = installations.find((inst) => inst.id === link.installationId);
    if (!installation) {
      console.warn(
        `[LarkToWx] 找不到对应的安装配置: installationId=${link.installationId}`,
      );
      return;
    }

    // 解析飞书消息内容，提取纯文本
    const text = this.extractText(data.content, data.messageType);
    if (!text) {
      console.log(`[LarkToWx] 消息内容为空，跳过转发 (messageId=${data.messageId})`);
      return;
    }

    try {
      // 通过 HubClient 发送消息到微信
      const hubClient = new HubClient(
        installation.hubUrl.replace(/\/$/, ""),
        installation.appToken,
      );
      await hubClient.sendText(link.wxUserId, text);

      console.log(
        `[LarkToWx] 转发成功: lark=${data.messageId} → wx=${link.wxUserId} (${link.wxUserName})`,
      );
    } catch (err) {
      console.error(
        `[LarkToWx] 转发飞书消息到微信失败 (wxUser=${link.wxUserId}):`,
        err,
      );
    }
  }

  /**
   * 从飞书消息内容中提取纯文本
   * 飞书消息 content 字段是 JSON 字符串
   */
  private extractText(content: string, messageType: string): string {
    try {
      const parsed = JSON.parse(content);

      switch (messageType) {
        case "text": {
          let text: string = parsed.text ?? "";
          // 去除 @机器人 的提及（飞书格式: @_user_N）
          text = text.replace(/@_user_\d+/g, "").trim();
          return text;
        }

        case "post": {
          // 富文本消息，提取所有文本段
          const texts: string[] = [];
          const postContent =
            parsed.zh_cn ?? parsed.en_us ?? Object.values(parsed)[0];
          if (postContent?.content) {
            for (const line of postContent.content) {
              for (const elem of line) {
                if (elem.tag === "text") {
                  texts.push(elem.text ?? "");
                }
              }
            }
          }
          return texts.join("").trim();
        }

        case "image":
          return "[图片]";

        case "file":
          return `[文件: ${parsed.file_name ?? "未知"}]`;

        default:
          return `[${messageType}消息]`;
      }
    } catch {
      // JSON 解析失败，直接返回原始内容
      return content;
    }
  }
}

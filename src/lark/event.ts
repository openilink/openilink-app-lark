/**
 * 飞书 WebSocket 事件订阅 - 接收飞书 IM 消息
 */
import * as lark from "@larksuiteoapi/node-sdk";

/** 飞书消息事件的结构化数据 */
export interface LarkMessageData {
  chatId: string;
  messageId: string;
  messageType: string;
  content: string;
  senderId: string;
  senderType: string;
  parentId?: string;
  rootId?: string;
}

/** 飞书消息回调处理函数（支持异步） */
export type LarkMessageHandler = (data: LarkMessageData) => void | Promise<void>;

/**
 * 启动飞书 WebSocket 长连接，订阅 IM 消息事件
 * @param appId 飞书 App ID
 * @param appSecret 飞书 App Secret
 * @param onMessage 收到消息时的回调
 */
export function startLarkEventSubscription(
  appId: string,
  appSecret: string,
  onMessage: LarkMessageHandler,
): lark.WSClient {
  // 创建事件分发器，注册 im.message.receive_v1 事件
  const dispatcher = new lark.EventDispatcher({});

  dispatcher.register({
    "im.message.receive_v1": async (data: any) => {
      try {
        const sender = data?.sender;
        const message = data?.message;

        if (!sender || !message) {
          console.warn("[LarkEvent] 收到无效消息事件，缺少 sender 或 message");
          return;
        }

        const senderType: string = sender.sender_type ?? "";

        // 忽略机器人自身发送的消息，避免循环
        if (senderType === "app") {
          return;
        }

        const messageData: LarkMessageData = {
          chatId: message.chat_id ?? "",
          messageId: message.message_id ?? "",
          messageType: message.message_type ?? "",
          content: message.content ?? "",
          senderId: sender.sender_id?.open_id ?? "",
          senderType,
          parentId: message.parent_id || undefined,
          rootId: message.root_id || undefined,
        };

        console.log(
          `[LarkEvent] 收到消息: type=${messageData.messageType}, chat=${messageData.chatId}, sender=${messageData.senderId}`,
        );

        await onMessage(messageData);
      } catch (err) {
        console.error("[LarkEvent] 处理消息事件异常:", err);
      }
    },
  });

  // 创建 WebSocket 客户端并启动
  const wsClient = new lark.WSClient({
    appId,
    appSecret,
  });

  wsClient.start({ eventDispatcher: dispatcher });
  console.log("[LarkEvent] WebSocket 事件订阅已启动");

  return wsClient;
}

/**
 * 命令/Tool Call 路由分发器
 * 根据 Hub 推送的 command 事件，查找对应 handler 并执行
 */
import type { HubEvent, Installation, ToolHandler, ToolContext, ToolResult } from "./hub/types.js";
import type { HubClient } from "./hub/client.js";

export class Router {
  private handlers: Map<string, ToolHandler>;

  constructor(handlers: Map<string, ToolHandler>) {
    this.handlers = handlers;
  }

  /**
   * 处理 Hub 推送的 command 事件（用户输入 /xxx 或 AI tool call）
   * @param event Hub 事件
   * @param installation 安装信息
   * @param hubClient Hub 客户端（可用于回复消息）
   * @returns 同步回复内容（字符串或 ToolResult），null 表示不处理
   */
  async handleCommand(
    event: HubEvent,
    installation: Installation,
    hubClient: HubClient,
  ): Promise<string | ToolResult | null> {
    // event.event 在回调链路中一定存在（url_verification 已提前处理）
    if (!event.event) return null;

    const data = event.event.data;

    // 从 event data 中提取命令名和参数
    const command: string = data.command ?? data.name ?? "";
    const args: Record<string, any> = data.args ?? data.parameters ?? {};

    if (!command) {
      console.warn("[router] 收到 command 事件但缺少命令名称:", event.event.id);
      return null;
    }

    // 去除可能的 "/" 前缀进行匹配
    const normalizedCommand = command.startsWith("/") ? command.slice(1) : command;

    const handler = this.handlers.get(normalizedCommand);
    if (!handler) {
      console.warn(`[router] 未找到命令处理器: ${normalizedCommand}`);
      return `未知命令: ${command}`;
    }

    // 构建 ToolContext
    const ctx: ToolContext = {
      installationId: installation.id,
      botId: event.bot.id,
      userId: data.sender?.id ?? data.user_id ?? data.from ?? "",
      traceId: event.trace_id,
      args,
    };

    try {
      console.log(`[router] 执行命令: ${normalizedCommand}, trace=${ctx.traceId}`);
      const result = await handler(ctx);
      console.log(`[router] 命令执行完成: ${normalizedCommand}`);
      return result;
    } catch (err: any) {
      console.error(`[router] 命令执行失败: ${normalizedCommand}`, err);
      return `命令执行失败: ${err.message ?? "未知错误"}`;
    }
  }
}

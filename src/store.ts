import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Installation, MessageLink } from "./hub/types.js";

/**
 * SQLite 存储层 - 管理安装凭证和消息映射
 */
export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保目录存在
    const dir = dirname(dbPath);
    if (dir) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id TEXT PRIMARY KEY,
        hub_url TEXT NOT NULL,
        app_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        app_token TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS message_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id TEXT NOT NULL,
        lark_message_id TEXT NOT NULL,
        wx_user_id TEXT NOT NULL,
        wx_user_name TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ml_lark_msg
        ON message_links(lark_message_id);

      CREATE INDEX IF NOT EXISTS idx_ml_wx_user
        ON message_links(wx_user_id);
    `);
  }

  // ─── 安装管理 ───

  saveInstallation(inst: Installation): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO installations
         (id, hub_url, app_id, bot_id, app_token, webhook_secret, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(inst.id, inst.hubUrl, inst.appId, inst.botId, inst.appToken, inst.webhookSecret);
  }

  getInstallation(id: string): Installation | undefined {
    const row = this.db
      .prepare("SELECT * FROM installations WHERE id = ?")
      .get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      hubUrl: row.hub_url,
      appId: row.app_id,
      botId: row.bot_id,
      appToken: row.app_token,
      webhookSecret: row.webhook_secret,
      createdAt: row.created_at,
    };
  }

  getAllInstallations(): Installation[] {
    const rows = this.db.prepare("SELECT * FROM installations").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      hubUrl: row.hub_url,
      appId: row.app_id,
      botId: row.bot_id,
      appToken: row.app_token,
      webhookSecret: row.webhook_secret,
      createdAt: row.created_at,
    }));
  }

  // ─── 消息映射 ───

  saveMessageLink(link: MessageLink): void {
    this.db
      .prepare(
        `INSERT INTO message_links
         (installation_id, lark_message_id, wx_user_id, wx_user_name)
         VALUES (?, ?, ?, ?)`,
      )
      .run(link.installationId, link.larkMessageId, link.wxUserId, link.wxUserName);
  }

  getMessageLinkByLarkId(larkMessageId: string): MessageLink | undefined {
    const row = this.db
      .prepare("SELECT * FROM message_links WHERE lark_message_id = ?")
      .get(larkMessageId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      installationId: row.installation_id,
      larkMessageId: row.lark_message_id,
      wxUserId: row.wx_user_id,
      wxUserName: row.wx_user_name,
      createdAt: row.created_at,
    };
  }

  /** 查找某微信用户最近的一条消息映射 */
  getLatestLinkByWxUser(wxUserId: string): MessageLink | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM message_links WHERE wx_user_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(wxUserId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      installationId: row.installation_id,
      larkMessageId: row.lark_message_id,
      wxUserId: row.wx_user_id,
      wxUserName: row.wx_user_name,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }
}

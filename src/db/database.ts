/**
 * Database class wrapping better-sqlite3.
 * Creates tables on construction, enables WAL mode and foreign keys.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { SCHEMA_SQL } from "./schema.js";

export class ConversationDatabase {
  db: Database.Database;

  constructor(dbPath: string) {
    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Create tables
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Insert a project, returning its id. Upserts on (provider, source_id).
   */
  insertProject(
    provider: string,
    sourceId: string,
    name: string,
    createdAt?: string,
    updatedAt?: string,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO projects (provider, source_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, source_id) DO UPDATE SET
        name = excluded.name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      RETURNING id
    `);
    const row = stmt.get(provider, sourceId, name, createdAt ?? null, updatedAt ?? null) as { id: number };
    return row.id;
  }

  /**
   * Update project conversation count.
   */
  updateProjectConversationCount(projectId: number, count: number): void {
    this.db.prepare("UPDATE projects SET conversation_count = ? WHERE id = ?").run(count, projectId);
  }

  /**
   * Insert a conversation, returning its id. Upserts on (provider, source_id).
   */
  insertConversation(
    provider: string,
    sourceId: string,
    title: string,
    createdAt?: string,
    updatedAt?: string,
    model?: string,
    messageCount?: number,
    totalWords?: number,
    projectId?: number,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (provider, source_id, title, created_at, updated_at, model, message_count, total_words, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, source_id) DO UPDATE SET
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        model = excluded.model,
        message_count = excluded.message_count,
        total_words = excluded.total_words,
        project_id = excluded.project_id
      RETURNING id
    `);
    const row = stmt.get(
      provider, sourceId, title,
      createdAt ?? null, updatedAt ?? null,
      model ?? null,
      messageCount ?? 0, totalWords ?? 0,
      projectId ?? null,
    ) as { id: number };
    return row.id;
  }

  /**
   * Insert a message.
   */
  insertMessage(
    conversationId: number,
    role: string,
    content: string,
    wordCount: number,
    createdAt?: string,
    model?: string,
    sequenceOrder?: number,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, word_count, created_at, model, sequence_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      conversationId, role, content, wordCount,
      createdAt ?? null, model ?? null, sequenceOrder ?? 0,
    );
    return Number(info.lastInsertRowid);
  }

  /**
   * Delete all messages for a conversation (used before re-import).
   */
  deleteMessagesForConversation(conversationId: number): void {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  }

  /**
   * Record an import in the log.
   */
  insertImportLog(
    provider: string,
    sourcePath: string,
    conversationsImported: number,
    messagesImported: number,
    projectsImported: number,
  ): void {
    this.db.prepare(`
      INSERT INTO import_log (provider, source_path, conversations_imported, messages_imported, projects_imported)
      VALUES (?, ?, ?, ?, ?)
    `).run(provider, sourcePath, conversationsImported, messagesImported, projectsImported);
  }

  /**
   * Invalidate cached profile so it regenerates on next access.
   */
  invalidateProfileCache(): void {
    this.db.prepare("DELETE FROM profile_cache").run();
  }

  /**
   * Rebuild FTS5 index. Drops and re-inserts all message content.
   */
  rebuildFts(): void {
    this.db.exec("DROP TABLE IF EXISTS messages_fts");
    this.db.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(content)");
    this.db.exec(`
      INSERT INTO messages_fts(rowid, content)
      SELECT id, content FROM messages
      WHERE content IS NOT NULL AND content != ''
    `);
  }

  // ── Memory CRUD ──────────────────────────────────────────────

  /**
   * Insert a single memory.
   */
  insertMemory(category: string, content: string): number {
    const stmt = this.db.prepare(
      "INSERT INTO memories (category, content, created_at) VALUES (?, ?, datetime('now'))",
    );
    const info = stmt.run(category, content);
    return Number(info.lastInsertRowid);
  }

  /**
   * Insert multiple memories in a transaction.
   */
  insertMemories(memories: { category: string; content: string }[]): number {
    const stmt = this.db.prepare(
      "INSERT INTO memories (category, content, created_at) VALUES (?, ?, datetime('now'))",
    );
    const insertAll = this.db.transaction((items: { category: string; content: string }[]) => {
      let count = 0;
      for (const m of items) {
        stmt.run(m.category, m.content);
        count++;
      }
      return count;
    });
    return insertAll(memories);
  }

  /**
   * Get all memories, optionally filtered by category.
   */
  getAllMemories(category?: string): { id: number; category: string; content: string; created_at: string }[] {
    if (category) {
      return this.db.prepare(
        "SELECT id, category, content, created_at FROM memories WHERE category = ? ORDER BY id",
      ).all(category) as { id: number; category: string; content: string; created_at: string }[];
    }
    return this.db.prepare(
      "SELECT id, category, content, created_at FROM memories ORDER BY id",
    ).all() as { id: number; category: string; content: string; created_at: string }[];
  }

  /**
   * Get total memory count.
   */
  getMemoryCount(): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }).count;
  }

  /**
   * Delete all memories.
   */
  deleteAllMemories(): void {
    this.db.prepare("DELETE FROM memories").run();
  }

  /**
   * Mark conversation IDs as processed for memory extraction.
   */
  markConversationsProcessed(conversationIds: number[]): void {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO memory_build_progress (conversation_id, processed_at) VALUES (?, datetime('now'))",
    );
    const markAll = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        stmt.run(id);
      }
    });
    markAll(conversationIds);
  }

  /**
   * Get IDs of conversations not yet processed for memory extraction.
   */
  getUnprocessedConversationIds(limit?: number): number[] {
    const sql = limit
      ? "SELECT c.id FROM conversations c LEFT JOIN memory_build_progress p ON c.id = p.conversation_id WHERE p.conversation_id IS NULL ORDER BY c.created_at ASC LIMIT ?"
      : "SELECT c.id FROM conversations c LEFT JOIN memory_build_progress p ON c.id = p.conversation_id WHERE p.conversation_id IS NULL ORDER BY c.created_at ASC";
    const rows = limit
      ? this.db.prepare(sql).all(limit) as { id: number }[]
      : this.db.prepare(sql).all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  /**
   * Get count of unprocessed conversations.
   */
  getUnprocessedCount(): number {
    return (this.db.prepare(
      "SELECT COUNT(*) as count FROM conversations c LEFT JOIN memory_build_progress p ON c.id = p.conversation_id WHERE p.conversation_id IS NULL",
    ).get() as { count: number }).count;
  }

  /**
   * Clear all memory build progress (for full rebuild).
   */
  clearMemoryBuildProgress(): void {
    this.db.prepare("DELETE FROM memory_build_progress").run();
  }

  /**
   * Clear memory build progress for specific conversation IDs (for re-import).
   */
  clearMemoryBuildProgressForConversations(conversationIds: number[]): void {
    const stmt = this.db.prepare(
      "DELETE FROM memory_build_progress WHERE conversation_id = ?",
    );
    const clearAll = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        stmt.run(id);
      }
    });
    clearAll(conversationIds);
  }

  /**
   * Run a function inside a transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

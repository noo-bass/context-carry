import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";
import { ConversationDatabase } from "../../src/db/database.js";
import { getStats, searchConversations, getConversation, listConversations, listProjects, getProject } from "../../src/db/queries.js";

let db: ConversationDatabase;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `context-carry-test-${randomUUID()}.db`);
  db = new ConversationDatabase(dbPath);
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
  // Also clean up WAL and SHM files
  if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
  if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
});

describe("ConversationDatabase", () => {
  it("creates tables on construction", () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("import_log");
  });

  it("inserts and retrieves a conversation", () => {
    const convId = db.insertConversation("chatgpt", "src-1", "Test Conversation", "2024-01-01T00:00:00Z");
    expect(convId).toBeGreaterThan(0);

    const result = getConversation(db.db, convId);
    expect(result).not.toBeNull();
    expect(result!.conversation.title).toBe("Test Conversation");
    expect(result!.conversation.provider).toBe("chatgpt");
  });

  it("upserts on conflict", () => {
    const id1 = db.insertConversation("chatgpt", "src-1", "Original Title");
    const id2 = db.insertConversation("chatgpt", "src-1", "Updated Title");
    expect(id1).toBe(id2);

    const result = getConversation(db.db, id1);
    expect(result!.conversation.title).toBe("Updated Title");
  });

  it("inserts messages with ON DELETE CASCADE", () => {
    const convId = db.insertConversation("chatgpt", "src-1", "Test");
    db.insertMessage(convId, "user", "Hello", 1, "2024-01-01T00:00:00Z");
    db.insertMessage(convId, "assistant", "Hi there", 2, "2024-01-01T00:00:01Z");

    const result = getConversation(db.db, convId);
    expect(result!.messages).toHaveLength(2);
  });

  it("inserts projects and links conversations", () => {
    const projId = db.insertProject("chatgpt", "proj-1", "My Project");
    const convId = db.insertConversation("chatgpt", "src-1", "Test", undefined, undefined, undefined, undefined, undefined, projId);

    const projectResult = getProject(db.db, projId);
    expect(projectResult).not.toBeNull();
    expect(projectResult!.conversations).toHaveLength(1);
    expect(projectResult!.conversations[0].id).toBe(convId);
  });
});

describe("FTS search", () => {
  it("rebuilds FTS and searches", () => {
    const convId = db.insertConversation("chatgpt", "src-1", "TypeScript Test", "2024-01-01T00:00:00Z");
    db.insertMessage(convId, "user", "How do I use TypeScript generics?", 6);
    db.insertMessage(convId, "assistant", "TypeScript generics allow you to create reusable components.", 9);

    db.rebuildFts();

    const results = searchConversations(db.db, "generics");
    expect(results).toHaveLength(1);
    expect(results[0].conversation_id).toBe(convId);
    expect(results[0].title).toBe("TypeScript Test");
  });
});

describe("Stats", () => {
  it("returns correct corpus statistics", () => {
    db.insertConversation("chatgpt", "c1", "Test 1", "2024-01-01T00:00:00Z", undefined, "gpt-4", 2, 100);
    db.insertConversation("claude-web", "c2", "Test 2", "2024-02-01T00:00:00Z", undefined, "claude-3", 3, 200);

    const stats = getStats(db.db);
    expect(stats.total_conversations).toBe(2);
    expect(stats.total_words).toBe(300);
    expect(stats.providers).toHaveLength(2);
  });
});

describe("List queries", () => {
  it("lists conversations with provider filter", () => {
    db.insertConversation("chatgpt", "c1", "ChatGPT Conv", "2024-01-01T00:00:00Z");
    db.insertConversation("claude-web", "c2", "Claude Conv", "2024-02-01T00:00:00Z");

    const all = listConversations(db.db);
    expect(all).toHaveLength(2);

    const chatgptOnly = listConversations(db.db, { provider: "chatgpt" });
    expect(chatgptOnly).toHaveLength(1);
    expect(chatgptOnly[0].provider).toBe("chatgpt");
  });

  it("lists projects", () => {
    db.insertProject("chatgpt", "p1", "Project 1");
    db.insertProject("claude-web", "p2", "Project 2");

    const all = listProjects(db.db);
    expect(all).toHaveLength(2);

    const chatgptOnly = listProjects(db.db, "chatgpt");
    expect(chatgptOnly).toHaveLength(1);
  });
});

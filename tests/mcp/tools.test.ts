import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";
import { ConversationDatabase } from "../../src/db/database.js";
import { executeTool } from "../../src/mcp/tools.js";

let db: ConversationDatabase;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `context-carry-mcp-test-${randomUUID()}.db`);
  db = new ConversationDatabase(dbPath);

  // Seed test data
  const projId = db.insertProject("chatgpt", "proj-1", "Test Project");
  const convId = db.insertConversation(
    "chatgpt", "conv-1", "TypeScript Discussion",
    "2024-01-15T10:00:00Z", undefined, "gpt-4", 2, 150, projId,
  );
  db.insertMessage(convId, "user", "What are TypeScript generics?", 5, "2024-01-15T10:00:00Z");
  db.insertMessage(convId, "assistant", "TypeScript generics allow you to write reusable typed code.", 10, "2024-01-15T10:00:30Z", "gpt-4");

  const convId2 = db.insertConversation(
    "claude-web", "conv-2", "MQTT Protocol Help",
    "2024-02-01T14:00:00Z", undefined, "claude-3", 3, 200,
  );
  db.insertMessage(convId2, "user", "Explain MQTT for IoT devices", 5, "2024-02-01T14:00:00Z");
  db.insertMessage(convId2, "assistant", "MQTT is a lightweight messaging protocol ideal for IoT.", 9, "2024-02-01T14:00:30Z", "claude-3");

  db.rebuildFts();
  db.updateProjectConversationCount(projId, 1);
});

afterEach(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
});

describe("MCP tools", () => {
  it("search_conversations finds matches", () => {
    const result = executeTool(db, "search_conversations", { query: "generics" }) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("TypeScript Discussion");
  });

  it("search_conversations with provider filter", () => {
    const result = executeTool(db, "search_conversations", {
      query: "MQTT",
      provider: "chatgpt",
    }) as any[];
    expect(result).toHaveLength(0); // MQTT is in claude-web, not chatgpt
  });

  it("get_conversation returns full data", () => {
    const result = executeTool(db, "get_conversation", { conversation_id: 1 }) as any;
    expect(result.conversation.title).toBe("TypeScript Discussion");
    expect(result.messages).toHaveLength(2);
  });

  it("get_conversation with message_limit", () => {
    const result = executeTool(db, "get_conversation", {
      conversation_id: 1,
      message_limit: 1,
    }) as any;
    expect(result.messages).toHaveLength(1);
  });

  it("get_conversation returns error for missing id", () => {
    const result = executeTool(db, "get_conversation", { conversation_id: 999 }) as any;
    expect(result.error).toBeDefined();
  });

  it("list_conversations returns all", () => {
    const result = executeTool(db, "list_conversations", {}) as any[];
    expect(result).toHaveLength(2);
  });

  it("list_conversations with provider filter", () => {
    const result = executeTool(db, "list_conversations", {
      provider: "claude-web",
    }) as any[];
    expect(result).toHaveLength(1);
  });

  it("list_projects returns all", () => {
    const result = executeTool(db, "list_projects", {}) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Project");
  });

  it("get_project returns project with conversations", () => {
    const result = executeTool(db, "get_project", { project_id: 1 }) as any;
    expect(result.project.name).toBe("Test Project");
    expect(result.conversations).toHaveLength(1);
  });

  it("get_stats returns corpus-wide statistics", () => {
    const result = executeTool(db, "get_stats", {}) as any;
    expect(result.total_conversations).toBe(2);
    expect(result.total_words).toBe(350);
    expect(result.providers).toHaveLength(2);
  });
});

describe("Memory extraction flow", () => {
  it("get_user_profile returns no_profile when no memories exist", () => {
    const result = executeTool(db, "get_user_profile", {}) as any;
    expect(result.status).toBe("no_profile");
    expect(result.conversations_available).toBe(2);
    expect(result.message).toContain("build_user_profile");
  });

  it("build_user_profile returns batch of unprocessed conversations", () => {
    const result = executeTool(db, "build_user_profile", {}) as any;
    expect(result.status).toBe("pending");
    expect(result.batch).toHaveLength(2);
    expect(result.conversation_ids).toHaveLength(2);
    expect(result.total_remaining).toBe(2);
    expect(result.instructions).toContain("INSTRUCTIONS");
    // Should only contain user messages
    expect(result.batch[0].user_messages).toBeDefined();
    expect(result.batch[0].title).toBeDefined();
  });

  it("save_memories stores memories and marks conversations processed", () => {
    const result = executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Interested in TypeScript generics" },
        { category: "interest", content: "Working with MQTT and IoT devices" },
      ],
      conversation_ids_processed: [1, 2],
    }) as any;

    expect(result.memories_saved).toBe(2);
    expect(result.conversations_marked_processed).toBe(2);
    expect(result.remaining_unprocessed).toBe(0);
  });

  it("build_user_profile returns complete after all conversations processed", () => {
    // Process all conversations
    executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Interested in TypeScript generics" },
        { category: "interest", content: "Working with MQTT and IoT devices" },
      ],
      conversation_ids_processed: [1, 2],
    });

    const result = executeTool(db, "build_user_profile", {}) as any;
    expect(result.status).toBe("complete");
    expect(result.profile).toContain("Professional Details");
    expect(result.profile).toContain("TypeScript generics");
  });

  it("get_user_profile returns assembled profile after memories saved", () => {
    // Save some memories
    executeTool(db, "save_memories", {
      memories: [
        { category: "personal", content: "Based in South London" },
        { category: "professional", content: "Building context-carry MCP server" },
        { category: "response_preference", content: "Prefers concise responses with code examples" },
      ],
      conversation_ids_processed: [1, 2],
    });

    const result = executeTool(db, "get_user_profile", {}) as any;
    expect(result.profile).toContain("Personal Context");
    expect(result.profile).toContain("South London");
    expect(result.profile).toContain("Professional Details");
    expect(result.profile).toContain("context-carry");
    expect(result.profile).toContain("Response Preferences");
  });

  it("get_user_profile caches the profile", () => {
    executeTool(db, "save_memories", {
      memories: [{ category: "personal", content: "Name is Test User" }],
      conversation_ids_processed: [1, 2],
    });

    const result1 = executeTool(db, "get_user_profile", {}) as any;
    const result2 = executeTool(db, "get_user_profile", {}) as any;
    expect(result1.profile).toBe(result2.profile);
  });

  it("regenerate_profile clears everything and prompts rebuild", () => {
    // First build a profile
    executeTool(db, "save_memories", {
      memories: [{ category: "personal", content: "Name is Test User" }],
      conversation_ids_processed: [1, 2],
    });

    // Now regenerate
    const result = executeTool(db, "regenerate_profile", {}) as any;
    expect(result.message).toContain("cleared");
    expect(result.conversations_available).toBe(2);

    // Profile should now be gone
    const profileResult = executeTool(db, "get_user_profile", {}) as any;
    expect(profileResult.status).toBe("no_profile");
  });

  it("full round-trip: build → save → profile", () => {
    // Step 1: Get batch
    const batch = executeTool(db, "build_user_profile", {}) as any;
    expect(batch.status).toBe("pending");
    expect(batch.batch.length).toBeGreaterThan(0);

    // Step 2: Save memories
    const saveResult = executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Works with TypeScript" },
        { category: "interest", content: "IoT and MQTT protocols" },
        { category: "insight", content: "Asks focused technical questions" },
      ],
      conversation_ids_processed: batch.conversation_ids,
    }) as any;
    expect(saveResult.remaining_unprocessed).toBe(0);

    // Step 3: Build returns complete
    const complete = executeTool(db, "build_user_profile", {}) as any;
    expect(complete.status).toBe("complete");
    expect(complete.profile).toContain("TypeScript");

    // Step 4: get_user_profile works
    const profile = executeTool(db, "get_user_profile", {}) as any;
    expect(profile.profile).toContain("Professional Details");
    expect(profile.profile).toContain("Key Interests");
    expect(profile.profile).toContain("User Insights");
  });
});

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

  it("build_user_profile returns overview with projects and unassigned grouping", () => {
    const result = executeTool(db, "build_user_profile", {}) as any;
    expect(result.status).toBe("overview");
    expect(result.total_conversations).toBe(2);
    expect(result.conversation_ids).toHaveLength(2);
    expect(result.conversation_ids).toContain(1);
    expect(result.conversation_ids).toContain(2);
    // conv-1 is in "Test Project", conv-2 is unassigned
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("Test Project");
    expect(result.projects[0].conversations).toHaveLength(1);
    expect(result.projects[0].conversations[0].title).toBe("TypeScript Discussion");
    expect(result.projects[0].conversations[0].first_message).toBe("What are TypeScript generics?");
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].title).toBe("MQTT Protocol Help");
    expect(result.unassigned[0].first_message).toBe("Explain MQTT for IoT devices");
    // Date range
    expect(result.date_range.earliest).toBe("2024-01-15T10:00:00Z");
    expect(result.date_range.latest).toBe("2024-02-01T14:00:00Z");
  });

  it("build_user_profile with depth=quick returns quick instructions", () => {
    const result = executeTool(db, "build_user_profile", { depth: "quick" }) as any;
    expect(result.status).toBe("overview");
    expect(result.instructions).toContain("Call save_memories when done.");
    expect(result.instructions).not.toContain("deep-dive");
  });

  it("build_user_profile with depth=standard returns standard instructions", () => {
    const result = executeTool(db, "build_user_profile", { depth: "standard" }) as any;
    expect(result.status).toBe("overview");
    expect(result.instructions).toContain("deep-dive the ~20-30 most interesting");
    expect(result.instructions).toContain("get_conversation");
  });

  it("build_user_profile with depth=deep returns deep instructions", () => {
    const result = executeTool(db, "build_user_profile", { depth: "deep" }) as any;
    expect(result.status).toBe("overview");
    expect(result.instructions).toContain("deep-dive every conversation");
    expect(result.instructions).toContain("Save memories periodically");
  });

  it("build_user_profile defaults to quick depth", () => {
    const result = executeTool(db, "build_user_profile", {}) as any;
    expect(result.status).toBe("overview");
    expect(result.instructions).toContain("Call save_memories when done.");
  });

  it("build_user_profile truncates long first messages to ~30 words", () => {
    // Add a conversation with a long first message
    const longMessage = Array(50).fill("word").join(" ");
    const convId3 = db.insertConversation(
      "chatgpt", "conv-3", "Long Message Test",
      "2024-03-01T10:00:00Z", undefined, "gpt-4", 1, 50,
    );
    db.insertMessage(convId3, "user", longMessage, 50, "2024-03-01T10:00:00Z");

    const result = executeTool(db, "build_user_profile", {}) as any;
    const longConv = result.unassigned.find((c: any) => c.title === "Long Message Test");
    expect(longConv).toBeDefined();
    expect(longConv.first_message.endsWith("...")).toBe(true);
    // Should be roughly 30 words
    const wordCount = longConv.first_message.replace("...", "").trim().split(/\s+/).length;
    expect(wordCount).toBe(30);
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

  it("save_memories works without conversation_ids_processed", () => {
    const result = executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Uses TypeScript daily" },
      ],
    }) as any;

    expect(result.memories_saved).toBe(1);
    expect(result.conversations_marked_processed).toBe(0);
    // Conversations are still unprocessed
    expect(result.remaining_unprocessed).toBe(2);
  });

  it("save_memories with empty conversation_ids_processed", () => {
    const result = executeTool(db, "save_memories", {
      memories: [
        { category: "insight", content: "Asks focused technical questions" },
      ],
      conversation_ids_processed: [],
    }) as any;

    expect(result.memories_saved).toBe(1);
    expect(result.conversations_marked_processed).toBe(0);
    expect(result.remaining_unprocessed).toBe(2);
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

  it("full round-trip: overview → save → profile (quick depth)", () => {
    // Step 1: Get overview
    const overview = executeTool(db, "build_user_profile", { depth: "quick" }) as any;
    expect(overview.status).toBe("overview");
    expect(overview.total_conversations).toBe(2);
    expect(overview.projects.length + overview.unassigned.length).toBe(2);
    expect(overview.conversation_ids).toHaveLength(2);

    // Step 2: Save memories with all conversation IDs
    const saveResult = executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Works with TypeScript" },
        { category: "interest", content: "IoT and MQTT protocols" },
        { category: "insight", content: "Asks focused technical questions" },
      ],
      conversation_ids_processed: overview.conversation_ids,
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

  it("deep-dive enrichment: save memories without marking conversations", () => {
    // Step 1: Quick overview + save with IDs
    const overview = executeTool(db, "build_user_profile", { depth: "standard" }) as any;
    executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Works with TypeScript" },
      ],
      conversation_ids_processed: overview.conversation_ids,
    });

    // Step 2: Deep-dive enrichment — save additional memories without IDs
    const enrichResult = executeTool(db, "save_memories", {
      memories: [
        { category: "professional", content: "Advanced knowledge of TypeScript generics and mapped types" },
        { category: "interest", content: "Building IoT systems with MQTT broker clusters" },
      ],
    }) as any;
    expect(enrichResult.memories_saved).toBe(2);
    expect(enrichResult.conversations_marked_processed).toBe(0);
    expect(enrichResult.remaining_unprocessed).toBe(0);

    // Profile should include all memories
    const profile = executeTool(db, "get_user_profile", {}) as any;
    expect(profile.profile).toContain("TypeScript");
    expect(profile.profile).toContain("mapped types");
    expect(profile.profile).toContain("MQTT broker");
  });
});

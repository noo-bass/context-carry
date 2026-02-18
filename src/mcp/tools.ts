/**
 * MCP tool definitions with zod schemas.
 */

import { z } from "zod";
import type { ConversationDatabase } from "../db/database.js";
import {
  searchConversations,
  getConversation,
  listConversations,
  listProjects,
  getProject,
  getStats,
} from "../db/queries.js";
import { getOrAssembleProfile, getProfileOverview } from "../profile/generator.js";
import type { Depth } from "../profile/generator.js";

export const TOOL_DEFINITIONS = {
  search_conversations: {
    description:
      "Search across all imported AI conversations using full-text search. " +
      "Returns matching conversations with text snippets showing where the query matched.",
    inputSchema: z.object({
      query: z.string().describe("Full-text search query (FTS5 syntax supported)"),
      provider: z
        .enum(["chatgpt", "claude-web", "claude-code", "cowork"])
        .optional()
        .describe("Filter results to a specific provider"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum results to return"),
      offset: z.number().int().min(0).default(0).describe("Offset for pagination"),
    }),
  },

  get_conversation: {
    description:
      "Get a single conversation with its full message history. " +
      "Use message_limit to get only the first N messages of long conversations.",
    inputSchema: z.object({
      conversation_id: z.number().int().describe("Conversation database ID"),
      message_limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Limit messages returned (omit for all)"),
    }),
  },

  list_conversations: {
    description:
      "List conversations with optional filters for provider, project, and date range. " +
      "Returns paginated results sorted by date (newest first).",
    inputSchema: z.object({
      provider: z
        .enum(["chatgpt", "claude-web", "claude-code", "cowork"])
        .optional()
        .describe("Filter by provider"),
      project_id: z.number().int().optional().describe("Filter by project ID"),
      after: z.string().optional().describe("Only conversations after this ISO date"),
      before: z.string().optional().describe("Only conversations before this ISO date"),
      limit: z.number().int().min(1).max(100).default(50).describe("Maximum results"),
      offset: z.number().int().min(0).default(0).describe("Offset for pagination"),
    }),
  },

  list_projects: {
    description: "List all projects/workspaces, optionally filtered by provider.",
    inputSchema: z.object({
      provider: z
        .enum(["chatgpt", "claude-web", "claude-code", "cowork"])
        .optional()
        .describe("Filter by provider"),
    }),
  },

  get_project: {
    description: "Get details for a specific project including its conversation list.",
    inputSchema: z.object({
      project_id: z.number().int().describe("Project database ID"),
    }),
  },

  get_stats: {
    description:
      "Get corpus-wide statistics: total conversations, messages, words, " +
      "and per-provider breakdowns. Useful for understanding the scope of imported data.",
    inputSchema: z.object({}),
  },

  get_user_profile: {
    description:
      "IMPORTANT: Call this tool at the start of every session. " +
      "Returns the user's profile built from extracted memories — their interests, skills, " +
      "projects, and communication style. If no profile exists yet, tells you to call " +
      "build_user_profile to start building one.",
    inputSchema: z.object({}),
  },

  regenerate_profile: {
    description:
      "Wipe all extracted memories and rebuild the profile from scratch. " +
      "Use after the user imports new conversations, or if they say the profile is outdated. " +
      "After calling this, call build_user_profile to start the rebuild.",
    inputSchema: z.object({}),
  },

  build_user_profile: {
    description:
      "Get an overview of ALL conversations for memory extraction. " +
      "Returns all conversation titles and first messages grouped by project in a single response. " +
      "Use depth='quick' for title-scan only (fastest), 'standard' to also deep-dive ~20-30 " +
      "interesting conversations, 'deep' to deep-dive all conversations.",
    inputSchema: z.object({
      depth: z
        .enum(["quick", "standard", "deep"])
        .default("quick")
        .describe("Extraction depth: quick (titles only), standard (titles + selective deep-dive), deep (titles + all deep-dives)"),
    }),
  },

  save_memories: {
    description:
      "Save extracted memories. Pass conversation_ids_processed to mark conversations as done. " +
      "After title scan, pass all conversation IDs. After deep dives, just pass the new memories.",
    inputSchema: z.object({
      memories: z
        .array(
          z.object({
            category: z
              .enum([
                "response_preference",
                "personal",
                "professional",
                "interest",
                "topic_highlight",
                "insight",
              ])
              .describe("Memory category"),
            content: z.string().describe("The memory content — be specific"),
          }),
        )
        .describe("Extracted memories"),
      conversation_ids_processed: z
        .array(z.number().int())
        .optional()
        .default([])
        .describe("IDs of conversations to mark as processed (pass all IDs after title scan)"),
    }),
  },
} as const;

type ToolName = keyof typeof TOOL_DEFINITIONS;

export function executeTool(
  db: ConversationDatabase,
  toolName: string,
  args: Record<string, unknown>,
): unknown {
  const sqliteDb = db.db;

  switch (toolName as ToolName) {
    case "search_conversations": {
      const { query, provider, limit, offset } = args as {
        query: string;
        provider?: string;
        limit?: number;
        offset?: number;
      };
      return searchConversations(sqliteDb, query, provider, limit, offset);
    }

    case "get_conversation": {
      const { conversation_id, message_limit } = args as {
        conversation_id: number;
        message_limit?: number;
      };
      const result = getConversation(sqliteDb, conversation_id, message_limit);
      if (!result) return { error: "Conversation not found" };
      return result;
    }

    case "list_conversations": {
      const { provider, project_id, after, before, limit, offset } = args as {
        provider?: string;
        project_id?: number;
        after?: string;
        before?: string;
        limit?: number;
        offset?: number;
      };
      return listConversations(sqliteDb, {
        provider,
        projectId: project_id,
        after,
        before,
        limit,
        offset,
      });
    }

    case "list_projects": {
      const { provider } = args as { provider?: string };
      return listProjects(sqliteDb, provider);
    }

    case "get_project": {
      const { project_id } = args as { project_id: number };
      const result = getProject(sqliteDb, project_id);
      if (!result) return { error: "Project not found" };
      return result;
    }

    case "get_stats": {
      return getStats(sqliteDb);
    }

    case "get_user_profile": {
      const { profile, source } = getOrAssembleProfile(db);
      if (source === "none") {
        const unprocessed = db.getUnprocessedCount();
        return {
          status: "no_profile",
          message:
            "No user profile has been built yet. " +
            `There are ${unprocessed} conversations available. ` +
            "Call `build_user_profile` to get an overview of all conversations, " +
            "extract memories, then call `save_memories` with your findings.",
          conversations_available: unprocessed,
        };
      }
      return { profile };
    }

    case "regenerate_profile": {
      db.deleteAllMemories();
      db.clearMemoryBuildProgress();
      db.invalidateProfileCache();
      const unprocessed = db.getUnprocessedCount();
      return {
        message:
          "All memories and profile cache cleared. " +
          `${unprocessed} conversations ready for processing. ` +
          "Call `build_user_profile` to start rebuilding.",
        conversations_available: unprocessed,
      };
    }

    case "build_user_profile": {
      const { depth } = args as { depth?: Depth };
      return getProfileOverview(db, depth || "quick");
    }

    case "save_memories": {
      const { memories, conversation_ids_processed = [] } = args as {
        memories: { category: string; content: string }[];
        conversation_ids_processed?: number[];
      };

      const savedCount = db.insertMemories(memories);
      if (conversation_ids_processed.length > 0) {
        db.markConversationsProcessed(conversation_ids_processed);
      }
      db.invalidateProfileCache();

      const remaining = db.getUnprocessedCount();
      return {
        memories_saved: savedCount,
        conversations_marked_processed: conversation_ids_processed.length,
        remaining_unprocessed: remaining,
        message:
          remaining > 0
            ? `Saved ${savedCount} memories. ${remaining} conversations remaining — use get_conversation to deep-dive interesting ones, or call get_user_profile to see the current profile.`
            : `Saved ${savedCount} memories. All conversations processed! Call get_user_profile to see the assembled profile.`,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

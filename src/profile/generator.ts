/**
 * Memory-based profile generation.
 * The AI client extracts memories from conversations in batches,
 * then this module assembles them into a ChatGPT-style profile.
 */

import type { ConversationDatabase } from "../db/database.js";

const BATCH_SIZE = 10;
const MAX_WORDS_PER_CONVERSATION = 500;

const MEMORY_CATEGORIES = [
  "response_preference",
  "personal",
  "professional",
  "interest",
  "topic_highlight",
  "insight",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const EXTRACTION_PROMPT = `INSTRUCTIONS: Below are user messages from conversations. Extract memories about this user.
For each memory, classify into a category:
- response_preference: How they communicate and like to receive responses
- personal: Name, location, relationships, hobbies, life details
- professional: Work, skills, tools, projects
- interest: Topics and domains they care about
- topic_highlight: Brief summary of a notable conversation topic
- insight: Behavioral patterns

Extract 2-5 memories per conversation where relevant. Skip conversations with nothing notable.
Be specific — "Interested in web3" is worse than "Building a Polymarket trading bot with LMSR".
After extracting, call save_memories with your findings, then call build_user_profile for the next batch.`;

interface ConversationBatch {
  conversation_id: number;
  title: string;
  created_at: string | null;
  user_messages: string;
}

export interface BuildBatchResult {
  status: "pending";
  batch: ConversationBatch[];
  conversation_ids: number[];
  total_remaining: number;
  instructions: string;
}

export interface BuildCompleteResult {
  status: "complete";
  profile: string;
}

/**
 * Get the next batch of unprocessed conversations for memory extraction.
 * Returns user messages only, truncated to ~500 words per conversation.
 */
export function getBuildBatch(db: ConversationDatabase): BuildBatchResult | BuildCompleteResult {
  const unprocessedIds = db.getUnprocessedConversationIds(BATCH_SIZE);

  if (unprocessedIds.length === 0) {
    // All conversations processed — return assembled profile
    const profile = assembleProfileFromMemories(db);
    return { status: "complete", profile };
  }

  const totalRemaining = db.getUnprocessedCount();

  const batch: ConversationBatch[] = [];
  for (const convId of unprocessedIds) {
    const conv = db.db.prepare(
      "SELECT id, title, created_at FROM conversations WHERE id = ?",
    ).get(convId) as { id: number; title: string; created_at: string | null } | undefined;
    if (!conv) continue;

    // Get user messages only
    const messages = db.db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role IN ('user', 'human') ORDER BY sequence_order",
    ).all(convId) as { content: string }[];

    // Truncate to ~MAX_WORDS_PER_CONVERSATION words total
    let wordCount = 0;
    const truncatedMessages: string[] = [];
    for (const msg of messages) {
      const words = msg.content.split(/\s+/);
      if (wordCount + words.length > MAX_WORDS_PER_CONVERSATION) {
        const remaining = MAX_WORDS_PER_CONVERSATION - wordCount;
        if (remaining > 0) {
          truncatedMessages.push(words.slice(0, remaining).join(" ") + "...");
        }
        break;
      }
      truncatedMessages.push(msg.content);
      wordCount += words.length;
    }

    batch.push({
      conversation_id: conv.id,
      title: conv.title,
      created_at: conv.created_at,
      user_messages: truncatedMessages.join("\n\n"),
    });
  }

  return {
    status: "pending",
    batch,
    conversation_ids: unprocessedIds,
    total_remaining: totalRemaining,
    instructions: EXTRACTION_PROMPT,
  };
}

/**
 * Assemble a profile from all stored memories in ChatGPT's section format.
 */
export function assembleProfileFromMemories(db: ConversationDatabase): string {
  const memories = db.getAllMemories();

  if (memories.length === 0) {
    return "";
  }

  // Group by category
  const grouped: Record<string, string[]> = {};
  for (const cat of MEMORY_CATEGORIES) {
    grouped[cat] = [];
  }
  for (const m of memories) {
    if (grouped[m.category]) {
      grouped[m.category].push(m.content);
    }
  }

  // Get date range from conversations
  const dateRange = db.db.prepare(
    "SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM conversations",
  ).get() as { earliest: string | null; latest: string | null };

  const totalConversations = (db.db.prepare(
    "SELECT COUNT(*) as count FROM conversations",
  ).get() as { count: number }).count;

  const processedCount = (db.db.prepare(
    "SELECT COUNT(*) as count FROM memory_build_progress",
  ).get() as { count: number }).count;

  const lines: string[] = [];

  const sectionMap: Record<string, string> = {
    response_preference: "Response Preferences",
    personal: "Personal Context",
    professional: "Professional Details",
    interest: "Key Interests",
    topic_highlight: "Notable Conversation Topics",
    insight: "User Insights",
  };

  for (const cat of MEMORY_CATEGORIES) {
    const items = grouped[cat];
    if (items.length === 0) continue;
    lines.push(`## ${sectionMap[cat]}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `*Built from ${processedCount} conversations spanning ${formatDate(dateRange.earliest)} to ${formatDate(dateRange.latest)}*`,
  );
  if (processedCount < totalConversations) {
    lines.push(`*${totalConversations - processedCount} conversations not yet processed*`);
  }

  return lines.join("\n");
}

/**
 * Check if a profile can be served from memories (memories exist).
 */
export function hasMemories(db: ConversationDatabase): boolean {
  return db.getMemoryCount() > 0;
}

/**
 * Get a cached profile or assemble from memories.
 */
export function getOrAssembleProfile(db: ConversationDatabase): { profile: string; source: "cache" | "memories" | "none" } {
  // Check cache first
  const cached = db.db.prepare(
    "SELECT content FROM profile_cache WHERE id = 1",
  ).get() as { content: string } | undefined;

  if (cached) {
    return { profile: cached.content, source: "cache" };
  }

  // Assemble from memories
  if (hasMemories(db)) {
    const profile = assembleProfileFromMemories(db);
    // Cache it
    db.db.prepare(
      "INSERT OR REPLACE INTO profile_cache (id, content, generated_at) VALUES (1, ?, datetime('now'))",
    ).run(profile);
    return { profile, source: "memories" };
  }

  return { profile: "", source: "none" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

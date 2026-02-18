/**
 * Memory-based profile generation.
 * Title-scan-first approach: returns ALL conversation titles + first messages
 * in a single response for efficient memory extraction.
 */

import type { ConversationDatabase } from "../db/database.js";

const MAX_FIRST_MESSAGE_WORDS = 30;

const MEMORY_CATEGORIES = [
  "response_preference",
  "personal",
  "professional",
  "interest",
  "topic_highlight",
  "insight",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type Depth = "quick" | "standard" | "deep";

const EXTRACTION_PROMPT = `Extract memories about this user from the conversation titles and first messages below.
For each memory, classify into a category:
- response_preference: How they communicate and like to receive responses
- personal: Name, location, relationships, hobbies, life details
- professional: Work, skills, tools, projects
- interest: Topics and domains they care about
- topic_highlight: Brief summary of a notable conversation topic
- insight: Behavioral patterns

Be specific — "Interested in web3" is worse than "Building a Polymarket trading bot with LMSR".
Look for patterns across conversations, not just individual titles.`;

const DEPTH_INSTRUCTIONS: Record<Depth, string> = {
  quick:
    EXTRACTION_PROMPT + "\n\nCall save_memories when done.",
  standard:
    EXTRACTION_PROMPT +
    "\n\nAfter extracting from the overview, deep-dive the ~20-30 most interesting conversations using get_conversation. Call save_memories after each phase.",
  deep:
    EXTRACTION_PROMPT +
    "\n\nAfter extracting from the overview, deep-dive every conversation using get_conversation. Save memories periodically.",
};

interface ConversationOverview {
  id: number;
  title: string;
  date: string | null;
  first_message: string;
  message_count: number;
  total_words: number;
}

interface ProjectGroup {
  name: string;
  conversations: ConversationOverview[];
}

export interface ProfileOverviewResult {
  status: "overview";
  total_conversations: number;
  conversation_ids: number[];
  date_range: { earliest: string | null; latest: string | null };
  projects: ProjectGroup[];
  unassigned: ConversationOverview[];
  instructions: string;
}

export interface BuildCompleteResult {
  status: "complete";
  profile: string;
}

/**
 * Get an overview of all unprocessed conversations for memory extraction.
 * Returns titles + first user messages grouped by project.
 */
export function getProfileOverview(
  db: ConversationDatabase,
  depth: Depth = "quick",
): ProfileOverviewResult | BuildCompleteResult {
  const unprocessedIds = db.getUnprocessedConversationIds();

  if (unprocessedIds.length === 0) {
    const profile = assembleProfileFromMemories(db);
    return { status: "complete", profile };
  }

  // Get all unprocessed conversations with project info
  const placeholders = unprocessedIds.map(() => "?").join(",");
  const conversations = db.db.prepare(`
    SELECT c.id, c.title, c.created_at, c.message_count, c.total_words, c.project_id,
           p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.id IN (${placeholders})
    ORDER BY c.created_at ASC
  `).all(...unprocessedIds) as {
    id: number;
    title: string;
    created_at: string | null;
    message_count: number;
    total_words: number;
    project_id: number | null;
    project_name: string | null;
  }[];

  // Get first user message for each conversation
  const firstMessageStmt = db.db.prepare(
    "SELECT content FROM messages WHERE conversation_id = ? AND role IN ('user', 'human') ORDER BY sequence_order ASC LIMIT 1",
  );

  // Build overview entries grouped by project
  const projectGroups: Map<string, ConversationOverview[]> = new Map();
  const unassigned: ConversationOverview[] = [];

  for (const conv of conversations) {
    const firstMsg = firstMessageStmt.get(conv.id) as { content: string } | undefined;
    let firstMessage = "";
    if (firstMsg) {
      const words = firstMsg.content.split(/\s+/);
      firstMessage =
        words.length > MAX_FIRST_MESSAGE_WORDS
          ? words.slice(0, MAX_FIRST_MESSAGE_WORDS).join(" ") + "..."
          : firstMsg.content;
    }

    const entry: ConversationOverview = {
      id: conv.id,
      title: conv.title,
      date: conv.created_at,
      first_message: firstMessage,
      message_count: conv.message_count,
      total_words: conv.total_words,
    };

    if (conv.project_id && conv.project_name) {
      const group = projectGroups.get(conv.project_name) || [];
      group.push(entry);
      projectGroups.set(conv.project_name, group);
    } else {
      unassigned.push(entry);
    }
  }

  const projects: ProjectGroup[] = Array.from(projectGroups.entries()).map(
    ([name, convos]) => ({ name, conversations: convos }),
  );

  // Compute date range from conversations
  const dates = conversations
    .map((c) => c.created_at)
    .filter((d): d is string => d !== null)
    .sort();

  return {
    status: "overview",
    total_conversations: unprocessedIds.length,
    conversation_ids: unprocessedIds,
    date_range: {
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
    },
    projects,
    unassigned,
    instructions: DEPTH_INSTRUCTIONS[depth],
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

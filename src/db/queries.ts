/**
 * Prepared query functions for search, list, get, and stats operations.
 */

import type Database from "better-sqlite3";

export interface ConversationRow {
  id: number;
  provider: string;
  source_id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  model: string | null;
  message_count: number;
  total_words: number;
  project_id: number | null;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  word_count: number;
  created_at: string | null;
  model: string | null;
  sequence_order: number;
}

export interface ProjectRow {
  id: number;
  provider: string;
  source_id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
  conversation_count: number;
}

export interface SearchResult {
  conversation_id: number;
  title: string;
  provider: string;
  created_at: string | null;
  snippet: string;
  message_count: number;
  total_words: number;
}

export interface StatsResult {
  total_conversations: number;
  total_messages: number;
  total_words: number;
  total_projects: number;
  providers: ProviderStats[];
  earliest_conversation: string | null;
  latest_conversation: string | null;
}

export interface ProviderStats {
  provider: string;
  conversation_count: number;
  message_count: number;
  total_words: number;
}

/**
 * Search conversations using FTS5.
 */
export function searchConversations(
  db: Database.Database,
  query: string,
  provider?: string,
  limit = 20,
  offset = 0,
): SearchResult[] {
  const params: unknown[] = [query];
  let providerClause = "";
  if (provider) {
    providerClause = "AND c.provider = ?";
    params.push(provider);
  }
  params.push(limit, offset);

  const stmt = db.prepare(`
    SELECT
      c.id as conversation_id,
      c.title,
      c.provider,
      c.created_at,
      substr(m.content, 1, 200) as snippet,
      c.message_count,
      c.total_words
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id IN (
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?
    )
    ${providerClause}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `);

  return stmt.all(...params) as SearchResult[];
}

/**
 * Get a single conversation by id with optional message limit.
 */
export function getConversation(
  db: Database.Database,
  conversationId: number,
  messageLimit?: number,
): { conversation: ConversationRow; messages: MessageRow[] } | null {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow | undefined;
  if (!conv) return null;

  let messagesStmt;
  if (messageLimit) {
    messagesStmt = db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence_order LIMIT ?",
    );
    const messages = messagesStmt.all(conversationId, messageLimit) as MessageRow[];
    return { conversation: conv, messages };
  } else {
    messagesStmt = db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence_order",
    );
    const messages = messagesStmt.all(conversationId) as MessageRow[];
    return { conversation: conv, messages };
  }
}

/**
 * List conversations with optional filters and pagination.
 */
export function listConversations(
  db: Database.Database,
  options: {
    provider?: string;
    projectId?: number;
    after?: string;
    before?: string;
    limit?: number;
    offset?: number;
  } = {},
): ConversationRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.provider) {
    conditions.push("provider = ?");
    params.push(options.provider);
  }
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.after) {
    conditions.push("created_at >= ?");
    params.push(options.after);
  }
  if (options.before) {
    conditions.push("created_at <= ?");
    params.push(options.before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  params.push(limit, offset);

  const stmt = db.prepare(`
    SELECT * FROM conversations
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);

  return stmt.all(...params) as ConversationRow[];
}

/**
 * List all projects with optional provider filter.
 */
export function listProjects(
  db: Database.Database,
  provider?: string,
): ProjectRow[] {
  if (provider) {
    return db.prepare(
      "SELECT * FROM projects WHERE provider = ? ORDER BY conversation_count DESC",
    ).all(provider) as ProjectRow[];
  }
  return db.prepare(
    "SELECT * FROM projects ORDER BY conversation_count DESC",
  ).all() as ProjectRow[];
}

/**
 * Get a single project by id with its conversations.
 */
export function getProject(
  db: Database.Database,
  projectId: number,
): { project: ProjectRow; conversations: ConversationRow[] } | null {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!project) return null;

  const conversations = db.prepare(
    "SELECT * FROM conversations WHERE project_id = ? ORDER BY created_at DESC",
  ).all(projectId) as ConversationRow[];

  return { project, conversations };
}

/**
 * Get corpus-wide statistics.
 */
export function getStats(db: Database.Database): StatsResult {
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_conversations,
      COALESCE(SUM(message_count), 0) as total_messages,
      COALESCE(SUM(total_words), 0) as total_words,
      MIN(created_at) as earliest_conversation,
      MAX(created_at) as latest_conversation
    FROM conversations
  `).get() as {
    total_conversations: number;
    total_messages: number;
    total_words: number;
    earliest_conversation: string | null;
    latest_conversation: string | null;
  };

  const totalProjects = (db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }).count;

  const providers = db.prepare(`
    SELECT
      c.provider,
      COUNT(*) as conversation_count,
      COALESCE(SUM(c.message_count), 0) as message_count,
      COALESCE(SUM(c.total_words), 0) as total_words
    FROM conversations c
    GROUP BY c.provider
    ORDER BY conversation_count DESC
  `).all() as ProviderStats[];

  return {
    total_conversations: totals.total_conversations,
    total_messages: totals.total_messages,
    total_words: totals.total_words,
    total_projects: totalProjects,
    providers,
    earliest_conversation: totals.earliest_conversation,
    latest_conversation: totals.latest_conversation,
  };
}

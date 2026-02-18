/**
 * DDL for the context-carry SQLite database.
 * Integer autoincrement PKs, UNIQUE(provider, source_id) for dedup,
 * ON DELETE CASCADE on messages, content-sync FTS5 table.
 */

export const SCHEMA_SQL = `
  -- Projects table
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    conversation_count INTEGER DEFAULT 0,
    UNIQUE(provider, source_id)
  );

  -- Conversations table
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    model TEXT,
    message_count INTEGER DEFAULT 0,
    total_words INTEGER DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    UNIQUE(provider, source_id)
  );

  -- Messages table
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    created_at TEXT,
    model TEXT,
    sequence_order INTEGER NOT NULL DEFAULT 0
  );

  -- FTS5 virtual table (standalone — rebuilt after each import)
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content
  );

  -- Memories extracted by the AI client
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Tracks which conversations have been processed for memory extraction
  CREATE TABLE IF NOT EXISTS memory_build_progress (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
    processed_at TEXT NOT NULL
  );

  -- Profile cache (generated user profile)
  CREATE TABLE IF NOT EXISTS profile_cache (
    id INTEGER PRIMARY KEY DEFAULT 1,
    content TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );

  -- Import log for provenance tracking
  CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    source_path TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    conversations_imported INTEGER DEFAULT 0,
    messages_imported INTEGER DEFAULT 0,
    projects_imported INTEGER DEFAULT 0
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_conversations_provider ON conversations(provider);
  CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
  CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
  CREATE INDEX IF NOT EXISTS idx_projects_provider ON projects(provider);
  CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
`;

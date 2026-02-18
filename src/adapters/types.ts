/**
 * Canonical data model for conversations from any AI provider.
 * All adapters normalize their provider-specific formats into these types.
 */

export type Provider = "chatgpt" | "claude-web" | "claude-code" | "cowork";

export type Role = "user" | "assistant" | "system" | "tool";

export type ContentType = "text" | "code" | "image" | "file" | "tool_call" | "tool_result" | "thinking";

export interface ContentPart {
  type: ContentType;
  text?: string;
  language?: string;     // for code blocks
  tool_name?: string;    // for tool_call / tool_result
  file_name?: string;    // for file / image
  mime_type?: string;    // for file / image
}

export interface CanonicalMessage {
  source_id: string;
  role: Role;
  content: ContentPart[];
  text: string;            // flattened plain text for FTS indexing
  word_count: number;
  created_at: string;      // ISO 8601
  model?: string;
  is_subagent?: boolean;   // Cowork subagent messages
}

export interface CanonicalConversation {
  source_id: string;
  provider: Provider;
  title: string;
  created_at: string;      // ISO 8601
  updated_at?: string;     // ISO 8601
  message_count: number;
  total_words: number;
  model?: string;          // primary model used
  project_source_id?: string;
  messages: CanonicalMessage[];
}

export interface CanonicalProject {
  source_id: string;
  provider: Provider;
  name: string;
  created_at?: string;
  updated_at?: string;
  conversation_count?: number;
}

export interface ImportResult {
  provider: Provider;
  conversations_imported: number;
  conversations_skipped: number;
  messages_imported: number;
  projects_imported: number;
  errors: string[];
}

export interface AdapterOptions {
  source_path: string;
}

export interface Adapter {
  provider: Provider;
  detect(path: string): Promise<boolean>;
  parse(options: AdapterOptions): AsyncGenerator<CanonicalConversation>;
  parseProjects?(options: AdapterOptions): AsyncGenerator<CanonicalProject>;
}

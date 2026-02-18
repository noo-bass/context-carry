/**
 * Claude.ai web export adapter.
 *
 * Parses the official Claude data export (conversations.json + projects.json).
 * Key differences from ChatGPT:
 *   - Messages are flat (no DAG)
 *   - Sender uses 'human'/'assistant' (not 'user'/'assistant')
 *   - Content is an array of typed blocks (text, thinking, tool_use, tool_result)
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { countWords, flattenContentToText, toIsoTimestamp } from "./base.js";
import type {
  Adapter,
  AdapterOptions,
  CanonicalConversation,
  CanonicalMessage,
  CanonicalProject,
  ContentPart,
} from "./types.js";

interface RawClaudeConversation {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: RawClaudeMessage[];
  account?: { uuid?: string };
  summary?: string;
}

interface RawClaudeMessage {
  uuid: string;
  sender: string;
  created_at: string;
  content: RawContentBlock[];
  text?: string;
  attachments?: Array<{ file_name?: string; file_type?: string; file_size?: number }>;
}

interface RawContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

interface RawClaudeProject {
  uuid: string;
  name: string;
  description?: string;
  is_private?: boolean;
  is_starter_project?: boolean;
  created_at?: string;
  updated_at?: string;
  docs?: Array<{ filename?: string }>;
}

export class ClaudeWebAdapter implements Adapter {
  provider = "claude-web" as const;

  async detect(path: string): Promise<boolean> {
    try {
      const convPath = join(path, "conversations.json");
      if (!existsSync(convPath)) return false;
      const raw = await readFile(convPath, "utf-8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) return false;
      // Claude.ai conversations have chat_messages (flat) and uuid
      return "chat_messages" in data[0] && "uuid" in data[0];
    } catch {
      return false;
    }
  }

  async *parse(options: AdapterOptions): AsyncGenerator<CanonicalConversation> {
    const raw = await readFile(join(options.source_path, "conversations.json"), "utf-8");
    const conversations: RawClaudeConversation[] = JSON.parse(raw);

    for (const conv of conversations) {
      const parsed = this.parseConversation(conv);
      if (parsed) yield parsed;
    }
  }

  async *parseProjects(options: AdapterOptions): AsyncGenerator<CanonicalProject> {
    const projectsPath = join(options.source_path, "projects.json");
    if (!existsSync(projectsPath)) return;

    const raw = await readFile(projectsPath, "utf-8");
    const projects: RawClaudeProject[] = JSON.parse(raw);

    for (const p of projects) {
      yield {
        source_id: p.uuid,
        provider: "claude-web",
        name: p.name || "Unnamed Project",
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    }
  }

  private parseConversation(conv: RawClaudeConversation): CanonicalConversation | null {
    const messages: CanonicalMessage[] = [];
    const modelCounts = new Map<string, number>();

    for (const msgRaw of conv.chat_messages || []) {
      const parsed = this.parseMessage(msgRaw);
      messages.push(...parsed);
    }

    if (messages.length === 0) return null;

    const totalWords = messages.reduce((sum, m) => sum + m.word_count, 0);
    const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      source_id: conv.uuid,
      provider: "claude-web",
      title: conv.name || "Untitled",
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      message_count: messages.length,
      total_words: totalWords,
      model: primaryModel,
      messages,
    };
  }

  private parseMessage(msgRaw: RawClaudeMessage): CanonicalMessage[] {
    const sender = msgRaw.sender || "unknown";
    const role = sender === "human" ? "user" : (sender as CanonicalMessage["role"]);
    const createdAt = msgRaw.created_at;
    const contentBlocks = msgRaw.content || [];

    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const contentParts: ContentPart[] = [];
    const toolMessages: CanonicalMessage[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
        contentParts.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && block.thinking) {
        thinkingParts.push(block.thinking);
        contentParts.push({ type: "thinking", text: block.thinking });
      } else if (block.type === "tool_use") {
        contentParts.push({
          type: "tool_call",
          tool_name: block.name,
          text: block.name === "create_artifact"
            ? `[Artifact: ${(block.input as Record<string, string>)?.title || "untitled"}]`
            : `[Tool: ${block.name || "unknown"}]`,
        });
      } else if (block.type === "tool_result") {
        contentParts.push({ type: "tool_result", tool_name: block.name });
      }
    }

    const results: CanonicalMessage[] = [];

    // Primary text message
    const primaryText = textParts.join("\n\n") || msgRaw.text || "";
    if (primaryText || contentParts.length === 0) {
      const text = flattenContentToText(contentParts.length > 0 ? contentParts : [{ type: "text", text: primaryText }]);
      results.push({
        source_id: msgRaw.uuid,
        role,
        content: contentParts.length > 0 ? contentParts : [{ type: "text", text: primaryText }],
        text,
        word_count: countWords(text),
        created_at: createdAt,
      });
    }

    return [...results, ...toolMessages];
  }
}

/**
 * Claude Code adapter.
 *
 * Parses the ~/.claude/ directory structure:
 *   projects/<encoded-path>/<session-id>.jsonl
 *
 * Each JSONL record has a 'type' field: user, assistant, progress, etc.
 * Sessions don't have titles — we infer from the first user message.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, basename } from "path";
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

interface JsonlRecord {
  type: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  userType?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
}

export class ClaudeCodeAdapter implements Adapter {
  provider = "claude-code" as const;

  async detect(path: string): Promise<boolean> {
    const projectsDir = join(path, "projects");
    if (!existsSync(projectsDir)) return false;

    try {
      const entries = await readdir(projectsDir);
      for (const entry of entries) {
        const entryPath = join(projectsDir, entry);
        const s = await stat(entryPath);
        if (s.isDirectory()) {
          const files = await readdir(entryPath);
          if (files.some((f) => f.endsWith(".jsonl"))) {
            // Check it's Claude Code (not Cowork) — no -sessions- prefix
            if (!entry.startsWith("-sessions-")) return true;
          }
        }
      }
    } catch {
      // fall through
    }
    return false;
  }

  async *parse(options: AdapterOptions): AsyncGenerator<CanonicalConversation> {
    const projectsDir = join(options.source_path, "projects");
    if (!existsSync(projectsDir)) return;

    const projectDirs = await readdir(projectsDir);

    for (const projDir of projectDirs.sort()) {
      const projPath = join(projectsDir, projDir);
      const s = await stat(projPath);
      if (!s.isDirectory()) continue;

      // Skip Cowork VM sessions
      if (projDir.startsWith("-sessions-")) continue;

      const files = await readdir(projPath);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();

      for (const jsonlFile of jsonlFiles) {
        const sessionPath = join(projPath, jsonlFile);
        const conv = await this.parseSession(sessionPath, projDir);
        if (conv && conv.message_count > 0) yield conv;
      }
    }
  }

  async *parseProjects(options: AdapterOptions): AsyncGenerator<CanonicalProject> {
    const projectsDir = join(options.source_path, "projects");
    if (!existsSync(projectsDir)) return;

    const projectDirs = await readdir(projectsDir);
    for (const projDir of projectDirs.sort()) {
      const projPath = join(projectsDir, projDir);
      const s = await stat(projPath);
      if (!s.isDirectory()) continue;
      if (projDir.startsWith("-sessions-")) continue;

      const files = await readdir(projPath);
      const jsonlCount = files.filter((f) => f.endsWith(".jsonl")).length;
      if (jsonlCount === 0) continue;

      yield {
        source_id: projDir,
        provider: "claude-code",
        name: decodeProjectPath(projDir),
        conversation_count: jsonlCount,
      };
    }
  }

  protected async parseSession(
    sessionPath: string,
    projectPath: string,
  ): Promise<CanonicalConversation | null> {
    const records = await readJsonl(sessionPath);
    if (records.length === 0) return null;

    const sessionId = basename(sessionPath, ".jsonl");
    const firstRecord = records[0];
    const messages: CanonicalMessage[] = [];
    const modelCounts = new Map<string, number>();
    const timestamps: string[] = [];

    for (const record of records) {
      if (record.timestamp) timestamps.push(record.timestamp);

      if (record.type === "user") {
        const msg = this.parseUserRecord(record);
        if (msg) messages.push(msg);
      } else if (record.type === "assistant") {
        const parsed = this.parseAssistantRecord(record);
        for (const msg of parsed) {
          messages.push(msg);
          if (msg.model) {
            modelCounts.set(msg.model, (modelCounts.get(msg.model) || 0) + 1);
          }
        }
      }
    }

    if (messages.length === 0) return null;

    const title = inferTitle(messages);
    const totalWords = messages.reduce((sum, m) => sum + m.word_count, 0);
    const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      source_id: sessionId,
      provider: this.provider,
      title,
      created_at: timestamps[0] ? toIsoTimestamp(timestamps[0]) : toIsoTimestamp(null),
      updated_at: timestamps.length > 1 ? toIsoTimestamp(timestamps[timestamps.length - 1]) : undefined,
      message_count: messages.length,
      total_words: totalWords,
      model: primaryModel,
      project_source_id: projectPath,
      messages,
    };
  }

  protected parseUserRecord(record: JsonlRecord): CanonicalMessage | null {
    const msgObj = record.message;
    if (!msgObj) return null;

    let text = "";
    const contentParts: ContentPart[] = [];

    const content = msgObj.content;
    if (typeof content === "string") {
      text = content;
      contentParts.push({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "string") {
          text += block;
          contentParts.push({ type: "text", text: block });
        } else if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            text += b.text;
            contentParts.push({ type: "text", text: b.text });
          }
        }
      }
    }

    // Skip empty and command messages
    if (!text || text.startsWith("<command-message>")) return null;

    return {
      source_id: record.uuid || "",
      role: "user",
      content: contentParts,
      text,
      word_count: countWords(text),
      created_at: record.timestamp ? toIsoTimestamp(record.timestamp) : toIsoTimestamp(null),
    };
  }

  protected parseAssistantRecord(record: JsonlRecord): CanonicalMessage[] {
    const msgObj = record.message;
    if (!msgObj) return [];

    const contentBlocks = msgObj.content;
    if (!Array.isArray(contentBlocks)) return [];

    const textParts: string[] = [];
    const contentParts: ContentPart[] = [];
    const model = msgObj.model;

    for (const block of contentBlocks) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === "text" && typeof b.text === "string" && b.text) {
        textParts.push(b.text);
        contentParts.push({ type: "text", text: b.text });
      } else if (b.type === "tool_use") {
        contentParts.push({
          type: "tool_call",
          tool_name: b.name as string,
        });
      }
    }

    if (textParts.length === 0 && contentParts.length === 0) return [];

    const text = flattenContentToText(contentParts);

    return [{
      source_id: record.uuid || "",
      role: "assistant",
      content: contentParts,
      text,
      word_count: countWords(text),
      created_at: record.timestamp ? toIsoTimestamp(record.timestamp) : toIsoTimestamp(null),
      model,
    }];
  }
}

/**
 * Decode encoded project path to human-readable name.
 * e.g. '-Users-jemrashbass-project' → 'project'
 */
export function decodeProjectPath(encoded: string): string {
  let pathStr = encoded.replace(/-/g, "/");
  if (pathStr.startsWith("/")) pathStr = pathStr.slice(1);

  const parts = pathStr.split("/").filter(Boolean);
  if (parts.length === 0) return encoded;

  // Skip common prefixes like Users/username
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() === "users" || parts[i].toLowerCase() === "home") {
      const meaningful = parts.slice(i + 2);
      return meaningful.length > 0 ? meaningful.join("/") : parts[parts.length - 1];
    }
  }
  return parts[parts.length - 1];
}

export async function readJsonl(filePath: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  } catch {
    // file read error
  }
  return records;
}

function inferTitle(messages: CanonicalMessage[]): string {
  for (const msg of messages) {
    if (msg.role === "user" && msg.text) {
      let title = msg.text.slice(0, 80).trim();
      if (msg.text.length > 80) title += "...";
      title = title.replace(/\n/g, " ").trim();
      return title;
    }
  }
  return "Untitled Claude Code Session";
}

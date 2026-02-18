/**
 * Cowork adapter.
 *
 * Extends Claude Code parsing with:
 *   - Multi-strategy session discovery (standard, LAMS, fallback)
 *   - Subagent chronological merging
 *   - Cowork-specific tool categorization
 *   - VM path detection (-sessions- prefix)
 */

import { readdir, stat } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { ClaudeCodeAdapter, readJsonl, decodeProjectPath } from "./claude-code.js";
import { countWords, flattenContentToText, toIsoTimestamp } from "./base.js";
import type {
  Adapter,
  AdapterOptions,
  CanonicalConversation,
  CanonicalMessage,
  CanonicalProject,
  ContentPart,
} from "./types.js";

/** Tools indicating a Cowork (vs Claude Code) session */
const COWORK_INDICATOR_TOOLS = new Set([
  "mcp__Claude_in_Chrome__computer",
  "mcp__Claude_in_Chrome__read_page",
  "mcp__Claude_in_Chrome__navigate",
  "Skill",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
]);

interface SessionInfo {
  mainFile: string;
  subagentFiles: string[];
  sessionId: string;
}

export class CoworkAdapter implements Adapter {
  provider = "cowork" as const;

  async detect(path: string): Promise<boolean> {
    // Check for Cowork-style sessions (-sessions- prefix in projects/)
    const projectsDir = join(path, "projects");
    if (!existsSync(projectsDir)) {
      // Also check LAMS directory
      const lamsDir = join(path, "local-agent-mode-sessions");
      return existsSync(lamsDir);
    }

    try {
      const entries = await readdir(projectsDir);
      return entries.some((e) => e.startsWith("-sessions-"));
    } catch {
      return false;
    }
  }

  async *parse(options: AdapterOptions): AsyncGenerator<CanonicalConversation> {
    const sessions = await this.discoverAllSessions(options.source_path);

    for (const [projectPath, sessionInfos] of sessions) {
      for (const sessionInfo of sessionInfos) {
        const conv = await this.parseSession(sessionInfo, projectPath);
        if (conv && conv.message_count > 0) yield conv;
      }
    }
  }

  async *parseProjects(options: AdapterOptions): AsyncGenerator<CanonicalProject> {
    const sessions = await this.discoverAllSessions(options.source_path);

    for (const [projectPath, sessionInfos] of sessions) {
      yield {
        source_id: projectPath,
        provider: "cowork",
        name: decodeCoworkProjectPath(projectPath),
        conversation_count: sessionInfos.length,
      };
    }
  }

  private async discoverAllSessions(sourcePath: string): Promise<Map<string, SessionInfo[]>> {
    const allSessions = new Map<string, SessionInfo[]>();

    const sources = this.resolveSources(sourcePath);

    for (const source of sources) {
      if (!existsSync(source)) continue;

      // Strategy 1: Standard projects/ directory
      const projectsDir = join(source, "projects");
      if (existsSync(projectsDir)) {
        const found = await this.discoverProjectSessions(projectsDir, true);
        for (const [key, sessions] of found) {
          allSessions.set(key, [...(allSessions.get(key) || []), ...sessions]);
        }
      }

      // Strategy 2: LAMS directory
      const lamsDir = join(source, "local-agent-mode-sessions");
      if (existsSync(lamsDir)) {
        const found = await this.discoverLamsSessions(lamsDir);
        for (const [key, sessions] of found) {
          allSessions.set(key, [...(allSessions.get(key) || []), ...sessions]);
        }
      }
    }

    return allSessions;
  }

  private resolveSources(sourcePath: string): string[] {
    if (sourcePath === "auto") {
      const home = homedir();
      return [
        join(home, ".claude"),
        join(home, "Library", "Application Support", "Claude"),
      ].filter((p) => existsSync(p));
    }

    const sources = [sourcePath];
    const home = homedir();
    const dotClaude = join(home, ".claude");
    const appSupport = join(home, "Library", "Application Support", "Claude");

    if (sourcePath === dotClaude && existsSync(appSupport)) sources.push(appSupport);
    if (sourcePath === appSupport && existsSync(dotClaude)) sources.push(dotClaude);

    return sources;
  }

  private async discoverProjectSessions(
    projectsDir: string,
    coworkOnly: boolean,
  ): Promise<Map<string, SessionInfo[]>> {
    const result = new Map<string, SessionInfo[]>();

    let entries: string[];
    try {
      entries = await readdir(projectsDir);
    } catch {
      return result;
    }

    for (const entry of entries.sort()) {
      const entryPath = join(projectsDir, entry);
      const s = await stat(entryPath).catch(() => null);
      if (!s?.isDirectory()) continue;

      if (coworkOnly && !entry.startsWith("-sessions-")) continue;

      const sessions = await this.scanProjectDir(entryPath);
      if (sessions.length > 0) {
        result.set(entry, sessions);
      }
    }

    return result;
  }

  private async scanProjectDir(projectDir: string): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    let files: string[];
    try {
      files = await readdir(projectDir);
    } catch {
      return sessions;
    }

    for (const file of files.sort()) {
      if (!file.endsWith(".jsonl")) continue;

      const sessionId = basename(file, ".jsonl");
      const mainFile = join(projectDir, file);

      // Look for subagent directory
      const subagentDir = join(projectDir, sessionId, "subagents");
      let subagentFiles: string[] = [];
      if (existsSync(subagentDir)) {
        try {
          const saFiles = await readdir(subagentDir);
          subagentFiles = saFiles
            .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
            .sort()
            .map((f) => join(subagentDir, f));
        } catch {
          // ignore
        }
      }

      sessions.push({ mainFile, subagentFiles, sessionId });
    }

    return sessions;
  }

  private async discoverLamsSessions(lamsDir: string): Promise<Map<string, SessionInfo[]>> {
    const result = new Map<string, SessionInfo[]>();

    const claudeProjectDirs = await this.findClaudeProjectsRecursive(lamsDir, 5);

    for (const [label, projDir] of claudeProjectDirs) {
      const found = await this.discoverProjectSessions(projDir, false);
      for (const [key, sessions] of found) {
        const prefixedKey = `lams:${label}:${key}`;
        result.set(prefixedKey, sessions);
      }
    }

    return result;
  }

  private async findClaudeProjectsRecursive(
    directory: string,
    maxDepth: number,
    depth = 0,
    labelParts: string[] = [],
  ): Promise<Array<[string, string]>> {
    if (depth > maxDepth) return [];
    const results: Array<[string, string]> = [];

    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return results;
    }

    for (const entry of entries.sort()) {
      if (entry.startsWith(".")) continue;
      const entryPath = join(directory, entry);

      const claudeProjects = join(entryPath, ".claude", "projects");
      if (existsSync(claudeProjects)) {
        const label = [...labelParts, entry].join("_");
        results.push([label, claudeProjects]);
        continue;
      }

      if (entry.length >= 8 || entry.startsWith("local_")) {
        const s = await stat(entryPath).catch(() => null);
        if (s?.isDirectory()) {
          const sub = await this.findClaudeProjectsRecursive(
            entryPath, maxDepth, depth + 1, [...labelParts, entry],
          );
          results.push(...sub);
        }
      }
    }

    return results;
  }

  private async parseSession(
    sessionInfo: SessionInfo,
    projectPath: string,
  ): Promise<CanonicalConversation | null> {
    // Parse main session records
    const mainRecords = await readJsonl(sessionInfo.mainFile);
    if (mainRecords.length === 0) return null;

    // Parse subagent records
    const allMessages: Array<{ msg: CanonicalMessage; sortTs: string }> = [];
    const modelCounts = new Map<string, number>();
    const timestamps: string[] = [];

    // Process main records
    this.processRecords(mainRecords, allMessages, modelCounts, timestamps);

    // Process subagent records (merge chronologically)
    for (const saFile of sessionInfo.subagentFiles) {
      const saRecords = await readJsonl(saFile);
      this.processRecords(saRecords, allMessages, modelCounts, timestamps, true);
    }

    // Sort by timestamp for chronological merge
    allMessages.sort((a, b) => a.sortTs.localeCompare(b.sortTs));
    const messages = allMessages.map((m) => m.msg);

    if (messages.length === 0) return null;

    const title = inferCoworkTitle(messages);
    const totalWords = messages.reduce((sum, m) => sum + m.word_count, 0);
    const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    timestamps.sort();

    return {
      source_id: sessionInfo.sessionId,
      provider: "cowork",
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

  private processRecords(
    records: Array<Record<string, unknown>>,
    allMessages: Array<{ msg: CanonicalMessage; sortTs: string }>,
    modelCounts: Map<string, number>,
    timestamps: string[],
    isSubagent = false,
  ): void {
    for (const record of records) {
      const timestamp = record.timestamp as string | undefined;
      if (timestamp) timestamps.push(timestamp);

      const recordType = record.type as string;

      if (recordType === "user") {
        const msg = this.parseUserRecord(record);
        if (msg) {
          if (isSubagent) msg.is_subagent = true;
          allMessages.push({ msg, sortTs: timestamp || "" });
        }
      } else if (recordType === "assistant") {
        const parsed = this.parseAssistantRecord(record);
        for (const msg of parsed) {
          if (isSubagent) msg.is_subagent = true;
          if (msg.model) modelCounts.set(msg.model, (modelCounts.get(msg.model) || 0) + 1);
          allMessages.push({ msg, sortTs: timestamp || "" });
        }
      }
    }
  }

  private parseUserRecord(record: Record<string, unknown>): CanonicalMessage | null {
    const msgObj = record.message as Record<string, unknown> | undefined;
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

    if (!text || text.startsWith("<command-message>")) return null;

    return {
      source_id: (record.uuid as string) || "",
      role: "user",
      content: contentParts,
      text,
      word_count: countWords(text),
      created_at: record.timestamp ? toIsoTimestamp(record.timestamp as string) : toIsoTimestamp(null),
    };
  }

  private parseAssistantRecord(record: Record<string, unknown>): CanonicalMessage[] {
    const msgObj = record.message as Record<string, unknown> | undefined;
    if (!msgObj) return [];

    const contentBlocks = msgObj.content;
    if (!Array.isArray(contentBlocks)) return [];

    const textParts: string[] = [];
    const contentParts: ContentPart[] = [];
    const model = msgObj.model as string | undefined;

    for (const block of contentBlocks) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === "text" && typeof b.text === "string" && b.text) {
        textParts.push(b.text);
        contentParts.push({ type: "text", text: b.text });
      } else if (b.type === "tool_use") {
        contentParts.push({ type: "tool_call", tool_name: b.name as string });
      }
    }

    if (textParts.length === 0 && contentParts.length === 0) return [];

    const text = flattenContentToText(contentParts);

    return [{
      source_id: (record.uuid as string) || "",
      role: "assistant",
      content: contentParts,
      text,
      word_count: countWords(text),
      created_at: record.timestamp ? toIsoTimestamp(record.timestamp as string) : toIsoTimestamp(null),
      model,
    }];
  }
}

function decodeCoworkProjectPath(encoded: string): string {
  // Handle LAMS prefix
  if (encoded.startsWith("lams:")) {
    const parts = encoded.split(":");
    const innerName = parts[parts.length - 1];
    return decodeCoworkProjectPath(innerName);
  }

  // Cowork VM paths: -sessions-<slug>
  if (encoded.startsWith("-sessions-")) {
    return encoded.slice("-sessions-".length);
  }

  return decodeProjectPath(encoded);
}

function inferCoworkTitle(messages: CanonicalMessage[]): string {
  for (const msg of messages) {
    if (msg.role === "user" && msg.text) {
      const content = msg.text.trim();
      if (content.length < 10) continue;
      let title = content.slice(0, 80).trim();
      if (content.length > 80) title += "...";
      title = title.replace(/\n/g, " ").trim();
      return title;
    }
  }
  return "Untitled Cowork Session";
}

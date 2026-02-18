/**
 * ChatGPT adapter.
 *
 * Parses conversations.json from ChatGPT data export.
 * Key challenge: ChatGPT uses a DAG/tree message structure (not flat).
 * We linearize by following children[-1] at each node (main branch).
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { countWords, flattenContentToText, toIsoTimestamp } from "./base.js";
import type {
  Adapter,
  AdapterOptions,
  CanonicalConversation,
  CanonicalMessage,
  CanonicalProject,
  ContentPart,
} from "./types.js";

interface RawChatGPTConversation {
  id: string;
  title: string;
  create_time: number | null;
  update_time: number | null;
  mapping: Record<string, RawNode>;
  gizmo_id?: string;
  gizmo_type?: string;
}

interface RawNode {
  id: string;
  parent?: string;
  children: string[];
  message?: {
    id: string;
    author: { role: string; metadata?: Record<string, unknown> };
    content: { content_type: string; parts?: unknown[] };
    create_time: number | null;
    metadata?: { model_slug?: string; [key: string]: unknown };
  };
}

export class ChatGPTAdapter implements Adapter {
  provider = "chatgpt" as const;

  async detect(path: string): Promise<boolean> {
    try {
      const raw = await readFile(join(path, "conversations.json"), "utf-8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) return false;
      // ChatGPT conversations have a "mapping" field (DAG)
      return "mapping" in data[0];
    } catch {
      return false;
    }
  }

  async *parse(options: AdapterOptions): AsyncGenerator<CanonicalConversation> {
    const raw = await readFile(join(options.source_path, "conversations.json"), "utf-8");
    const conversations: RawChatGPTConversation[] = JSON.parse(raw);

    for (const conv of conversations) {
      const parsed = this.parseConversation(conv);
      if (parsed) yield parsed;
    }
  }

  async *parseProjects(options: AdapterOptions): AsyncGenerator<CanonicalProject> {
    const raw = await readFile(join(options.source_path, "conversations.json"), "utf-8");
    const conversations: RawChatGPTConversation[] = JSON.parse(raw);

    // Group conversations by gizmo_id to extract projects
    const projectMap = new Map<string, { gizmoType: string; titles: string[]; count: number }>();

    for (const conv of conversations) {
      if (conv.gizmo_id) {
        const existing = projectMap.get(conv.gizmo_id);
        if (existing) {
          existing.titles.push(conv.title || "Untitled");
          existing.count++;
        } else {
          projectMap.set(conv.gizmo_id, {
            gizmoType: conv.gizmo_type || "snorlax",
            titles: [conv.title || "Untitled"],
            count: 1,
          });
        }
      }
    }

    for (const [gizmoId, info] of projectMap) {
      yield {
        source_id: gizmoId,
        provider: "chatgpt",
        name: inferProjectName(info.titles),
        conversation_count: info.count,
      };
    }
  }

  private parseConversation(conv: RawChatGPTConversation): CanonicalConversation | null {
    const linearized = this.linearizeDAG(conv.mapping);
    if (linearized.length === 0) return null;

    const messages: CanonicalMessage[] = [];
    const modelCounts = new Map<string, number>();

    for (const node of linearized) {
      const msg = node.message;
      if (!msg) continue;

      const role = msg.author.role;
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") continue;

      const contentParts = this.extractContent(msg.content);
      const text = flattenContentToText(contentParts);
      if (!text && role !== "system") continue;

      const model = msg.metadata?.model_slug as string | undefined;
      if (role === "assistant" && model) {
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      }

      messages.push({
        source_id: msg.id,
        role: role as CanonicalMessage["role"],
        content: contentParts,
        text,
        word_count: countWords(text),
        created_at: msg.create_time ? toIsoTimestamp(msg.create_time) : toIsoTimestamp(conv.create_time),
        model,
      });
    }

    if (messages.length === 0) return null;

    const totalWords = messages.reduce((sum, m) => sum + m.word_count, 0);
    const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      source_id: conv.id,
      provider: "chatgpt",
      title: conv.title || "Untitled",
      created_at: toIsoTimestamp(conv.create_time),
      updated_at: conv.update_time ? toIsoTimestamp(conv.update_time) : undefined,
      message_count: messages.length,
      total_words: totalWords,
      model: primaryModel,
      project_source_id: conv.gizmo_id,
      messages,
    };
  }

  /**
   * Linearize the DAG by following children[-1] (main branch).
   * This matches the Python ConversationParser behavior.
   */
  private linearizeDAG(mapping: Record<string, RawNode>): RawNode[] {
    // Find root node (no parent or parent not in mapping)
    let rootId: string | undefined;
    for (const [id, node] of Object.entries(mapping)) {
      if (!node.parent || !(node.parent in mapping)) {
        rootId = id;
        break;
      }
    }
    if (!rootId) return [];

    // Follow main branch: always take last child
    const result: RawNode[] = [];
    let currentId: string | undefined = rootId;

    while (currentId) {
      const node = mapping[currentId];
      if (!node) break;
      result.push(node);
      // Follow the last child (main branch)
      currentId = node.children.length > 0 ? node.children[node.children.length - 1] : undefined;
    }

    return result;
  }

  private extractContent(content: { content_type: string; parts?: unknown[] }): ContentPart[] {
    const parts: ContentPart[] = [];

    if (content.content_type === "text" && content.parts) {
      for (const part of content.parts) {
        if (typeof part === "string" && part.trim()) {
          parts.push({ type: "text", text: part });
        }
      }
    } else if (content.content_type === "code" && content.parts) {
      for (const part of content.parts) {
        if (typeof part === "string") {
          parts.push({ type: "code", text: part });
        }
      }
    } else if (content.content_type === "multimodal_text" && content.parts) {
      for (const part of content.parts) {
        if (typeof part === "string") {
          parts.push({ type: "text", text: part });
        } else if (typeof part === "object" && part !== null) {
          const obj = part as Record<string, unknown>;
          if ("content_type" in obj && obj.content_type === "image_asset_pointer") {
            parts.push({ type: "image", file_name: (obj.metadata as Record<string, string>)?.dalle_metadata_prompt ?? "image" });
          }
        }
      }
    }

    return parts;
  }
}

function inferProjectName(titles: string[]): string {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
    "for", "of", "with", "by", "from", "is", "it", "this", "that",
    "how", "what", "when", "where", "why", "which", "who",
    "help", "please", "fix", "update", "add", "new", "create",
    "using", "make", "get", "set", "test", "debug", "issue",
  ]);

  const wordCounts = new Map<string, number>();
  for (const title of titles) {
    for (const word of title.toLowerCase().split(/\s+/)) {
      const clean = word.replace(/[.,!?:;()[\]{}'"–-]/g, "");
      if (clean.length > 2 && !stopWords.has(clean)) {
        wordCounts.set(clean, (wordCounts.get(clean) || 0) + 1);
      }
    }
  }

  const topWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

  return topWords.length > 0 ? topWords.join(" ") : titles[0] || "Unnamed Project";
}

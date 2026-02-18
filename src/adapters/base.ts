/**
 * Shared utilities used across all adapters.
 */

import type { ContentPart } from "./types.js";

/**
 * Count words in a string. Matches Python's simple split() behavior.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Convert various timestamp formats to ISO 8601 string.
 * Handles: Unix seconds, Unix milliseconds, ISO strings, Python datetime strings.
 */
export function toIsoTimestamp(value: unknown): string {
  if (value === null || value === undefined) {
    return new Date(0).toISOString();
  }

  if (typeof value === "number") {
    // Unix timestamp: if > 1e12, treat as milliseconds
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

/**
 * Flatten content parts into a single plain-text string for FTS indexing.
 */
export function flattenContentToText(parts: ContentPart[]): string {
  return parts
    .map((p) => {
      if (p.type === "text" || p.type === "thinking") return p.text ?? "";
      if (p.type === "code") return p.text ?? "";
      if (p.type === "tool_call") return `[Tool: ${p.tool_name ?? "unknown"}] ${p.text ?? ""}`;
      if (p.type === "tool_result") return `[Result: ${p.tool_name ?? "unknown"}] ${p.text ?? ""}`;
      if (p.type === "image") return `[Image: ${p.file_name ?? "image"}]`;
      if (p.type === "file") return `[File: ${p.file_name ?? "file"}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Safely parse JSON, returning undefined on failure.
 */
export function safeJsonParse<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Generate a stable source ID from provider + path components.
 */
export function makeSourceId(...parts: string[]): string {
  return parts.filter(Boolean).join(":");
}

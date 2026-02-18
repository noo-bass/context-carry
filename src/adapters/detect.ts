/**
 * Auto-detect provider from file/directory structure.
 */

import { ChatGPTAdapter } from "./chatgpt.js";
import { ClaudeWebAdapter } from "./claude-web.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CoworkAdapter } from "./cowork.js";
import type { Adapter, Provider } from "./types.js";

const ADAPTERS: Adapter[] = [
  new ChatGPTAdapter(),
  new ClaudeWebAdapter(),
  new CoworkAdapter(),     // Check Cowork before Claude Code (Cowork is a superset)
  new ClaudeCodeAdapter(),
];

/**
 * Auto-detect the provider for a given path.
 * Returns the first matching adapter, or null if no match.
 */
export async function detectProvider(path: string): Promise<Adapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(path)) {
      return adapter;
    }
  }
  return null;
}

/**
 * Get an adapter by provider name.
 */
export function getAdapter(provider: Provider): Adapter {
  switch (provider) {
    case "chatgpt":
      return new ChatGPTAdapter();
    case "claude-web":
      return new ClaudeWebAdapter();
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "cowork":
      return new CoworkAdapter();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

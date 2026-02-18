/**
 * List command: show conversations in the terminal.
 */

import { existsSync } from "fs";
import { ConversationDatabase } from "../db/database.js";
import { listConversations, searchConversations } from "../db/queries.js";
import type { Provider } from "../adapters/types.js";

export interface ListOptions {
  dbPath: string;
  provider?: Provider;
  search?: string;
  limit?: number;
  offset?: number;
}

export function runList(options: ListOptions): void {
  const { dbPath, provider, search, limit = 20, offset = 0 } = options;

  if (!existsSync(dbPath)) {
    console.log("No database found. Run 'context-carry import' first.");
    return;
  }

  const db = new ConversationDatabase(dbPath);
  try {
    if (search) {
      // FTS search
      const results = searchConversations(db.db, search, provider, limit, offset);
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      console.log(`Search results for "${search}":\n`);
      for (const r of results) {
        const date = r.created_at?.slice(0, 10) || "unknown";
        console.log(`  [${r.conversation_id}] ${date} (${r.provider}) ${r.title}`);
        if (r.snippet) {
          console.log(`       ${r.snippet.replace(/>>>/g, "[").replace(/<<</g, "]")}`);
        }
      }
    } else {
      // Simple list
      const conversations = listConversations(db.db, { provider, limit, offset });
      if (conversations.length === 0) {
        console.log("No conversations found.");
        return;
      }

      console.log("Conversations:\n");
      for (const c of conversations) {
        const date = c.created_at?.slice(0, 10) || "unknown";
        const words = c.total_words.toLocaleString();
        console.log(
          `  [${c.id}] ${date} (${c.provider.padEnd(11)}) ${c.title.slice(0, 60)}  [${words} words]`,
        );
      }

      if (conversations.length === limit) {
        console.log(`\n  Showing ${limit} of more. Use --offset ${offset + limit} for next page.`);
      }
    }
  } finally {
    db.close();
  }
}

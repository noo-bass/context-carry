/**
 * Status command: show database statistics.
 */

import { existsSync } from "fs";
import { ConversationDatabase } from "../db/database.js";
import { getStats } from "../db/queries.js";

export function runStatus(dbPath: string): void {
  if (!existsSync(dbPath)) {
    console.log("No database found. Run 'context-carry import' first.");
    return;
  }

  const db = new ConversationDatabase(dbPath);
  try {
    const stats = getStats(db.db);

    console.log("context-carry database status\n");
    console.log(`  Conversations: ${stats.total_conversations.toLocaleString()}`);
    console.log(`  Messages:      ${stats.total_messages.toLocaleString()}`);
    console.log(`  Words:         ${stats.total_words.toLocaleString()}`);
    console.log(`  Projects:      ${stats.total_projects.toLocaleString()}`);

    if (stats.earliest_conversation) {
      console.log(`  Date range:    ${stats.earliest_conversation.slice(0, 10)} to ${stats.latest_conversation?.slice(0, 10)}`);
    }

    if (stats.providers.length > 0) {
      console.log("\n  By provider:");
      for (const p of stats.providers) {
        console.log(
          `    ${p.provider.padEnd(12)} ${String(p.conversation_count).padStart(6)} conversations, ${p.total_words.toLocaleString().padStart(10)} words`,
        );
      }
    }
  } finally {
    db.close();
  }
}

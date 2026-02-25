/**
 * MCP server setup + stdio transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConversationDatabase } from "../db/database.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

export async function startMcpServer(dbPath: string): Promise<void> {
  const db = new ConversationDatabase(dbPath);

  const server = new McpServer({
    name: "context-carry",
    version: "0.2.0",
    instructions:
      "context-carry gives you access to the user's conversation history and session handoff tools.\n\n" +
      "SESSION HANDOFF (use these every session):\n" +
      "1. At session start, call `resume_context` with the current project directory to check for " +
      "prior context from a previous session.\n" +
      "2. Before ending a session, call `commit_context` to save a structured handoff snapshot " +
      "(task state, decisions, modified files, next steps). This is NOT the same as `save_memories` — " +
      "`commit_context` saves a project-specific session snapshot, while `save_memories` saves " +
      "long-lived user profile memories.\n\n" +
      "USER PROFILE:\n" +
      "Call `get_user_profile` to load the user's profile. If none exists, call `build_user_profile` " +
      "to get an overview of all conversations, extract memories, then call `save_memories` with " +
      "your findings and conversation IDs.\n\n" +
      "SEARCH:\n" +
      "Use `search_conversations` to find specific past conversations when the user references " +
      "something from their history.",
  });

  // Register all tools
  for (const [name, def] of Object.entries(TOOL_DEFINITIONS)) {
    server.tool(
      name,
      def.description,
      def.inputSchema.shape,
      async (args) => {
        try {
          const result = executeTool(db, name, args);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: String(err) }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    db.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    db.close();
    process.exit(0);
  });
}

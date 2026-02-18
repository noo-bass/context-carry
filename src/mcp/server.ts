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
      "context-carry gives you access to the user's conversation history from other AI providers. " +
      "IMPORTANT: At the start of every new session, call `get_user_profile` to load the user's profile. " +
      "If it says no profile exists, call `build_user_profile` to get an overview of ALL conversations " +
      "(titles + first messages) in a single response. Extract memories from the overview, then call " +
      "`save_memories` with your findings and the conversation IDs. That's it — just 2-3 tool calls! " +
      "For richer profiles, use depth='standard' or 'deep' to deep-dive interesting conversations " +
      "with `get_conversation`. " +
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

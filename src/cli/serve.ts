/**
 * Serve command: launch MCP server over stdio.
 */

import { startMcpServer } from "../mcp/server.js";

export async function runServe(dbPath: string): Promise<void> {
  await startMcpServer(dbPath);
}

/**
 * CLI entry point for context-carry.
 */

import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import type { Provider } from "./adapters/types.js";

const DEFAULT_DB = join(homedir(), ".context-carry", "conversations.db");

const program = new Command();

program
  .name("context-carry")
  .description("Import AI conversation exports and serve them via MCP")
  .version("0.1.0");

program
  .command("import")
  .description("Import conversations from a provider export (ZIP or directory)")
  .argument("<path>", "Path to export file (ZIP) or directory")
  .option("--provider <provider>", "Force provider (chatgpt, claude-web, claude-code, cowork)")
  .option("--db <path>", "Database path", DEFAULT_DB)
  .action(async (sourcePath: string, opts: { provider?: string; db: string }) => {
    const { runImport } = await import("./cli/import.js");
    await runImport({
      sourcePath,
      dbPath: opts.db,
      provider: opts.provider as Provider | undefined,
    });
  });

program
  .command("serve")
  .description("Start the MCP server (stdio transport)")
  .option("--db <path>", "Database path", DEFAULT_DB)
  .action(async (opts: { db: string }) => {
    const { runServe } = await import("./cli/serve.js");
    await runServe(opts.db);
  });

program
  .command("status")
  .description("Show database statistics")
  .option("--db <path>", "Database path", DEFAULT_DB)
  .action(async (opts: { db: string }) => {
    const { runStatus } = await import("./cli/status.js");
    runStatus(opts.db);
  });

program
  .command("list")
  .description("List conversations")
  .option("--provider <provider>", "Filter by provider")
  .option("--search <query>", "Full-text search")
  .option("--limit <n>", "Max results", "20")
  .option("--offset <n>", "Offset for pagination", "0")
  .option("--db <path>", "Database path", DEFAULT_DB)
  .action(
    async (opts: {
      provider?: string;
      search?: string;
      limit: string;
      offset: string;
      db: string;
    }) => {
      const { runList } = await import("./cli/list.js");
      runList({
        dbPath: opts.db,
        provider: opts.provider as Provider | undefined,
        search: opts.search,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
    },
  );

program.parse();

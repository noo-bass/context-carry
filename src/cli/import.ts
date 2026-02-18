/**
 * Import command: ZIP extraction → detect → parse → store.
 */

import { existsSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { detectProvider, getAdapter } from "../adapters/detect.js";
import { ConversationDatabase } from "../db/database.js";
import type { Adapter, CanonicalConversation, ImportResult, Provider } from "../adapters/types.js";

/**
 * Extract a ZIP file to a temporary directory using yauzl.
 */
async function extractZip(zipPath: string): Promise<string> {
  const yauzl = await import("yauzl");
  const { createWriteStream, mkdirSync: mkdirSyncFs } = await import("fs");
  const { dirname, join: joinPath } = await import("path");
  const { pipeline } = await import("stream/promises");

  const tempDir = join(tmpdir(), `context-carry-${randomUUID()}`);
  mkdirSyncFs(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) return reject(err || new Error("Failed to open ZIP"));

      zipFile.readEntry();

      zipFile.on("entry", (entry) => {
        const outputPath = joinPath(tempDir, entry.fileName);

        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          mkdirSyncFs(outputPath, { recursive: true });
          zipFile.readEntry();
        } else {
          // File entry
          mkdirSyncFs(dirname(outputPath), { recursive: true });
          zipFile.openReadStream(entry, (err2, readStream) => {
            if (err2 || !readStream) return reject(err2 || new Error("Failed to read ZIP entry"));

            const writeStream = createWriteStream(outputPath);
            pipeline(readStream, writeStream)
              .then(() => zipFile.readEntry())
              .catch(reject);
          });
        }
      });

      zipFile.on("end", () => resolve(tempDir));
      zipFile.on("error", reject);
    });
  });
}

export interface ImportOptions {
  sourcePath: string;
  dbPath: string;
  provider?: Provider;
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const { sourcePath, dbPath, provider: forceProvider } = options;

  // Determine if source is a ZIP
  let importPath = sourcePath;
  let tempDir: string | null = null;

  if (sourcePath.endsWith(".zip") && existsSync(sourcePath)) {
    console.log("Extracting ZIP archive...");
    tempDir = await extractZip(sourcePath);
    importPath = tempDir;

    // If ZIP extracted to a single subdirectory, use that
    const { readdirSync } = await import("fs");
    const entries = readdirSync(importPath).filter((e) => !e.startsWith("."));
    if (entries.length === 1) {
      const subdir = join(importPath, entries[0]);
      if (statSync(subdir).isDirectory()) {
        importPath = subdir;
      }
    }
    console.log(`Extracted to ${importPath}`);
  }

  try {
    // Detect or use forced provider
    let adapter: Adapter;
    if (forceProvider) {
      adapter = getAdapter(forceProvider);
      console.log(`Using provider: ${forceProvider}`);
    } else {
      const detected = await detectProvider(importPath);
      if (!detected) {
        throw new Error(
          `Could not auto-detect provider for ${importPath}. ` +
          `Use --provider to specify one of: chatgpt, claude-web, claude-code, cowork`,
        );
      }
      adapter = detected;
      console.log(`Auto-detected provider: ${adapter.provider}`);
    }

    // Open database
    const db = new ConversationDatabase(dbPath);

    const result: ImportResult = {
      provider: adapter.provider,
      conversations_imported: 0,
      conversations_skipped: 0,
      messages_imported: 0,
      projects_imported: 0,
      errors: [],
    };

    try {
      // Import projects first (if adapter supports it)
      const projectIdMap = new Map<string, number>();
      if (adapter.parseProjects) {
        console.log("Importing projects...");
        for await (const project of adapter.parseProjects({ source_path: importPath })) {
          try {
            const id = db.insertProject(
              project.provider,
              project.source_id,
              project.name,
              project.created_at,
              project.updated_at,
            );
            projectIdMap.set(project.source_id, id);
            result.projects_imported++;
          } catch (err) {
            result.errors.push(`Project ${project.source_id}: ${err}`);
          }
        }
        console.log(`  ${result.projects_imported} projects`);
      }

      // Import conversations in a transaction
      console.log("Importing conversations...");

      // Collect conversations first (async generator can't run inside sync transaction)
      const conversations: CanonicalConversation[] = [];
      for await (const conv of adapter.parse({ source_path: importPath })) {
        conversations.push(conv);
      }

      db.transaction(() => {
        for (const conv of conversations) {
          try {
            // Resolve project reference
            let projectId: number | undefined;
            if (conv.project_source_id && projectIdMap.has(conv.project_source_id)) {
              projectId = projectIdMap.get(conv.project_source_id);
            }

            const convId = db.insertConversation(
              conv.provider,
              conv.source_id,
              conv.title,
              conv.created_at,
              conv.updated_at,
              conv.model,
              conv.message_count,
              conv.total_words,
              projectId,
            );

            // Delete existing messages before re-inserting (for upsert behavior)
            db.deleteMessagesForConversation(convId);

            // Insert messages
            for (let i = 0; i < conv.messages.length; i++) {
              const msg = conv.messages[i];
              db.insertMessage(
                convId,
                msg.role,
                msg.text,
                msg.word_count,
                msg.created_at,
                msg.model,
                i,
              );
              result.messages_imported++;
            }

            result.conversations_imported++;
          } catch (err) {
            result.errors.push(`Conversation ${conv.source_id}: ${err}`);
            result.conversations_skipped++;
          }
        }

        // Update project conversation counts
        for (const [sourceId, projectId] of projectIdMap) {
          const count = conversations.filter(
            (c) => c.project_source_id === sourceId,
          ).length;
          db.updateProjectConversationCount(projectId, count);
        }
      });

      // Rebuild FTS
      console.log("Rebuilding FTS index...");
      db.rebuildFts();

      // Invalidate profile cache and clear memory build progress
      // so re-imported conversations get re-processed for memory extraction
      db.invalidateProfileCache();
      db.clearMemoryBuildProgress();

      // Log the import
      db.insertImportLog(
        adapter.provider,
        sourcePath,
        result.conversations_imported,
        result.messages_imported,
        result.projects_imported,
      );

      // Print summary
      console.log("\nImport complete:");
      console.log(`  Provider:      ${result.provider}`);
      console.log(`  Conversations: ${result.conversations_imported}`);
      console.log(`  Messages:      ${result.messages_imported}`);
      console.log(`  Projects:      ${result.projects_imported}`);
      if (result.conversations_skipped > 0) {
        console.log(`  Skipped:       ${result.conversations_skipped}`);
      }
      if (result.errors.length > 0) {
        console.log(`  Errors:        ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) {
          console.log(`    - ${err}`);
        }
      }
    } finally {
      db.close();
    }

    return result;
  } finally {
    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

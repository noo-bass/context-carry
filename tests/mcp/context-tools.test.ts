import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";
import { ConversationDatabase } from "../../src/db/database.js";
import { executeTool } from "../../src/mcp/tools.js";

let db: ConversationDatabase;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `context-carry-ctx-test-${randomUUID()}.db`);
  db = new ConversationDatabase(dbPath);
});

afterEach(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
});

const SAMPLE_CONTEXT = `## Task
Implement authentication

## Current State
JWT middleware is working, login endpoint done.

## Key Decisions
- Chose JWT over sessions for statelessness
- Using bcrypt for password hashing

## Modified Files
- src/auth/middleware.ts: JWT verification
- src/routes/login.ts: login endpoint

## Next Steps
1. Add refresh token rotation
2. Write integration tests`;

describe("commit_context", () => {
  it("creates a snapshot and returns correct fields", () => {
    const result = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "feat: auth middleware complete",
      context: SAMPLE_CONTEXT,
    }) as any;

    expect(result.status).toBe("committed");
    expect(result.context_id).toBe(1);
    expect(result.conversation_id).toBeGreaterThan(0);
    expect(result.parent_id).toBeNull();
    expect(result.created_at).toBeDefined();
    expect(result.message).toContain("First snapshot");
  });

  it("chains parent_id to the first commit for same path", () => {
    const first = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "feat: initial setup",
      context: "## Task\nSetup project",
    }) as any;

    const second = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "feat: add auth",
      context: SAMPLE_CONTEXT,
    }) as any;

    expect(second.parent_id).toBe(first.context_id);
    expect(second.message).toContain(`Chained to parent ${first.context_id}`);
  });

  it("does not chain across different paths", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/project-a",
      message: "project A snapshot",
      context: "## Task\nProject A work",
    });

    const resultB = executeTool(db, "commit_context", {
      project_path: "/home/user/project-b",
      message: "project B snapshot",
      context: "## Task\nProject B work",
    }) as any;

    expect(resultB.parent_id).toBeNull();
  });

  it("committed context is searchable via FTS without rebuildFts()", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "auth snapshot",
      context: SAMPLE_CONTEXT,
    });

    // Search for a term in the context — should find it without calling db.rebuildFts()
    const searchResult = executeTool(db, "search_conversations", {
      query: "bcrypt",
    }) as any[];

    expect(searchResult).toHaveLength(1);
    expect(searchResult[0].provider).toBe("context-carry");
  });

  it("normalises trailing slashes in project_path", () => {
    const first = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project/",
      message: "first",
      context: "## Task\nFirst",
    }) as any;

    const second = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "second",
      context: "## Task\nSecond",
    }) as any;

    expect(second.parent_id).toBe(first.context_id);
  });
});

describe("resume_context", () => {
  it("returns latest snapshot for a path", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "initial",
      context: "## Task\nInitial setup",
    });

    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "second commit",
      context: SAMPLE_CONTEXT,
    });

    const result = executeTool(db, "resume_context", {
      project_path: "/home/user/my-project",
    }) as any;

    expect(result.status).toBe("found");
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].summary).toBe("second commit");
    expect(result.snapshots[0].content).toContain("JWT middleware");
  });

  it("walks parent chain with depth > 1", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "commit 1",
      context: "## Task\nStep one",
    });

    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "commit 2",
      context: "## Task\nStep two",
    });

    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "commit 3",
      context: "## Task\nStep three",
    });

    const result = executeTool(db, "resume_context", {
      project_path: "/home/user/my-project",
      depth: 3,
    }) as any;

    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots[0].summary).toBe("commit 3");
    expect(result.snapshots[1].summary).toBe("commit 2");
    expect(result.snapshots[2].summary).toBe("commit 1");
  });

  it("returns no_context for unknown path", () => {
    const result = executeTool(db, "resume_context", {
      project_path: "/nonexistent/path",
    }) as any;

    expect(result.status).toBe("no_context");
    expect(result.message).toContain("No context snapshots");
  });
});

describe("list_contexts", () => {
  it("returns all contexts", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/project-a",
      message: "snapshot A",
      context: "## Task\nA",
    });

    executeTool(db, "commit_context", {
      project_path: "/home/user/project-b",
      message: "snapshot B",
      context: "## Task\nB",
    });

    const result = executeTool(db, "list_contexts", {}) as any[];
    expect(result).toHaveLength(2);
  });

  it("filters by project_path", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/project-a",
      message: "snapshot A",
      context: "## Task\nA",
    });

    executeTool(db, "commit_context", {
      project_path: "/home/user/project-b",
      message: "snapshot B",
      context: "## Task\nB",
    });

    const result = executeTool(db, "list_contexts", {
      project_path: "/home/user/project-a",
    }) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("snapshot A");
  });
});

describe("diff_contexts", () => {
  it("returns both snapshots side-by-side", () => {
    const first = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "initial setup",
      context: "## Task\nSetup the project\n\n## Next Steps\n1. Add auth",
    }) as any;

    const second = executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "auth complete",
      context: SAMPLE_CONTEXT,
    }) as any;

    const result = executeTool(db, "diff_contexts", {
      context_id_old: first.context_id,
      context_id_new: second.context_id,
    }) as any;

    expect(result.old).toBeDefined();
    expect(result.new).toBeDefined();
    expect(result.old.summary).toBe("initial setup");
    expect(result.new.summary).toBe("auth complete");
    expect(result.old.content).toContain("Setup the project");
    expect(result.new.content).toContain("JWT middleware");
  });

  it("returns error for non-existent context ids", () => {
    const result = executeTool(db, "diff_contexts", {
      context_id_old: 999,
      context_id_new: 1000,
    }) as any;

    expect(result.error).toBeDefined();
  });
});

describe("context conversations in list_conversations", () => {
  it("context commits appear as conversations with provider 'context-carry'", () => {
    executeTool(db, "commit_context", {
      project_path: "/home/user/my-project",
      message: "auth snapshot",
      context: SAMPLE_CONTEXT,
    });

    const result = executeTool(db, "list_conversations", {
      provider: "context-carry",
    }) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("context-carry");
    expect(result[0].title).toBe("auth snapshot");
  });
});

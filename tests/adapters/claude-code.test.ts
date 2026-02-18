import { describe, it, expect } from "vitest";
import { join } from "path";
import { ClaudeCodeAdapter, decodeProjectPath } from "../../src/adapters/claude-code.js";

const FIXTURES = join(__dirname, "..", "fixtures", "claude-code");

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("detects Claude Code directory", async () => {
    expect(await adapter.detect(FIXTURES)).toBe(true);
  });

  it("parses JSONL sessions", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations).toHaveLength(1);
    const conv = conversations[0];
    expect(conv.source_id).toBe("session-001");
    expect(conv.provider).toBe("claude-code");
    expect(conv.messages.length).toBeGreaterThan(0);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].text).toContain("Refactor");
    expect(conv.model).toBe("claude-sonnet-4-20250514");
    expect(conv.project_source_id).toBe("-Users-test-myproject");
  });

  it("infers title from first user message", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations[0].title).toContain("Refactor");
  });

  it("discovers projects", async () => {
    const projects = [];
    for await (const proj of adapter.parseProjects!({ source_path: FIXTURES })) {
      projects.push(proj);
    }

    expect(projects).toHaveLength(1);
    expect(projects[0].source_id).toBe("-Users-test-myproject");
    expect(projects[0].provider).toBe("claude-code");
  });
});

describe("decodeProjectPath", () => {
  it("decodes standard paths", () => {
    expect(decodeProjectPath("-Users-jemrashbass-project")).toBe("project");
  });

  it("handles paths without Users prefix", () => {
    expect(decodeProjectPath("-var-data-myapp")).toBe("myapp");
  });
});

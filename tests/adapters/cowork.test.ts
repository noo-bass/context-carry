import { describe, it, expect } from "vitest";
import { join } from "path";
import { CoworkAdapter } from "../../src/adapters/cowork.js";

const FIXTURES = join(__dirname, "..", "fixtures", "cowork");

describe("CoworkAdapter", () => {
  const adapter = new CoworkAdapter();

  it("detects Cowork directory with -sessions- prefix", async () => {
    expect(await adapter.detect(FIXTURES)).toBe(true);
  });

  it("does not detect Claude Code directory", async () => {
    expect(await adapter.detect(join(__dirname, "..", "fixtures", "claude-code"))).toBe(false);
  });

  it("parses Cowork sessions", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations).toHaveLength(1);
    const conv = conversations[0];
    expect(conv.source_id).toBe("session-cw-001");
    expect(conv.provider).toBe("cowork");
    expect(conv.messages.length).toBeGreaterThan(0);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].text).toContain("dashboard");
  });

  it("infers title from first substantial user message", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations[0].title).toContain("dashboard");
  });

  it("discovers projects from -sessions- paths", async () => {
    const projects = [];
    for await (const proj of adapter.parseProjects!({ source_path: FIXTURES })) {
      projects.push(proj);
    }

    expect(projects).toHaveLength(1);
    expect(projects[0].provider).toBe("cowork");
    expect(projects[0].name).toBe("friendly-helpful-pasteur");
  });
});

import { describe, it, expect } from "vitest";
import { join } from "path";
import { ClaudeWebAdapter } from "../../src/adapters/claude-web.js";

const FIXTURES = join(__dirname, "..", "fixtures", "claude-web");

describe("ClaudeWebAdapter", () => {
  const adapter = new ClaudeWebAdapter();

  it("detects Claude.ai export directory", async () => {
    expect(await adapter.detect(FIXTURES)).toBe(true);
  });

  it("does not detect ChatGPT directory", async () => {
    expect(await adapter.detect(join(__dirname, "..", "fixtures", "chatgpt"))).toBe(false);
  });

  it("parses conversations with sender mapping", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations).toHaveLength(1);
    const conv = conversations[0];
    expect(conv.source_id).toBe("conv-claude-web-1");
    expect(conv.provider).toBe("claude-web");
    expect(conv.title).toBe("Claude Web Test Conversation");

    // Should have messages — human mapped to user
    expect(conv.messages.length).toBeGreaterThan(0);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].text).toContain("async/await");
  });

  it("handles content block types (text, thinking, tool_use)", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    const conv = conversations[0];
    // Third message has thinking + text + tool_use blocks
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    // Should have content parts including thinking and tool_call
    const hasThinking = lastMsg.content.some((p) => p.type === "thinking");
    const hasToolCall = lastMsg.content.some((p) => p.type === "tool_call");
    expect(hasThinking).toBe(true);
    expect(hasToolCall).toBe(true);
  });

  it("parses projects from projects.json", async () => {
    const projects = [];
    for await (const proj of adapter.parseProjects!({ source_path: FIXTURES })) {
      projects.push(proj);
    }

    expect(projects).toHaveLength(1);
    expect(projects[0].source_id).toBe("proj-cw-1");
    expect(projects[0].name).toBe("Web Dev Project");
  });
});

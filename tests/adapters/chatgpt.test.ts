import { describe, it, expect } from "vitest";
import { join } from "path";
import { ChatGPTAdapter } from "../../src/adapters/chatgpt.js";

const FIXTURES = join(__dirname, "..", "fixtures", "chatgpt");

describe("ChatGPTAdapter", () => {
  const adapter = new ChatGPTAdapter();

  it("detects ChatGPT export directory", async () => {
    expect(await adapter.detect(FIXTURES)).toBe(true);
  });

  it("does not detect other directories", async () => {
    expect(await adapter.detect(join(__dirname, "..", "fixtures", "claude-web"))).toBe(false);
  });

  it("parses conversations from conversations.json", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    expect(conversations).toHaveLength(2);

    // First conversation
    const conv1 = conversations[0];
    expect(conv1.source_id).toBe("conv-chatgpt-1");
    expect(conv1.provider).toBe("chatgpt");
    expect(conv1.title).toBe("Hello World Test");
    expect(conv1.messages).toHaveLength(2);
    expect(conv1.messages[0].role).toBe("user");
    expect(conv1.messages[0].text).toContain("TypeScript");
    expect(conv1.messages[1].role).toBe("assistant");
    expect(conv1.messages[1].model).toBe("gpt-4");
    expect(conv1.project_source_id).toBe("gizmo-project-1");
  });

  it("linearizes DAG by following last child (main branch)", async () => {
    const conversations = [];
    for await (const conv of adapter.parse({ source_path: FIXTURES })) {
      conversations.push(conv);
    }

    // Second conversation has a branch — should follow children[-1]
    const conv2 = conversations[1];
    expect(conv2.messages).toHaveLength(2);
    // Should pick msg-b-branch2 (the last child), not msg-b-branch1
    expect(conv2.messages[1].text).toContain("MQTT");
    expect(conv2.messages[1].text).toContain("IoT");
  });

  it("extracts projects from gizmo_id", async () => {
    const projects = [];
    for await (const proj of adapter.parseProjects!({ source_path: FIXTURES })) {
      projects.push(proj);
    }

    expect(projects).toHaveLength(1);
    expect(projects[0].source_id).toBe("gizmo-project-1");
    expect(projects[0].provider).toBe("chatgpt");
  });
});

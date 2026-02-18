import { describe, it, expect } from "vitest";
import { join } from "path";
import { detectProvider } from "../../src/adapters/detect.js";

const FIXTURES = join(__dirname, "..", "fixtures");

describe("detectProvider", () => {
  it("detects ChatGPT export", async () => {
    const adapter = await detectProvider(join(FIXTURES, "chatgpt"));
    expect(adapter).not.toBeNull();
    expect(adapter!.provider).toBe("chatgpt");
  });

  it("detects Claude.ai web export", async () => {
    const adapter = await detectProvider(join(FIXTURES, "claude-web"));
    expect(adapter).not.toBeNull();
    expect(adapter!.provider).toBe("claude-web");
  });

  it("detects Claude Code directory", async () => {
    const adapter = await detectProvider(join(FIXTURES, "claude-code"));
    expect(adapter).not.toBeNull();
    expect(adapter!.provider).toBe("claude-code");
  });

  it("detects Cowork directory", async () => {
    const adapter = await detectProvider(join(FIXTURES, "cowork"));
    expect(adapter).not.toBeNull();
    expect(adapter!.provider).toBe("cowork");
  });

  it("returns null for unknown directory", async () => {
    const adapter = await detectProvider("/tmp/nonexistent-dir-" + Date.now());
    expect(adapter).toBeNull();
  });
});

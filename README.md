# 📦 context-carry

A super simple local MCP server for chat exports from LLM webapps so you can own your context and escape the walled garden 🧱💥🕊️

## 🌟 Highlights
- Simple importing of chat exports from ChatGPT, Claude etc.
- Reconstruct ChatGPT style memory across LLM providers to make switching without losing context easy
- Simple search across past conversations for any LLM

## ℹ️ Overview

I'm Noo 👋 philosopher turned vibe coder from the UK. When I wanted to switch away from GPT to Claude earlier this year it was super hard to let go of my conversation history so I built this to help me move everything over in a simple way.

<div align="center">
  <img src="Hi what do you know about me.png" alt="Before/After Hi what do you know about me?">
  <img src="What have we spoken about in the past.png" alt="Before/After Hi what do you know about me">
</div>

## ⬇️ Installation

```bash
npm install -g context-carry
```

Or run directly with npx:

```bash
npx context-carry import /path/to/export
```

## 🚀 Usage

### Download past conversations

#### ChatGPT
Settings -> Data Controls -> Export Data

#### Claude
Settings -> Privace -> Export Data

### Import conversations

```bash
# Auto-detect provider from file structure
context-carry import /path/to/chatgpt-export.zip
context-carry import /path/to/claude-export/
context-carry import ~/.claude/

# Force a specific provider
context-carry import /path/to/data --provider chatgpt

# Custom database location (default: ~/.context-carry/conversations.db)
context-carry import /path/to/data --db /path/to/conversations.db
```

### Check status

```bash
context-carry status
```

### List conversations

```bash
context-carry list
context-carry list --provider chatgpt
context-carry list --search "MQTT"
context-carry list --limit 50 --offset 50
```

## MCP Integration

Add context-carry to your AI tool of choice.

### Claude Code

```bash
claude mcp add --transport stdio --scope user context-carry -- npx context-carry serve
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "npx",
      "args": ["context-carry", "serve"]
    }
  }
}
```

### Gemini CLI

```bash
gemini mcp add -s user context-carry npx context-carry serve
```

Or edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "npx",
      "args": ["context-carry", "serve"]
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "npx",
      "args": ["context-carry", "serve"]
    }
  }
}
```

### VS Code / GitHub Copilot

Edit `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "context-carry": {
      "type": "stdio",
      "command": "npx",
      "args": ["context-carry", "serve"]
    }
  }
}
```

> Note: VS Code uses `"servers"` (not `"mcpServers"`) and requires `"type": "stdio"`.

## 🤖 MCP Tools For Agents

| Tool | Description |
|------|-------------|
| `get_user_profile` | Synthesized user profile (interests, skills, style) — called automatically on session start |
| `build_user_profile` | Get an overview of all conversations for memory extraction. Supports `quick`, `standard`, and `deep` depth levels |
| `save_memories` | Save extracted memories about the user. Optionally marks conversations as processed |
| `regenerate_profile` | Wipe and rebuild the profile from scratch |
| `search_conversations` | Full-text search across all conversations |
| `get_conversation` | Get a conversation with its full message history |
| `list_conversations` | Paginated list with provider/date/project filters |
| `list_projects` | List all projects/workspaces |
| `get_project` | Project detail with conversation list |
| `get_stats` | Corpus-wide statistics and per-provider breakdown |

### 🧠 How the memory building works

When an AI agent calls `get_user_profile` and no profile exists, it builds one:

1. **`build_user_profile`** — Returns all conversation titles and first messages in a single response, grouped by project
2. The AI extracts memories (interests, skills, preferences) from the overview
3. **`save_memories`** — Stores the extracted memories and marks conversations as processed
4. **`get_user_profile`** — Returns the assembled profile

3 tool calls total for a quick profile, regardless of how many conversations you have.

For richer profiles, use `depth="standard"` (AI deep-dives ~20-30 interesting conversations) or `depth="deep"` (deep-dives all conversations).

## Supported Providers

- **ChatGPT** — `conversations.json` from OpenAI data export (DAG linearization)
- **Claude.ai** — Official Claude data export (conversations.json + projects.json)
- **Claude Code** — Local `~/.claude/` session data (JSONL)
- **Cowork** — Claude Cowork sessions with subagent merging

## ROADMAP:
- [ ] Continual updating conversations
- [ ] Add HTTP server + hosting to sync with WebApp AI clients
- [ ] Test with more LLM providers
- [ ] Inline data analysis
- [ ] Non-download memory gathering

## License

MIT

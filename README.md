# context-carry

Import AI conversation exports and serve them via MCP, so any AI application can access your conversation history.

## Supported Providers

- **ChatGPT** — `conversations.json` from OpenAI data export (DAG linearization)
- **Claude.ai** — Official Claude data export (conversations.json + projects.json)
- **Claude Code** — Local `~/.claude/` session data (JSONL)
- **Cowork** — Claude Cowork sessions with subagent merging

## Install

```bash
npm install -g context-carry
```

Or run directly with npx:

```bash
npx context-carry import /path/to/export
npx context-carry serve
```

## Usage

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

### Start MCP server

```bash
context-carry serve
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

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

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

### Cline

Edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

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

## MCP Tools

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

### How profile building works

When an AI agent calls `get_user_profile` and no profile exists, it builds one:

1. **`build_user_profile`** — Returns all conversation titles and first messages in a single response, grouped by project
2. The AI extracts memories (interests, skills, preferences) from the overview
3. **`save_memories`** — Stores the extracted memories and marks conversations as processed
4. **`get_user_profile`** — Returns the assembled profile

That's 3 tool calls total for a quick profile, regardless of how many conversations you have.

For richer profiles, use `depth="standard"` (AI deep-dives ~20-30 interesting conversations) or `depth="deep"` (deep-dives all conversations).

## Development

```bash
npm install
npm run dev       # Watch mode
npm test          # Run tests
npm run build     # Production build
```

## Architecture

```
User's AI export (ZIP/directory)
    ↓
context-carry import <path>     ← CLI (commander)
    ↓
Provider auto-detection → Adapter (ChatGPT/Claude.ai/Claude Code/Cowork)
    ↓
Canonical data model → SQLite + FTS5 (better-sqlite3)
    ↓
context-carry serve             ← MCP server (stdio, @modelcontextprotocol/sdk)
    ↓
Any AI application (Claude Desktop, Claude Code, Cursor, etc.)
```

## License

MIT

# context-carry

Import AI conversation exports and serve them via MCP, so any AI application can access your conversation history.

## Supported Providers

- **ChatGPT** — `conversations.json` from OpenAI data export (DAG linearization)
- **Claude.ai** — Official Claude data export (conversations.json + projects.json)
- **Claude Code** — Local `~/.claude/` session data (JSONL)
- **Cowork** — Claude Cowork sessions with subagent merging

## Install

```bash
npm install
npm run build
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

### MCP Integration

Add context-carry to your AI tool of choice. Replace `/path/to/context-carry` with the actual path to this repo.

#### Claude Code

```bash
claude mcp add --transport stdio --scope user context-carry -- node /path/to/context-carry/dist/index.js serve
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

#### Gemini CLI

```bash
gemini mcp add -s user context-carry node /path/to/context-carry/dist/index.js serve
```

Or edit `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project):

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

#### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

#### VS Code / GitHub Copilot

Edit `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "context-carry": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

> Note: VS Code uses `"servers"` (not `"mcpServers"`) and requires `"type": "stdio"`.

#### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

#### Cline

Edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "context-carry": {
      "command": "node",
      "args": ["/path/to/context-carry/dist/index.js", "serve"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_user_profile` | Synthesized user profile (interests, skills, style) — called automatically on session start |
| `regenerate_profile` | Force-regenerate profile after importing new conversations |
| `search_conversations` | Full-text search across all conversations |
| `get_conversation` | Get a conversation with its messages |
| `list_conversations` | Paginated list with provider/date/project filters |
| `list_projects` | List all projects/workspaces |
| `get_project` | Project detail with conversation list |
| `get_stats` | Corpus-wide statistics and per-provider breakdown |

## Development

```bash
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
Any AI application (Claude Desktop, Claude Code, etc.)
```

## Stack

TypeScript, commander, better-sqlite3, @modelcontextprotocol/sdk, zod, yauzl

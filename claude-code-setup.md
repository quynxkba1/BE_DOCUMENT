# Claude Code Project Setup

## Folder Structure

```
~/.claude/                          ← GLOBAL (all projects)
├── CLAUDE.md                       ← personal rules & habits
├── settings.json                   ← global permissions & hooks
├── agents/                         ← global sub-agents
│   └── *.md
└── skills/                         ← global custom slash commands
    └── *.md

<project>/                          ← PROJECT LEVEL
├── CLAUDE.md                       ← project rules
├── .mcp.json                       ← MCP tools registration
├── .claude/
│   ├── settings.json               ← project permissions & hooks
│   └── agents/                     ← project sub-agents
│       └── *.md
└── src/
    └── CLAUDE.md                   ← subfolder rules
```

---

## The 4 Pillars and What Each Controls

| Pillar      | File                        | Controls                         |
|-------------|-----------------------------|----------------------------------|
| Rules       | CLAUDE.md                   | HOW Claude behaves & writes code |
| Tools       | .mcp.json                   | WHAT Claude can access/call      |
| Permissions | settings.json (permissions) | WHAT Claude can run without ask  |
| Hooks       | settings.json (hooks)       | WHEN to auto-run side effects    |
| Sub-agents  | .claude/agents/*.md         | WHO handles specialized tasks    |
| Skills      | ~/.claude/skills/*.md       | /commands you trigger manually   |

---

## How They Connect at Runtime

```
You type a message
        │
        ▼
Claude Code CLI
        │
        ├── loads CLAUDE.md files (global → project → subfolder)
        ├── loads MCP tools from .mcp.json
        ├── loads agent definitions from .claude/agents/
        ├── loads permissions + hooks from settings.json
        │
        ▼
Builds ONE request to Claude LLM:
┌─────────────────────────────────────────┐
│ system:                                 │
│   built-in prompt                       │
│   + CLAUDE.md content (all levels)      │
│   + environment (cwd, git, date)        │
│   + agent descriptions                  │
│                                         │
│ tools:                                  │
│   built-in tools (Read, Edit, Bash...)  │
│   + MCP tool schemas                    │
│   + sub-agent schemas                   │
│                                         │
│ messages: conversation history          │
└─────────────────────────────────────────┘
        │
        ▼
Claude decides:
  → run a tool?       → check permissions → run hook → execute
  → spawn sub-agent?  → load agent prompt → isolated LLM call
  → answer directly?  → reply text
```

---

## Decision Guide — Where to Put Each Thing

```
"Claude should always write code this way"
  → CLAUDE.md

"Claude needs access to my database / Jira / custom API"
  → .mcp.json

"Claude can run pnpm/git without asking me each time"
  → settings.json permissions.allow

"Claude must never push or delete files"
  → settings.json permissions.deny

"Auto-lint every file Claude edits"
  → settings.json hooks PostToolUse

"Notify me when Claude finishes"
  → settings.json hooks Stop

"A specialized agent for one domain (DB, security, docs)"
  → .claude/agents/<name>.md

"A workflow I trigger manually (deploy, review, ingest)"
  → ~/.claude/skills/<name>.md  → call with /<name>
```

# mcp-plugin-patterns

**Demonstrating plugin-equivalent capabilities via a remote MCP server.**

This prototype shows how a remote MCP server can replicate every major capability of Anthropic's [plugin system](https://code.claude.com/docs/en/plugins) — skills, hooks, agents, and evals — using standard MCP primitives. The key architectural insight: **what plugins deliver locally through files, a well-designed MCP server can deliver remotely through tool calls and sampling**.

The domain is briefing document generation (executive briefs, competitive intel, meeting prep, technical assessments), chosen because it naturally requires curated methodologies, quality gates, multi-step orchestration, and structured evaluation — all the things that make plugins powerful.

## Why this matters

Plugins are excellent for local, per-user customisation. But they have a distribution problem:

- **No remote updates.** Skills and hooks are local files. Updating them requires users to reinstall.
- **No cross-agent portability.** Plugins only work in Claude Code / Cowork. An MCP server works with any MCP client (Claude, ChatGPT, Cursor, Gemini, etc).
- **No centralised governance.** A publisher can't ensure all users are running the latest methodology version.

A remote MCP server solves all three. This repo demonstrates the pattern.

## Plugin → MCP mapping

| Plugin component | What it does | MCP equivalent in this repo |
|---|---|---|
| **Skills** (`skills/SKILL.md`) | Auto-triggered expert knowledge based on task context | `briefing_search_skills` — server-side relevance matching returns the right methodology |
| **Hooks** (`hooks/hooks.json`) | Quality gates that fire before/after tool use and at completion | `briefing_check_hooks` + hooks embedded in `briefing_execute` — pre/post/stop hooks that block, allow, or modify |
| **Agents** (`agents/*.md`) | Subagents Claude invokes for specialised tasks | `briefing_execute` — server-side agent loop using sampling/createMessage (SEP-1577) |
| **Commands** (`commands/*.md`) | User-invoked slash commands | Any MCP tool can serve as a command entry point |
| **Evals** (no plugin equivalent) | Quality scoring against methodology criteria | `briefing_evaluate` — transparent scorecard with per-criterion scores |
| **`.mcp.json`** | MCP server config bundled in plugin | The MCP server itself — connection config lives in the client |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  CLIENT (Claude, ChatGPT, Cursor, etc.)             │
│                                                     │
│  User query → Agent selects tools → Agent executes  │
│       ▲                                      │      │
│       │         sampling/createMessage        │      │
│       │         (SEP-1577 agent loop)         │      │
│       └──────────────────────────────────────┘      │
│                        ▲  │                         │
└────────────────────────┼──┼─────────────────────────┘
                         │  │  MCP tool calls
                         │  ▼
┌────────────────────────┴──┴─────────────────────────┐
│  MCP SERVER (this repo)                             │
│                                                     │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Skills     │  │  Hooks   │  │  Agent Loop   │  │
│  │             │  │  Engine  │  │  (= Agents)   │  │
│  │             │  │          │  │               │  │
│  │  - Search   │  │  - Pre   │  │  - Sampling   │  │
│  │  - Match    │  │  - Post  │  │    requests   │  │
│  │  - Select   │  │  - Stop  │  │  - Tool defs  │  │
│  └─────────────┘  └──────────┘  └───────────────┘  │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │  Evals      │  │  Session store               │  │
│  │  Engine     │  │  (execution context)         │  │
│  └─────────────┘  └──────────────────────────────┘  │
│                                                     │
│  ALL of this updates centrally. No reinstallation.  │
└─────────────────────────────────────────────────────┘
```

## Tools exposed

| Tool | Purpose | Plugin analogue |
|---|---|---|
| `briefing_search_skills` | Find the right methodology for a query | Skill auto-matching |
| `briefing_list_skills` | Browse all available skills | Plugin discovery |
| `briefing_execute` | Run full skill with hooks + agent loop | Skill + hooks + subagent |
| `briefing_check_hooks` | Run quality hooks independently | Direct hook invocation |
| `briefing_evaluate` | Score output against methodology criteria | No plugin equivalent |
| `briefing_completion_gate` | Final readiness check | Stop hook |

## Skills included

- **Executive Briefing** — Situation analysis → key findings → strategic implications → next steps
- **Competitive Intelligence** — Competitor research → comparison matrix → SWOT → recommendations
- **Meeting Preparation** — Stakeholder research → org context → discussion strategy → talking points
- **Technical Assessment** — Capability audit → limitations → integration fit → risk matrix

Each skill includes methodology-specific evaluation criteria curated by a named working group.

## Hook pipeline

The hook engine runs three types of quality gates:

**Pre-hooks** (like `PreToolUse`):
- `scope-validation` — Blocks execution if the query is too vague
- `skill-required` — Blocks if no skill has been selected

**Post-hooks** (like `PostToolUse`):
- `source-quality-check` — Flags research steps that lack source attribution
- `length-compliance` — Checks draft length against skill targets
- `analytical-balance` — Flags one-sided drafts that need counterpoints

**Stop-hooks** (like `Stop`):
- `completeness-gate` — Blocks delivery if any skill steps are incomplete
- `eval-required` — Requires an eval to be run before final delivery

## Quick start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run via stdio (for Claude Code / Claude Desktop)
npm start

# Run via HTTP (for remote deployment)
npm run start:http
```

### Connect to Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "briefing": {
      "command": "node",
      "args": ["/path/to/mcp-plugin-patterns/dist/index.js"]
    }
  }
}
```

### Connect to Claude Code

```bash
claude mcp add briefing node /path/to/mcp-plugin-patterns/dist/index.js
```

### Connect via HTTP (remote)

```bash
TRANSPORT=http PORT=3001 npm start
```

Then configure your MCP client to connect to `http://localhost:3001/mcp`.

## Example conversation flow

```
User: "I need a competitive analysis of the top 3 LLM providers for our
       enterprise deployment decision."

Agent: [calls briefing_search_skills]
       → Competitive Intelligence Brief scores highest (0.72)

Agent: [calls briefing_execute with skill_id="competitive-intel"]
       → Pre-hooks pass
       → 5 steps prepared with sampling requests
       → Post-hooks flag: source quality check on step 2

Agent: [executes each step, producing the brief]

Agent: [calls briefing_evaluate with the completed brief]
       → Composite score: 71/100
       → Low on "Specificity" — needs more data points
       → Good on "Objectivity" — balanced analysis

Agent: [calls briefing_completion_gate]
       → ✅ All gates passed. Ready for delivery.
```

## Key spec references

- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — Latest protocol version
- [Sampling with Tools (SEP-1577)](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) — Server-side agent loops
- [Tasks (SEP-1686)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686) — Async execution
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — Plugin component specs
- [Cowork Plugins](https://github.com/anthropics/knowledge-work-plugins) — Knowledge-work plugin examples

## What's next

This prototype demonstrates the pattern. To move toward production:

1. **Implement actual sampling calls** — Use the SDK's `server.requestSampling()` (or equivalent) to send `sampling/createMessage` with tool definitions to the client LLM
2. **Add OAuth 2.1** — Required for institutional deployment per the MCP auth spec
3. **Add Tasks support** — Long-running research sessions should use the Tasks primitive for async execution
4. **Connect real data sources** — Replace simulated tool outputs with actual web search, document search, etc.
5. **LLM-powered hooks** — Use sampling to make hook evaluations more nuanced (e.g., ask the LLM to judge analytical balance rather than keyword counting)
6. **LLM-powered evals** — Same pattern — use sampling for richer, context-aware scoring

## License

MIT

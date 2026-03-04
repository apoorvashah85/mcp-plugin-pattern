# mcp-plugin-patterns

**Demonstrating plugin-equivalent capabilities via a remote MCP server.**

This prototype shows how a remote MCP server can replicate every major capability of Anthropic's [plugin system](https://code.claude.com/docs/en/plugins) — skills, hooks, agents, and evals — using standard MCP primitives. The key architectural insight: **what plugins deliver locally through files, a well-designed MCP server can deliver remotely through tool calls and sampling**.

The domain is briefing document generation (executive briefs, competitive intel, meeting prep, technical assessments), chosen because it naturally requires curated methodologies, quality gates, multi-step orchestration, and structured evaluation — all the things that make plugins powerful.

## LLM strategy and sampling support

The server uses LLM calls for step execution, hook evaluation, and eval scoring. It tries three strategies in order:

1. **MCP sampling** ([`sampling/createMessage`](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)) — the spec-correct approach where the client provides the LLM and no server-side API keys are needed. **As of March 2026, no major MCP client implements this** (not Claude Desktop, Claude Code, ChatGPT, or Cursor). The code is ready and will activate automatically when clients add support.

2. **Anthropic API fallback** — if `ANTHROPIC_API_KEY` is set, the server calls the Claude API directly. **This is how you demo the server today.** Run with:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm start
   ```

3. **Simulation fallback** — if neither is available, returns descriptive placeholders. The full pipeline (skill matching, hooks, evals, completion gates) still runs, but on placeholder text.

> **Why isn't sampling implemented by clients?** The [MCP sampling spec](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) is part of the 2025-11-25 protocol revision. Protocol specs are written ahead of implementation — this is normal for open standards. Security concerns ([prompt injection via sampling](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/)) and the human-in-the-loop requirement are likely factors in the rollout timeline. There is an [open feature request](https://github.com/anthropics/claude-code/issues/1785) on Claude Code for sampling support.

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
| **Agents** (`agents/*.md`) | Subagents Claude invokes for specialised tasks | `briefing_execute` — server-side agent loop using LLM calls (sampling or API fallback) |
| **Commands** (`commands/*.md`) | User-invoked slash commands | Any MCP tool can serve as a command entry point |
| **Evals** (no plugin equivalent) | Quality scoring against methodology criteria | `briefing_evaluate` — LLM-powered scorecard with per-criterion scores |
| **`.mcp.json`** | MCP server config bundled in plugin | The MCP server itself — connection config lives in the client |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  CLIENT (Claude, ChatGPT, Cursor, etc.)             │
│                                                     │
│  User query → Agent selects tools → Agent executes  │
│       ▲                                      │      │
│       │         sampling/createMessage        │      │
│       │         (or Anthropic API fallback)    │      │
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
│  │  - Search   │  │  - Pre   │  │  - LLM calls  │  │
│  │  - Match    │  │  - Post  │  │    per step   │  │
│  │  - Select   │  │  - Stop  │  │  - 3 fallback │  │
│  └─────────────┘  └──────────┘  └───────────────┘  │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │  Evals      │  │  LLM Abstraction (src/llm.ts)│  │
│  │  Engine     │  │  sampling → API → simulation │  │
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

**Pre-hooks** (deterministic):
- `scope-validation` — Blocks execution if the query is too vague
- `skill-required` — Blocks if no skill has been selected

**Post-hooks** (LLM-powered with heuristic fallback):
- `source-quality-check` — LLM evaluates whether research cites specific named sources
- `length-compliance` — Deterministic word count check against skill targets
- `analytical-balance` — LLM evaluates whether the draft presents balanced perspectives

**Stop-hooks** (deterministic):
- `completeness-gate` — Blocks delivery if any skill steps are incomplete
- `eval-required` — Requires an eval to be run before final delivery

## Quick start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with Anthropic API (recommended for demo)
ANTHROPIC_API_KEY=sk-ant-... npm start

# Run without API key (simulation fallback)
npm start

# Run via HTTP (for remote deployment)
ANTHROPIC_API_KEY=sk-ant-... npm run start:http
```

### Connect to Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "briefing": {
      "command": "node",
      "args": ["/path/to/mcp-plugin-patterns/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Connect to Claude Code

```bash
claude mcp add briefing -- env ANTHROPIC_API_KEY=sk-ant-... node /path/to/mcp-plugin-patterns/dist/index.js
```

### Connect via HTTP (remote)

```bash
ANTHROPIC_API_KEY=sk-ant-... TRANSPORT=http PORT=3001 npm start
```

Then configure your MCP client to connect to `http://localhost:3001/mcp`.

## Example conversation flow

```
User: "I need a competitive analysis of the top 3 LLM providers for our
       enterprise deployment decision."

Agent: [calls briefing_search_skills]
       → Competitive Intelligence Brief scores highest (0.64)

Agent: [calls briefing_execute with skill_id="competitive-intel"]
       → Pre-hooks pass (scope validated, skill selected)
       → 5 steps execute via LLM (anthropic-api or sampling)
       → Post-hooks: source quality check, length compliance, analytical balance

Agent: [calls briefing_evaluate with the completed brief]
       → LLM scores each criterion (or heuristic fallback)
       → Composite score: 78/100
       → Suggestions for improvement

Agent: [calls briefing_completion_gate]
       → ✅ All gates passed. Ready for delivery.
```

## Key spec references

- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — Protocol version this server targets
- [Sampling (client capability)](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) — Server-initiated LLM calls via `sampling/createMessage`
- [Tasks (SEP-1686)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686) — Async execution (future)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — Plugin component specs
- [Cowork Plugins](https://github.com/anthropics/knowledge-work-plugins) — Knowledge-work plugin examples

## What's next

1. **MCP sampling support** — When clients implement [`sampling/createMessage`](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling), the server will use it automatically (no code changes needed). Track progress: [Claude Code #1785](https://github.com/anthropics/claude-code/issues/1785).
2. **Add OAuth 2.1** — Required for institutional deployment per the MCP auth spec
3. **Add Tasks support** — Long-running research sessions should use the Tasks primitive for async execution
4. **Server-side tool execution** — Implement the sampling tool loop (server executes tools, sends results back) per the spec's multi-turn tool flow

## License

MIT

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

All commands run from `mcp-plugin-patterns/`:

```bash
npm install          # install dependencies
npm run build        # compile TypeScript (tsc)
npm run dev          # watch mode (tsc --watch)
npm start            # run server via stdio transport
npm run start:http   # run server via HTTP (Streamable HTTP on port 3001)
TRANSPORT=http PORT=3001 npm start  # equivalent to start:http
```

No test framework is configured. No linter is configured.

## Architecture

This is a prototype MCP server that demonstrates how Anthropic's plugin system capabilities (skills, hooks, agents, evals) can be delivered remotely through standard MCP primitives instead of local plugin files.

**Domain:** Briefing document generation (executive briefs, competitive intel, meeting prep, technical assessments).

### Plugin-to-MCP Mapping (core concept)

| Plugin concept | MCP equivalent | Module |
|---|---|---|
| Skills (auto-triggered knowledge) | Skills with server-side relevance matching | `src/skills/` |
| Hooks (PreToolUse/PostToolUse/Stop) | Hook engine with pre/post/stop quality gates | `src/hooks/index.ts` |
| Agents/Subagents | Server-side agent loop via sampling/createMessage (SEP-1577) | `src/sampling/agent-loop.ts` |
| Evals | Scoring engine with per-criterion heuristics | `src/evals/index.ts` |

### Request Flow

1. Client calls `briefing_search_skills` → skill registry scores all skills against query using tag/keyword matching
2. Client calls `briefing_execute` with chosen skill → orchestrator runs pre-hooks, builds sampling requests per step, runs post-hooks
3. Client calls `briefing_evaluate` → heuristic scorer grades output against skill-specific eval criteria
4. Client calls `briefing_completion_gate` → stop-hooks verify all steps complete and eval has been run

### Key Types (`src/types.ts`)

- `ExecutionContext` — session state threading through the entire pipeline (query, selected skill, step outputs, hook results, eval result)
- `Skill` / `SkillStep` — methodology templates with steps, tags, eval criteria
- `HookDefinition` / `HookResult` — quality gates with allow/block/modify decisions
- `EvalCriterion` / `EvalResult` — weighted scoring criteria per skill

### Transport

Entry point (`src/index.ts`) supports two transports selected via `TRANSPORT` env var:
- **stdio** (default) — for Claude Code / Claude Desktop
- **http** — Express server with `StreamableHTTPServerTransport` at `/mcp`, health check at `/health`

### Session Management

In-memory `Map<string, ExecutionContext>` keyed by session ID (UUID). Sessions persist across tool calls within a server lifetime but are not durable.

## Conventions

- TypeScript with strict mode, ES2022 target, NodeNext module resolution
- ESM (`"type": "module"` in package.json) — all local imports use `.js` extension
- MCP SDK: `@modelcontextprotocol/sdk` — tools registered via `server.registerTool()`
- Input validation: Zod schemas passed as `inputSchema` to `registerTool`
- Sampling requests follow the MCP 2025-11-25 spec (SEP-1577) but are currently simulated (not sent to client)
- Hook step matchers use step ID strings or `"*"` for all steps; step IDs follow pattern like `exec-2-gather`, `ci-5-draft`

/**
 * MCP Plugin Patterns Server
 *
 * A demonstration MCP server that replicates the capabilities of Anthropic's
 * plugin system (skills, hooks, agents, evals) through standard MCP primitives.
 *
 * The server exposes these tools:
 *
 *   briefing_search_skills     — Find the right methodology for a query
 *                                 (plugin equivalent: skill auto-matching)
 *
 *   briefing_list_skills       — Browse all available skills
 *                                 (plugin equivalent: /commands list)
 *
 *   briefing_execute           — Run the full skill with hooks + agent loop
 *                                 (plugin equivalent: skill + hooks + subagent)
 *
 *   briefing_check_hooks       — Run hooks independently for any content
 *                                 (plugin equivalent: PreToolUse / PostToolUse)
 *
 *   briefing_evaluate          — Score a brief against methodology criteria
 *                                 (plugin equivalent: prompt-based Stop hook)
 *
 *   briefing_completion_gate   — Check if a session is ready to deliver
 *                                 (plugin equivalent: Stop hook)
 *
 * Architecture notes:
 *   - Uses Streamable HTTP transport for remote deployment (or stdio for local)
 *   - Skills, hooks, and eval criteria are server-managed — updates ship
 *     instantly to all connected clients without reinstallation
 *   - Sampling with tools (SEP-1577) enables server-side agent loops using
 *     the client's LLM — no server-side API keys required
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import {
  searchSkills,
  listSkills,
  getSkill,
} from "./skills/index.js";
import {
  runHooks,
  formatHookResults,
  hasBlockingDecision,
  getModifications,
} from "./hooks/index.js";
import {
  orchestrateSkill,
  checkCompletionGates,
} from "./sampling/agent-loop.js";
import {
  evaluateBrief,
  formatEvalResult,
} from "./evals/index.js";
import type { ExecutionContext } from "./types.js";

// ── Server initialisation ───────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-plugin-patterns",
  version: "0.1.0",
});

// ── Session store (in-memory for prototype) ─────────────────────────────

const sessions = new Map<string, ExecutionContext>();

function getOrCreateSession(
  sessionId: string | undefined,
  query: string
): ExecutionContext {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }
  const id = sessionId ?? randomUUID();
  const ctx: ExecutionContext = {
    sessionId: id,
    query,
    stepOutputs: new Map(),
    hookResults: [],
  };
  sessions.set(id, ctx);
  return ctx;
}

// ── Tool: Search skills ─────────────────────────────────────────────────
// PLUGIN EQUIVALENT: Skill auto-matching by description

server.registerTool(
  "briefing_search_skills",
  {
    title: "Search Briefing Skills",
    description: `Search for the most relevant briefing methodology for a given query.
Returns ranked skill matches with relevance scores and matched tags.
This should be the FIRST tool called — it identifies which expert-curated
methodology to apply, just like a plugin skill auto-triggers based on context.

Args:
  - query (string): The user's research question or briefing request
  - min_score (number): Minimum relevance score 0-1 (default: 0.05)

Returns:
  Ranked list of skill matches with scores and reasoning.`,
    inputSchema: {
      query: z.string().min(1).describe("The user's briefing request or research question"),
      min_score: z.number().min(0).max(1).default(0.05).describe("Minimum relevance threshold"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, min_score }) => {
    const matches = searchSkills(query, min_score);

    const output = matches.map((m) => ({
      skillId: m.skill.id,
      skillName: m.skill.name,
      relevanceScore: Math.round(m.relevanceScore * 100) / 100,
      matchedTags: m.matchedTags,
      reasoning: m.reasoning,
      curator: m.skill.curator,
      stepCount: m.skill.steps.length,
      evalCriteriaCount: m.skill.evalCriteria.length,
    }));

    const text = matches.length > 0
      ? [
          `Found ${matches.length} matching skill(s) for: "${query}"`,
          "",
          ...matches.map(
            (m, i) =>
              `${i + 1}. **${m.skill.name}** (score: ${Math.round(m.relevanceScore * 100)}%)` +
              `\n   Curator: ${m.skill.curator}` +
              `\n   Steps: ${m.skill.steps.length} | Eval criteria: ${m.skill.evalCriteria.length}` +
              `\n   ${m.reasoning}`
          ),
        ].join("\n")
      : `No skills matched the query "${query}" above the minimum score threshold.`;

    return {
      content: [{ type: "text", text }],
      structuredContent: { matches: output },
    };
  }
);

// ── Tool: List skills ───────────────────────────────────────────────────

server.registerTool(
  "briefing_list_skills",
  {
    title: "List All Briefing Skills",
    description: `List all available briefing skills with their descriptions and metadata.
Use this to browse the full library of expert-curated methodologies.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const all = listSkills();
    const text = [
      `## Available Briefing Skills (${all.length})`,
      "",
      ...all.map(
        (s) =>
          `### ${s.name}\n` +
          `ID: \`${s.id}\` | Curator: ${s.curator} | Steps: ${s.stepCount}\n` +
          `${s.description}`
      ),
    ].join("\n\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: { skills: all },
    };
  }
);

// ── Tool: Execute skill ─────────────────────────────────────────────────
// PLUGIN EQUIVALENT: Skill execution + hooks + subagent orchestration

server.registerTool(
  "briefing_execute",
  {
    title: "Execute Briefing Skill",
    description: `Execute a selected skill's methodology step by step.

This is the core orchestration tool. It:
1. Validates the session via pre-hooks (like PreToolUse in plugins)
2. Generates sampling requests for each step (server-side agent loop)
3. Runs post-hooks after each step to check quality (like PostToolUse)
4. Returns the full execution plan with hook results

In a production deployment with full sampling support, this tool would
use sampling/createMessage (SEP-1577) to have the client's LLM execute
each step. In this prototype, it generates the sampling requests and
demonstrates the hook pipeline.

Args:
  - skill_id (string): ID of the skill to execute
  - query (string): The user's original research question
  - session_id (string): Optional session ID for continuity

Returns:
  Step-by-step execution plan with sampling requests and hook results.`,
    inputSchema: {
      skill_id: z.string().min(1).describe("Skill ID from search results"),
      query: z.string().min(1).describe("The user's briefing request"),
      session_id: z.string().optional().describe("Session ID for continuity"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ skill_id, query, session_id }) => {
    const skill = getSkill(skill_id);
    if (!skill) {
      return {
        content: [{
          type: "text",
          text: `Error: Skill "${skill_id}" not found. Use briefing_search_skills or briefing_list_skills to find available skills.`,
        }],
        isError: true,
      };
    }

    const context = getOrCreateSession(session_id, query);
    context.selectedSkill = skill;
    context.query = query;

    const stepResults = orchestrateSkill(context);

    const textParts: string[] = [
      `## Executing: ${skill.name}`,
      `**Session:** ${context.sessionId}`,
      `**Query:** ${query}`,
      `**Curator:** ${skill.curator}`,
      "",
    ];

    for (const result of stepResults) {
      textParts.push(`### Step: ${result.stepTitle}`);

      if (result.blocked) {
        textParts.push(`🚫 **BLOCKED** — ${result.blockReason}`);
        textParts.push(`\nPre-hooks:\n${result.preHookResults}`);
      } else {
        textParts.push(`Pre-hooks:\n${result.preHookResults}`);

        if (result.postHookResults) {
          textParts.push(`\nPost-hooks:\n${result.postHookResults}`);
        }

        if (result.modifications.length > 0) {
          textParts.push(`\n⚠️ Modifications required:`);
          for (const mod of result.modifications) {
            textParts.push(`  - ${mod}`);
          }
        }

        // Show the sampling request for transparency
        textParts.push(
          `\n<details><summary>Sampling request for this step</summary>\n` +
          `\`\`\`json\n${JSON.stringify(result.samplingRequest, null, 2)}\n\`\`\`\n</details>`
        );
      }
      textParts.push("");
    }

    const blocked = stepResults.some((r) => r.blocked);
    if (!blocked) {
      textParts.push(
        "---",
        `✅ All ${stepResults.length} steps prepared.`,
        `Next: Use \`briefing_evaluate\` to score the output, then \`briefing_completion_gate\` to check delivery readiness.`
      );
    }

    return {
      content: [{ type: "text", text: textParts.join("\n") }],
      structuredContent: {
        sessionId: context.sessionId,
        skillId: skill.id,
        steps: stepResults.map((r) => ({
          stepId: r.stepId,
          stepTitle: r.stepTitle,
          blocked: r.blocked,
          blockReason: r.blockReason,
          modifications: r.modifications,
        })),
        blocked,
      },
    };
  }
);

// ── Tool: Run hooks independently ───────────────────────────────────────
// PLUGIN EQUIVALENT: Direct hook invocation

server.registerTool(
  "briefing_check_hooks",
  {
    title: "Run Quality Hooks",
    description: `Run hook checks (pre, post, or stop) independently on any content.

This exposes the hook engine directly, letting the agent validate content
at any point — not just during skill execution.

Plugin equivalent: Manually triggering PreToolUse / PostToolUse hooks.

Args:
  - timing (string): "pre", "post", or "stop"
  - content (string): The content to validate
  - step_id (string): Optional step ID for step-specific hooks
  - session_id (string): Session ID for context

Returns:
  Hook results with pass/block/modify decisions and reasoning.`,
    inputSchema: {
      timing: z.enum(["pre", "post", "stop"]).describe("Hook timing: pre, post, or stop"),
      content: z.string().describe("Content to validate"),
      step_id: z.string().optional().describe("Step ID for step-specific hooks"),
      session_id: z.string().describe("Session ID for context"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ timing, content, step_id, session_id }) => {
    const context = sessions.get(session_id);
    if (!context) {
      return {
        content: [{
          type: "text",
          text: `Error: Session "${session_id}" not found. Run briefing_execute first.`,
        }],
        isError: true,
      };
    }

    const results = runHooks(timing, step_id, content, context);
    const blocked = hasBlockingDecision(results);
    const modifications = getModifications(results);

    return {
      content: [{ type: "text", text: formatHookResults(results) }],
      structuredContent: {
        timing,
        hookCount: results.length,
        blocked,
        modifications,
        results: results.map((r) => ({
          hookName: r.hookName,
          decision: r.decision.action,
          reasoning: r.reasoning,
          durationMs: r.durationMs,
        })),
      },
    };
  }
);

// ── Tool: Evaluate brief ────────────────────────────────────────────────
// PLUGIN EQUIVALENT: Prompt-based eval hook

server.registerTool(
  "briefing_evaluate",
  {
    title: "Evaluate Brief Quality",
    description: `Score a completed brief against the skill's methodology-specific
evaluation criteria. Returns a transparent scorecard with per-criterion
scores, reasoning, and improvement suggestions.

The eval criteria are curated by the skill's subject-matter experts
and are continuously updated — a key advantage of server-hosted methodology.

Args:
  - content (string): The completed brief text to evaluate
  - session_id (string): Session ID (must have a selected skill)

Returns:
  Evaluation scorecard with composite score and per-criterion breakdown.`,
    inputSchema: {
      content: z.string().min(1).describe("The completed brief text to evaluate"),
      session_id: z.string().describe("Session ID with selected skill"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ content, session_id }) => {
    const context = sessions.get(session_id);
    if (!context) {
      return {
        content: [{
          type: "text",
          text: `Error: Session "${session_id}" not found.`,
        }],
        isError: true,
      };
    }
    if (!context.selectedSkill) {
      return {
        content: [{
          type: "text",
          text: "Error: No skill selected in this session. Run briefing_execute first.",
        }],
        isError: true,
      };
    }

    context.draftContent = content;
    const result = evaluateBrief(content, context);
    context.evalResult = result;

    return {
      content: [{ type: "text", text: formatEvalResult(result) }],
      structuredContent: result,
    };
  }
);

// ── Tool: Completion gate ───────────────────────────────────────────────
// PLUGIN EQUIVALENT: Stop hook

server.registerTool(
  "briefing_completion_gate",
  {
    title: "Check Completion Readiness",
    description: `Run stop-hooks to verify the brief is ready for delivery.

Checks that all skill steps are complete and an eval has been run.
This is the final quality gate before the brief is delivered to the user.

Plugin equivalent: The Stop hook that validates task completeness
before allowing the agent to finish.

Args:
  - session_id (string): Session ID to check

Returns:
  Whether the session can complete, with any remaining requirements.`,
    inputSchema: {
      session_id: z.string().describe("Session ID to check for completeness"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ session_id }) => {
    const context = sessions.get(session_id);
    if (!context) {
      return {
        content: [{
          type: "text",
          text: `Error: Session "${session_id}" not found.`,
        }],
        isError: true,
      };
    }

    const gate = checkCompletionGates(context);

    const text = gate.canComplete
      ? `✅ All completion gates passed. The brief is ready for delivery.\n\n${gate.hookResults}`
      : `🚫 Not ready for delivery.\n\n${gate.hookResults}` +
        (gate.modifications.length > 0
          ? `\n\nRequired actions:\n${gate.modifications.map((m) => `- ${m}`).join("\n")}`
          : "");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        canComplete: gate.canComplete,
        modifications: gate.modifications,
      },
    };
  }
);

// ── Transport ───────────────────────────────────────────────────────────

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Plugin Patterns server running on stdio");
}

async function runHTTP(): Promise<void> {
  // Dynamic import to avoid requiring express when using stdio
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "mcp-plugin-patterns",
      version: "0.1.0",
    });
  });

  const port = parseInt(process.env.PORT || "3001");
  app.listen(port, () => {
    console.error(`MCP Plugin Patterns server running on http://localhost:${port}/mcp`);
  });
}

// ── Entry point ─────────────────────────────────────────────────────────

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}

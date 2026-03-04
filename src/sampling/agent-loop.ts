/**
 * Server-Side Agent Loop via MCP Sampling
 *
 * This module implements the SEP-1577 "sampling with tools" pattern from
 * the November 2025 MCP specification. The server orchestrates a multi-step
 * workflow by sending LLM requests for each skill step.
 *
 * LLM strategy (via src/llm.ts):
 *   1. MCP sampling/createMessage — when the client supports it
 *   2. Anthropic API fallback — when ANTHROPIC_API_KEY is set
 *   3. Simulation — descriptive placeholder text
 *
 * PLUGIN EQUIVALENT:
 *   Agents/Subagents → agents/ directory in plugin root
 *   Claude can invoke subagents automatically based on task context.
 *   Here, the MCP server creates an equivalent "inverted agent" pattern
 *   where the server defines the loop and the client provides the LLM.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  Skill,
  SkillStep,
  ExecutionContext,
  AgentLoopConfig,
  SamplingToolDef,
} from "../types.js";
import { runHooks, hasBlockingDecision, getModifications, formatHookResults } from "../hooks/index.js";
import { llmCall } from "../llm.js";

// ── Tool definitions for sampling requests ──────────────────────────────

export const samplingTools: SamplingToolDef[] = [
  {
    name: "web_search",
    description: "Search the web for current information on a topic.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "document_search",
    description: "Search internal documents and knowledge bases.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        source: {
          type: "string",
          description: "Specific source to search (optional)",
        },
      },
      required: ["query"],
    },
  },
];

// ── Prompt builder ──────────────────────────────────────────────────────

/**
 * Build the system prompt and user message for a single skill step.
 */
function buildStepPrompt(
  step: SkillStep,
  context: ExecutionContext
): { systemPrompt: string; userMessage: string } {
  const priorContext = Array.from(context.stepOutputs.entries())
    .map(([stepId, output]) => `[Step: ${stepId}]\n${output}`)
    .join("\n\n---\n\n");

  const systemPrompt = [
    `You are executing step "${step.title}" of the ${context.selectedSkill?.name ?? "unknown"} skill.`,
    `Original user query: "${context.query}"`,
    "",
    "Follow the step instruction precisely.",
    "Produce structured, evidence-based output. Cite sources where applicable.",
  ].join("\n");

  const userMessage = [
    `## Step instruction\n${step.instruction}`,
    priorContext
      ? `\n## Context from prior steps\n${priorContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemPrompt, userMessage };
}

// ── Agent loop orchestrator ─────────────────────────────────────────────

export interface StepResult {
  stepId: string;
  stepTitle: string;
  /** The actual output from the LLM */
  stepOutput: string;
  /** Hook results from pre-execution checks */
  preHookResults: string;
  /** Hook results from post-execution checks */
  postHookResults: string;
  /** Whether pre-hooks blocked this step */
  blocked: boolean;
  blockReason?: string;
  /** Modifications suggested by post-hooks */
  modifications: string[];
  /** How the LLM output was produced */
  llmSource: "sampling" | "anthropic-api" | "simulation";
}

/**
 * Orchestrate the full skill execution.
 *
 * For each step, sends an LLM request (via sampling or API fallback),
 * then runs hooks on the real output.
 */
export async function orchestrateSkill(
  server: Server,
  context: ExecutionContext,
  config: AgentLoopConfig = { maxIterations: 10 }
): Promise<StepResult[]> {
  const skill = context.selectedSkill;
  if (!skill) {
    throw new Error("No skill selected in execution context.");
  }

  const results: StepResult[] = [];

  for (const step of skill.steps) {
    // ── Pre-hooks (deterministic, no server needed) ────────────
    const preHooks = await runHooks("pre", step.id, "", context);
    context.hookResults.push(...preHooks);

    if (hasBlockingDecision(preHooks)) {
      const blockReasons = preHooks
        .filter((h) => h.decision.action === "block")
        .map((h) => (h.decision as { action: "block"; reason: string }).reason);

      results.push({
        stepId: step.id,
        stepTitle: step.title,
        stepOutput: "",
        preHookResults: formatHookResults(preHooks),
        postHookResults: "",
        blocked: true,
        blockReason: blockReasons.join("; "),
        modifications: [],
        llmSource: "simulation",
      });
      break;
    }

    // ── Execute step via LLM ─────────────────────────────────────
    const { systemPrompt, userMessage } = buildStepPrompt(step, context);
    const llmResponse = await llmCall(
      { systemPrompt, userMessage, maxTokens: 4000 },
      server,
      `[No LLM available for step "${step.title}". Set ANTHROPIC_API_KEY or use an MCP client with sampling support.]`
    );

    context.stepOutputs.set(step.id, llmResponse.text);

    // ── Post-hooks (LLM-powered when available) ──────────────────
    const postHooks = step.requiresValidation
      ? await runHooks("post", step.id, llmResponse.text, context, server)
      : [];
    context.hookResults.push(...postHooks);

    const modifications = getModifications(postHooks);

    results.push({
      stepId: step.id,
      stepTitle: step.title,
      stepOutput: llmResponse.text,
      preHookResults: formatHookResults(preHooks),
      postHookResults: formatHookResults(postHooks),
      blocked: false,
      modifications,
      llmSource: llmResponse.source,
    });

    // Check iteration limit
    if (results.length >= config.maxIterations) break;
  }

  return results;
}

/**
 * Run stop-hooks to determine if the brief is ready for delivery.
 */
export async function checkCompletionGates(
  context: ExecutionContext
): Promise<{ canComplete: boolean; hookResults: string; modifications: string[] }> {
  const stopHooks = await runHooks(
    "stop",
    undefined,
    context.draftContent ?? "",
    context
  );
  context.hookResults.push(...stopHooks);

  return {
    canComplete: !hasBlockingDecision(stopHooks),
    hookResults: formatHookResults(stopHooks),
    modifications: getModifications(stopHooks),
  };
}

/**
 * Server-Side Agent Loop via MCP Sampling
 *
 * This module demonstrates the SEP-1577 "sampling with tools" pattern from
 * the November 2025 MCP specification. The server orchestrates a multi-step
 * workflow by sending sampling requests (with tool definitions) back to the
 * client's LLM.
 *
 * PLUGIN EQUIVALENT:
 *   Agents/Subagents → agents/ directory in plugin root
 *   Claude can invoke subagents automatically based on task context.
 *   Here, the MCP server creates an equivalent "inverted agent" pattern
 *   where the server defines the loop and the client provides the LLM.
 *
 * WHY THIS MATTERS FOR CHORUS:
 *   This is the architectural primitive that lets a remote MCP server
 *   deliver skills + hooks + agent logic as a single deployment —
 *   the "remote hosted skills" concept.
 *
 * NOTE: As of early 2026, not all MCP clients fully support sampling with
 * tools. The code below is written against the 2025-11-25 spec. For clients
 * that don't yet support sampling, the server falls back to returning
 * step-by-step instructions as structured tool responses.
 */

import type {
  Playbook,
  PlaybookStep,
  ExecutionContext,
  AgentLoopConfig,
  SamplingToolDef,
} from "../types.js";
import { runHooks, hasBlockingDecision, getModifications, formatHookResults } from "../hooks/index.js";

// ── Tool definitions for sampling requests ──────────────────────────────

/**
 * These are the tools the server includes in its sampling/createMessage
 * request. The client's LLM can invoke these during the server-side loop.
 */
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

// ── Sampling request builder ────────────────────────────────────────────

/**
 * Build a sampling/createMessage request for a single playbook step.
 *
 * This returns the JSON-RPC params that would be sent to the client.
 * In production, the MCP server SDK handles the actual transport.
 */
export function buildSamplingRequest(
  step: PlaybookStep,
  context: ExecutionContext,
  config: AgentLoopConfig
): Record<string, unknown> {
  // Build context from prior step outputs
  const priorContext = Array.from(context.stepOutputs.entries())
    .map(([stepId, output]) => `[Step: ${stepId}]\n${output}`)
    .join("\n\n---\n\n");

  const systemPrompt = [
    `You are executing step "${step.title}" of the ${context.selectedPlaybook?.name ?? "unknown"} playbook.`,
    `Original user query: "${context.query}"`,
    "",
    "Follow the step instruction precisely. Use the available tools if the step suggests them.",
    "Produce structured, evidence-based output. Cite sources where applicable.",
  ].join("\n");

  const userMessage = [
    `## Step instruction\n${step.instruction}`,
    priorContext
      ? `\n## Context from prior steps\n${priorContext}`
      : "",
    step.suggestedTools
      ? `\n## Suggested tools for this step\nConsider using: ${step.suggestedTools.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // The sampling request params per 2025-11-25 spec
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: userMessage },
      },
    ],
    systemPrompt,
    modelPreferences: {
      hints: (config.modelHints ?? []).map((name) => ({ name })),
      intelligencePriority: config.intelligencePriority ?? 0.8,
      speedPriority: config.speedPriority ?? 0.5,
    },
    // SEP-1577: Include tool definitions so the LLM can call them
    tools: (step.suggestedTools ?? []).map((toolName) => {
      const def = samplingTools.find((t) => t.name === toolName);
      return def
        ? {
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema,
          }
        : null;
    }).filter(Boolean),
    maxTokens: 2000,
  };
}

// ── Agent loop orchestrator ─────────────────────────────────────────────

export interface StepResult {
  stepId: string;
  stepTitle: string;
  /** The sampling request that would be sent (for transparency) */
  samplingRequest: Record<string, unknown>;
  /** Hook results from pre-execution checks */
  preHookResults: string;
  /** Hook results from post-execution checks (populated after sampling) */
  postHookResults: string;
  /** Whether pre-hooks blocked this step */
  blocked: boolean;
  blockReason?: string;
  /** Modifications suggested by post-hooks */
  modifications: string[];
}

/**
 * Orchestrate the full playbook execution.
 *
 * In a live deployment with full sampling support, this function would
 * actually send sampling/createMessage requests and process responses.
 *
 * In this prototype, it generates the sampling requests and runs hooks
 * to demonstrate the pattern. The actual LLM interaction would happen
 * via the SDK's sampling API.
 */
export function orchestratePlaybook(
  context: ExecutionContext,
  config: AgentLoopConfig = { maxIterations: 10 }
): StepResult[] {
  const playbook = context.selectedPlaybook;
  if (!playbook) {
    throw new Error("No playbook selected in execution context.");
  }

  const results: StepResult[] = [];

  for (const step of playbook.steps) {
    // ── Pre-hooks ────────────────────────────────────────────────
    const preHooks = runHooks("pre", step.id, "", context);
    context.hookResults.push(...preHooks);

    if (hasBlockingDecision(preHooks)) {
      const blockReasons = preHooks
        .filter((h) => h.decision.action === "block")
        .map((h) => (h.decision as { action: "block"; reason: string }).reason);

      results.push({
        stepId: step.id,
        stepTitle: step.title,
        samplingRequest: {},
        preHookResults: formatHookResults(preHooks),
        postHookResults: "",
        blocked: true,
        blockReason: blockReasons.join("; "),
        modifications: [],
      });
      // Stop the loop — a pre-hook blocked execution
      break;
    }

    // ── Build sampling request ───────────────────────────────────
    const samplingRequest = buildSamplingRequest(step, context, config);

    // ── Simulate step output (in production, this comes from sampling) ─
    // For the prototype, we record that the step was "executed" so
    // post-hooks and the completeness gate can evaluate properly.
    const simulatedOutput = `[Output of step "${step.title}" would be produced by the client LLM via sampling/createMessage]`;
    context.stepOutputs.set(step.id, simulatedOutput);

    // ── Post-hooks ───────────────────────────────────────────────
    const postHooks = step.requiresValidation
      ? runHooks("post", step.id, simulatedOutput, context)
      : [];
    context.hookResults.push(...postHooks);

    const modifications = getModifications(postHooks);

    results.push({
      stepId: step.id,
      stepTitle: step.title,
      samplingRequest,
      preHookResults: formatHookResults(preHooks),
      postHookResults: formatHookResults(postHooks),
      blocked: false,
      modifications,
    });

    // Check iteration limit
    if (results.length >= config.maxIterations) break;
  }

  return results;
}

/**
 * Run stop-hooks to determine if the brief is ready for delivery.
 */
export function checkCompletionGates(
  context: ExecutionContext
): { canComplete: boolean; hookResults: string; modifications: string[] } {
  const stopHooks = runHooks(
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

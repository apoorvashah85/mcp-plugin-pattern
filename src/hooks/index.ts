/**
 * Hook Engine
 *
 * This is the most architecturally significant module in the prototype.
 * It demonstrates how an MCP server can replicate the hook behaviour that
 * Anthropic's plugin system provides locally — but delivered remotely,
 * updated centrally, and governed by subject-matter experts.
 *
 * PLUGIN EQUIVALENTS:
 *   PreToolUse hook   → pre-hooks   (validate before a step executes)
 *   PostToolUse hook  → post-hooks  (check quality after a step completes)
 *   Stop hook         → stop-hooks  (gate whether the agent should finish)
 *
 * Post-hooks use LLM-powered evaluation via sampling/createMessage when
 * available, falling back to deterministic heuristics otherwise.
 * Pre-hooks and stop-hooks remain deterministic (structural checks).
 *
 * KEY INSIGHT: Because these hooks live on the server, the publisher can
 * update them at any time without requiring the user to reinstall anything.
 */

import type {
  HookTiming,
  HookInput,
  HookResult,
  HookDecision,
  ExecutionContext,
  SkillStep,
} from "../types.js";
import { llmCall } from "../llm.js";

// ── LLM hook helper ────────────────────────────────────────────────────

/**
 * Ask an LLM to evaluate content. Uses the llmCall abstraction layer
 * (sampling → API fallback → simulation). Returns parsed JSON or null.
 */
async function llmEvaluate(
  input: HookInput,
  prompt: string
): Promise<{ pass: boolean; reason: string } | null> {
  const response = await llmCall(
    {
      systemPrompt: "You are a quality assurance evaluator. Respond ONLY with valid JSON, no markdown fencing.",
      userMessage: prompt,
      maxTokens: 300,
    },
    input.server
  );

  if (response.source === "simulation") return null;

  try {
    const cleaned = response.text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as { pass: boolean; reason: string };
  } catch {
    return null;
  }
}

// ── Hook definitions ────────────────────────────────────────────────────

interface HookDefinition {
  name: string;
  timing: HookTiming;
  /** Which step IDs this hook applies to (glob "*" = all steps) */
  matcher: string | string[];
  /** The check logic. Returns a decision (may be async for LLM-powered hooks). */
  evaluate: (input: HookInput) => HookDecision | Promise<HookDecision>;
}

// ── Pre-execution hooks (deterministic) ─────────────────────────────────

const scopeValidation: HookDefinition = {
  name: "scope-validation",
  timing: "pre",
  matcher: "*",
  evaluate: (input) => {
    if (input.context.query.split(/\s+/).length < 3) {
      return {
        action: "block",
        reason:
          "Query is too vague (fewer than 3 words). Ask the user to provide more context before proceeding.",
      };
    }
    return { action: "allow" };
  },
};

const skillRequired: HookDefinition = {
  name: "skill-required",
  timing: "pre",
  matcher: "*",
  evaluate: (input) => {
    if (!input.context.selectedSkill) {
      return {
        action: "block",
        reason:
          "No skill selected. Run skill search first to identify the right methodology.",
      };
    }
    return { action: "allow" };
  },
};

// ── Post-execution hooks (LLM-powered with heuristic fallback) ──────────

const sourceCheck: HookDefinition = {
  name: "source-quality-check",
  timing: "post",
  matcher: ["exec-2-gather", "ci-2-research", "mp-2-stakeholders", "ta-2-capabilities"],
  evaluate: async (input) => {
    // Try LLM evaluation first
    const llmResult = await llmEvaluate(
      input,
      `Evaluate whether this research output cites specific, named sources (URLs, publication names, author names, organization names). Content to evaluate:\n\n${input.content.slice(0, 2000)}\n\nRespond with JSON: {"pass": true/false, "reason": "brief explanation"}`
    );

    if (llmResult) {
      return llmResult.pass
        ? { action: "allow" }
        : { action: "modify", modifications: `[LLM] ${llmResult.reason}` };
    }

    // Heuristic fallback
    const content = input.content.toLowerCase();
    const hasSourceIndicators =
      content.includes("http") ||
      content.includes("source:") ||
      content.includes("according to") ||
      content.includes("reported") ||
      content.includes("published");

    if (!hasSourceIndicators) {
      return {
        action: "modify",
        modifications:
          "Research output lacks source attribution. Re-run this step and ensure every claim cites a specific, named source.",
      };
    }
    return { action: "allow" };
  },
};

const lengthCheck: HookDefinition = {
  name: "length-compliance",
  timing: "post",
  // Stays deterministic — word count is precise, LLM adds no value
  matcher: ["exec-5-draft", "ci-5-draft", "mp-5-draft", "ta-5-draft"],
  evaluate: (input) => {
    const wordCount = input.content.split(/\s+/).length;
    const skill = input.context.selectedSkill;
    if (!skill) return { action: "allow" };

    const draftStep = skill.steps[skill.steps.length - 1];
    const lengthMatch = draftStep.instruction.match(/(\d+)-(\d+)\s*words/);
    if (!lengthMatch) return { action: "allow" };

    const minWords = parseInt(lengthMatch[1], 10);
    const maxWords = parseInt(lengthMatch[2], 10);

    if (wordCount < minWords * 0.7) {
      return {
        action: "modify",
        modifications: `Draft is ${wordCount} words, well below the target range of ${minWords}-${maxWords}. Expand with more detail and evidence.`,
      };
    }
    if (wordCount > maxWords * 1.3) {
      return {
        action: "modify",
        modifications: `Draft is ${wordCount} words, exceeding the target range of ${minWords}-${maxWords}. Tighten the prose and remove redundancies.`,
      };
    }
    return { action: "allow" };
  },
};

const biasCheck: HookDefinition = {
  name: "analytical-balance",
  timing: "post",
  matcher: ["exec-5-draft", "ci-5-draft", "ta-5-draft"],
  evaluate: async (input) => {
    // Try LLM evaluation first
    const llmResult = await llmEvaluate(
      input,
      `Evaluate whether this draft presents a balanced analysis with multiple perspectives, trade-offs, risks, and counterpoints — rather than being one-sided or purely positive. Content to evaluate:\n\n${input.content.slice(0, 2000)}\n\nRespond with JSON: {"pass": true/false, "reason": "brief explanation"}`
    );

    if (llmResult) {
      return llmResult.pass
        ? { action: "allow" }
        : { action: "modify", modifications: `[LLM] ${llmResult.reason}` };
    }

    // Heuristic fallback
    const content = input.content.toLowerCase();
    const balanceIndicators = [
      "however", "on the other hand", "trade-off", "risk",
      "limitation", "alternatively", "concern", "caveat",
      "downside", "weakness",
    ];
    const balanceCount = balanceIndicators.filter((indicator) =>
      content.includes(indicator)
    ).length;

    if (balanceCount < 2) {
      return {
        action: "modify",
        modifications:
          "Draft appears one-sided. Add counterpoints, trade-offs, or risk considerations to improve analytical balance.",
      };
    }
    return { action: "allow" };
  },
};

// ── Stop hooks (deterministic) ──────────────────────────────────────────

const completenessGate: HookDefinition = {
  name: "completeness-gate",
  timing: "stop",
  matcher: "*",
  evaluate: (input) => {
    const ctx = input.context;
    const skill = ctx.selectedSkill;
    if (!skill) return { action: "allow" };

    const missingSteps = skill.steps.filter(
      (step) => !ctx.stepOutputs.has(step.id)
    );

    if (missingSteps.length > 0) {
      return {
        action: "block",
        reason: `Cannot complete: ${missingSteps.length} step(s) have not been executed yet: [${missingSteps.map((s) => s.title).join(", ")}].`,
      };
    }
    return { action: "allow" };
  },
};

const evalRequiredGate: HookDefinition = {
  name: "eval-required",
  timing: "stop",
  matcher: "*",
  evaluate: (input) => {
    if (!input.context.evalResult) {
      return {
        action: "modify",
        modifications:
          "Brief is complete but has not been evaluated. Run the eval tool before delivering the final output.",
      };
    }
    return { action: "allow" };
  },
};

// ── Hook registry ───────────────────────────────────────────────────────

const allHooks: HookDefinition[] = [
  scopeValidation,
  skillRequired,
  sourceCheck,
  lengthCheck,
  biasCheck,
  completenessGate,
  evalRequiredGate,
];

// ── Engine ──────────────────────────────────────────────────────────────

function matchesStep(
  matcher: string | string[],
  stepId: string | undefined
): boolean {
  if (matcher === "*") return true;
  if (!stepId) return matcher === "*";
  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  return matchers.includes(stepId);
}

/**
 * Run all hooks for a given timing + step. Returns an array of results.
 * If any hook returns "block", execution should stop.
 * If any hook returns "modify", the modifications should be applied.
 *
 * Post-hooks may use LLM-powered evaluation via the server parameter.
 */
export async function runHooks(
  timing: HookTiming,
  stepId: string | undefined,
  content: string,
  context: ExecutionContext,
  server?: import("@modelcontextprotocol/sdk/server/index.js").Server
): Promise<HookResult[]> {
  const applicableHooks = allHooks.filter(
    (h) => h.timing === timing && matchesStep(h.matcher, stepId)
  );

  const results: HookResult[] = [];

  for (const hook of applicableHooks) {
    const start = Date.now();
    const decision = await hook.evaluate({ timing, stepId, content, context, server });
    const durationMs = Date.now() - start;

    let reasoning: string;
    switch (decision.action) {
      case "allow":
        reasoning = `${hook.name}: passed`;
        break;
      case "block":
        reasoning = `${hook.name}: BLOCKED — ${decision.reason}`;
        break;
      case "modify":
        reasoning = `${hook.name}: modification required — ${decision.modifications}`;
        break;
    }

    results.push({
      hookName: hook.name,
      timing,
      decision,
      reasoning,
      durationMs,
    });
  }

  return results;
}

/**
 * Convenience: check if any hook results contain a blocking decision.
 */
export function hasBlockingDecision(results: HookResult[]): boolean {
  return results.some((r) => r.decision.action === "block");
}

/**
 * Convenience: collect all modification instructions from hook results.
 */
export function getModifications(results: HookResult[]): string[] {
  return results
    .filter((r) => r.decision.action === "modify")
    .map((r) =>
      r.decision.action === "modify" ? r.decision.modifications : ""
    )
    .filter(Boolean);
}

/**
 * Format hook results for inclusion in a tool response.
 */
export function formatHookResults(results: HookResult[]): string {
  if (results.length === 0) return "No hooks triggered.";

  const lines = results.map((r) => {
    const icon =
      r.decision.action === "allow"
        ? "✅"
        : r.decision.action === "block"
          ? "🚫"
          : "⚠️";
    return `${icon} [${r.timing}] ${r.reasoning} (${r.durationMs}ms)`;
  });

  return lines.join("\n");
}

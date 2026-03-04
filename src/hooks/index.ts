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
 * In the plugin system, hooks fire locally via deterministic scripts or
 * prompt-based evaluation. Here, the MCP server runs the same logic
 * server-side—and can optionally use sampling to delegate evaluation
 * to the client's LLM for more nuanced checks.
 *
 * KEY INSIGHT: Because these hooks live on the server, the publisher can
 * update them at any time without requiring the user to reinstall anything.
 * This is the "remote hosted skills" pattern Alex Kasavin articulated.
 */

import type {
  HookTiming,
  HookInput,
  HookResult,
  HookDecision,
  ExecutionContext,
  SkillStep,
} from "../types.js";

// ── Hook definitions ────────────────────────────────────────────────────

interface HookDefinition {
  name: string;
  timing: HookTiming;
  /** Which step IDs this hook applies to (glob "*" = all steps) */
  matcher: string | string[];
  /** The check logic. Returns a decision. */
  evaluate: (input: HookInput) => HookDecision;
}

// ── Pre-execution hooks ─────────────────────────────────────────────────

const scopeValidation: HookDefinition = {
  name: "scope-validation",
  timing: "pre",
  matcher: "*",
  evaluate: (input) => {
    // Block execution if the query is too vague
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

// ── Post-execution hooks ────────────────────────────────────────────────

const sourceCheck: HookDefinition = {
  name: "source-quality-check",
  timing: "post",
  // Only fire after research/gather steps
  matcher: ["exec-2-gather", "ci-2-research", "mp-2-stakeholders", "ta-2-capabilities"],
  evaluate: (input) => {
    const content = input.content.toLowerCase();
    // Check if the output references any sources
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
  // Fire after draft steps
  matcher: ["exec-5-draft", "ci-5-draft", "mp-5-draft", "ta-5-draft"],
  evaluate: (input) => {
    const wordCount = input.content.split(/\s+/).length;
    const skill = input.context.selectedSkill;
    if (!skill) return { action: "allow" };

    // Extract target length from the last step's instruction
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
  evaluate: (input) => {
    const content = input.content.toLowerCase();
    // Simple heuristic: check for hedging / contrasting language
    const balanceIndicators = [
      "however",
      "on the other hand",
      "trade-off",
      "risk",
      "limitation",
      "alternatively",
      "concern",
      "caveat",
      "downside",
      "weakness",
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

// ── Stop hooks (completion gates) ───────────────────────────────────────

const completenessGate: HookDefinition = {
  name: "completeness-gate",
  timing: "stop",
  matcher: "*",
  evaluate: (input) => {
    const ctx = input.context;
    const skill = ctx.selectedSkill;
    if (!skill) return { action: "allow" };

    // Check that every step has produced output
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
  // Pre-hooks
  scopeValidation,
  skillRequired,
  // Post-hooks
  sourceCheck,
  lengthCheck,
  biasCheck,
  // Stop-hooks
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
 */
export function runHooks(
  timing: HookTiming,
  stepId: string | undefined,
  content: string,
  context: ExecutionContext
): HookResult[] {
  const applicableHooks = allHooks.filter(
    (h) => h.timing === timing && matchesStep(h.matcher, stepId)
  );

  return applicableHooks.map((hook) => {
    const start = Date.now();
    const decision = hook.evaluate({ timing, stepId, content, context });
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

    return {
      hookName: hook.name,
      timing,
      decision,
      reasoning,
      durationMs,
    };
  });
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

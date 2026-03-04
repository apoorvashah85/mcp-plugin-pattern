/**
 * Evaluation Engine
 *
 * Scores a completed brief against the skill's methodology-specific
 * evaluation criteria. Uses LLM-powered evaluation via sampling when
 * available, falling back to deterministic heuristics otherwise.
 *
 * PLUGIN EQUIVALENT:
 *   There is no direct plugin equivalent — evals are a Chorus innovation.
 *   However, the pattern maps to a PostToolUse hook with a prompt-based
 *   evaluation type, or to the Stop hook that validates completeness.
 *
 * In production, the eval criteria would be curated by editorial boards
 * and subject-matter experts — the same way Chorus skill evals work.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  EvalCriterion,
  EvalScore,
  EvalResult,
  ExecutionContext,
  Skill,
} from "../types.js";
import { llmCall } from "../llm.js";

// ── LLM-powered scoring ─────────────────────────────────────────────────

/**
 * Score a criterion using the LLM abstraction layer (sampling → API → simulation).
 * Returns null if no LLM is available or parsing fails.
 */
async function llmScoreCriterion(
  server: Server | undefined,
  criterion: EvalCriterion,
  content: string
): Promise<{ score: number; reasoning: string } | null> {
  const response = await llmCall(
    {
      systemPrompt: "You are an expert evaluator scoring content quality. Be rigorous and specific. Respond ONLY with valid JSON, no markdown fencing.",
      userMessage: `Score the following content on a scale of 0-100 for this criterion:\n\n**${criterion.name}**: ${criterion.description}\n\n---\n\nContent to evaluate:\n\n${content.slice(0, 3000)}\n\n---\n\nRespond ONLY with valid JSON (no markdown fencing): {"score": <0-100>, "reasoning": "<1-2 sentence explanation>"}`,
      maxTokens: 300,
    },
    server
  );

  if (response.source === "simulation") return null;

  try {
    const cleaned = response.text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { score: number; reasoning: string };
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    return { score, reasoning: `[LLM] ${parsed.reasoning}` };
  } catch {
    return null;
  }
}

// ── Heuristic fallback scorers ──────────────────────────────────────────

/**
 * Score a single criterion using heuristic checks.
 * Used as fallback when LLM scoring is unavailable.
 */
function heuristicScoreCriterion(
  criterion: EvalCriterion,
  content: string,
  context: ExecutionContext
): EvalScore {
  const contentLower = content.toLowerCase();
  const wordCount = content.split(/\s+/).length;

  let score = 50;
  let reasoning = "";

  const sourceIndicators = [
    "according to", "source:", "http", "reported by",
    "published", "data from", "research by", "study",
  ];
  const sourceCount = sourceIndicators.filter((i) =>
    contentLower.includes(i)
  ).length;

  const balanceIndicators = [
    "however", "trade-off", "risk", "limitation",
    "alternatively", "on the other hand", "caveat",
    "weakness", "concern", "challenge",
  ];
  const balanceCount = balanceIndicators.filter((i) =>
    contentLower.includes(i)
  ).length;

  const actionIndicators = [
    "recommend", "next step", "action", "timeline",
    "owner", "priority", "implement", "invest",
    "should", "consider",
  ];
  const actionCount = actionIndicators.filter((i) =>
    contentLower.includes(i)
  ).length;

  const structureIndicators = [
    "##", "1.", "2.", "- ", "key finding",
    "summary", "implication", "conclusion",
  ];
  const structureCount = structureIndicators.filter((i) =>
    content.includes(i)
  ).length;

  const criterionNameLower = criterion.name.toLowerCase();

  if (
    criterionNameLower.includes("evidence") ||
    criterionNameLower.includes("source") ||
    criterionNameLower.includes("accuracy")
  ) {
    score = Math.min(sourceCount * 15, 100);
    reasoning =
      sourceCount > 3
        ? `Strong source attribution (${sourceCount} indicators found).`
        : sourceCount > 0
          ? `Some source attribution (${sourceCount} indicators), but could be stronger.`
          : `No source attribution detected. Claims need evidence.`;
  } else if (
    criterionNameLower.includes("balance") ||
    criterionNameLower.includes("objectivity")
  ) {
    score = Math.min(balanceCount * 20, 100);
    reasoning =
      balanceCount >= 3
        ? `Good analytical balance (${balanceCount} contrasting points).`
        : `Limited counterpoints (${balanceCount}). Add trade-offs and risks.`;
  } else if (
    criterionNameLower.includes("action") ||
    criterionNameLower.includes("strategic")
  ) {
    score = Math.min(actionCount * 12, 100);
    reasoning =
      actionCount >= 4
        ? `Actionable and strategic (${actionCount} action-oriented elements).`
        : `Could be more actionable (${actionCount} elements). Add specific next steps.`;
  } else if (
    criterionNameLower.includes("clarity") ||
    criterionNameLower.includes("concis")
  ) {
    if (wordCount >= 300 && wordCount <= 1000) {
      score = 80;
      reasoning = `Good length (${wordCount} words). Within expected range.`;
    } else if (wordCount < 300) {
      score = 40;
      reasoning = `Too brief (${wordCount} words). Needs more substance.`;
    } else {
      score = 50;
      reasoning = `Potentially too long (${wordCount} words). Consider tightening.`;
    }
    score = Math.min(score + structureCount * 5, 100);
  } else if (
    criterionNameLower.includes("coverage") ||
    criterionNameLower.includes("completeness")
  ) {
    const skill = context.selectedSkill;
    if (skill) {
      const completedSteps = skill.steps.filter((s) =>
        context.stepOutputs.has(s.id)
      ).length;
      const ratio = completedSteps / skill.steps.length;
      score = Math.round(ratio * 100);
      reasoning = `${completedSteps}/${skill.steps.length} steps completed.`;
    } else {
      score = 50;
      reasoning = "No skill context available for completeness check.";
    }
  } else if (
    criterionNameLower.includes("relevance") ||
    criterionNameLower.includes("specific") ||
    criterionNameLower.includes("practical")
  ) {
    const numberMatches = content.match(/\d+/g) ?? [];
    const specificityScore = Math.min(numberMatches.length * 8, 60) + structureCount * 5;
    score = Math.min(specificityScore + 20, 100);
    reasoning =
      numberMatches.length > 3
        ? `Good specificity (${numberMatches.length} quantitative references).`
        : `Could be more specific. Add data points and named examples.`;
  } else {
    score = Math.min(
      (sourceCount * 8 + balanceCount * 10 + actionCount * 8 + structureCount * 5 + 20),
      100
    );
    reasoning = `Composite score based on general quality signals.`;
  }

  return {
    criterionId: criterion.id,
    criterionName: criterion.name,
    score: Math.round(score),
    maxScore: 100,
    reasoning,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Evaluate a completed brief against its skill's criteria.
 * Uses LLM scoring via sampling when available, heuristic fallback otherwise.
 */
export async function evaluateBrief(
  content: string,
  context: ExecutionContext,
  server?: Server
): Promise<EvalResult> {
  const skill = context.selectedSkill;
  if (!skill) {
    throw new Error("No skill in context — cannot evaluate.");
  }

  const scores: EvalScore[] = [];

  for (const criterion of skill.evalCriteria) {
    // Try LLM scoring first
    let llmResult: { score: number; reasoning: string } | null = null;
    if (server) {
      llmResult = await llmScoreCriterion(server, criterion, content);
    }

    if (llmResult) {
      scores.push({
        criterionId: criterion.id,
        criterionName: criterion.name,
        score: llmResult.score,
        maxScore: 100,
        reasoning: llmResult.reasoning,
      });
    } else {
      scores.push(heuristicScoreCriterion(criterion, content, context));
    }
  }

  // Weighted composite score
  const compositeScore = Math.round(
    skill.evalCriteria.reduce((sum, criterion, i) => {
      return sum + scores[i].score * criterion.weight;
    }, 0)
  );

  // Generate suggestions from low-scoring criteria
  const suggestions = scores
    .filter((s) => s.score < 60)
    .map((s) => `[${s.criterionName}] ${s.reasoning}`);

  return {
    skillId: skill.id,
    compositeScore,
    scores,
    suggestions:
      suggestions.length > 0
        ? suggestions
        : ["All criteria met minimum thresholds. Consider refining for excellence."],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format eval results for tool response output.
 */
export function formatEvalResult(result: EvalResult): string {
  const lines: string[] = [
    `## Evaluation Scorecard`,
    `**Skill:** ${result.skillId}`,
    `**Composite Score:** ${result.compositeScore}/100`,
    `**Evaluated:** ${result.timestamp}`,
    "",
    "### Per-Criterion Scores",
  ];

  for (const score of result.scores) {
    const bar = "█".repeat(Math.round(score.score / 10)) +
                "░".repeat(10 - Math.round(score.score / 10));
    lines.push(`${bar} ${score.score}/100 — **${score.criterionName}**`);
    lines.push(`  ${score.reasoning}`);
  }

  if (result.suggestions.length > 0) {
    lines.push("", "### Improvement Suggestions");
    for (const suggestion of result.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join("\n");
}

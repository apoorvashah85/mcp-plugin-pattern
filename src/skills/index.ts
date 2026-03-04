/**
 * Skill Registry
 *
 * This module mirrors the "skill auto-matching" behaviour of Anthropic's plugin
 * system. When a query comes in, the registry scores every skill against it
 * and returns ranked matches — exactly what Chorus does with its skill search.
 *
 * PLUGIN EQUIVALENT:
 *   Skills → skills/ directory with SKILL.md files
 *   Claude auto-triggers skills whose description matches the task context.
 *   Here, the MCP server performs the same matching server-side.
 */

import type { Skill } from "../types.js";
import { executiveBrief } from "./executive-brief.js";
import { competitiveIntel } from "./competitive-intel.js";
import { meetingPrep } from "./meeting-prep.js";
import { technicalAssessment } from "./technical-assessment.js";

// ── Registry ────────────────────────────────────────────────────────────

const skills: Skill[] = [
  executiveBrief,
  competitiveIntel,
  meetingPrep,
  technicalAssessment,
];

export interface SkillMatch {
  skill: Skill;
  relevanceScore: number; // 0-1
  matchedTags: string[];
  reasoning: string;
}

/**
 * Score a single skill against the query using tag overlap and
 * description keyword matching. This is intentionally a simple heuristic;
 * in Chorus, sampling would let the server ask the client LLM to do
 * semantic matching.
 */
function scoreSkill(skill: Skill, query: string): SkillMatch {
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/);

  // Tag matching — direct overlap
  const matchedTags = skill.tags.filter((tag) =>
    queryTokens.some(
      (token) => token.includes(tag) || tag.includes(token)
    )
  );
  const tagScore = matchedTags.length / skill.tags.length;

  // Description keyword matching
  const descTokens = skill.description.toLowerCase().split(/\s+/);
  const descOverlap = queryTokens.filter((t) =>
    descTokens.some((d) => d.includes(t) && t.length > 3)
  );
  const descScore =
    descOverlap.length > 0
      ? Math.min(descOverlap.length / queryTokens.length, 1)
      : 0;

  // Name matching bonus
  const nameBonus = skill.name
    .toLowerCase()
    .split(/\s+/)
    .some((w) => queryTokens.includes(w))
    ? 0.15
    : 0;

  const relevanceScore = Math.min(
    tagScore * 0.5 + descScore * 0.35 + nameBonus,
    1
  );

  const reasoning =
    matchedTags.length > 0
      ? `Matched tags: [${matchedTags.join(", ")}]. Description overlap: ${descOverlap.length} terms.`
      : `Low tag overlap. Description overlap: ${descOverlap.length} terms.`;

  return { skill, relevanceScore, matchedTags, reasoning };
}

/**
 * Search all skills and return ranked matches.
 *
 * This is the tool the agent calls first — analogous to how Chorus's
 * `chorus_skills` tool works.
 */
export function searchSkills(
  query: string,
  minScore = 0.05
): SkillMatch[] {
  return skills
    .map((s) => scoreSkill(s, query))
    .filter((m) => m.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Get a specific skill by ID.
 */
export function getSkill(id: string): Skill | undefined {
  return skills.find((s) => s.id === id);
}

/**
 * List all available skills (for browsing / discovery).
 */
export function listSkills(): Array<{
  id: string;
  name: string;
  description: string;
  curator: string;
  stepCount: number;
}> {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    curator: s.curator,
    stepCount: s.steps.length,
  }));
}

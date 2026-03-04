/**
 * Playbook Registry
 *
 * This module mirrors the "skill auto-matching" behaviour of Anthropic's plugin
 * system. When a query comes in, the registry scores every playbook against it
 * and returns ranked matches — exactly what Chorus does with its playbook search.
 *
 * PLUGIN EQUIVALENT:
 *   Skills → skills/ directory with SKILL.md files
 *   Claude auto-triggers skills whose description matches the task context.
 *   Here, the MCP server performs the same matching server-side.
 */

import type { Playbook } from "../types.js";
import { executiveBrief } from "./executive-brief.js";
import { competitiveIntel } from "./competitive-intel.js";
import { meetingPrep } from "./meeting-prep.js";
import { technicalAssessment } from "./technical-assessment.js";

// ── Registry ────────────────────────────────────────────────────────────

const playbooks: Playbook[] = [
  executiveBrief,
  competitiveIntel,
  meetingPrep,
  technicalAssessment,
];

export interface PlaybookMatch {
  playbook: Playbook;
  relevanceScore: number; // 0-1
  matchedTags: string[];
  reasoning: string;
}

/**
 * Score a single playbook against the query using tag overlap and
 * description keyword matching. This is intentionally a simple heuristic;
 * in Chorus, sampling would let the server ask the client LLM to do
 * semantic matching.
 */
function scorePlaybook(playbook: Playbook, query: string): PlaybookMatch {
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/);

  // Tag matching — direct overlap
  const matchedTags = playbook.tags.filter((tag) =>
    queryTokens.some(
      (token) => token.includes(tag) || tag.includes(token)
    )
  );
  const tagScore = matchedTags.length / playbook.tags.length;

  // Description keyword matching
  const descTokens = playbook.description.toLowerCase().split(/\s+/);
  const descOverlap = queryTokens.filter((t) =>
    descTokens.some((d) => d.includes(t) && t.length > 3)
  );
  const descScore =
    descOverlap.length > 0
      ? Math.min(descOverlap.length / queryTokens.length, 1)
      : 0;

  // Name matching bonus
  const nameBonus = playbook.name
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

  return { playbook, relevanceScore, matchedTags, reasoning };
}

/**
 * Search all playbooks and return ranked matches.
 *
 * This is the tool the agent calls first — analogous to how Chorus's
 * `chorus_playbooks` tool works.
 */
export function searchPlaybooks(
  query: string,
  minScore = 0.05
): PlaybookMatch[] {
  return playbooks
    .map((pb) => scorePlaybook(pb, query))
    .filter((m) => m.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Get a specific playbook by ID.
 */
export function getPlaybook(id: string): Playbook | undefined {
  return playbooks.find((pb) => pb.id === id);
}

/**
 * List all available playbooks (for browsing / discovery).
 */
export function listPlaybooks(): Array<{
  id: string;
  name: string;
  description: string;
  curator: string;
  stepCount: number;
}> {
  return playbooks.map((pb) => ({
    id: pb.id,
    name: pb.name,
    description: pb.description,
    curator: pb.curator,
    stepCount: pb.steps.length,
  }));
}

/**
 * Core types shared across the MCP plugin-patterns server.
 *
 * This server demonstrates how a remote MCP server can replicate the
 * capabilities that Anthropic's plugin system provides locally:
 *   - Skills    → Playbooks  (auto-matched methodology templates)
 *   - Hooks     → Hook engine (pre/post/stop quality gates)
 *   - Agents    → Sampling agent loop (server-side orchestration)
 *   - Evals     → Scoring engine (methodology-specific quality checks)
 */

// ── Playbook types ──────────────────────────────────────────────────────

export interface PlaybookStep {
  id: string;
  title: string;
  instruction: string;
  /** Which data-retrieval tools this step should invoke */
  suggestedTools?: string[];
  /** If true, the hook engine runs quality checks after this step */
  requiresValidation?: boolean;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  /** Domain tags used for relevance matching */
  tags: string[];
  /** Who curated this methodology */
  curator: string;
  version: string;
  steps: PlaybookStep[];
  /** Eval criteria specific to this playbook */
  evalCriteria: EvalCriterion[];
}

// ── Hook types ──────────────────────────────────────────────────────────

export type HookTiming = "pre" | "post" | "stop";

export type HookDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "modify"; modifications: string };

export interface HookInput {
  timing: HookTiming;
  /** The playbook step being checked, if applicable */
  stepId?: string;
  /** The content or context being validated */
  content: string;
  /** Full execution context for richer checks */
  context: ExecutionContext;
}

export interface HookResult {
  hookName: string;
  timing: HookTiming;
  decision: HookDecision;
  /** Diagnostic info for transparency */
  reasoning: string;
  durationMs: number;
}

// ── Sampling / Agent-loop types ─────────────────────────────────────────

export interface SamplingToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentLoopConfig {
  /** Maximum number of sampling round-trips */
  maxIterations: number;
  /** Model preference hints for the client */
  modelHints?: string[];
  intelligencePriority?: number;
  speedPriority?: number;
}

// ── Eval types ──────────────────────────────────────────────────────────

export interface EvalCriterion {
  id: string;
  name: string;
  description: string;
  /** Weight 0-1 in composite score */
  weight: number;
}

export interface EvalScore {
  criterionId: string;
  criterionName: string;
  score: number;        // 0-100
  maxScore: number;     // always 100
  reasoning: string;
}

export interface EvalResult {
  playbookId: string;
  compositeScore: number;
  scores: EvalScore[];
  suggestions: string[];
  timestamp: string;
}

// ── Execution context (threads through the whole pipeline) ──────────────

export interface ExecutionContext {
  sessionId: string;
  query: string;
  selectedPlaybook?: Playbook;
  /** Accumulated content from each completed step */
  stepOutputs: Map<string, string>;
  hookResults: HookResult[];
  /** Final assembled brief */
  draftContent?: string;
  evalResult?: EvalResult;
}

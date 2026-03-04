import type { Skill } from "../types.js";

export const executiveBrief: Skill = {
  id: "executive-brief",
  name: "Executive Briefing",
  description:
    "Produces a concise executive brief with situation analysis, key findings, strategic implications, and recommended actions. Optimised for C-suite and board audiences.",
  tags: [
    "executive", "leadership", "strategy", "briefing", "summary",
    "board", "c-suite", "decision", "overview"
  ],
  curator: "Strategy & Operations Working Group",
  version: "1.0.0",
  steps: [
    {
      id: "exec-1-scope",
      title: "Define scope and audience",
      instruction:
        "Identify the core question the executive needs answered. Determine the decision context: is this for information, approval, or action? Constrain the brief to a single decision frame.",
      requiresValidation: true,
    },
    {
      id: "exec-2-gather",
      title: "Gather key data points",
      instruction:
        "Search for 3-5 high-authority sources. Prioritise recent data (last 12 months), named sources, and quantitative evidence. Capture market size, competitive positioning, regulatory context, and financial impact where relevant.",
      suggestedTools: ["web_search", "document_search"],
      requiresValidation: true,
    },
    {
      id: "exec-3-analyse",
      title: "Synthesise findings",
      instruction:
        "Distil gathered data into 3-4 key findings. Each finding should be a single declarative sentence supported by evidence. Identify one primary tension or trade-off the executive must weigh.",
    },
    {
      id: "exec-4-implications",
      title: "Derive strategic implications",
      instruction:
        "Translate findings into 2-3 strategic implications. Frame each as 'Because [finding], the organisation should consider [implication].' Quantify impact where possible.",
    },
    {
      id: "exec-5-draft",
      title: "Draft the brief",
      instruction:
        "Assemble the brief in this structure: (1) Situation summary (2-3 sentences), (2) Key findings (bulleted), (3) Strategic implications, (4) Recommended next steps with owners and timelines. Total length: 400-600 words.",
      requiresValidation: true,
    },
  ],
  evalCriteria: [
    {
      id: "exec-eval-clarity",
      name: "Clarity & Conciseness",
      description: "Is the brief under 600 words with no jargon or ambiguity?",
      weight: 0.25,
    },
    {
      id: "exec-eval-evidence",
      name: "Evidence Quality",
      description: "Are claims backed by named, recent, quantitative sources?",
      weight: 0.30,
    },
    {
      id: "exec-eval-actionability",
      name: "Actionability",
      description: "Does the brief end with concrete next steps, owners, and timelines?",
      weight: 0.25,
    },
    {
      id: "exec-eval-balance",
      name: "Analytical Balance",
      description: "Does the brief present trade-offs rather than a single viewpoint?",
      weight: 0.20,
    },
  ],
};

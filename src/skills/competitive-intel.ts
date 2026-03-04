import type { Skill } from "../types.js";

export const competitiveIntel: Skill = {
  id: "competitive-intel",
  name: "Competitive Intelligence Brief",
  description:
    "Produces a structured competitive analysis covering market positioning, product comparison, SWOT, and strategic recommendations. Designed for product and strategy teams.",
  tags: [
    "competitive", "competitor", "market", "analysis", "comparison",
    "SWOT", "positioning", "landscape", "benchmark"
  ],
  curator: "Product Strategy Council",
  version: "1.0.0",
  steps: [
    {
      id: "ci-1-target",
      title: "Identify competitors and frame",
      instruction:
        "Determine the 2-4 most relevant competitors to analyse. Define the comparison dimensions: product features, pricing, market share, go-to-market strategy, and technology stack.",
      requiresValidation: true,
    },
    {
      id: "ci-2-research",
      title: "Gather competitive data",
      instruction:
        "For each competitor, collect: (a) recent product launches or feature updates, (b) pricing and packaging, (c) publicly reported revenue or funding, (d) key customer wins or losses, (e) technology or platform differentiators. Use earnings calls, press releases, product pages, and analyst reports.",
      suggestedTools: ["web_search", "document_search"],
      requiresValidation: true,
    },
    {
      id: "ci-3-matrix",
      title: "Build comparison matrix",
      instruction:
        "Create a structured comparison across the defined dimensions. Use a tabular format. Note where data is estimated vs confirmed. Highlight areas of clear advantage or disadvantage.",
    },
    {
      id: "ci-4-swot",
      title: "SWOT analysis",
      instruction:
        "For the user's organisation (or the primary subject), produce a SWOT analysis relative to the competitive set. Each quadrant should contain 2-3 specific, evidence-backed points.",
    },
    {
      id: "ci-5-draft",
      title: "Draft the brief",
      instruction:
        "Assemble the brief: (1) Competitive landscape overview, (2) Comparison matrix, (3) SWOT summary, (4) Strategic recommendations—what to defend, where to invest, and where to differentiate. Total length: 600-900 words.",
      requiresValidation: true,
    },
  ],
  evalCriteria: [
    {
      id: "ci-eval-coverage",
      name: "Competitor Coverage",
      description: "Are all relevant competitors addressed with current data?",
      weight: 0.25,
    },
    {
      id: "ci-eval-objectivity",
      name: "Objectivity",
      description: "Is the analysis balanced, noting both strengths and weaknesses?",
      weight: 0.25,
    },
    {
      id: "ci-eval-specificity",
      name: "Specificity",
      description: "Are claims grounded in specific data points, not generalities?",
      weight: 0.25,
    },
    {
      id: "ci-eval-strategic",
      name: "Strategic Insight",
      description: "Do recommendations follow logically from the analysis?",
      weight: 0.25,
    },
  ],
};

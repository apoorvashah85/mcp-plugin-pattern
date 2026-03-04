import type { Playbook } from "../types.js";

export const technicalAssessment: Playbook = {
  id: "technical-assessment",
  name: "Technical Assessment Brief",
  description:
    "Produces a structured technical evaluation of a technology, platform, or architecture. Covers capabilities, limitations, integration considerations, risk assessment, and suitability recommendations. Designed for engineering leadership and architecture review boards.",
  tags: [
    "technical", "assessment", "evaluation", "technology", "platform",
    "architecture", "engineering", "integration", "risk", "stack"
  ],
  curator: "Engineering Architecture Board",
  version: "1.0.0",
  steps: [
    {
      id: "ta-1-scope",
      title: "Define evaluation scope",
      instruction:
        "Clarify what is being evaluated and against what criteria. Define the use case, scale requirements, integration constraints, and non-negotiable requirements. Establish whether this is a build-vs-buy, migration, or greenfield assessment.",
      requiresValidation: true,
    },
    {
      id: "ta-2-capabilities",
      title: "Assess capabilities",
      instruction:
        "Research the technology's core capabilities: feature set, performance benchmarks, scalability characteristics, API surface, extensibility model, and ecosystem maturity. Use official documentation, benchmark reports, and community resources.",
      suggestedTools: ["web_search", "document_search"],
      requiresValidation: true,
    },
    {
      id: "ta-3-limitations",
      title: "Identify limitations and risks",
      instruction:
        "Document known limitations: performance ceilings, missing features, vendor lock-in risks, licensing constraints, security considerations, and operational complexity. Check CVE databases, community forums, and post-mortems from adopters.",
      suggestedTools: ["web_search"],
    },
    {
      id: "ta-4-integration",
      title: "Evaluate integration fit",
      instruction:
        "Assess how the technology integrates with the existing stack: API compatibility, data format support, authentication model, migration path, and operational requirements (monitoring, deployment, rollback).",
    },
    {
      id: "ta-5-draft",
      title: "Draft the brief",
      instruction:
        "Assemble the brief: (1) Assessment scope and context, (2) Capabilities summary with evidence, (3) Limitations and risk matrix (likelihood × impact), (4) Integration analysis, (5) Recommendation with conditions and next steps. Use a traffic-light (red/amber/green) rating for each major dimension. Total length: 700-1000 words.",
      requiresValidation: true,
    },
  ],
  evalCriteria: [
    {
      id: "ta-eval-accuracy",
      name: "Technical Accuracy",
      description: "Are technical claims verifiable and current?",
      weight: 0.30,
    },
    {
      id: "ta-eval-completeness",
      name: "Assessment Completeness",
      description: "Are capabilities, limitations, and risks all covered?",
      weight: 0.25,
    },
    {
      id: "ta-eval-practical",
      name: "Practical Applicability",
      description: "Is the assessment grounded in the specific use case, not generic?",
      weight: 0.25,
    },
    {
      id: "ta-eval-risk",
      name: "Risk Identification",
      description: "Are risks quantified with likelihood and impact?",
      weight: 0.20,
    },
  ],
};

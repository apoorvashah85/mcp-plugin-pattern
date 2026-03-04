import type { Playbook } from "../types.js";

export const meetingPrep: Playbook = {
  id: "meeting-prep",
  name: "Meeting Preparation Brief",
  description:
    "Produces a pre-meeting brief covering attendee backgrounds, agenda context, discussion points, potential objections, and recommended talking points. Designed for sales, partnerships, and leadership meetings.",
  tags: [
    "meeting", "preparation", "prep", "agenda", "stakeholder",
    "attendee", "talking points", "sales", "partnership"
  ],
  curator: "Business Development Practice",
  version: "1.0.0",
  steps: [
    {
      id: "mp-1-context",
      title: "Establish meeting context",
      instruction:
        "Identify the meeting purpose, attendees, and desired outcome. Classify the meeting type: informational, decision-making, negotiation, or relationship-building. Note any prior interactions or history.",
      requiresValidation: true,
    },
    {
      id: "mp-2-stakeholders",
      title: "Research attendees",
      instruction:
        "For each attendee, gather: current role and tenure, professional background, recent public statements or publications, known priorities or concerns, and decision-making authority. Use LinkedIn, company websites, and recent news.",
      suggestedTools: ["web_search"],
    },
    {
      id: "mp-3-landscape",
      title: "Map organisational context",
      instruction:
        "Identify the attendees' organisation's recent initiatives, strategic priorities, challenges, and any relevant news. Note partnerships, competitors, or market events that may shape the conversation.",
      suggestedTools: ["web_search"],
    },
    {
      id: "mp-4-strategy",
      title: "Develop discussion strategy",
      instruction:
        "Based on the research, develop: (a) 3-5 tailored discussion points, (b) anticipated objections or concerns with prepared responses, (c) questions to ask that demonstrate preparation, (d) clear ask or next-step proposal.",
      requiresValidation: true,
    },
    {
      id: "mp-5-draft",
      title: "Draft the brief",
      instruction:
        "Assemble the brief: (1) Meeting snapshot (purpose, attendees, desired outcome), (2) Attendee profiles (2-3 bullets each), (3) Organisational context, (4) Discussion strategy with talking points, (5) Prepared responses to objections, (6) Recommended ask. Total length: 500-800 words.",
      requiresValidation: true,
    },
  ],
  evalCriteria: [
    {
      id: "mp-eval-relevance",
      name: "Stakeholder Relevance",
      description: "Are attendee profiles tailored to this specific meeting context?",
      weight: 0.30,
    },
    {
      id: "mp-eval-preparation",
      name: "Preparation Depth",
      description: "Does the brief anticipate objections and prepare responses?",
      weight: 0.25,
    },
    {
      id: "mp-eval-actionability",
      name: "Actionability",
      description: "Are talking points specific enough to use directly?",
      weight: 0.25,
    },
    {
      id: "mp-eval-recency",
      name: "Information Recency",
      description: "Is attendee and organisational information current?",
      weight: 0.20,
    },
  ],
};

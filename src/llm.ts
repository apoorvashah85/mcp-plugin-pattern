/**
 * LLM Abstraction Layer
 *
 * Provides a unified interface for LLM calls across the server. Tries
 * three strategies in order:
 *
 *   1. MCP sampling/createMessage (SEP-1577) — no server-side keys needed,
 *      but requires client support. As of March 2026, no major MCP client
 *      (Claude Desktop, Claude Code, ChatGPT, Cursor) implements this yet.
 *
 *   2. Anthropic API fallback — if ANTHROPIC_API_KEY is set, calls the
 *      Claude API directly. This makes the demo fully functional today.
 *
 *   3. Simulation fallback — returns a descriptive placeholder. The rest
 *      of the pipeline (hooks, evals) still runs on the placeholder text.
 *
 * When MCP clients add sampling support, strategy 1 will activate
 * automatically with no code changes.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

// ── Lazy-loaded Anthropic client ────────────────────────────────────────

let anthropicClient: import("@anthropic-ai/sdk").default | null = null;

async function getAnthropicClient(): Promise<import("@anthropic-ai/sdk").default | null> {
  if (anthropicClient) return anthropicClient;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic();
    return anthropicClient;
  } catch {
    return null;
  }
}

// ── Response text extraction ────────────────────────────────────────────

function extractSamplingText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text")
      .map((block: Record<string, unknown>) => block.text as string)
      .join("\n\n");
  }
  if (content && typeof content === "object" && "type" in content) {
    const block = content as Record<string, unknown>;
    if (block.type === "text") return block.text as string;
  }
  return "";
}

// ── Public API ──────────────────────────────────────────────────────────

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  source: "sampling" | "anthropic-api" | "simulation";
}

/**
 * Send a prompt to an LLM using the best available strategy.
 *
 *   1. Try MCP sampling via server.createMessage()
 *   2. Try Anthropic API via ANTHROPIC_API_KEY
 *   3. Return simulation fallback
 */
export async function llmCall(
  request: LLMRequest,
  server?: Server,
  simulationFallback?: string
): Promise<LLMResponse> {
  const maxTokens = request.maxTokens ?? 2000;

  // ── Strategy 1: MCP sampling ────────────────────────────────────
  if (server) {
    try {
      const response = await server.createMessage({
        messages: [
          {
            role: "user",
            content: { type: "text", text: request.userMessage },
          },
        ],
        systemPrompt: request.systemPrompt,
        maxTokens,
      });

      const text = extractSamplingText(response.content);
      if (text) {
        return { text, source: "sampling" };
      }
    } catch {
      // Sampling not supported by client — try next strategy
    }
  }

  // ── Strategy 2: Anthropic API ───────────────────────────────────
  const client = await getAnthropicClient();
  if (client) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: request.systemPrompt,
        messages: [
          { role: "user", content: request.userMessage },
        ],
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.type === "text" ? b.text : "")
        .join("\n\n");

      if (text) {
        return { text, source: "anthropic-api" };
      }
    } catch {
      // API call failed — fall through to simulation
    }
  }

  // ── Strategy 3: Simulation fallback ─────────────────────────────
  return {
    text: simulationFallback ?? "[No LLM available. Set ANTHROPIC_API_KEY for API fallback, or use an MCP client that supports sampling.]",
    source: "simulation",
  };
}

/**
 * SuperCompress × Vercel AI SDK Integration
 *
 * A drop-in wrapper for Vercel's `wrapLanguageModel` and `generateText`/`streamText`
 * that automatically compresses conversation context before sending to any LLM.
 *
 * Works with any provider: OpenAI, Anthropic, Google, Mistral, etc.
 *
 * Installation:
 *   npm install ai @ai-sdk/openai supercompress
 *   # supercompress npm package coming soon; use the REST API directly for now
 *
 * Usage (Next.js App Router):
 *   import { SuperCompressAI } from "./integrations/vercel-ai-sdk";
 *   import { openai } from "@ai-sdk/openai";
 *
 *   const client = new SuperCompressAI({ budgetRatio: 0.35 });
 *
 *   const { text } = await client.generateText({
 *     model: openai("gpt-4o"),
 *     messages: [
 *       { role: "system", content: "You are a helpful assistant." },
 *       { role: "user", content: longContext },
 *       { role: "user", content: "What are the key findings?" },
 *     ],
 *   });
 *
 * How it works:
 *   1. Intercepts messages before they reach the LLM
 *   2. Compresses via SuperCompress API (POST /api/v1/compress)
 *   3. Forwards compressed context to Vercel AI SDK
 *   4. Returns the exact same response format
 */

interface CompressRequest {
  context: string;
  query: string;
  budget_ratio?: number;
}

interface CompressResponse {
  compressed_text: string;
  original_tokens: number;
  kept_tokens: number;
  tokens_saved_pct?: number;
  /** @deprecated Use tokens_saved_pct. */
  kv_savings_pct?: number;
  policy_name: string;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface SuperCompressAIOptions {
  budgetRatio?: number;
  apiKey?: string;
  baseUrl?: string;
  verbose?: boolean;
}

interface GenerateTextParams {
  model: any;
  messages: Message[];
  [key: string]: any;
}

interface StreamTextParams {
  model: any;
  messages: Message[];
  [key: string]: any;
}

export class SuperCompressAI {
  private apiKey: string;
  private baseUrl: string;
  private budgetRatio: number;
  private verbose: boolean;
  public totalOriginalTokens: number = 0;
  public totalKeptTokens: number = 0;

  constructor(options: SuperCompressAIOptions = {}) {
    this.apiKey = options.apiKey || process.env.SUPERCOMPRESS_API_KEY || "";
    this.baseUrl = options.baseUrl || "https://supercompress.dev";
    this.budgetRatio = options.budgetRatio ?? 0.35;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Compress messages before sending to the LLM.
   * Preserves system messages and the last user message.
   */
  async compressMessages(messages: Message[]): Promise<Message[]> {
    if (messages.length <= 2) return messages;

    const systemMsgs = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    if (nonSystem.length < 2) return messages;

    const lastMsg = nonSystem[nonSystem.length - 1];
    if (lastMsg.role !== "user") return messages;

    const history = nonSystem.slice(0, -1);
    const query = lastMsg.content;

    // Flatten history into context string
    const context = history
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");

    // Call SuperCompress API
    const compressed = await this.callAPI(context, query);

    if (!compressed) {
      // Fallback: return original messages if compression fails
      if (this.verbose) console.warn("SuperCompress: API call failed, using original context");
      return messages;
    }

    this.totalOriginalTokens += compressed.original_tokens;
    this.totalKeptTokens += compressed.kept_tokens;
    const tokensSavedPct =
      compressed.tokens_saved_pct ?? compressed.kv_savings_pct ?? 0;

    if (this.verbose) {
      console.log(
        `SuperCompress: ${compressed.original_tokens}→${compressed.kept_tokens} tok ` +
        `(${tokensSavedPct.toFixed(1)}% saved)`
      );
    }

    // Rebuild messages with compressed context
    const compressedContent = [
      `[SuperCompress: ${compressed.original_tokens}→${compressed.kept_tokens} tok, ${tokensSavedPct.toFixed(1)}% saved]`,
      "",
      compressed.compressed_text,
      "",
      "---",
      "",
      query,
    ].join("\n");

    return [...systemMsgs, { role: "user", content: compressedContent }];
  }

  /**
   * Call the SuperCompress REST API.
   */
  private async callAPI(
    context: string,
    query: string
  ): Promise<CompressResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/compress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({
          context,
          query,
          budget_ratio: this.budgetRatio,
        } as CompressRequest),
      });

      if (!response.ok) {
        if (this.verbose) {
          console.error(`SuperCompress API error: ${response.status} ${response.statusText}`);
        }
        return null;
      }

      return await response.json() as CompressResponse;
    } catch (error) {
      if (this.verbose) {
        console.error("SuperCompress API error:", error);
      }
      return null;
    }
  }

  /**
   * Generate text with automatic context compression.
   * Drop-in replacement for `generateText` from Vercel AI SDK.
   */
  async generateText(params: GenerateTextParams): Promise<{ text: string; [key: string]: any }> {
    const { messages, ...rest } = params;
    const compressedMessages = await this.compressMessages(messages);

    // Import dynamically to avoid requiring Vercel AI SDK as a dependency
    const { generateText } = await import("ai");
    return generateText({ ...rest, messages: compressedMessages });
  }

  /**
   * Stream text with automatic context compression.
   * Drop-in replacement for `streamText` from Vercel AI SDK.
   */
  async streamText(params: StreamTextParams): Promise<any> {
    const { messages, ...rest } = params;
    const compressedMessages = await this.compressMessages(messages);

    const { streamText } = await import("ai");
    return streamText({ ...rest, messages: compressedMessages });
  }

  /**
   * Get cumulative compression statistics.
   */
  getStats(): { totalOriginalTokens: number; totalKeptTokens: number; totalSavingsPct: number } {
    return {
      totalOriginalTokens: this.totalOriginalTokens,
      totalKeptTokens: this.totalKeptTokens,
      totalSavingsPct:
        this.totalOriginalTokens > 0
          ? (1 - this.totalKeptTokens / this.totalOriginalTokens) * 100
          : 0,
    };
  }
}

// ── Example: Next.js API Route ────────────────────────────────────

/*
// app/api/chat/route.ts
import { SuperCompressAI } from "@/integrations/vercel-ai-sdk";
import { openai } from "@ai-sdk/openai";

const sc = new SuperCompressAI({ budgetRatio: 0.35, verbose: true });

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await sc.streamText({
    model: openai("gpt-4o"),
    messages,
  });

  return result.toDataStreamResponse();
}
*/

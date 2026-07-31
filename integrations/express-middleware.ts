/**
 * SuperCompress Express / Next.js API Route Middleware
 *
 * Drop-in middleware for Express.js and Next.js API routes.
 * Automatically compresses request context before forwarding to any LLM.
 *
 * Installation:
 *   npm install express @types/express
 *   # or for Next.js: included out of the box
 *
 * Usage (Express):
 *   import express from "express";
 *   import { supercompressMiddleware } from "./integrations/express-middleware";
 *
 *   const app = express();
 *   app.post("/api/chat", supercompressMiddleware(), async (req, res) => {
 *     // req.body.messages are already compressed!
 *     const response = await callLLM(req.body.messages);
 *     res.json(response);
 *   });
 *
 * Usage (Next.js App Router):
 *   // app/api/chat/route.ts
 *   import { supercompressMiddleware } from "@/integrations/express-middleware";
 *
 *   export async function POST(req: Request) {
 *     const body = await req.json();
 *     const compressed = await supercompressMiddleware().compressMessages(body.messages);
 *     // Forward compressed messages to your LLM
 *   }
 */

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompressRequest {
  context: string;
  query: string;
  budget_ratio?: number;
}

interface CompressResponse {
  compressed_text: string;
  original_tokens: number;
  kept_tokens: number;
  kv_savings_pct: number;
  policy_name: string;
}

interface MiddlewareOptions {
  budgetRatio?: number;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Field name in the request body that contains messages.
   * Default: "messages"
   */
  messageField?: string;
  verbose?: boolean;
}

interface MiddlewareInstance {
  compressMessages: (messages: Message[]) => Promise<Message[]>;
  getStats: () => {
    totalOriginalTokens: number;
    totalKeptTokens: number;
    totalSavingsPct: number;
  };
  /** Express middleware handler */
  handler: (req: any, res: any, next: any) => Promise<void>;
}

/**
 * Create SuperCompress middleware for Express / Next.js.
 *
 * @param options - Configuration options
 * @returns Middleware instance with handler and utilities
 */
export function supercompressMiddleware(
  options: MiddlewareOptions = {}
): MiddlewareInstance {
  const apiKey = options.apiKey || process.env.SUPERCOMPRESS_API_KEY || "";
  const baseUrl = options.baseUrl || "https://supercompress.dev";
  const budgetRatio = options.budgetRatio ?? 0.35;
  const messageField = options.messageField || "messages";
  const verbose = options.verbose ?? false;

  let totalOriginalTokens = 0;
  let totalKeptTokens = 0;

  /**
   * Compress an array of messages.
   */
  async function compressMessages(
    messages: Message[]
  ): Promise<Message[]> {
    if (messages.length <= 2) return messages;

    const systemMsgs = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    if (nonSystem.length < 2) return messages;

    const lastMsg = nonSystem[nonSystem.length - 1];
    if (lastMsg.role !== "user") return messages;

    const history = nonSystem.slice(0, -1);
    const query = lastMsg.content;

    // Flatten history into context
    const context = history
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");

    // Call SuperCompress API
    try {
      const response = await fetch(`${baseUrl}/api/v1/compress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          context,
          query,
          budget_ratio: budgetRatio,
        } as CompressRequest),
      });

      if (!response.ok) {
        if (verbose) {
          console.error(
            `SuperCompress API error: ${response.status} ${response.statusText}`
          );
        }
        return messages;
      }

      const compressed = (await response.json()) as CompressResponse;

      totalOriginalTokens += compressed.original_tokens;
      totalKeptTokens += compressed.kept_tokens;

      if (verbose) {
        console.log(
          `SuperCompress: ${compressed.original_tokens}→${compressed.kept_tokens} tok ` +
          `(${compressed.kv_savings_pct.toFixed(1)}%% saved)`
        );
      }

      // Rebuild messages
      const compressedContent = [
        `[SuperCompress: ${compressed.original_tokens}→${compressed.kept_tokens} tok, ${compressed.kv_savings_pct.toFixed(1)}%% saved]`,
        "",
        compressed.compressed_text,
        "",
        "---",
        "",
        query,
      ].join("\n");

      return [...systemMsgs, { role: "user", content: compressedContent }];
    } catch (error) {
      if (verbose) {
        console.error("SuperCompress API error:", error);
      }
      return messages;
    }
  }

  /**
   * Express middleware handler.
   * Compresses messages in the request body and calls next().
   */
  async function handler(req: any, res: any, next: any): Promise<void> {
    if (req.body && req.body[messageField]) {
      req.body[messageField] = await compressMessages(req.body[messageField]);
    }
    next();
  }

  return {
    compressMessages,
    getStats: () => ({
      totalOriginalTokens,
      totalKeptTokens,
      totalSavingsPct:
        totalOriginalTokens > 0
          ? (1 - totalKeptTokens / totalOriginalTokens) * 100
          : 0,
    }),
    handler,
  };
}

// ── Example: Express App ──────────────────────────────────────────

/*
import express from "express";
import { supercompressMiddleware } from "./integrations/express-middleware";

const app = express();
app.use(express.json());

const sc = supercompressMiddleware({
  budgetRatio: 0.35,
  verbose: true,
});

app.post("/api/chat", sc.handler, async (req, res) => {
  // req.body.messages are now compressed!
  // Forward to your LLM of choice
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: req.body.messages,
    }),
  });

  const data = await response.json();
  res.json(data);
});

app.listen(3000, () => console.log("Server running on port 3000"));
*/

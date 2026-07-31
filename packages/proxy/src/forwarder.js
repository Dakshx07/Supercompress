/**
 * Forwarder — forwards compressed messages to the real LLM provider.
 *
 * Supports:
 *   - OpenAI (POST /v1/chat/completions) — streaming + non-streaming
 *   - Anthropic (POST /v1/messages) — streaming + non-streaming
 *
 * The user's original API key for the provider is extracted from the
 * Authorization header passed from the server route handler.
 */

const fetch = require("node-fetch");

const OPENAI_BASE = process.env.SUPERCOMPRESS_OPENAI_BASE || "https://api.openai.com/v1";
const ANTHROPIC_BASE = process.env.SUPERCOMPRESS_ANTHROPIC_BASE || "https://api.anthropic.com";

/**
 * Extract Bearer token from an Authorization header string.
 */
function extractBearer(authorization) {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractProviderKey(authorization, apiKeyHeader) {
  return extractBearer(authorization) || apiKeyHeader || null;
}

/**
 * Try to parse a provider error response into a human-readable message.
 * Falls back to raw text if JSON parsing fails.
 */
function parseProviderError(status, body) {
  try {
    const errJson = JSON.parse(body);
    return errJson.error?.message || errJson.error || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function shouldFallbackResponses(status, body) {
  // Some OpenAI-compatible gateways strip the JSON error body. A 401 on the
  // Responses endpoint is still safe to retry through Chat Completions: an
  // invalid key will fail there with the provider's actual auth error.
  return status === 401 || (status === 403 && /api\.responses\.write|responses.*scope|responses.*permission|missing scope/i.test(body || ""));
}

/**
 * Build the OpenAI-style streaming response for a chunk.
 * Accepts an optional extraFields object to merge into the chunk data.
 */
function openaiStreamChunk(id, model, content, finishReason, created, extraFields) {
  const data = {
    id,
    object: "chat.completion.chunk",
    created: created || Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: content ? { content } : {},
      finish_reason: finishReason || null,
    }],
    ...extraFields,
  };
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Set SSE headers on the response.
 */
function setSSEHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

/**
 * Forward to OpenAI chat completions — supports streaming.
 */
async function forwardChat(model, compressed, extraParams, res, authHeader) {
  const apiKey = extractBearer(authHeader);

  if (!apiKey) {
    throw new Error("No provider API key found in Authorization header. Login-only subscription sessions are not supported by this local proxy; use the provider's API-key mode.");
  }

  const isStream = extraParams.stream === true || extraParams.stream === "true";

  const body = {
    model,
    messages: compressed.messages,
    ...extraParams,
    stream: isStream,
  };

  // Build supercompress metadata once
  const scMeta = {
    _supercompress: {
      original_tokens: compressed.original_tokens,
      compressed_tokens: compressed.compressed_tokens,
      tokens_saved: compressed.tokens_saved,
      savings_pct: compressed.savings_pct,
    },
  };

  if (isStream) {
    // ── Streaming mode ──
    // Set SSE headers before the fetch so they're set even on error
    setSSEHeaders(res);

    const apiResponse = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text().catch(() => "");
      const msg = parseProviderError(apiResponse.status, errorBody);
      // Send error as an SSE event so the client can parse it
      res.write(`data: ${JSON.stringify({ error: { message: msg, type: "provider_error" } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!apiResponse.body) {
      throw new Error("Provider returned no response body stream");
    }

    // Track whether we've sent the first chunk (to attach metadata)
    let firstChunkSent = false;
    const streamId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = Math.floor(Date.now() / 1000);

    apiResponse.body.on("data", (chunk) => {
      const text = chunk.toString();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content || "";
            const finishReason = parsed.choices?.[0]?.finish_reason || null;

            // Attach _supercompress metadata to the first chunk only
            const extra = firstChunkSent ? undefined : scMeta;
            res.write(openaiStreamChunk(streamId, model, delta, finishReason, created, extra));
            firstChunkSent = true;
          } catch {}
        }
      }
    });

    apiResponse.body.on("end", () => {
      res.write("data: [DONE]\n\n");
      res.end();
    });

    apiResponse.body.on("error", (err) => {
      console.error("[supercompress] Stream error:", err.message);
      res.end();
    });

    return;
  }

  // ── Non-streaming mode ──
  const apiResponse = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text().catch(() => "");
    throw new Error(`Provider error (${apiResponse.status}): ${parseProviderError(apiResponse.status, errorBody)}`);
  }

  const data = await apiResponse.json();

  // Preserve the provider response verbatim. Coding agents rely on fields
  // beyond plain text, including tool_calls, function_call, logprobs, and
  // provider-specific usage details.
  res.json({ ...data, ...scMeta });
}

/**
 * Build Anthropic SSE event string.
 */
function anthropicSSE(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Forward to Anthropic messages API — supports streaming.
 */
async function forwardAnthropic(model, compressed, system, extraParams, res, authHeader, apiKeyHeader) {
  const apiKey = extractProviderKey(authHeader, apiKeyHeader);

  if (!apiKey) {
    throw new Error("No provider API key found in Authorization header. Login-only subscription sessions are not supported by this local proxy; use the provider's API-key mode.");
  }

  const isStream = extraParams.stream === true || extraParams.stream === "true";

  const compressedMessages = compressed.messages || [];

  let systemContent = system || "";
  let userMessages = [];

  for (const msg of compressedMessages) {
    if (msg.role === "system") {
      systemContent = (systemContent ? systemContent + "\n\n" : "") + msg.content;
    } else if (msg.role === "user") {
      userMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      userMessages.push({ role: "assistant", content: msg.content });
    }
  }

  const body = {
    model,
    messages: userMessages.length > 0 ? userMessages : [{ role: "user", content: "Continue." }],
    ...extraParams,
  };

  if (systemContent) {
    body.system = systemContent;
  }

  const apiResponse = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text().catch(() => "");
    throw new Error(`Anthropic error (${apiResponse.status}): ${parseProviderError(apiResponse.status, errorBody)}`);
  }

  if (isStream) {
    // ── Streaming mode ──
    setSSEHeaders(res);

    if (!apiResponse.body) {
      throw new Error("Anthropic returned no response body stream");
    }

    // Send supercompress metadata as a custom event (Anthropic SSE format)
    res.write(anthropicSSE("supercompress", {
      original_tokens: compressed.original_tokens,
      compressed_tokens: compressed.compressed_tokens,
      tokens_saved: compressed.tokens_saved,
      savings_pct: compressed.savings_pct,
    }));

    // Pipe Anthropic SSE stream through
    apiResponse.body.on("data", (chunk) => {
      const text = chunk.toString();
      // Anthropic sends SSE events like:
      // event: content_block_delta\n
      // data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}\n\n
      res.write(text);
    });

    apiResponse.body.on("end", () => {
      res.end();
    });

    apiResponse.body.on("error", (err) => {
      console.error("[supercompress] Anthropic stream error:", err.message);
      res.end();
    });

    return;
  }

  // ── Non-streaming mode ──
  const data = await apiResponse.json();

  res.json({
    id: data.id,
    type: "message",
    role: "assistant",
    content: data.content,
    model: data.model,
    stop_reason: data.stop_reason,
    stop_sequence: data.stop_sequence,
    usage: data.usage,
    _supercompress: {
      original_tokens: compressed.original_tokens,
      compressed_tokens: compressed.compressed_tokens,
      tokens_saved: compressed.tokens_saved,
      savings_pct: compressed.savings_pct,
    },
  });
}

function responseContentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    return part.text || part.content || part.input_text || part.output_text || "";
  }).filter(Boolean).join("\n");
}

function responsesInputToMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [{ role: "user", content: JSON.stringify(input) }];

  const messages = input.filter(Boolean).map((item) => {
    if (typeof item === "string") return { role: "user", content: item };
    return {
      role: item.role || "user",
      content: responseContentToText(item.content ?? item.text ?? item.input_text ?? item.output_text ?? item),
    };
  });
  return messages.length ? messages : [{ role: "user", content: "" }];
}

function messagesToResponsesInput(messages) {
  return (messages || []).map((message) => ({
    role: message.role === "system" ? "developer" : message.role,
    content: responseContentToText(message.content),
  }));
}

function responsesToChatBody(model, compressed, extraParams, isStream) {
  const messages = messagesToResponsesInput(compressed.messages);
  const instructions = responseContentToText(extraParams.instructions);
  if (instructions) messages.unshift({ role: "system", content: instructions });

  const body = {
    model,
    messages,
    stream: isStream,
  };

  // Preserve the provider fields that Chat Completions and Responses share.
  for (const key of ["temperature", "top_p", "tools", "tool_choice", "parallel_tool_calls", "user", "metadata", "store"]) {
    if (extraParams[key] !== undefined) body[key] = extraParams[key];
  }
  if (extraParams.max_output_tokens !== undefined) body.max_tokens = extraParams.max_output_tokens;
  if (extraParams.max_tokens !== undefined) body.max_tokens = extraParams.max_tokens;
  return body;
}

function responsesFallbackObject(data, model) {
  const message = data.choices?.[0]?.message || { role: "assistant", content: "" };
  const text = responseContentToText(message.content);
  const output = [{
    id: `msg_${Date.now().toString(36)}`,
    type: "message",
    status: "completed",
    role: message.role || "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  }];
  return {
    id: data.id || `resp_${Date.now().toString(36)}`,
    object: "response",
    created_at: data.created || Math.floor(Date.now() / 1000),
    status: "completed",
    model: data.model || model,
    output,
    output_text: text,
    usage: data.usage || null,
  };
}

async function forwardResponsesViaChat(model, compressed, extraParams, res, apiKey, providerError) {
  const isStream = extraParams.stream === true || extraParams.stream === "true";
  const body = responsesToChatBody(model, compressed, extraParams, isStream);
  console.error(`[supercompress] Responses permission unavailable; using Chat Completions compatibility fallback (${providerError.slice(0, 160)})`);

  const apiResponse = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text().catch(() => "");
    throw new Error(`OpenAI Chat Completions fallback error (${apiResponse.status}): ${parseProviderError(apiResponse.status, errorBody)}`);
  }

  if (!isStream) {
    const data = await apiResponse.json();
    res.json({
      ...responsesFallbackObject(data, model),
      _supercompress: {
        original_tokens: compressed.original_tokens,
        compressed_tokens: compressed.compressed_tokens,
        tokens_saved: compressed.tokens_saved,
        savings_pct: compressed.savings_pct,
      },
    });
    return;
  }

  setSSEHeaders(res);
  const responseId = `resp_${Date.now().toString(36)}`;
  const messageId = `msg_${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const writeEvent = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  writeEvent("response.created", { type: "response.created", response: { id: responseId, object: "response", status: "in_progress", model } });
  writeEvent("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { id: messageId, type: "message", status: "in_progress", role: "assistant", content: [] } });
  writeEvent("response.content_part.added", { type: "response.content_part.added", item_id: messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });

  let fullText = "";
  let buffer = "";
  apiResponse.body.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (!delta) continue;
        fullText += delta;
        writeEvent("response.output_text.delta", { type: "response.output_text.delta", item_id: messageId, output_index: 0, content_index: 0, delta, sequence_number: fullText.length });
      } catch {}
    }
  });
  apiResponse.body.on("end", () => {
    writeEvent("response.output_text.done", { type: "response.output_text.done", item_id: messageId, output_index: 0, content_index: 0, text: fullText });
    writeEvent("response.content_part.done", { type: "response.content_part.done", item_id: messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: fullText, annotations: [] } });
    writeEvent("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { id: messageId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText, annotations: [] }] } });
    writeEvent("response.completed", { type: "response.completed", response: { id: responseId, object: "response", status: "completed", created_at: created, model, output_text: fullText } });
    res.end();
  });
  apiResponse.body.on("error", (err) => {
    console.error("[supercompress] Responses compatibility stream error:", err.message);
    res.end();
  });
}

async function forwardResponses(model, compressed, extraParams, res, authHeader) {
  const apiKey = extractBearer(authHeader);
  if (!apiKey) throw new Error("No provider API key found in Authorization header. Login-only subscription sessions are not supported by this local proxy; use the provider's API-key mode.");

  const isStream = extraParams.stream === true || extraParams.stream === "true";
  const body = {
    ...extraParams,
    model,
    input: messagesToResponsesInput(compressed.messages),
    stream: isStream,
  };
  const apiResponse = await fetch(`${OPENAI_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text().catch(() => "");
    if (shouldFallbackResponses(apiResponse.status, errorBody)) {
      await forwardResponsesViaChat(model, compressed, extraParams, res, apiKey, parseProviderError(apiResponse.status, errorBody));
      return;
    }
    throw new Error(`OpenAI Responses error (${apiResponse.status}): ${parseProviderError(apiResponse.status, errorBody)}`);
  }

  if (isStream) {
    setSSEHeaders(res);
    apiResponse.body.pipe(res);
    return;
  }

  const data = await apiResponse.json();
  res.json({
    ...data,
    _supercompress: {
      original_tokens: compressed.original_tokens,
      compressed_tokens: compressed.compressed_tokens,
      tokens_saved: compressed.tokens_saved,
      savings_pct: compressed.savings_pct,
    },
  });
}

module.exports = {
  forwardChat,
  forwardAnthropic,
  forwardResponses,
  responsesInputToMessages,
  extractBearer,
};

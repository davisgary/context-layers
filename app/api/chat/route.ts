import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  buildLayeredPrompt,
  loadLayerContext,
  type LayerPathInput,
} from "@/lib/layer-context";
import { loadUrlContext, type UrlContextInput } from "@/lib/url-context";

type ChatSource = "openai" | "claude" | "ollama";

type StreamWriter = (chunk: string) => void;

const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000;
const RESPONSE_CACHE_MAX = 100;
const responseCache = new Map<
  string,
  { answer: string; expiresAt: number }
>();

function buildResponseCacheKey(
  source: ChatSource,
  model: string,
  query: string,
  layers?: LayerPathInput[],
  urls?: UrlContextInput[],
  notes?: Array<{ id: string; title?: string; body?: string; label?: string }>
): string {
  const layerKey = layers?.map((layer) => ({
    path: layer.path,
    label: layer.label,
  }));
  const urlKey = urls?.map((url) => ({
    url: url.url,
    label: url.label,
  }));
  const noteKey = notes?.map((n) => ({ id: n.id, title: n.title, body: n.body, label: n.label }));
  return JSON.stringify({
    source,
    model,
    query,
    layers: layerKey || [],
    urls: urlKey || [],
    notes: noteKey || [],
  });
}

function parseNoteInputs(input: unknown): Array<{ id: string; title?: string; body?: string; label?: string }> | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error("`notes` must be an array when provided.");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`notes[${index}] must be an object.`);
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : `note-${index}`;
    const title = typeof rec.title === "string" ? rec.title : undefined;
    const body = typeof rec.body === "string" ? rec.body : undefined;
    const label = typeof rec.label === "string" ? rec.label : undefined;
    return { id, title, body, label };
  });
}

function getCachedAnswer(cacheKey: string): string | null {
  const cached = responseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    responseCache.delete(cacheKey);
    return null;
  }
  return cached.answer;
}

function setCachedAnswer(cacheKey: string, answer: string): void {
  responseCache.set(cacheKey, {
    answer,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });

  if (responseCache.size > RESPONSE_CACHE_MAX) {
    const oldestKey = responseCache.keys().next().value as string | undefined;
    if (oldestKey) {
      responseCache.delete(oldestKey);
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: unknown;
      layers?: unknown;
      urls?: unknown;
      notes?: unknown;
      source?: unknown;
      model?: unknown;
      stream?: unknown;
    };
    const query = typeof body.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json(
          {
            error:
              "Expected body: { query: string, source?: 'openai' | 'claude' | 'ollama', model: string, layers?: Array<{ path: string, label?: string }>, urls?: Array<{ url: string, label?: string }> }",
          },
          { status: 400 }
        );
    }

    const source = parseSource(body.source);
    const model = parseRequiredModel(body.model);
  const layerInputs = parseLayerInputs(body.layers);
  const urlInputs = parseUrlInputs(body.urls);
  const noteInputs = parseNoteInputs(body.notes);
    const acceptHeader = request.headers.get("accept") || "";
    const wantsStream =
      body.stream !== false &&
      !acceptHeader.includes("application/json") &&
      (body.stream === true || acceptHeader.includes("text/event-stream") || !body.stream);
    const cacheKey = buildResponseCacheKey(
      source,
      model,
      query,
      layerInputs,
      urlInputs,
      noteInputs
    );
    const cachedAnswer = getCachedAnswer(cacheKey);
    if (cachedAnswer) {
      if (!wantsStream) {
        return NextResponse.json({ answer: cachedAnswer, source, model });
      }

      const stream = new ReadableStream({
        async start(controller) {
          await streamCachedAnswer(cachedAnswer, controller);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const [layerContexts, urlContexts] = await Promise.all([
      loadLayerContext(layerInputs),
      loadUrlContext(urlInputs),
    ]);

    const noteContexts = (noteInputs || [])
      .filter((n) => typeof n.body === "string" && n.body.trim().length > 0)
      .map((n) => ({ name: n.label || n.title || "Note", content: (n.body || "").trim() }));
    const contexts = [...layerContexts, ...urlContexts, ...noteContexts];
    const prompt = buildLayeredPrompt(query, contexts);
    if (!wantsStream) {
      const answer = await generateAnswer(source, prompt, model);

      let finalAnswer = answer;

      if (!finalAnswer) {
        return NextResponse.json(
          { error: "Model returned an empty response." },
          { status: 502 }
        );
      }

  // Normalize Markdown while avoiding table pipes and math notation.
  finalAnswer = normalizeMarkdownSpacing(finalAnswer);
      setCachedAnswer(cacheKey, finalAnswer);

      return NextResponse.json({ answer: finalAnswer, source, model });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let collected = "";

        const write: StreamWriter = (chunk) => {
          if (!chunk) return;
          const sanitized = sanitizeStreamingChunk(chunk);
          collected += sanitized;
          const payload = JSON.stringify({ delta: sanitized });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        try {
          await streamAnswer(source, prompt, model, write);
          const normalized = normalizeMarkdownSpacing(collected);
          if (normalized) {
            setCachedAnswer(cacheKey, normalized);
          }
          const donePayload = JSON.stringify({ done: true });
          controller.enqueue(encoder.encode(`data: ${donePayload}\n\n`));
        } catch (streamError) {
          const message =
            streamError instanceof Error
              ? streamError.message
              : "Unexpected server error.";
          const errorPayload = JSON.stringify({ error: message });
          controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function streamCachedAnswer(
  answer: string,
  controller: ReadableStreamDefaultController
): Promise<void> {
  const encoder = new TextEncoder();
  const chunkSize = 64;

  for (let index = 0; index < answer.length; index += chunkSize) {
    const chunk = answer.slice(index, index + chunkSize);
    const payload = JSON.stringify({ delta: chunk });
    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const donePayload = JSON.stringify({ done: true });
  controller.enqueue(encoder.encode(`data: ${donePayload}\n\n`));
  controller.close();
}

// Normalize Markdown spacing for readability while avoiding changes inside fenced code blocks.
function normalizeMarkdownSpacing(md: string): string {
  if (!md) return md;
  // Unwrap fenced blocks that are actually markdown content so they render correctly.
  md = unwrapMarkdownCodeBlocks(md);
  // Split on fenced code blocks so we don't alter their contents.
  const parts = md.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i++) {
    // Only transform outside code blocks (even indices)
    if (i % 2 === 0) {
      let text = parts[i];
      // Normalize markdown tables so rows are contiguous and on their own lines.
      const lines = text.split("\n");
      const normalizedLines: string[] = [];
      let inTable = false;

      for (const line of lines) {
        const trimmed = line.trimEnd();
        const isTableLine = trimmed.trim().startsWith("|") && trimmed.includes("|");

        if (isTableLine) {
          if (
            !inTable &&
            normalizedLines.length > 0 &&
            normalizedLines[normalizedLines.length - 1].trim() !== ""
          ) {
            normalizedLines.push("");
          }
          inTable = true;

          // If multiple rows were jammed into one line, split them.
          const splitRows = trimmed
            .replace(/\|\s*\|\s*(?=\S)/g, "|\n| ")
            .replace(/\s+\|\s*(:?-{3,}|:{1,2}-{3,}:{0,1})/g, "\n| $1")
            .split("\n");
          for (const row of splitRows) {
            let cleanedRow = row.trimEnd();
            const separatorMatch = cleanedRow.match(/\|\s*:?-{3,}/);
            if (separatorMatch?.index && separatorMatch.index > 0) {
              const before = cleanedRow.slice(0, separatorMatch.index).trimEnd();
              const after = cleanedRow.slice(separatorMatch.index).trimStart();
              if (before.replace(/[\s|]/g, "").length > 0) {
                normalizedLines.push(before);
                normalizedLines.push(after);
                continue;
              }
            }
            if (cleanedRow.trim().startsWith("|")) {
              const parts = cleanedRow.split("|");
              const cells = parts
                .slice(1, parts.length - 1)
                .map((cell) => cell.trim());
              if (cells.length > 0) {
                const isSeparatorRow = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
                if (isSeparatorRow) {
                  cleanedRow = `| ${cells.map(() => "---").join(" | ")} |`;
                } else {
                  cleanedRow = `| ${cells.join(" | ")} |`;
                }
              }
            }
            normalizedLines.push(cleanedRow);
          }
          continue;
        }

        if (inTable) {
          if (trimmed.trim() === "") {
            // Drop blank lines inside table blocks.
            continue;
          }
          // End of table; ensure a blank line after it.
          if (
            normalizedLines.length > 0 &&
            normalizedLines[normalizedLines.length - 1].trim() !== ""
          ) {
            normalizedLines.push("");
          }
          inTable = false;
        }

        normalizedLines.push(trimmed);
      }

      if (
        inTable &&
        normalizedLines.length > 0 &&
        normalizedLines[normalizedLines.length - 1].trim() !== ""
      ) {
        normalizedLines.push("");
      }

      text = normalizedLines.join("\n");
      // Ensure at least one blank line before any heading (if not start of document)
      text = text.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
      // Ensure a blank line after each heading
      text = text.replace(/(#{1,6}[^\n]*)\n(?!\n|$)/g, "$1\n\n");
      // Collapse 3+ newlines into exactly two for consistent paragraph spacing
      text = text.replace(/\n{3,}/g, "\n\n");
      // Strip math notation delimiters while keeping content.
      text = text.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
      text = text.replace(/\$([^$\n]+)\$/g, "$1");
      text = text.replace(/\\rightarrow/g, "→");
      text = text.replace(/\$/g, "");
      parts[i] = text;
    }
  }
  return parts.join("");
}

function unwrapMarkdownCodeBlocks(input: string): string {
  return input.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, body) => {
    const language = typeof lang === "string" ? lang.toLowerCase() : "";
    if (language && language !== "md" && language !== "markdown") {
      return match;
    }
    const trimmedBody = body.trim();
    const looksLikeMarkdown = /^(#{1,6}\s|\*\s|\-\s|\d+\.\s)/m.test(trimmedBody);
    if (!looksLikeMarkdown) {
      return match;
    }
    return trimmedBody;
  });
}

function sanitizeStreamingChunk(chunk: string): string {
  let text = chunk;
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  text = text.replace(/\$([^$\n]+)\$/g, "$1");
  text = text.replace(/\\rightarrow/g, "→");
  text = text.replace(/\$/g, "");
  return text;
}

function parseSource(input: unknown): ChatSource {
  if (input === undefined) {
    return "openai";
  }

  if (input === "openai" || input === "claude" || input === "ollama") {
    return input;
  }

  throw new Error(
    "`source` must be one of: openai, claude, ollama-gemma, local-llm."
  );
}

function parseLayerInputs(input: unknown): LayerPathInput[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new Error("`layers` must be an array when provided.");
  }

  return input.map((layer, index) => {
    if (!layer || typeof layer !== "object") {
      throw new Error(`layers[${index}] must be an object.`);
    }

    const layerRecord = layer as Record<string, unknown>;
    const layerPath = layerRecord.path;
    const layerLabel = layerRecord.label;

    if (typeof layerPath !== "string" || layerPath.trim().length === 0) {
      throw new Error(`layers[${index}].path must be a non-empty string.`);
    }

    if (layerLabel !== undefined && typeof layerLabel !== "string") {
      throw new Error(`layers[${index}].label must be a string when provided.`);
    }

    return {
      path: layerPath.trim(),
      label: typeof layerLabel === "string" ? layerLabel.trim() : undefined,
    };
  });
}

function parseUrlInputs(input: unknown): UrlContextInput[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new Error("`urls` must be an array when provided.");
  }

  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`urls[${index}] must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const url = record.url;
    const label = record.label;

    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error(`urls[${index}].url must be a non-empty string.`);
    }

    if (label !== undefined && typeof label !== "string") {
      throw new Error(`urls[${index}].label must be a string when provided.`);
    }

    return {
      url: url.trim(),
      label: typeof label === "string" ? label.trim() : undefined,
    };
  });
}

function parseRequiredModel(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("`model` is required and must be a string.");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("`model` cannot be empty.");
  }
  return trimmed;
}

async function generateAnswer(
  source: ChatSource,
  prompt: string,
  model: string
): Promise<string> {
  if (source === "openai") {
    return generateWithOpenAI(prompt, model);
  }
  if (source === "claude") {
    return generateWithClaude(prompt, model);
  }
  if (source === "ollama") {
    return generateWithOllama(prompt, model);
  }

  // Fallback to Ollama-compatible endpoint for any unknown source.
  return generateWithOllama(prompt, model);
}

async function streamAnswer(
  source: ChatSource,
  prompt: string,
  model: string,
  write: StreamWriter
): Promise<void> {
  if (source === "openai") {
    await streamWithOpenAI(prompt, model, write);
    return;
  }
  if (source === "claude") {
    await streamWithClaude(prompt, model, write);
    return;
  }
  if (source === "ollama") {
    await streamWithOllama(prompt, model, write);
    return;
  }

  const fallback = await generateWithOllama(prompt, model);
  if (fallback) {
    write(fallback);
  }
}

async function streamWithOpenAI(
  prompt: string,
  model: string,
  write: StreamWriter
): Promise<void> {
  const { getOpenAIClient } = await import("@/lib/openai-client");
  const client = getOpenAIClient();
  const stream = await client.responses.stream({ model, input: prompt });
  let sawDelta = false;

  for await (const event of stream) {
    if (event?.type === "response.output_text.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta) {
        sawDelta = true;
        write(delta);
      }
    }
  }

  const final = await stream.finalResponse();
  if (!sawDelta) {
    const text = final.output_text?.trim() || "";
    if (text) {
      write(text);
    }
  }
}

async function streamWithClaude(
  prompt: string,
  model: string,
  write: StreamWriter
): Promise<void> {
  const text = await generateWithClaude(prompt, model);
  if (text) {
    write(text);
  }
}

async function streamWithOllama(
  prompt: string,
  model: string,
  write: StreamWriter
): Promise<void> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    ""
  );

  const apiKey = process.env.OLLAMA_API_KEY;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, prompt, stream: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const payload = JSON.parse(trimmed) as {
        response?: string;
        done?: boolean;
      };
      if (payload.response) {
        write(payload.response);
      }
      if (payload.done) {
        return;
      }
    }
  }

  const leftover = buffer.trim();
  if (leftover) {
    const payload = JSON.parse(leftover) as {
      response?: string;
    };
    if (payload.response) {
      write(payload.response);
    }
  }
}

async function generateWithOpenAI(
  prompt: string,
  model: string
): Promise<string> {
  // Use a shared OpenAI client to avoid per-request construction overhead.
  const { getOpenAIClient } = await import("@/lib/openai-client");
  const client = getOpenAIClient();
  const response = await client.responses.create({ model, input: prompt });
  return response.output_text?.trim() || "";
}

async function generateWithClaude(
  prompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Claude API key.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const text = data.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("")
    .trim();

  return text || "";
}

async function generateWithOllama(
  prompt: string,
  model: string
): Promise<string> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    ""
  );

  // If an API key is provided in the environment (e.g. OLLAMA_API_KEY),
  // include it as a Bearer token. This supports setups where the Ollama
  // or proxy endpoint requires authentication.
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { response?: string };
  return data.response?.trim() || "";
}

import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  buildLayeredPrompt,
  loadLayerContext,
  type LayerPathInput,
} from "@/lib/layer-context";

type ChatSource = "openai" | "claude" | "ollama";

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
  layers?: LayerPathInput[]
): string {
  const layerKey = layers?.map((layer) => ({
    path: layer.path,
    label: layer.label,
  }));
  return JSON.stringify({ source, model, query, layers: layerKey || [] });
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
      source?: unknown;
      model?: unknown;
    };
    const query = typeof body.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json(
          {
            error:
              "Expected body: { query: string, source?: 'openai' | 'claude' | 'ollama', model: string, layers?: Array<{ path: string, label?: string }> }",
          },
          { status: 400 }
        );
    }

    const source = parseSource(body.source);
    const model = parseRequiredModel(body.model);
    const layerInputs = parseLayerInputs(body.layers);
    const cacheKey = buildResponseCacheKey(source, model, query, layerInputs);
    const cachedAnswer = getCachedAnswer(cacheKey);
    if (cachedAnswer) {
      return NextResponse.json({ answer: cachedAnswer, source, model });
    }
    const contexts = await loadLayerContext(layerInputs);
    const prompt = buildLayeredPrompt(query, contexts);
    const answer = await generateAnswer(source, prompt, model);

    let finalAnswer = answer;

    if (!finalAnswer) {
      return NextResponse.json(
        { error: "Model returned an empty response." },
        { status: 502 }
      );
    }

    // Do not force or prepend any top-level headings; respect the model's original output.

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
              if (!inTable && normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() !== "") {
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
              if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() !== "") {
                normalizedLines.push("");
              }
              inTable = false;
            }

            normalizedLines.push(trimmed);
          }

          if (inTable && normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() !== "") {
            normalizedLines.push("");
          }

          text = normalizedLines.join("\n");
          // Ensure at least one blank line before any heading (if not start of document)
          text = text.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
          // Ensure a blank line after each heading
          text = text.replace(/(#{1,6}[^\n]*)\n(?!\n|$)/g, "$1\n\n");
          // Collapse 3+ newlines into exactly two for consistent paragraph spacing
          text = text.replace(/\n{3,}/g, "\n\n");
          // Convert any remaining markdown tables to bullet lists to avoid pipe symbols in output.
          text = convertTablesToLists(text);
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

    function convertTablesToLists(input: string): string {
      const lines = input.split("\n");
      const output: string[] = [];
      let idx = 0;

      const isTableLine = (line: string) => line.trim().startsWith("|") && line.includes("|");

      while (idx < lines.length) {
        if (!isTableLine(lines[idx])) {
          output.push(lines[idx]);
          idx += 1;
          continue;
        }

        const tableLines: string[] = [];
        while (idx < lines.length && isTableLine(lines[idx])) {
          tableLines.push(lines[idx]);
          idx += 1;
        }

        if (tableLines.length < 2) {
          output.push(...tableLines);
          continue;
        }

        const headers = tableLines[0]
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        const dataLines = tableLines.slice(2);

        if (headers.length === 0 || dataLines.length === 0) {
          output.push(...tableLines);
          continue;
        }

        for (const row of dataLines) {
          const cells = row
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
          if (cells.length === 0) continue;
          const hasContent = cells.some((cell) => cell.length > 0 && !/^:?-{3,}:?$/.test(cell));
          if (!hasContent) {
            continue;
          }
          const pairs = headers.map((header, index) => {
            const value = cells[index] ?? "";
            return `${header}: ${value}`.trim();
          });
          const nonEmptyPairs = pairs.filter((pair) => !pair.endsWith(":") && !pair.endsWith(": "));
          if (nonEmptyPairs.length === 0) {
            continue;
          }
          output.push(`- ${nonEmptyPairs.join("; ")}`);
        }

        if (output.length > 0 && output[output.length - 1].trim() !== "") {
          output.push("");
        }
      }

      return output.join("\n");
    }

    finalAnswer = normalizeMarkdownSpacing(finalAnswer);

  setCachedAnswer(cacheKey, finalAnswer);

    return NextResponse.json({ answer: finalAnswer, source, model });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

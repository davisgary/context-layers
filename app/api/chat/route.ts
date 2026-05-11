import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  buildLayeredPrompt,
  loadLayerContext,
  type LayerPathInput,
} from "@/lib/layer-context";

type ChatSource = "openai" | "claude" | "ollama";

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
      // Split on fenced code blocks so we don't alter their contents.
      const parts = md.split(/(```[\s\S]*?```)/g);
      for (let i = 0; i < parts.length; i++) {
        // Only transform outside code blocks (even indices)
        if (i % 2 === 0) {
          let text = parts[i];
          // Ensure at least one blank line before any heading (if not start of document)
          text = text.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
          // Ensure a blank line after each heading
          text = text.replace(/(#{1,6}[^\n]*)\n(?!\n|$)/g, "$1\n\n");
          // Collapse 3+ newlines into exactly two for consistent paragraph spacing
          text = text.replace(/\n{3,}/g, "\n\n");
          parts[i] = text;
        }
      }
      return parts.join("");
    }

    finalAnswer = normalizeMarkdownSpacing(finalAnswer);

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenAI API key.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    input: prompt,
  });

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

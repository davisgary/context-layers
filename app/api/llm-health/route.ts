import OpenAI from "openai";
import { NextResponse } from "next/server";

const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

async function fetchOllamaModels(baseUrl: string, apiKey?: string) {
  try {
    const url = baseUrl.replace(/\/$/, "") + "/api/models";
    const headers: Record<string, string> = {};
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`status=${res.status}`);
    const data = await res.json();
    // Ollama returns an array (or object) with model records; try to map to ids
    if (Array.isArray(data)) {
      return data.map((m: any) => m.name || m.id || String(m));
    }
    if (data.models && Array.isArray(data.models)) {
      return data.models.map((m: any) => m.name || m.id || String(m));
    }
    return [];
  } catch (err) {
    return [];
  }
}

async function fetchOpenAIModels(apiKey?: string) {
  if (!apiKey) return [];
  try {
    const client = new OpenAI({ apiKey });
    const res = await client.models.list();
    // response.data is an array of model objects
    if (Array.isArray(res.data)) {
      return res.data.map((m: any) => m.id).filter(Boolean);
    }
    return [];
  } catch (err) {
    return [];
  }
}

async function fetchClaudeModels(apiKey?: string) {
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) throw new Error(`status=${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) return data.map((m: any) => m.name || m.id || String(m));
    if (data.models && Array.isArray(data.models)) return data.models.map((m: any) => m.name || m.id || String(m));
    return [];
  } catch (err) {
    return [];
  }
}

export async function GET() {
  const ollamaBase = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT;
  const ollamaKey = process.env.OLLAMA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const [ollamaModels, openaiModels, claudeModels] = await Promise.all([
    fetchOllamaModels(ollamaBase, ollamaKey),
    fetchOpenAIModels(openaiKey),
    fetchClaudeModels(anthropicKey),
  ]);

  return NextResponse.json({
    providers: {
      ollama: { reachable: ollamaModels.length > 0, models: ollamaModels },
      openai: { reachable: openaiModels.length > 0, models: openaiModels },
      claude: { reachable: claudeModels.length > 0, models: claudeModels },
    },
  });
}

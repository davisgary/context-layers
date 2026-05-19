import { load } from "cheerio";
import { LayerContextFile } from "@/lib/layer-context";

export type UrlContextInput = {
  url: string;
  label?: string;
};

type UrlCacheEntry = {
  title: string;
  text: string;
  expiresAt: number;
};

const URL_CACHE_TTL_MS = 5 * 60 * 1000;
const URL_CACHE_MAX = 80;
const MAX_TEXT_CHARS = 20000;
const FETCH_TIMEOUT_MS = 12000;

const urlCache = new Map<string, UrlCacheEntry>();

export async function loadUrlContext(
  inputs?: UrlContextInput[]
): Promise<LayerContextFile[]> {
  if (!inputs || inputs.length === 0) {
    return [];
  }

  const contexts: LayerContextFile[] = [];
  for (const input of inputs) {
    const normalizedUrl = normalizeUrl(input.url);
    if (!normalizedUrl) {
      continue;
    }
    const { title, text } = await getOrFetchUrl(normalizedUrl);
    if (!text) {
      continue;
    }
    const label = input.label?.trim() || title || new URL(normalizedUrl).host;
    contexts.push({
      name: label,
      content: buildContextContent(normalizedUrl, title, text),
    });
  }

  return contexts;
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function getOrFetchUrl(url: string): Promise<UrlCacheEntry> {
  const cached = urlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const fetched = await fetchUrl(url);
  urlCache.set(url, fetched);

  if (urlCache.size > URL_CACHE_MAX) {
    const oldestKey = urlCache.keys().next().value as string | undefined;
    if (oldestKey) {
      urlCache.delete(oldestKey);
    }
  }

  return fetched;
}

async function fetchUrl(url: string): Promise<UrlCacheEntry> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "LayersBot/1.0 (+https://layers.local)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const html = await response.text();
    const { title, text } = extractContent(html);

    return {
      title,
      text: truncateText(text),
      expiresAt: Date.now() + URL_CACHE_TTL_MS,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractContent(html: string): { title: string; text: string } {
  const $ = load(html);
  $("script, style, noscript, svg, canvas, iframe").remove();

  const title = $("title").first().text().trim();
  const main = $("main, article, [role='main']").first();
  const root = main.length > 0 ? main : $("body");
  const text = root.text().replace(/\s+/g, " ").trim();

  return { title, text };
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + "\n\n[Content truncated]";
}

function buildContextContent(url: string, title: string, text: string): string {
  const header = [`Source URL: ${url}`, title ? `Title: ${title}` : ""].
    filter(Boolean)
    .join("\n");
  return [header, "", text].join("\n");
}

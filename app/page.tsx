"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiArrowUp, FiPlus, FiMinusCircle, FiChevronDown, FiLoader } from "react-icons/fi";
import Footer from "../components/Footer";

type LayerEntry = { kind: "path" | "url"; value: string };

const LAYER_STORAGE_KEY = "layers:user-inputs"; // legacy
const URL_STORAGE_KEY = "layers:url-inputs"; // legacy
const LAYER_ENTRY_STORAGE_KEY = "layers:entries";

type ChatSource = "openai" | "claude" | "ollama";
type SourceModelState = { openai: string; claude: string; ollama: string };

const OPENAI_MODEL_OPTIONS = [
  "gpt-5.5",
  "gpt-5.5-instant",
  "gpt-5.4",
  "gpt-5.3-instant",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-4.1",
];
const CLAUDE_MODEL_OPTIONS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
const OLLAMA_GEMMA_MODEL_OPTIONS = ["gemma4", "llama3.3", "qwen3.6", "qwen3-coder", "deepseek-r1", "phi4", "mistral-small3.2"];

function layerName(index: number) {
  if (index === 0) return "Layer 1";
  if (index === 1) return "Layer 2";
  if (index === 2) return "Layer 3";
  return `Layer ${index + 1}`;
}

function layerPathExample(_index: number) {
  return "Documents/github/repo/SKILL.md";
}

function safeParseArray<T>(raw: string | null, mapper: (item: any) => T | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const items = parsed
      .map((it) => (it && typeof it === "object" ? mapper(it) : null))
      .filter((x) => x !== null) as T[];
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function sanitizeStoredLayers(raw: string | null) {
  return safeParseArray(raw, (record: any) => {
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!path) return null;
    return { path, label };
  });
}

function sanitizeStoredUrls(raw: string | null) {
  return safeParseArray(raw, (record: any) => {
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!url) return null;
    return { url, label };
  });
}

function sanitizeStoredEntries(raw: string | null): LayerEntry[] | null {
  return safeParseArray(raw, (record: any) => {
    const kind = record.kind === "url" ? "url" : "path";
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (!value) return null;
    return { kind: kind as LayerEntry["kind"], value };
  });
}

export default function Home() {
  const queryRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<ChatSource>("openai");
  const [sourceModels, setSourceModels] = useState<SourceModelState>({
    openai: OPENAI_MODEL_OPTIONS[0],
    claude: CLAUDE_MODEL_OPTIONS[0],
    ollama: OLLAMA_GEMMA_MODEL_OPTIONS[0],
  });
  const [dynamicModels, setDynamicModels] = useState<{ openai?: string[]; claude?: string[]; ollama?: string[] }>({});

  const [layers, setLayers] = useState<LayerEntry[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  // Load saved entries on mount (client-only) to avoid SSR/CSR mismatch.
  useEffect(() => {
    setMounted(true);
    try {
      const entries = sanitizeStoredEntries(localStorage.getItem(LAYER_ENTRY_STORAGE_KEY));
      if (entries) {
        setLayers(entries);
        return;
      }

      // fallback to legacy keys (paths then urls)
      const paths = sanitizeStoredLayers(localStorage.getItem(LAYER_STORAGE_KEY)) || [];
      const urls = sanitizeStoredUrls(localStorage.getItem(URL_STORAGE_KEY)) || [];
      const merged: LayerEntry[] = [];
      merged.push(...paths.map((p) => ({ kind: "path" as const, value: p.path })));
      merged.push(...urls.map((u) => ({ kind: "url" as const, value: u.url })));
      if (merged.length > 0) {
        setLayers(merged);
        return;
      }

      // seed a single empty path entry when there are no saved entries
      setLayers([{ kind: "path", value: "" }]);
    } catch {
      setLayers([{ kind: "path", value: "" }]);
    }
  }, []);

  // Persist non-empty entries after mount only
  useEffect(() => {
    if (!mounted) return;
    try {
      const nonEmpty = layers.filter((l) => l.value && l.value.trim().length > 0);
      if (nonEmpty.length > 0) {
        localStorage.setItem(LAYER_ENTRY_STORAGE_KEY, JSON.stringify(nonEmpty));
      } else {
        localStorage.removeItem(LAYER_ENTRY_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [layers, mounted]);

  function addLayer() {
    setLayers((prev) => [...prev, { kind: "path", value: "" }]);
  }

  function removeLayer(index: number) {
    setLayers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLayer(index: number, field: keyof LayerEntry, value: string) {
    setLayers((prev) => prev.map((layer, i) => (i === index ? { ...layer, [field]: value } : layer)));
  }

  function currentModelOptions(): string[] {
    if (source === "openai") return OPENAI_MODEL_OPTIONS;
    if (source === "claude") return CLAUDE_MODEL_OPTIONS;
    return OLLAMA_GEMMA_MODEL_OPTIONS;
  }

  function currentModel(): string {
    return sourceModels[source];
  }

  function updateCurrentModel(value: string) {
    setSourceModels((prev) => ({ ...prev, [source]: value }));
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/llm-health");
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setDynamicModels({
          openai: data.providers.openai.models,
          claude: data.providers.claude.models,
          ollama: data.providers.ollama.models,
        });

        const pickPreferred = (available: string[] | undefined, preferred: string[]) => {
          if (!available || available.length === 0) return undefined;
          for (const p of preferred) {
            if (available.includes(p)) return p;
          }
          return available[0];
        };

        const ollamaPick = pickPreferred(data.providers.ollama.models, OLLAMA_GEMMA_MODEL_OPTIONS);
        const openaiPick = pickPreferred(data.providers.openai.models, OPENAI_MODEL_OPTIONS);
        const claudePick = pickPreferred(data.providers.claude.models, CLAUDE_MODEL_OPTIONS);

        setSourceModels((prev) => ({
          ...prev,
          ...(ollamaPick ? { ollama: ollamaPick } : {}),
          ...(openaiPick ? { openai: openaiPick } : {}),
          ...(claudePick ? { claude: claudePick } : {}),
        }));
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setAnswer("");

    let pathCount = 0;
    let urlCount = 0;
    const payloadLayers = layers
      .filter((layer) => layer.kind === "path")
      .map((layer) => {
        const value = layer.value.trim();
        if (!value) return null;
        const label = layerName(pathCount);
        pathCount += 1;
        return { path: value, label };
      })
      .filter((l): l is { path: string; label: string } => !!l);

    const payloadUrls = layers
      .filter((layer) => layer.kind === "url")
      .map((layer) => {
        const value = layer.value.trim();
        if (!value) return null;
        urlCount += 1;
        return { url: value, label: `URL ${urlCount}` };
      })
      .filter((u): u is { url: string; label: string } => !!u);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          query,
          source,
          model: currentModel(),
          layers: payloadLayers.length > 0 ? payloadLayers : undefined,
          urls: payloadUrls.length > 0 ? payloadUrls : undefined,
          stream: true,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Request failed.");
        }
        const fallback = await response.text();
        throw new Error(fallback || "Request failed.");
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError: string | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.replace(/^data:\s*/, "").trim();
              if (!data) continue;
              const payload = JSON.parse(data) as { delta?: string; done?: boolean; error?: string };
              if (payload.delta) setAnswer((prev) => prev + payload.delta);
              if (payload.error) streamError = payload.error;
            }
          }
        }

        if (streamError) throw new Error(streamError);
        return;
      }

      const data = (await response.json()) as { answer?: string };
      setAnswer(data.answer ?? "");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unexpected error.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const messages = ["Getting layer data...", "Summarizing context...", "Retrieving answer..."];
    let t1: number | undefined;
    let t2: number | undefined;
    if (isLoading) {
      setLoadingText(messages[0]);
      t1 = window.setTimeout(() => setLoadingText(messages[1]), 3000);
      t2 = window.setTimeout(() => setLoadingText(messages[2]), 6000);
    } else {
      setLoadingText("");
    }
    return () => {
      if (typeof t1 !== "undefined") clearTimeout(t1);
      if (typeof t2 !== "undefined") clearTimeout(t2);
    };
  }, [isLoading]);

  function handleQueryChange(value: string) {
    setQuery(value);
    const textarea = queryRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-grow flex justify-center px-4 py-10">
        <div className="w-full max-w-3xl space-y-6">
          <h1 className="text-2xl font-semibold text-center">Let's go deeper</h1>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-muted bg-card p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Layers</h2>
              </div>
              <p className="text-xs text-muted-foreground">Choose Path for local files or URL for website scraping.</p>

              <div className="space-y-2" suppressHydrationWarning>
                {!mounted ? (
                  <div className="text-sm text-muted-foreground">Loading layers…</div>
                ) : (
                  <>
                    {layers.length === 0 ? (
                      <div className="pt-2 flex justify-end">
                        <button type="button" onClick={addLayer} className="inline-flex items-center gap-2 rounded-md border border-muted px-2 pr-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors duration-300 ease-in-out hover:text-foreground">
                          <FiPlus className="h-4 w-4" />
                          Add item
                        </button>
                      </div>
                    ) : (
                      layers.map((layer, index) => (
                        <div key={index} className="grid grid-cols-1 gap-2 rounded-md border border-muted p-3 md:grid-cols-[160px_1fr_auto]">
                          <div className="relative">
                            <select value={layer.kind} onChange={(e) => updateLayer(index, "kind", e.target.value as LayerEntry["kind"])} className="w-full appearance-none rounded-md border border-muted bg-background px-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent">
                              <option value="path">Path</option>
                              <option value="url">URL</option>
                            </select>
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><FiChevronDown className="h-4 w-4" /></span>
                          </div>
                          <input type={layer.kind === "url" ? "url" : "text"} value={layer.value} onChange={(e) => updateLayer(index, "value", e.target.value)} className="rounded-md border border-muted bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent" placeholder={layer.kind === "url" ? "https://example.com/page" : layerPathExample(index)} />
                          <button type="button" onClick={() => removeLayer(index)} title="Delete layer" aria-label="Delete layer" className="inline-flex items-center gap-2 rounded-md font-normal text-sm text-destructive px-2 py-2 cursor-pointer transition-colors duration-300 ease-in-out hover:text-destructive/80"><FiMinusCircle /> Remove</button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="source" className="block text-sm font-medium">AI Source</label>
              <div className="relative">
                <select id="source" value={source} onChange={(e) => setSource(e.target.value as ChatSource)} className="w-full appearance-none rounded-md border border-muted bg-background px-3 pr-12 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent">
                  <option value="openai">OpenAI API</option>
                  <option value="claude">Claude API</option>
                  <option value="ollama">Ollama</option>
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><FiChevronDown className="h-4 w-4" /></span>
              </div>
              <p className="text-xs text-muted-foreground">Provider credentials are configured server-side only.</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="model" className="block text-sm font-medium">Model</label>
              <div className="relative">
                <select id="model" value={currentModel()} onChange={(e) => updateCurrentModel(e.target.value)} className="w-full appearance-none rounded-md border border-muted bg-background px-3 pr-12 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent">
                  {(dynamicModels[source] && dynamicModels[source]!.length > 0 ? dynamicModels[source] : currentModelOptions()).map((modelId) => (
                    <option key={modelId} value={modelId}>{modelId}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><FiChevronDown className="h-4 w-4" /></span>
              </div>
              <p className="text-xs text-muted-foreground">Latest models are listed first.</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="query" className="block text-sm font-medium">Query</label>
              <div className="relative">
                <textarea ref={queryRef} id="query" value={query} onChange={(e) => handleQueryChange(e.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (formRef.current) {
                      if (typeof formRef.current.requestSubmit === "function") formRef.current.requestSubmit();
                      else formRef.current.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
                    }
                  }
                }} className="min-h-20 w-full resize-none overflow-hidden rounded-md border border-muted bg-background p-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent" placeholder="Ask your question..." required />
                <button type="submit" disabled={isLoading} title="Submit" aria-label="Submit" aria-busy={isLoading} className={`mb-1 absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-60 transition-colors duration-300 ease-in-out${query.trim().length > 0 ? " hover:bg-primary/90 cursor-pointer" : " cursor-default"}`}>
                  {isLoading ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiArrowUp className="h-4 w-4" />}
                </button>
              </div>
              {isLoading && loadingText ? <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />{loadingText}</p> : null}
            </div>
          </form>

          {error ? <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          {answer ? (
            <div className="space-y-4 rounded-lg border border-muted bg-card p-6">
              <div className="prose max-w-none text-base break-words"><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown></div>
            </div>
          ) : null}
        </div>
      </div>
      <Footer />
    </div>
  );
}

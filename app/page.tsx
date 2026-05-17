"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { FiArrowUp, FiPlus, FiMinusCircle, FiChevronDown, FiLoader } from "react-icons/fi";
import Footer from "../components/Footer";

type LayerInput = {
  path: string;
  label: string;
};

const LAYER_STORAGE_KEY = "layers:user-inputs";

type ChatSource = "openai" | "claude" | "ollama";
type SourceModelState = {
  openai: string;
  claude: string;
  ollama: string;
};

const OPENAI_MODEL_OPTIONS = [
  // Flagship
  "gpt-5.5",
  "gpt-5.5-instant",
  "gpt-5.4",
  // Fast
  "gpt-5.3-instant",
  // Small
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  // Coding
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  // Legacy
  "gpt-4.1",
];

const CLAUDE_MODEL_OPTIONS = [
  // Provided Claude model IDs
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

const OLLAMA_GEMMA_MODEL_OPTIONS = [
  // Prefer Gemma 4 as the default local model (no ":latest" tag).
  "gemma4",
  // Primary Ollama model options (kept in a stable order).
  "llama3.3",
  "qwen3.6",
  "qwen3-coder",
  "deepseek-r1",
  "phi4",
  "mistral-small3.2",
];

function layerName(index: number): string {
  if (index === 0) return "Layer 1";
  if (index === 1) return "Layer 2";
  if (index === 2) return "Layer 3";
  return `Layer ${index + 1}`;
}

function layerPathExample(_index: number): string {
  // Generic example placeholder
  return "Documents/github/repo/SKILL.md";
}

function sanitizeStoredLayers(raw: string | null): LayerInput[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const sanitized = parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          path: typeof record.path === "string" ? record.path : "",
          label: typeof record.label === "string" ? record.label : "",
        };
      });
    return sanitized.length > 0 ? sanitized : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const queryRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<ChatSource>("openai");
  const [sourceModels, setSourceModels] = useState<SourceModelState>({
    openai: OPENAI_MODEL_OPTIONS[0],
    claude: CLAUDE_MODEL_OPTIONS[0],
      ollama: OLLAMA_GEMMA_MODEL_OPTIONS[0],
  });
  const [dynamicModels, setDynamicModels] = useState<{
    openai?: string[];
    claude?: string[];
    ollama?: string[];
  }>({});
  const [layers, setLayers] = useState<LayerInput[]>([
    { path: "", label: "" },
  ]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sanitizeStoredLayers(localStorage.getItem(LAYER_STORAGE_KEY));
    if (stored && stored.length > 0) {
      setLayers(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(layers));
    } catch {
      // Ignore storage errors (e.g., private mode or quota exceeded).
    }
  }, [layers]);

  function addLayer() {
    setLayers((prev) => [...prev, { path: "", label: "" }]);
  }

  function removeLayer(index: number) {
    setLayers((prev) => {
      // Ensure at least one layer remains in the UI.
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  function updateLayer(index: number, field: keyof LayerInput, value: string) {
    setLayers((prev) =>
      prev.map((layer, i) =>
        i === index ? { ...layer, [field]: value } : layer
      )
    );
  }

  function currentModelOptions(): string[] {
  if (source === "openai") return OPENAI_MODEL_OPTIONS;
  if (source === "claude") return CLAUDE_MODEL_OPTIONS;
  // Ollama primarily exposes Gemma model IDs; use that list in the UI.
  return OLLAMA_GEMMA_MODEL_OPTIONS;
  }

  function currentModel(): string {
  return sourceModels[source];
  }

  function updateCurrentModel(value: string) {
  setSourceModels((prev) => ({ ...prev, [source]: value }));
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/llm-health");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setDynamicModels({
          openai: data.providers.openai.models,
          claude: data.providers.claude.models,
          ollama: data.providers.ollama.models,
        });
        const pickPreferred = (available: string[] | undefined, preferred: string[]) => {
          if (!available || available.length === 0) return undefined;
          // Find the first preferred model that exists in the provider list
          for (const p of preferred) {
            if (available.includes(p)) return p;
          }
          // Fall back to the provider's first model
          return available[0];
        };

        const ollamaPick = pickPreferred(
          data.providers.ollama.models,
          OLLAMA_GEMMA_MODEL_OPTIONS
        );
        const openaiPick = pickPreferred(
          data.providers.openai.models,
          OPENAI_MODEL_OPTIONS
        );
        const claudePick = pickPreferred(
          data.providers.claude.models,
          CLAUDE_MODEL_OPTIONS
        );

        setSourceModels((prev) => ({
          ...prev,
          ...(ollamaPick ? { ollama: ollamaPick } : {}),
          ...(openaiPick ? { openai: openaiPick } : {}),
          ...(claudePick ? { claude: claudePick } : {}),
        }));
      } catch (err) {
        // ignore and keep static lists
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setAnswer("");

    const payloadLayers = layers
      .map((layer, index) => ({
        // Only use the user-provided path. Do NOT fall back to the example
        path: layer.path.trim(),
        label: layer.label.trim() || layerName(index),
      }))
      .filter((layer) => layer.path && layer.path.length > 0);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          query,
          source,
          model: currentModel(),
          layers: payloadLayers.length > 0 ? payloadLayers : undefined,
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
              const payload = JSON.parse(data) as {
                delta?: string;
                done?: boolean;
                error?: string;
              };
              if (payload.delta) {
                setAnswer((prev) => prev + payload.delta);
              }
              if (payload.error) {
                streamError = payload.error;
              }
            }
          }
        }

        if (streamError) {
          throw new Error(streamError);
        }

        return;
      }

      const data = (await response.json()) as { answer?: string };
      setAnswer(data.answer ?? "");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unexpected error.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Loading messages
    const messages = [
      "Getting layer data...",
      "Summarizing context...",
      "Retrieving answer...",
    ];
    let t1: number | undefined;
    let t2: number | undefined;
    if (isLoading) {
      // Start with the first message immediately.
      setLoadingText(messages[0]);
      // Second message.
      t1 = window.setTimeout(() => {
        setLoadingText(messages[1]);
      }, 3000);
      // Final message.
      t2 = window.setTimeout(() => {
        setLoadingText(messages[2]);
      }, 6000);
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
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-grow flex justify-center px-4 py-10">
        <div className="w-full max-w-3xl space-y-6">
          <h1 className="text-2xl font-semibold text-center">Let's go deeper</h1>

          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="space-y-4 rounded-lg border border-muted bg-card p-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Layers</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Use relative paths (e.g. SKILL.md) or local file
                paths (Documents/github/repo/SKILL.md).
              </p>

              <div className="space-y-2">
                {layers.map((layer, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 gap-2 rounded-md border border-muted p-3 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <input
                      type="text"
                      value={layer.path}
                      onChange={(event) =>
                        updateLayer(index, "path", event.target.value)
                      }
                      className="rounded-md border border-muted bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder={layerPathExample(index)}
                    />
                    <input
                      type="text"
                      value={layer.label}
                      onChange={(event) =>
                        updateLayer(index, "label", event.target.value)
                      }
                      className="rounded-md border border-muted bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder={layerName(index)}
                    />
                    <button
                      type="button"
                      onClick={() => removeLayer(index)}
                      disabled={layers.length <= 1}
                      title="Delete layer"
                      aria-label="Delete layer"
                      className="inline-flex items-center gap-2 rounded-md font-normal text-sm text-destructive px-2 py-2 cursor-pointer disabled:cursor-not-allowed transition-colors duration-300 ease-in-out hover:text-destructive/80 disabled:hover:text-destructive"
                    >
                      <FiMinusCircle />
                      Remove
                    </button>
                  </div>
                ))}
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={addLayer}
                    disabled={layers.length >= 6}
                    className="inline-flex items-center gap-2 rounded-md border border-muted px-2 pr-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors duration-300 ease-in-out hover:text-foreground"
                  >
                    <FiPlus className="h-4 w-4" />
                    Add layer
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="source" className="block text-sm font-medium">
                AI Source
              </label>
              <div className="relative">
                <select
                  id="source"
                  value={source}
                  onChange={(event) => setSource(event.target.value as ChatSource)}
                  className="w-full appearance-none rounded-md border border-muted bg-background px-3 pr-12 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="openai">OpenAI API</option>
                  <option value="claude">Claude API</option>
                  <option value="ollama">Ollama</option>
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                  <FiChevronDown className="h-4 w-4" />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Provider credentials are configured server-side only.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="model" className="block text-sm font-medium">
                Model
              </label>
              <div className="relative">
                <select
                  id="model"
                  value={currentModel()}
                  onChange={(event) => updateCurrentModel(event.target.value)}
                  className="w-full appearance-none rounded-md border border-muted bg-background px-3 pr-12 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {(dynamicModels[source] && dynamicModels[source]!.length > 0
                    ? dynamicModels[source]
                    : currentModelOptions()
                  ).map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                  <FiChevronDown className="h-4 w-4" />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Latest models are listed first.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="query" className="block text-sm font-medium">
                Query
              </label>
              <div className="relative">
                <textarea
                  ref={queryRef}
                  id="query"
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    // Submit the form when Enter is pressed without Shift.
                    if (event.key === "Enter" && !event.shiftKey) {
                      // Prevent inserting a newline.
                      event.preventDefault();
                      // Use requestSubmit if available to trigger form validation and onSubmit.
                      if (formRef.current) {
                        // requestSubmit is preferred because it triggers the form's submit event
                        // and respects the type="submit" button behavior.
                        if (typeof formRef.current.requestSubmit === "function") {
                          formRef.current.requestSubmit();
                        } else {
                          // Fallback for older browsers.
                          formRef.current.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
                        }
                      }
                    }
                  }}
                  className="min-h-20 w-full resize-none overflow-hidden rounded-md border border-muted bg-background p-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Ask your question..."
                  required
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  title="Submit"
                  aria-label="Submit"
                  aria-busy={isLoading}
                  className={
                    `mb-1 absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-60 transition-colors duration-300 ease-in-out` +
                    (query.trim().length > 0
                      ? " hover:bg-primary/90 cursor-pointer"
                      : " cursor-default")
                  }
                >
                  {isLoading ? (
                    <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FiArrowUp className="h-4 w-4" />
                  )}
                </button>
              </div>
              {isLoading && loadingText ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {loadingText}
                </p>
              ) : null}
            </div>
          </form>

          {error ? (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {answer ? (
            <div className="space-y-4 rounded-lg border border-muted bg-card p-6">
              <div className="prose max-w-none text-base break-words">
                <ReactMarkdown>{answer}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Footer />
    </div>
  );
}

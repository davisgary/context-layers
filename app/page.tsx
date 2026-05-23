"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiArrowUp, FiPlus, FiChevronDown, FiLoader, FiTrash2 } from "react-icons/fi";
import Footer from "../components/Footer";

type LayerEntry = { kind: "path" | "url" | "note"; value: string; label?: string };

type Note = { id: string; title: string; body: string; createdAt: number };

const LAYER_STORAGE_KEY = "layers:user-inputs"; // legacy
const URL_STORAGE_KEY = "layers:url-inputs"; // legacy
const LAYER_ENTRY_STORAGE_KEY = "layers:entries";
const NOTES_STORAGE_KEY = "layers:notes";

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
    const kind = record.kind === "url" ? "url" : record.kind === "note" ? "note" : "path";
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (!value) return null;
    const label = typeof record.label === "string" ? record.label.trim() : undefined;
    return { kind: kind as LayerEntry["kind"], value, label };
  });
}

function sanitizeStoredNotes(raw: string | null): Note[] | null {
  return safeParseArray(raw, (record: any) => {
    const id = typeof record.id === "string" ? record.id : null;
    const title = typeof record.title === "string" ? record.title : "";
    const body = typeof record.body === "string" ? record.body : "";
    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
    if (!id) return null;
    return { id, title, body, createdAt } as Note;
  });
}

function NoteInlineEditor({
  layerValue,
  notes,
  onSave,
  onDelete,
}: {
  layerValue: string;
  notes: Note[];
  onSave: (note: Note) => void;
  onDelete: () => void;
}) {
  const existing = notes.find((n) => n.id === layerValue);
  const [title, setTitle] = useState(existing ? existing.title : "");
  const [body, setBody] = useState(existing ? existing.body : layerValue || "");

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setBody(existing.body);
    }
  }, [layerValue]);

  function save() {
    const id = existing ? existing.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const note: Note = { id, title: title || "Untitled", body, createdAt: existing ? existing.createdAt : Date.now() };
    onSave(note);
  }

  return (
    <div className="space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full rounded-md border border-muted bg-background px-3 py-2 text-sm" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Note body..." className="w-full rounded-md border border-muted bg-background px-3 py-2 text-sm min-h-[80px]" />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-1 text-xs font-medium hover:bg-muted">
          Save
        </button>
        <button type="button" onClick={onDelete} className="text-xs text-destructive">Clear</button>
      </div>
    </div>
  );
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  // Load saved entries on mount (client-only) to avoid SSR/CSR mismatch.
  useEffect(() => {
    setMounted(true);
    try {
      const storedNotes = sanitizeStoredNotes(localStorage.getItem(NOTES_STORAGE_KEY));
      if (storedNotes) setNotes(storedNotes);

      const entries = sanitizeStoredEntries(localStorage.getItem(LAYER_ENTRY_STORAGE_KEY));
      if (entries) {
        setLayers(entries);
        return;
      }

      // fallback to legacy keys (paths then urls)
      const paths = sanitizeStoredLayers(localStorage.getItem(LAYER_STORAGE_KEY)) || [];
      const urls = sanitizeStoredUrls(localStorage.getItem(URL_STORAGE_KEY)) || [];
  const merged: LayerEntry[] = [];
  merged.push(...paths.map((p, i) => ({ kind: "path" as const, value: p.path, label: p.label ?? layerName(i) })));
  merged.push(...urls.map((u, i) => ({ kind: "url" as const, value: u.url, label: u.label ?? undefined })));
      if (merged.length > 0) {
        setLayers(merged);
        return;
      }

      // seed a single empty path entry when there are no saved entries
      setLayers([{ kind: "path", value: "", label: layerName(0) }]);
    } catch {
      setLayers([{ kind: "path", value: "", label: layerName(0) }]);
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

  // Persist notes
  useEffect(() => {
    if (!mounted) return;
    try {
      if (notes.length > 0) localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
      else localStorage.removeItem(NOTES_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [notes, mounted]);

  // removed addLayer (use addPathLayer/addUrlLayer/addNoteLayer instead)

  function addPathLayer() {
    setLayers((prev) => [...prev, { kind: "path", value: "", label: layerName(prev.filter(l=>l.kind==='path').length) }]);
  }

  function addUrlLayer() {
    setLayers((prev) => [...prev, { kind: "url", value: "", label: undefined }]);
  }

  function addNoteLayer() {
    setLayers((prev) => [...prev, { kind: "note", value: "", label: undefined }]);
  }

  function removeLayer(index: number) {
    setLayers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLayer(index: number, field: keyof LayerEntry, value: string) {
    setLayers((prev) => {
      return prev.map((layer, i) => {
        if (i !== index) return layer;

        // protect saved notes: if this layer currently references a saved note id
        // and the user is trying to change its kind away from 'note', block it.
        if (field === "kind" && layer.kind === "note" && value !== "note") {
          const noteExists = notes.some((n) => n.id === layer.value);
          if (noteExists) {
            try {
              // Use confirm so the user can intentionally override; default is to block.
              const ok = window.confirm(
                "This layer references a saved note. Changing the kind will detach it. Proceed?"
              );
              if (!ok) return layer;
            } catch {
              return layer;
            }
          }
        }

        return { ...layer, [field]: value } as LayerEntry;
      });
    });
  }

  // Notes helpers
  function createNote(title: string, body: string) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const note: Note = { id, title: title || "Untitled", body, createdAt: Date.now() };
    setNotes((prev) => [note, ...prev]);
    return note;
  }

  function deleteNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    // remove any layer references to this note
    setLayers((prev) => prev.filter((l) => !(l.kind === "note" && l.value === id)));
  }

  function addNoteAsLayer(id: string) {
    // only add if not already present
    setLayers((prev) => {
      if (prev.some((p) => p.kind === "note" && p.value === id)) return prev;
      return [...prev, { kind: "note", value: id }];
    });
  }

  function attachNoteToQuery(id: string) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    setQuery((prev) => (prev ? `${prev}\n\n${note.body}` : note.body));
    // resize textarea
    setTimeout(() => handleQueryChange((queryRef.current?.value ?? "") as string), 0);
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
        const label = (typeof layer.label === "string" && layer.label.trim().length > 0) ? layer.label : layerName(pathCount);
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
        const label = (typeof layer.label === "string" && layer.label.trim().length > 0) ? layer.label : `URL ${urlCount}`;
        return { url: value, label };
      })
      .filter((u): u is { url: string; label: string } => !!u);

    // include notes payload: expand note layer references to their content
    let noteCount = 0;
    const payloadNotes = layers
      .filter((layer) => layer.kind === "note")
      .map((layer, i) => {
        const value = layer.value.trim();
        if (!value) return null;
        // try to find a saved note by id
        const found = notes.find((n) => n.id === value);
        if (found) {
          noteCount += 1;
          const label = (typeof layer.label === "string" && layer.label.trim().length > 0) ? layer.label : (found.title || `Note ${noteCount}`);
          return { id: found.id, title: found.title, body: found.body, label };
        }
        // fallback: if layer contains unsaved body, send as temporary note
  noteCount += 1;
  const label = (typeof layer.label === "string" && layer.label.trim().length > 0) ? layer.label : `Note ${noteCount}`;
  return { id: `unsaved-${i}-${Date.now()}`, title: "Unsaved note", body: value, label };
      })
      .filter((n) => n !== null) as { id: string; title: string; body: string; label?: string }[];

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
          notes: payloadNotes.length > 0 ? payloadNotes : undefined,
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
        <div className="w-full max-w-4xl space-y-6">
          <h1 className="text-center text-3xl font-semibold tracking-tight">Let's go deeper</h1>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-muted bg-card/90 p-5 shadow-sm">
            <div className="space-y-3 rounded-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide">Layers</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Attach local file paths or scrape URLs as context.</p>
                </div>
                <div className="inline-flex items-center gap-2">
                  <button type="button" onClick={addPathLayer} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
                    <FiPlus className="h-4 w-4" />
                    Add path
                  </button>
                  <button type="button" onClick={addUrlLayer} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
                    Add URL
                  </button>
                  <button type="button" onClick={addNoteLayer} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
                    Add note
                  </button>
                </div>
              </div>

              <div className="space-y-3" suppressHydrationWarning>
                {!mounted ? (
                  <div className="text-sm text-muted-foreground">Loading layers…</div>
                ) : (
                  <>
                    {layers.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-muted bg-background/80 p-6 text-center text-sm text-muted-foreground">
                        No context items yet. Add your first path or URL.
                      </div>
                    ) : (
                      layers.map((layer, index) => (
                        <div key={index} className="space-y-3 rounded-xl border border-muted bg-background/90 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <input
                              aria-label={`Layer ${index + 1} title`}
                              value={layer.label ?? layerName(index)}
                              onChange={(e) => updateLayer(index, "label", e.target.value)}
                              className="w-full rounded-md border border-muted bg-background px-3 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground"
                            />
                            <button
                              type="button"
                              onClick={() => removeLayer(index)}
                              title="Delete layer"
                              aria-label="Delete layer"
                              className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-destructive transition-colors duration-300 ease-in-out hover:bg-destructive/10"
                            >
                              <FiTrash2 className="h-4 w-4" />
                              Remove
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
                            <div className="inline-flex items-center gap-2">
                              <span className="rounded-md px-3 py-1.5 text-xs font-medium bg-background text-muted-foreground">{layer.kind.toUpperCase()}</span>
                            </div>

                            {layer.kind === "note" ? (
                              // Show note title (read-only) instead of exposing internal note id
                              <input
                                type="text"
                                readOnly
                                value={(() => {
                                  const note = notes.find((n) => n.id === layer.value);
                                  return note ? note.title || note.body.slice(0, 60) : "Unsaved note";
                                })()}
                                className="w-full rounded-lg border border-muted bg-background/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                placeholder="Unsaved note"
                              />
                            ) : (
                              <input
                                type={layer.kind === "url" ? "url" : "text"}
                                value={layer.value}
                                onChange={(e) => updateLayer(index, "value", e.target.value)}
                                className="w-full rounded-lg border border-muted bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                placeholder={layer.kind === "url" ? "https://example.com/page" : layerPathExample(index)}
                              />
                            )}
                          </div>

                          {layer.kind === "note" ? (
                            <div className="mt-3 space-y-2">
                              {/* Inline note editor: title + body. layer.value stores note id or temporary body if not saved */}
                              <NoteInlineEditor
                                layerValue={layer.value}
                                notes={notes}
                                onSave={(note) => {
                                  // ensure note is in notes list and layer references the id
                                  setNotes((prev) => {
                                    const exists = prev.find((n) => n.id === note.id);
                                    if (exists) return prev.map((n) => (n.id === note.id ? note : n));
                                    return [note, ...prev];
                                  });
                                  updateLayer(index, "value", note.id);
                                }}
                                onDelete={() => {
                                  // clear layer value
                                  updateLayer(index, "value", "");
                                }}
                              />
                            </div>
                          ) : null}
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
                }} className="min-h-24 w-full resize-none overflow-hidden rounded-md border border-muted bg-background p-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent" placeholder="Ask your question..." required />
                <button
                  type="submit"
                  disabled={isLoading}
                  title="Submit"
                  aria-label="Submit"
                  aria-busy={isLoading}
                  className={`mb-1 absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-lg shadow-md disabled:opacity-60 disabled:cursor-not-allowed transition transform duration-200 ease-out bg-primary text-primary-foreground${query.trim().length > 0 ? " hover:bg-accent-foreground hover:-translate-y-0.5 hover:scale-105 hover:shadow-xl active:scale-95 cursor-pointer" : " cursor-default"}`}
                >
                  {isLoading ? (
                    <FiLoader className="h-[20px] w-[20px] animate-spin" aria-hidden="true" />
                  ) : (
                    <FiArrowUp className="h-[20px] w-[20px]" />
                  )}
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

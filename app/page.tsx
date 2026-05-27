"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiArrowUp, FiPlus, FiChevronDown, FiLoader, FiTrash2, FiMoreVertical } from "react-icons/fi";
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

function kindPlaceholder(layers: LayerEntry[], index: number, kind: LayerEntry["kind"]) {
  // count preceding layers of same kind to produce ordinal
  const count = layers.slice(0, index).filter((l) => l.kind === kind).length + 1;
  if (kind === "url") return `URL ${count}`;
  if (kind === "path") return `Path ${count}`;
  return `Note ${count}`;
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
        <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-1 text-xs font-medium hover:bg-muted">Save</button>
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
  // stable keys for list items to avoid React reusing DOM nodes when reordered
  const [layerKeys, setLayerKeys] = useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  // menu & rename state
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null);
  const [editingTitleIndex, setEditingTitleIndex] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  // selected layer shown in the right panel
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0);
  // drag & drop state for reordering
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(null);

  function genKey() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ensure we have a stable key for every layer; keep keys in sync when layers change
  useEffect(() => {
    setLayerKeys((prev) => {
      if (prev.length === layers.length) return prev;
      if (prev.length < layers.length) {
        const next = [...prev];
        while (next.length < layers.length) next.push(genKey());
        return next;
      }
      return prev.slice(0, layers.length);
    });
  }, [layers.length]);

  function openMenuFor(index: number) {
    setMenuOpenIndex((p) => (p === index ? null : index));
  }

  function moveLayer(from: number, to: number) {
  // moveLayer(from, candidateTo) -- 'to' is the candidate insertion index in the original array
    // 'to' is the candidate insertion index in the original array (0..length)
    // compute adjusted insertion index after removal
    const adj = from < to ? to - 1 : to;
    // no-op checks: inserting into same place
    if (from === adj) return;

    setLayers((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(adj, 0, item);
      return next;
    });

    // move keys in parallel
    setLayerKeys((prev) => {
      const next = [...prev];
      const [k] = next.splice(from, 1);
      next.splice(adj, 0, k);
      return next;
    });

    // adjust selected index using adj
    setSelectedLayerIndex((cur) => {
      if (cur === from) return adj;
      if (from < to) {
        // moved later: items between from+1..adj inclusive shift left
        if (cur > from && cur <= adj) return cur - 1;
      } else {
        // moved earlier: items between adj..from-1 inclusive shift right
        if (cur >= adj && cur < from) return cur + 1;
      }
      return cur;
    });

    // close any open menu
    setMenuOpenIndex(null);
  }

  function moveLayerUp(index: number) {
    if (index <= 0) return;
    moveLayer(index, index - 1);
  }

  function moveLayerDown(index: number) {
    if (index >= layers.length - 1) return;
    // pass candidate insertion index so that final position becomes index+1
    const candidate = Math.min(layers.length, index + 2);
    moveLayer(index, candidate);
  }

  function startRenaming(index: number) {
    setEditingTitleIndex(index);
    setEditingTitleValue(layers[index]?.label ?? kindPlaceholder(layers, index, layers[index].kind));
    setMenuOpenIndex(null);
  }

  function saveRename(index: number) {
    updateLayer(index, "label", editingTitleValue || "");
    setEditingTitleIndex(null);
    setEditingTitleValue("");
  }

  function cancelRename() {
    setEditingTitleIndex(null);
    setEditingTitleValue("");
  }

  // Close the layer menu when clicking outside of it
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (menuOpenIndex === null) return;
      const target = e.target as Element | null;
      if (!target) return;
      // if the click is inside the menu or the menu button, do nothing
      if (target.closest('.layer-menu') || target.closest('.layer-menu-button')) return;
      setMenuOpenIndex(null);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpenIndex]);

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

  // add/remove helpers now manage selection for single-pane view
  function addPathLayer() {
    setLayers((prev) => {
      const next = [...prev, ({ kind: "path", value: "", label: layerName(prev.filter((l) => l.kind === "path").length) } as LayerEntry)];
      setSelectedLayerIndex(next.length - 1);
      return next;
    });
  }

  function addUrlLayer() {
    setLayers((prev) => {
      const next = [...prev, ({ kind: "url", value: "", label: undefined } as LayerEntry)];
      setSelectedLayerIndex(next.length - 1);
      return next;
    });
  }

  function addNoteLayer() {
    setLayers((prev) => {
      const next = [...prev, ({ kind: "note", value: "", label: undefined } as LayerEntry)];
      setSelectedLayerIndex(next.length - 1);
      return next;
    });
  }

  function removeLayer(index: number) {
    setLayers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // adjust selected index
      if (next.length === 0) {
        setSelectedLayerIndex(0);
      } else if (selectedLayerIndex >= next.length) {
        setSelectedLayerIndex(next.length - 1);
      } else if (index === selectedLayerIndex) {
        setSelectedLayerIndex(Math.max(0, selectedLayerIndex - 1));
      }
      return next;
    });
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
    setLayers((prev) => {
      const next = prev.filter((l) => !(l.kind === "note" && l.value === id));
      return next;
    });
  }

  function addNoteAsLayer(id: string) {
    // only add if not already present
    setLayers((prev) => {
      if (prev.some((p) => p.kind === "note" && p.value === id)) return prev;
      return [...prev, { kind: "note", value: id } as LayerEntry];
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
        // title comes from the editable label (preferred) or from the layer.value for backwards compatibility
        const title = (typeof layer.label === "string" && layer.label.trim().length > 0) ? layer.label : (value || `Note ${i + 1}`);
        // try to find a saved note by id
        const found = notes.find((n) => n.id === value);
        if (found) {
          noteCount += 1;
          const label = title || (found.title || `Note ${noteCount}`);
          return { id: found.id, title: found.title, body: found.body, label };
        }
        // unsaved note: send empty body but include title so AI sees the title as the layer name
        noteCount += 1;
        const label = title || `Note ${noteCount}`;
        return { id: `unsaved-${i}-${Date.now()}`, title: label, body: "", label };
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
        <div className="w-full max-w-4xl space-y-2">
          <h1 className="text-center text-3xl font-semibold tracking-tight">Go farther with Context Layers</h1>
          <p className="text-center text-sm text-muted-foreground pb-3">Create ordered context layers for deeper, more relevant answers.</p>

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
                      <div className="rounded-lg border border-dashed border-muted bg-background/80 p-6 text-center text-sm text-muted-foreground">No context items yet. Add your first path or URL.</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-4">
                        {/* Left: titles list */}
                        <div className="col-span-1 space-y-2">
                          {layers.map((layer, index) => (
                            <div
                              key={layerKeys[index] ?? index}
                              draggable
                              onDragStart={(e) => {
                                setDraggingIndex(index);
                                try {
                                  e.dataTransfer?.setData("text/plain", String(index));
                                  e.dataTransfer!.effectAllowed = "move";
                                } catch {
                                  // ignore
                                }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                const target = e.currentTarget as HTMLElement;
                                const rect = target.getBoundingClientRect();
                                const offsetY = e.clientY - rect.top;
                                const position = offsetY < rect.height / 2 ? 'before' : 'after';
                                // signal that this index is being hovered for drop and whether above/below
                                setDragOverIndex(index);
                                setDragOverIndex(index);
                                setDragOverPosition(position);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const from = draggingIndex;
                                const targetIndex = index;
                                // compute before/after based on drop Y position synchronously
                                const target = e.currentTarget as HTMLElement;
                                const rect = target.getBoundingClientRect();
                                const offsetY = e.clientY - rect.top;
                                const pos = offsetY < rect.height / 2 ? 'before' : 'after';
                                // candidate insertion index in the original array
                                const candidateTo = targetIndex + (pos === 'before' ? 0 : 1);
                                // perform drop
                                if (from !== null && from !== undefined) moveLayer(from, candidateTo);
                                setDraggingIndex(null);
                                setDragOverIndex(null);
                                setDragOverPosition(null);
                              }}
                              onDragEnd={() => {
                                setDraggingIndex(null);
                                setDragOverIndex(null);
                              }}
                              onClick={() => setSelectedLayerIndex(index)}
                              className={`flex items-center justify-between cursor-pointer rounded-md border p-2 ${selectedLayerIndex === index ? "border-accent/40 bg-muted/40" : "border-transparent hover:bg-muted/40 transition-colors duration-300"} ${draggingIndex === index ? "opacity-60" : ""} ${(dragOverIndex === index && draggingIndex !== null && draggingIndex !== index && dragOverPosition === 'before') ? "border-t-2 border-accent/50" : ""} ${(dragOverIndex === index && draggingIndex !== null && draggingIndex !== index && dragOverPosition === 'after') ? "border-b-2 border-accent/50" : ""}`}
                            >
                              <div className="flex-1 text-sm font-medium">
                                {editingTitleIndex === index ? (
                                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                    <input value={editingTitleValue} onChange={(e) => setEditingTitleValue(e.target.value)} className="flex-1 rounded-md border px-2 py-1 text-sm text-primary-foreground" />
                                    <div className="ml-1 flex flex-col items-start">
                                      <button type="button" className="text-sm" onClick={(e) => { e.stopPropagation(); saveRename(index); }}>Save</button>
                                      <button type="button" className="text-sm text-destructive mt-1" onClick={(e) => { e.stopPropagation(); cancelRename(); }}>Cancel</button>
                                    </div>
                                    {/* Drop zone at the end to append */}
                                    <div
                                      onDragOver={(e) => {
                                      e.preventDefault();
                                      setDragOverIndex(layers.length - 1);
                                      setDragOverPosition('after');
                                    }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        const from = draggingIndex;
                                        const candidateTo = layers.length; // append
                                        // append drop
                                        if (from !== null && from !== undefined) moveLayer(from, candidateTo);
                                        setDraggingIndex(null);
                                        setDragOverIndex(null);
                                        setDragOverPosition(null);
                                      }}
                                      className="h-8"
                                    />
                                  </div>
                                ) : (
                                  <div>{layer.label ?? kindPlaceholder(layers, index, layer.kind)}</div>
                                )}
                              </div>
                              {editingTitleIndex !== index && (
                                <div className="ml-2 relative">
                                  <button type="button" aria-label="Layer menu" onClick={(e) => { e.stopPropagation(); openMenuFor(index); }} className="p-1 rounded hover:bg-muted layer-menu-button"><FiMoreVertical /></button>
                                  {menuOpenIndex === index && (
                                    <div className="absolute right-0 mt-2 w-44 rounded-md border bg-card p-0 z-10 overflow-hidden layer-menu">
                                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => startRenaming(index)}>Rename</button>
                                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => moveLayerUp(index)} disabled={index === 0}>Reorder up</button>
                                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => moveLayerDown(index)} disabled={index === layers.length - 1}>Reorder down</button>
                                      <button type="button" className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-muted rounded-b-md" onClick={() => removeLayer(index)}>Remove</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Right: detail editor for selected layer */}
                        <div className="col-span-2">
                          {layers[selectedLayerIndex] ? (
                            <div className="space-y-3 rounded-xl border border-muted bg-background/90 px-4 pb-4 pt-2">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="text-sm font-semibold">{layers[selectedLayerIndex].label ?? kindPlaceholder(layers, selectedLayerIndex, layers[selectedLayerIndex].kind)}</div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {layers[selectedLayerIndex].kind === "note" ? (
                                  <div className="flex-1" />
                                ) : (
                                  <input type={layers[selectedLayerIndex].kind === "url" ? "url" : "text"} value={layers[selectedLayerIndex].value} onChange={(e) => updateLayer(selectedLayerIndex, "value", e.target.value)} className="flex-1 rounded-lg border border-muted bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent" placeholder={layers[selectedLayerIndex].kind === "url" ? "https://example.com/page" : layerPathExample(selectedLayerIndex)} />
                                )}
                              </div>

                              {layers[selectedLayerIndex].kind === "note" ? (
                                <div className="mt-3 space-y-2">
                                  <textarea value={((): string => { const note = notes.find((n) => n.id === layers[selectedLayerIndex].value); return note ? note.body : layers[selectedLayerIndex].value; })()} onChange={(e) => updateLayer(selectedLayerIndex, "value", e.target.value)} placeholder="Note body..." className="w-full rounded-md border border-muted bg-background px-3 py-2 text-sm min-h-[80px]" />
                                  <div className="flex items-center justify-end gap-2">
                                    <button type="button" onClick={() => {
                                      const content = ((): string => { const note = notes.find((n) => n.id === layers[selectedLayerIndex].value); return note ? note.body : layers[selectedLayerIndex].value; })();
                                      const title = (typeof layers[selectedLayerIndex].label === "string" && layers[selectedLayerIndex].label!.trim().length > 0) ? layers[selectedLayerIndex].label! : "Untitled";
                                      const existing = notes.find((n) => n.id === layers[selectedLayerIndex].value);
                                      if (existing) {
                                        const updated: Note = { ...existing, title: title || existing.title, body: content };
                                        setNotes((prev) => prev.map((n) => (n.id === existing.id ? updated : n)));
                                        updateLayer(selectedLayerIndex, "value", existing.id);
                                      } else {
                                        const created = createNote(title, content);
                                        updateLayer(selectedLayerIndex, "value", created.id);
                                      }
                                    }} className="inline-flex items-center gap-2 rounded-lg border border-muted bg-background px-3 py-1 text-xs font-medium hover:bg-muted">Save</button>
                                    <button type="button" onClick={() => {
                                      const existing = notes.find((n) => n.id === layers[selectedLayerIndex].value);
                                      if (existing) deleteNote(existing.id);
                                      updateLayer(selectedLayerIndex, "value", "");
                                    }} className="text-xs text-destructive">Clear</button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
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

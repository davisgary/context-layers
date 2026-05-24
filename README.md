# Layers

Provides LLMs with layered context memory for each request, producing deeper, more context-aware responses based on user data. From the frontend, pick a model and it will attach the layers to every request from the file paths you enter.

> Note: This repository is currently intended to run locally. Environment variables in a local env file control which models and API keys are available to the frontend and server.

## Key concepts

- Extend the context window for LLMs by attaching structured, per-query context "layers." Instead of relying on the model to decide which context to use, Layers maintains an explicit, ordered memory ("structured reasoning memory") that seeds responses and helps form the foundation for LLM reasoning.
- Layers can be loaded from files inside the project (for example the `layers/` directory) or from any folder on your machine by entering the path on the frontend. The more context you provide, the less prompting you'll need and the more reliable, data-rich, and knowledgeable the outputs become.
- Layers can also be created from website URLs. Paste URLs in the UI and the server will fetch, extract the main text, and add it as contextual layers for your request.
- Model selection: the frontend UI exposes model selection; the selected model and API key(s) are configured via environment variables.
- Providers: this project supports OpenAI (OpenAI API), Anthropic Claude (Claude API), and Ollama for running local models.

## Environment variables

You can reference the repository's environment example file (for example `.example.env`) as a starting point. Create a `.env.local` in the project root with your secrets and local configuration. Example keys the app expects or can use:

```env
 # Provider API key (example)
OPENAI_API_KEY=sk-...

ANTHROPIC_API_KEY=sk-...

OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Keep secrets out of source control. If the repo already contains an example file, reference it to see the expected variable names and defaults.

## Recommended files & structure for layers

- Recommended file formats: prefer text-based formats such as Markdown (`.md`), MDX (`.mdx`), HTML (`.html`), or plain text (`.txt`) for skill guides, role instructions, personas, and any structured context you want the model to follow. These formats are human-readable, easy to author, and simple to preprocess (summarize, sanitize, or chunk) before they're attached to model prompts.
- Project folder: keep reusable layers inside the `layers/` directory (already present in this repo). That makes it easy to commit templates and share them across your local sessions.
- Local folders: you may also point the app at absolute paths anywhere on your machine. When running locally this is convenient for temporary or private context layers.

## How to add layers

- Open the app at `http://localhost:3000` (after `npm run dev`).
- On the App Router pages (the UI under `app/`), use the Layers input to paste or type a path to a file or a folder.
- Use the Website URLs input to paste one or more URLs to scrape. The server will fetch the page and extract the primary text (scripts/styles are removed).
- Enable or disable specific layers in the UI before sending a query.

Paths accepted: you can use relative paths (for example `SKILL.md` or `layers/SKILL.md`), local file paths like `Documents/github/repo/SKILL.md`, absolute paths starting with `/` (for example `/Users/you/Documents/SKILL.md`), or tilde-expanded paths like `~/Documents/SKILL.md`. You can also point at folder paths (for example `/Documents` or `~/Documents`) — the server will read supported files inside the folder. Relative paths are resolved from the project root where the Next.js server runs.

For URLs, only `http` and `https` links are accepted. Each scraped URL becomes a layer labeled by the page title (or custom label if provided).

The frontend stores which paths are active for the session and sends those layer paths with each query to the server. The server reads files, parses supported formats (plain text, Markdown), and builds the context bundle for the chosen model.

## Layer reading

The AI integration is programmed to read each layer sequentially — one at a time — and incorporate its content into the context before producing a final answer. This means you can order layers (e.g., priority skill.md first, then persona.md) and the system will process them in that order when composing the prompt for the model.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create your `.env.local` from the example and add API keys

3. Run the dev server

```bash
npm run dev
```

4. Open the app, select a model, and add layers via the App UI (enter paths to `.md` or text files, or point to the `layers/` folder).

## Security & privacy notes

- This app is intended for local development. Be careful when you point the server at folders that contain secrets or sensitive data.
- Do not commit `.env.local` or real API keys to version control.

## Troubleshooting

- If the server cannot read a path, verify that the site has access and that the path is correct (relative paths are resolved from the project root).
- If a model call fails, verify your API key and the model name in `.env.local`.

## Where to look

- `app/` — App Router pages including the layer UI and chat flows where users enter and manage paths.
- `pages/` — legacy Pages Router pages; the app uses a hybrid approach so some routes remain here.
- `lib/` — utilities for auth, session, and file reading.
- `layers/` — recommended place to put reusable files for use as context layers.

## Roadmap & Todos

- [ ] Production build with third-party OAuth for LLM integrations. Implement secure per-user OAuth flows so individual users can sign in with their own LLM provider account (do not rely on API keys in env for user access).
- [ ] Integrate auth — implement user authentication and session management.
- [ ] Integrate DB — add Postgres (Neon) for users, layers, sessions, and provider tokens.
- [ ] Make editable .md files — provide an in-app editor to create and edit Markdown layers, and persist edits (either to filesystem or DB-backed storage) with versioning or save history.
- [ ] Follow-up suggestions — after each model response, generate suggested follow-up prompts or actions (brief & contextual) to help iterate with the model.
- [ ] Simplifying fills to improve efficiency and reduce tokens — optimize prompt templates and layer concatenation (summarize long layers, use templates, or chunk+retrieve) to lower token use while preserving signal.
- [ ] Templates for different topics — create a set of starter `.md` templates in `layers/` (e.g., knowledge graphs, data sets, project brief, persona, etc) that users can quickly enable and customize.
- [x] Move/reorder layers — allow users to reorder layers (drag & drop, menu commands like reorder up/down, and keyboard controls), persist the ordering across sessions, and update any links or references between layers when the order changes.
- [x] Add URL scraping as a data source — implement URL fetching + parsing to turn a web page into one or more layers (fetch HTML, extract main content, convert to Markdown, sanitize), and add field on frontend for a URL.
- [x] Stream answers — implement streaming model responses so the frontend can render partial output as it's produced, improving response time.
- [x] Add caching for processed layers — cache preprocessed layer content (summaries, embeddings, or canonicalized chunks) with a TTL and simple invalidation to avoid re-reading and re-tokenizing unchanged files; this will reduce latency, API token usage, and server load.
- [x] Persist selected layer paths — save the user's active layer file paths for session persistence (local file or DB), so enabled layers are preserved between restarts or sessions.

---

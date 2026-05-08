# Layers

Layers provides LLMs with ordered context for each request, producing deeper, more context-aware responses based on user data. From the frontend, pick a model and it will attach the layers to every request from the file paths you enter.

> Note: This repository is currently intended to run locally. Environment variables in a local env file control which models and API keys are available to the frontend and server.

## Key concepts

- Context layer: a piece of text or document loaded from a file or folder that is appended (or otherwise provided) as context to every model query.
- Local-first: Layers can be pulled from files inside this project (for example the `layers/` dir) or from any folder on your machine by entering a path in the UI.
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

- Recommended file format: use Markdown (`.md`) for skill guides, role instructions, personas, and any structured context you want the model to follow. Markdown is readable and easy to author.
- Project folder: keep reusable layers inside the `layers/` directory (already present in this repo). That makes it easy to commit templates and share them across your local sessions.
- Local folders: you may also point the app at absolute paths anywhere on your machine. When running locally this is convenient for temporary or private context layers.

## How to add layers

- Open the app at `http://localhost:3000` (after `npm run dev`).
- On the App Router pages (the UI under `app/`), use the Layers input to paste or type a path to a file or a folder.
- Enable or disable specific layers in the UI before sending a query.

Paths accepted: you can use relative paths (for example `SKILL.md` or `layers/SKILL.md`), local file paths like `Documents/github/repo/SKILL.md`, absolute paths starting with `/` (for example `/Users/you/Documents/SKILL.md`), or tilde-expanded paths like `~/Documents/SKILL.md`. You can also point at folder paths (for example `/Documents` or `~/Documents`) — the server will read supported files inside the folder. Relative paths are resolved from the project root where the Next.js server runs.

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
- `layers/` — recommended place to put reusable `.md or .mdx` files for use as context layers.

---

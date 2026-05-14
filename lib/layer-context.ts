import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type LayerContextFile = {
  name: string;
  content: string;
};

export type LayerPathInput = {
  path: string;
  label?: string;
};

function getLayersDir(): string {
  // compute on demand to avoid filesystem/path operations at module import time
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "layers");
}

function getUserHomeDir(): string {
  // return the user's home directory when needed (avoid top-level os calls)
  return os.homedir();
}

export async function loadLayerContext(
  selectedLayers?: LayerPathInput[]
): Promise<LayerContextFile[]> {
  // Simple in-memory cache for active server instance to avoid repeated disk I/O
  // Keyed by JSON.stringify of selectedLayers (or "__all__" for all layers)
  // Cache is intentionally small and not persisted across restarts.
  const cacheKey = selectedLayers && selectedLayers.length > 0 ? `sel:${JSON.stringify(selectedLayers.map(l=>l.path))}` : "__all__";
  // @ts-ignore - attach cache to function to keep module-level state minimal
  const cache: Map<string, LayerContextFile[]> = (loadLayerContext as any).cache || new Map();
  (loadLayerContext as any).cache = cache;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) || [];
  }
  if (selectedLayers && selectedLayers.length > 0) {
    return loadSelectedLayers(selectedLayers);
  }

  let entries: string[] = [];

  try {
  entries = await fs.readdir(getLayersDir());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const markdownFiles = entries
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const contexts = await Promise.all(
    markdownFiles.map(async (fileName) => {
  const fullPath = path.join(getLayersDir(), fileName);
      const content = await fs.readFile(fullPath, "utf8");
      return {
        name: fileName,
        content: content.trim(),
      };
    })
  );

  return contexts.filter((context) => context.content.length > 0);
}

export function buildLayeredPrompt(
  query: string,
  contexts: LayerContextFile[]
): string {
  // Instruction for the model to follow.
  const instructionBlock = [
    "System instructions:",
    "You are a smart, professional AI assistant. Respond with clarity, precision, and a confident, approachable voice appropriate for technical and executive readers.",
    "Prioritize and use factual data from the provided layer files. When you cite a specific fact or quote from a layer, include an inline citation like (Layer: filename.md).",
  "Structure your response using clear Markdown sections (headings, lists, and fenced code blocks where helpful). Aim for a short concise summary first, followed by a detailed explanation with inline citations to layer files when appropriate, then concrete recommendations or next steps, and finally a short list of sources. Use fenced code blocks for any example commands or code and prefer Markdown lists and headings for readability. If you include Markdown tables, ensure each row is on its own line with a header separator row.",
    "Provide technical depth where appropriate: show concise examples, commands, or code snippets if they help illustrate the point.",
    "When there are trade-offs or multiple options, present a brief pros/cons comparison and a recommended choice with reasoning.",
    "If layer files conflict or are ambiguous, explicitly call out the conflict, state which source you prioritized and why, and list any assumptions you made.",
    "If the layers lack needed details, state what is missing, why it matters, and ask up to 3 concise clarifying questions to get the required context.",
    "Keep language professional and avoid excessive hedging; be clear about uncertainty and confidence levels (e.g., high/medium/low).",
  ].join(" ");

  const contextBlock =
    contexts.length > 0
      ? contexts.map((context) => `### ${context.name}\n${context.content}`).join("\n\n")
      : [
          "Overview:",
          "No layer files were provided. You are a helpful assistant that reviews user-provided layer source files to build layered context.",
          "If no layers are provided, use your best judgment to answer the user's query, state any assumptions, and offer clarifying questions to improve accuracy.",
        ].join(" ");

  return [
    instructionBlock,
    "",
    "Layered context:",
    contextBlock,
    "",
    `User query: ${query}`,
  ].join("\n");
}

async function loadSelectedLayers(
  selectedLayers: LayerPathInput[]
): Promise<LayerContextFile[]> {
  const contexts = await Promise.all(
    selectedLayers.map(async (layer) => {
      const resolvedPath = await resolveLayerPath(layer.path.trim());
      const content = (await fs.readFile(resolvedPath, "utf8")).trim();

      return {
        name: layer.label?.trim() || path.basename(layer.path),
        content,
      };
    })
  );

  return contexts.filter((context) => context.content.length > 0);
}

async function resolveLayerPath(layerPath: string): Promise<string> {
  if (layerPath.length === 0) {
    throw new Error("Layer path cannot be empty.");
  }

  const normalizedInput = normalizeInputPath(layerPath);
  const pathWithTilde = expandHomePath(normalizedInput);
  const attempted = new Set<string>();

  const tryCandidate = async (candidate: string): Promise<string | null> => {
    const normalizedCandidate = path.normalize(candidate);
    attempted.add(normalizedCandidate);
    if (await fileExists(normalizedCandidate)) {
      return normalizedCandidate;
    }
    return null;
  };

  const tryWithGithubVariants = async (
    candidate: string
  ): Promise<string | null> => {
    const variants = githubCaseVariants(candidate);
    for (const variant of variants) {
      const match = await tryCandidate(variant);
      if (match) {
        return match;
      }
    }
    return null;
  };

  if (path.isAbsolute(pathWithTilde)) {
    const absolutePath = path.normalize(pathWithTilde);
    const absoluteMatch = await tryWithGithubVariants(absolutePath);
    if (absoluteMatch) return absoluteMatch;

    const correctedHomeAbsolute = path.resolve(
      getUserHomeDir(),
      absolutePath.slice(1)
    );
    const correctedMatch = await tryWithGithubVariants(correctedHomeAbsolute);
    if (correctedMatch) return correctedMatch;

    const autoDiscovered = await findByFileNameInGithubDirs(
      path.basename(pathWithTilde),
      attempted
    );
    if (autoDiscovered) return autoDiscovered;

    throw buildNotFoundError(layerPath, attempted);
  }

  if (pathWithTilde.startsWith("Users/")) {
    const usersAbsolutePath = path.resolve(path.sep, pathWithTilde);
    const usersAbsoluteMatch = await tryWithGithubVariants(usersAbsolutePath);
    if (usersAbsoluteMatch) return usersAbsoluteMatch;

    const autoDiscovered = await findByFileNameInGithubDirs(
      path.basename(pathWithTilde),
      attempted
    );
    if (autoDiscovered) return autoDiscovered;

    throw buildNotFoundError(layerPath, attempted);
  }

  if (normalizedInput.startsWith("./") || normalizedInput.startsWith("../")) {
  const projectRelativePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), pathWithTilde);
    const projectRelativeMatch = await tryWithGithubVariants(projectRelativePath);
    if (projectRelativeMatch) return projectRelativeMatch;

    const autoDiscovered = await findByFileNameInGithubDirs(
      path.basename(pathWithTilde),
      attempted
    );
    if (autoDiscovered) return autoDiscovered;

    throw buildNotFoundError(layerPath, attempted);
  }

  const layersRelativePath = path.resolve(/*turbopackIgnore: true*/ getLayersDir(), pathWithTilde);
  const layersMatch = await tryWithGithubVariants(layersRelativePath);
  if (layersMatch) return layersMatch;

  const homeRelativePath = path.resolve(/*turbopackIgnore: true*/ getUserHomeDir(), pathWithTilde);
  const homeMatch = await tryWithGithubVariants(homeRelativePath);
  if (homeMatch) return homeMatch;

  const autoDiscovered = await findByFileNameInGithubDirs(
    path.basename(pathWithTilde),
    attempted
  );
  if (autoDiscovered) return autoDiscovered;

  throw buildNotFoundError(layerPath, attempted);
}

function normalizeInputPath(inputPath: string): string {
  return inputPath.replaceAll("\\", "/");
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") {
    return getUserHomeDir();
  }

  if (inputPath.startsWith(`~${path.sep}`)) {
    return path.join(/*turbopackIgnore: true*/ getUserHomeDir(), inputPath.slice(2));
  }

  return inputPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function githubCaseVariants(filePath: string): string[] {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const variants = new Set<string>([normalizedPath]);

  variants.add(normalizedPath.replaceAll("/github/", "/GitHub/"));
  variants.add(normalizedPath.replaceAll("/GitHub/", "/github/"));

  return Array.from(variants);
}

function buildNotFoundError(inputPath: string, attempted: Set<string>): Error {
  const attemptedList = Array.from(attempted).slice(0, 8);
  return new Error(
    [
      `Layer file not found for path: ${inputPath}`,
      `Tried: ${attemptedList.join(" | ")}`,
    ].join(" ")
  );
}

async function findByFileNameInGithubDirs(
  fileName: string,
  attempted: Set<string>
): Promise<string | null> {
  if (!fileName) {
    return null;
  }

  const roots = [
    path.join(/*turbopackIgnore: true*/ getUserHomeDir(), "Documents", "GitHub"),
    path.join(/*turbopackIgnore: true*/ getUserHomeDir(), "Documents", "github"),
  ];

  for (const root of roots) {
    const found = await findFileByName(root, fileName, 0, 6);
    if (found) {
      attempted.add(found);
      return found;
    }
  }

  return null;
}

async function findFileByName(
  dirPath: string,
  fileName: string,
  depth: number,
  maxDepth: number
): Promise<string | null> {
  if (depth > maxDepth) {
    return null;
  }

  let entries: Array<{
    isFile: () => boolean;
    isDirectory: () => boolean;
    name: string | Buffer;
  }>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryName = String(entry.name);
    if (entry.isFile() && entryName === fileName) {
      return path.join(dirPath, entryName);
    }
  }

  for (const entry of entries) {
    const entryName = String(entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (
      entryName === ".git" ||
      entryName === "node_modules" ||
      entryName === ".next"
    ) {
      continue;
    }

    const found = await findFileByName(
      path.join(dirPath, entryName),
      fileName,
      depth + 1,
      maxDepth
    );
    if (found) {
      return found;
    }
  }

  return null;
}

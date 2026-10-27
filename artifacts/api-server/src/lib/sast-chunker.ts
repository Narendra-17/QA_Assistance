import path from "node:path";
import {
  parseSourceFiles,
  type AstNode,
  type ParseSourceFilesResult,
  type ParsedFile,
} from "./ast-parser";

export const SAST_CHUNK_CHAR_BUDGET = 6_000;
export const SAST_CHUNK_OVERLAP_LINES = 15;
export const SAST_AI_CHUNK_CHAR_BUDGET = 72_000;

export interface SastChunk {
  id: string;
  file: string;
  language: string;
  startLine: number;
  endLine: number;
  text: string;
  priority: number;
  priorityReasons: string[];
}

export interface UnscannedChunk {
  file: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export interface TaintPriorityHint {
  sourceFile: string;
  sourceLine: number;
  sinkFile: string;
  sinkLine: number;
}

interface SourceSpan {
  startLine: number;
  endLine: number;
  bodyText?: string;
}

interface ChunkBuildResult {
  chunks: SastChunk[];
  fallbackFiles: Array<{ name: string; reason: string }>;
}

const SOURCE_SIGNAL = /(?:\breq(?:uest)?\.(?:params|query|body|headers|cookies|files?)\b|\brequest\.(?:args|form|values|data|json|query_params)\b|\bprocess\.env\b|\bos\.environ\b|\binput\s*\(|\breadline\b|\bstdin\b|\bargv\b|\bgetparameter\s*\(|\bcookie\b|\bauthorization\b)/i;
const SINK_SIGNAL = /\b(?:query|execute|executemany|raw|exec|eval|innerHTML|outerHTML|document\.write|send_file|open|readFile|writeFile|fetch|request|redirect|deserialize|pickle\.loads|yaml\.load)\s*\(|\.(?:innerHTML|outerHTML)\s*=/i;
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use", "options", "head", "route"]);

function normalizeFileName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
}

function sourceLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function rangeTextLength(lines: string[], startLine: number, endLine: number): number {
  if (endLine < startLine) return 0;
  return lines.slice(startLine - 1, endLine).join("\n").length;
}

function lineRange(node: AstNode, maxLine: number): SourceSpan {
  const startLine = Math.max(1, Math.min(maxLine, node.line || 1));
  const endLine = Math.max(startLine, Math.min(maxLine, node.endLine ?? node.line ?? startLine));
  return { startLine, endLine };
}

function isFunction(node: AstNode): boolean {
  return node.kind === "function";
}

function isFunctionUnit(node: AstNode): boolean {
  return node.kind === "function"
    || (node.kind === "variable" && node.value?.kind === "function")
    || isRouteCall(node);
}

function isRouteCall(node: AstNode): boolean {
  if (node.kind !== "call" || !node.callee) return false;
  let callee = node.callee;
  while (callee.kind === "member" && callee.children[0]) {
    const memberName = String(callee.name ?? "").toLowerCase();
    if (ROUTE_METHODS.has(memberName)) return true;
    callee = callee.children[0];
  }
  return false;
}

function splitChildren(node: AstNode): AstNode[] {
  if (node.kind === "function") return node.body ?? [];
  if (node.kind === "variable" && node.value?.kind === "function") return node.value.body ?? [];
  if (node.kind === "if") return [...(node.body ?? []), ...(node.params ?? [])];
  if (node.kind === "call" && isRouteCall(node)) {
    return (node.args ?? []).filter(isFunction);
  }
  if (node.kind === "other") return node.children.filter(child => child.endLine != null);
  return [];
}

function splitLongLine(line: string, lineNumber: number, maxChars: number): SourceSpan[] {
  const overlapChars = Math.min(240, Math.max(40, Math.floor(maxChars * 0.04)));
  const step = Math.max(1, maxChars - overlapChars);
  const spans: SourceSpan[] = [];
  for (let start = 0; start < line.length; start += step) {
    spans.push({
      startLine: lineNumber,
      endLine: lineNumber,
      bodyText: line.slice(start, Math.min(line.length, start + maxChars)),
    });
    if (start + maxChars >= line.length) break;
  }
  return spans;
}

function lineWindows(
  lines: string[],
  startLine: number,
  endLine: number,
  maxChars: number,
): SourceSpan[] {
  const spans: SourceSpan[] = [];
  let cursor = startLine;
  while (cursor <= endLine) {
    const windowStart = cursor;
    let end = windowStart - 1;
    let chars = 0;
    let handledLongLine = false;
    for (let lineNumber = windowStart; lineNumber <= endLine; lineNumber++) {
      const line = lines[lineNumber - 1] ?? "";
      if (line.length > maxChars) {
        if (end >= windowStart) spans.push({ startLine: windowStart, endLine: end });
        spans.push(...splitLongLine(line, lineNumber, maxChars));
        end = lineNumber;
        handledLongLine = true;
        break;
      }
      const nextChars = chars + line.length + (end >= windowStart ? 1 : 0);
      if (nextChars > maxChars && end >= windowStart) break;
      chars = nextChars;
      end = lineNumber;
    }
    if (handledLongLine) {
      cursor = end + 1;
      continue;
    }
    if (end >= windowStart) spans.push({ startLine: windowStart, endLine: end });
    if (end >= endLine) break;
    const nextStart = Math.max(windowStart + 1, end - SAST_CHUNK_OVERLAP_LINES + 1);
    if (nextStart <= cursor) break;
    cursor = nextStart;
  }
  return spans;
}

function addGaps(
  startLine: number,
  endLine: number,
  childSpans: SourceSpan[],
): SourceSpan[] {
  const output: SourceSpan[] = [];
  let cursor = startLine;
  for (const span of childSpans) {
    if (span.startLine > cursor) output.push({ startLine: cursor, endLine: span.startLine - 1 });
    output.push(span);
    cursor = Math.max(cursor, span.endLine + 1);
  }
  if (cursor <= endLine) output.push({ startLine: cursor, endLine });
  return output;
}

function splitAstSpan(
  node: AstNode | undefined,
  span: SourceSpan,
  lines: string[],
  maxBodyChars: number,
  depth = 0,
): SourceSpan[] {
  if (rangeTextLength(lines, span.startLine, span.endLine) <= maxBodyChars) return [span];

  const children = depth < 12
    ? (node ? splitChildren(node) : [])
        .map(child => ({ node: child, ...lineRange(child, lines.length) }))
        .filter(child => child.endLine >= span.startLine && child.startLine <= span.endLine)
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
    : [];

  if (!children.length) return lineWindows(lines, span.startLine, span.endLine, maxBodyChars);

  const splitChildrenSpans = children.flatMap(child => splitAstSpan(
    child.node,
    {
      startLine: Math.max(span.startLine, child.startLine),
      endLine: Math.min(span.endLine, child.endLine),
    },
    lines,
    maxBodyChars,
    depth + 1,
  ));
  const withGaps = addGaps(span.startLine, span.endLine, splitChildrenSpans);
  return packSpans(withGaps, lines, maxBodyChars, span.startLine);
}

function packSpans(
  spans: SourceSpan[],
  lines: string[],
  maxBodyChars: number,
  minStartLine: number,
): SourceSpan[] {
  const output: SourceSpan[] = [];
  let currentStart: number | undefined;
  let currentEnd: number | undefined;

  const flush = (): void => {
    if (currentStart == null || currentEnd == null) return;
    output.push({ startLine: currentStart, endLine: currentEnd });
    currentStart = undefined;
    currentEnd = undefined;
  };

  for (const span of spans) {
    if (span.bodyText != null) {
      flush();
      output.push(span);
      continue;
    }
    if (currentStart == null || currentEnd == null) {
      currentStart = span.startLine;
      currentEnd = span.endLine;
      continue;
    }
    const candidateEnd = Math.max(currentEnd, span.endLine);
    if (rangeTextLength(lines, currentStart, candidateEnd) <= maxBodyChars) {
      currentEnd = candidateEnd;
      continue;
    }

    const previousEnd = currentEnd;
    flush();
    currentStart = Math.max(minStartLine, previousEnd - (SAST_CHUNK_OVERLAP_LINES - 1));
    currentEnd = span.endLine;
    if (rangeTextLength(lines, currentStart, currentEnd) > maxBodyChars) {
      const overflow = lineWindows(lines, currentStart, currentEnd, maxBodyChars);
      output.push(...overflow);
      currentStart = undefined;
      currentEnd = undefined;
    }
  }
  flush();
  return output;
}

function importLineSet(parsed: ParsedFile, lines: string[]): Set<number> {
  const imports = new Set<number>();
  for (const node of parsed.root.body ?? parsed.root.children) {
    if (node.kind !== "import") continue;
    const span = lineRange(node, lines.length);
    for (let line = span.startLine; line <= span.endLine; line++) imports.add(line);
  }

  const importStart = /^\s*(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\b.*=\s*require\s*\(|require\s*\()/;
  for (let index = 0; index < lines.length; index++) {
    if (!importStart.test(lines[index])) continue;
    let depth = 0;
    for (let cursor = index; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      imports.add(cursor + 1);
      for (const char of line) {
        if ("{[(".includes(char)) depth++;
        if ("}])".includes(char)) depth--;
      }
      if (depth <= 0) break;
    }
  }
  return imports;
}

function languageForName(name: string, parsed?: ParsedFile): string {
  if (parsed?.language === "python") return "Python";
  if (parsed?.language === "javascript") {
    return /\.tsx?$/i.test(name) ? "TypeScript" : "JavaScript";
  }
  const extension = path.extname(name).replace(/^\./, "").toLowerCase();
  return extension ? `${extension.toUpperCase()} source` : "Source";
}

function commentForLanguage(language: string): string {
  return language === "Python" ? "#" : "//";
}

function importPrelude(lines: string[], importLines: Set<number>): string {
  return [...importLines]
    .sort((a, b) => a - b)
    .map(line => lines[line - 1])
    .filter((line): line is string => line != null)
    .join("\n");
}

function makeChunkText(
  file: { name: string; content: string },
  language: string,
  lines: string[],
  imports: string,
  span: SourceSpan,
  id: string,
): string {
  const marker = commentForLanguage(language);
  const code = span.bodyText ?? lines.slice(span.startLine - 1, span.endLine).join("\n");
  const importText = imports || "(no file-level imports)";
  return [
    `[SAST CHUNK ${id}]`,
    `File: ${JSON.stringify(file.name)}`,
    `Language: ${language}`,
    `Original source lines: ${span.startLine}-${span.endLine}`,
    `${marker} File imports for context:`,
    imports ? `\`\`\`\n${importText}\n\`\`\`` : `${marker} ${importText}`,
    `${marker} Chunk source (exact original source lines):`,
    `\`\`\`\n${code}\n\`\`\``,
  ].join("\n");
}

function chunkPriority(
  text: string,
  fileName: string,
  startLine: number,
  endLine: number,
  taintHints: TaintPriorityHint[],
): { priority: number; priorityReasons: string[] } {
  const hasSource = SOURCE_SIGNAL.test(text);
  const hasSink = SINK_SIGNAL.test(text);
  const normalizedFile = normalizeFileName(fileName);
  const hasTaintFinding = taintHints.some(hint => {
    const sourceMatch = normalizeFileName(hint.sourceFile) === normalizedFile
      && hint.sourceLine >= startLine && hint.sourceLine <= endLine;
    const sinkMatch = normalizeFileName(hint.sinkFile) === normalizedFile
      && hint.sinkLine >= startLine && hint.sinkLine <= endLine;
    return sourceMatch || sinkMatch;
  });
  const sensitivePath = /(auth|login|password|token|session|payment|admin|route|controller|handler|query|model)/i.test(fileName);
  const reasons: string[] = [];
  if (hasTaintFinding) reasons.push("existing taint finding");
  if (hasSource) reasons.push("source signal");
  if (hasSink) reasons.push("sink signal");
  if (sensitivePath) reasons.push("security-sensitive file");
  return {
    priority: (hasTaintFinding ? 100 : 0) + (hasSource ? 30 : 0) + (hasSink ? 30 : 0) + (sensitivePath ? 10 : 0),
    priorityReasons: reasons,
  };
}

function astUnits(parsed: ParsedFile, lines: string[], imports: Set<number>): Array<{ node?: AstNode; span: SourceSpan }> {
  const units: Array<{ node?: AstNode; span: SourceSpan }> = [];
  for (const node of parsed.root.body ?? parsed.root.children) {
    if (node.kind === "import") continue;
    const isPythonClass = parsed.language === "python"
      && node.kind === "other"
      && /^\s*class\s+[A-Za-z_]/.test(node.text);
    if (isPythonClass && node.children.length > 0) {
      for (const member of node.children.filter(isFunction)) {
        units.push({ node: member, span: lineRange(member, lines.length) });
      }
      continue;
    }
    if (!isFunctionUnit(node)) continue;
    const span = lineRange(node, lines.length);
    if (span.endLine < span.startLine) continue;
    units.push({ node, span });
  }

  const covered = new Set<number>(imports);
  for (const unit of units) {
    for (let line = unit.span.startLine; line <= unit.span.endLine; line++) covered.add(line);
  }
  let line = 1;
  while (line <= lines.length) {
    if (covered.has(line)) {
      line++;
      continue;
    }
    const startLine = line;
    while (line <= lines.length && !covered.has(line)) line++;
    const endLine = line - 1;
    if (lines.slice(startLine - 1, endLine).some(sourceLine => sourceLine.trim())) {
      units.push({ span: { startLine, endLine } });
    }
  }
  return units.sort((a, b) => a.span.startLine - b.span.startLine || a.span.endLine - b.span.endLine);
}

function buildParsedFileChunks(
  file: { name: string; content: string },
  parsed: ParsedFile,
  taintHints: TaintPriorityHint[],
): SastChunk[] {
  const lines = sourceLines(file.content);
  const importsSet = importLineSet(parsed, lines);
  const imports = importPrelude(lines, importsSet);
  const language = languageForName(file.name, parsed);
  const units = astUnits(parsed, lines, importsSet);
  if (units.length === 0 && file.content.trim()) {
    units.push({ span: { startLine: 1, endLine: Math.max(1, lines.length) } });
  }

  const chunks: SastChunk[] = [];
  let ordinal = 0;
  for (const unit of units) {
    const marker = commentForLanguage(language);
    const prefixLength = makeChunkText(
      file, language, lines, imports,
      { startLine: unit.span.startLine, endLine: unit.span.endLine },
      "C000000",
    ).length - rangeTextLength(lines, unit.span.startLine, unit.span.endLine);
    const bodyBudget = Math.max(256, SAST_CHUNK_CHAR_BUDGET - prefixLength - marker.length - 8);
    const packed = splitAstSpan(unit.node, unit.span, lines, bodyBudget);
    for (const span of packed) {
      ordinal++;
      const id = `C${String(ordinal).padStart(6, "0")}`;
      const text = makeChunkText(file, language, lines, imports, span, id);
      const priority = chunkPriority(text, file.name, span.startLine, span.endLine, taintHints);
      chunks.push({
        id,
        file: file.name,
        language,
        startLine: span.startLine,
        endLine: span.endLine,
        text,
        ...priority,
      });
    }
  }
  return chunks;
}

function fallbackImportPrelude(lines: string[]): string {
  const selected = new Set<number>();
  const starts = /^\s*(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\b.*=\s*require\s*\(|require\s*\()/;
  for (let index = 0; index < lines.length; index++) {
    if (!starts.test(lines[index])) continue;
    let depth = 0;
    for (let cursor = index; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      selected.add(cursor + 1);
      for (const char of line) {
        if ("{[(".includes(char)) depth++;
        if ("}])".includes(char)) depth--;
      }
      if (depth <= 0) break;
    }
  }
  return importPrelude(lines, selected);
}

function buildFallbackFileChunks(
  file: { name: string; content: string },
  taintHints: TaintPriorityHint[],
): SastChunk[] {
  const lines = sourceLines(file.content);
  if (!file.content.trim()) return [];
  const language = languageForName(file.name);
  const imports = fallbackImportPrelude(lines);
  const marker = commentForLanguage(language);
  const provisional = makeChunkText(
    file, language, lines, imports,
    { startLine: 1, endLine: Math.max(1, lines.length) },
    "C000000",
  );
  const bodyBudget = Math.max(256, SAST_CHUNK_CHAR_BUDGET - provisional.length + file.content.length - marker.length - 8);
  const spans = lineWindows(lines, 1, lines.length, bodyBudget);
  return spans.map((span, index) => {
    const id = `C${String(index + 1).padStart(6, "0")}`;
    const text = makeChunkText(file, language, lines, imports, span, id);
    const priority = chunkPriority(text, file.name, span.startLine, span.endLine, taintHints);
    return { id, file: file.name, language, startLine: span.startLine, endLine: span.endLine, text, ...priority };
  });
}

export async function buildSastChunks(
  files: Array<{ name: string; content: string }>,
  taintHints: TaintPriorityHint[] = [],
  parserResult?: ParseSourceFilesResult,
): Promise<ChunkBuildResult> {
  const result = parserResult ?? await parseSourceFiles(files);
  const parsedByName = new Map(result.parsed.map(file => [normalizeFileName(file.name), file]));
  const failuresByName = new Map(result.skipped.map(file => [normalizeFileName(file.name), file.reason]));
  const chunks: SastChunk[] = [];
  const fallbackFiles: Array<{ name: string; reason: string }> = [];

  for (const file of files) {
    const key = normalizeFileName(file.name);
    const parsed = parsedByName.get(key);
    if (parsed) {
      try {
        chunks.push(...buildParsedFileChunks(file, parsed, taintHints));
      } catch (error) {
        const reason = `AST chunk construction failed: ${error instanceof Error ? error.message : String(error)}`;
        fallbackFiles.push({ name: file.name, reason });
        chunks.push(...buildFallbackFileChunks(file, taintHints));
      }
      continue;
    }
    const reason = failuresByName.get(key) ?? "Parser result unavailable; using line-based chunks.";
    fallbackFiles.push({ name: file.name, reason });
    chunks.push(...buildFallbackFileChunks(file, taintHints));
  }

  const uniqueChunks = chunks.map((chunk, index) => {
    const id = `C${String(index + 1).padStart(6, "0")}`;
    return {
      ...chunk,
      id,
      text: chunk.text.replace(`[SAST CHUNK ${chunk.id}]`, `[SAST CHUNK ${id}]`),
    };
  });
  return { chunks: uniqueChunks, fallbackFiles };
}

export function selectSastChunksForAi(
  chunks: SastChunk[],
  charBudget = SAST_AI_CHUNK_CHAR_BUDGET,
): { selected: SastChunk[]; unscanned: UnscannedChunk[] } {
  const ordered = chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => b.chunk.priority - a.chunk.priority || a.index - b.index)
    .map(entry => entry.chunk);
  const selected: SastChunk[] = [];
  const unscanned: UnscannedChunk[] = [];
  let usedChars = 0;
  for (const chunk of ordered) {
    if (chunk.text.length <= charBudget - usedChars) {
      selected.push(chunk);
      usedChars += chunk.text.length;
      continue;
    }
    unscanned.push({
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      reason: chunk.text.length > charBudget
        ? `Chunk exceeds the ${charBudget.toLocaleString()} character AI context budget.`
        : `AI context budget exhausted after higher-priority chunks (${chunk.priorityReasons.join(", ") || "standard priority"}).`,
    });
  }
  return { selected, unscanned };
}

export function findSnippetLineInChunk(
  fileContent: string,
  snippet: string,
  startLine: number,
  endLine: number,
  preferredLine?: number,
): number | null {
  if (!fileContent || !snippet) return null;
  const anchor = snippet.split("\n").map(line => line.trim()).find(line => line.length > 6);
  if (!anchor) return null;
  const lines = fileContent.split(/\r?\n/);
  const minLine = Math.max(1, startLine);
  const maxLine = Math.min(lines.length, Math.max(minLine, endLine));
  const matches: number[] = [];
  for (let line = minLine; line <= maxLine; line++) {
    if (lines[line - 1].includes(anchor)) matches.push(line);
  }
  if (!matches.length) return null;
  if (preferredLine != null) {
    return matches.reduce((closest, line) =>
      Math.abs(line - preferredLine) < Math.abs(closest - preferredLine) ? line : closest,
    );
  }
  return matches[0];
}

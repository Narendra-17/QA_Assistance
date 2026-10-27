import path from "node:path";
import { parseSourceFiles, type AstImportBinding, type AstNode, type ParsedFile } from "./ast-parser";

export type TaintVulnerabilityClass =
  | "SQL"
  | "Command"
  | "Code"
  | "XSS"
  | "Path"
  | "SSRF"
  | "Redirect"
  | "Deserialization";

export interface DataFlowStep {
  file: string;
  line: number;
  snippet: string;
  step: string;
}

export interface TaintFinding {
  sourceFile: string;
  sourceLine: number;
  sinkFile: string;
  sinkLine: number;
  vulnClass: TaintVulnerabilityClass;
  confidence: "confirmed" | "probable";
  path: DataFlowStep[];
  codeSnippet: string;
  sinkName: string;
}

export interface TaintScanResult {
  findings: TaintFinding[];
  parsedFiles: string[];
  skippedFiles: Array<{ name: string; reason: string }>;
  parsedAst: ParsedFile[];
}

interface TaintTrace {
  sourceFile: string;
  sourceLine: number;
  path: DataFlowStep[];
  unresolvedImport: boolean;
  sanitizedFor: Set<TaintVulnerabilityClass>;
}

interface AbstractValue {
  traces: TaintTrace[];
  properties?: Map<string, AbstractValue>;
  elements?: AbstractValue[];
}

interface FunctionDefinition {
  file: ParsedFile;
  node: AstNode;
  name: string;
  aliases: Set<string>;
  key: string;
}

interface ModuleBinding extends AstImportBinding {
  resolvedFile?: string;
}

interface AnalysisContext {
  files: Map<string, ParsedFile>;
  functionsByFile: Map<string, Map<string, FunctionDefinition[]>>;
  importsByFile: Map<string, Map<string, ModuleBinding>>;
  unresolvedAliases: Map<string, Set<string>>;
  findings: TaintFinding[];
  invocationCount: number;
}

const MAX_CALL_DEPTH = 6;
const MAX_FUNCTION_INVOCATIONS = 2_000;
const MAX_FINDINGS = 400;
const MAX_TRACES_PER_VALUE = 12;
const MAX_PATH_STEPS = 18;

export const LANGUAGE_TAINT_CONFIG = {
  javascript: {
    sourcePatterns: [
      { pattern: /^(?:req|request)\.(?:query|body|params|headers|cookies)(?:\.|$)/, description: "HTTP request input" },
      { pattern: /^process\.argv(?:\.|$)/, description: "process command-line arguments" },
      { pattern: /^event\.body(?:\.|$)/, description: "event body" },
    ],
    sinkMethods: {
      SQL: ["db.query", "db.execute", "db.raw", "cursor.execute", "sequelize.query", "knex.raw"],
      Command: ["exec", "execSync", "spawn(shell: true)", "os.system", "subprocess(shell=True)"],
      Code: ["eval", "new Function", "vm.*"],
      XSS: ["innerHTML", "outerHTML", "document.write", "dangerouslySetInnerHTML", "res.send(HTML)", "render_template_string"],
      Path: ["fs.readFile", "fs.writeFile", "fs.createReadStream", "open"],
      SSRF: ["fetch", "axios.*", "http.get", "requests.get"],
      Redirect: ["res.redirect", "location.href"],
      Deserialization: ["pickle.loads", "yaml.load"],
    },
    sanitizers: ["parameterized query", "escape", "validator/zod parse", "path.resolve + startsWith", "allowlist", "encodeURIComponent", "DOMPurify", "shlex.quote"],
  },
  python: {
    sourcePatterns: [
      { pattern: /^request\.(?:args|form|json|get|post)(?:\.|$)/, description: "Python request input" },
      { pattern: /^process\.argv(?:\.|$)/, description: "process command-line arguments" },
      { pattern: /^event\.body(?:\.|$)/, description: "event body" },
    ],
    sinkMethods: {
      SQL: ["db.query", "db.execute", "db.raw", "cursor.execute", "sequelize.query", "knex.raw"],
      Command: ["os.system", "subprocess(shell=True)"],
      Code: ["eval", "new Function", "vm.*"],
      XSS: ["document.write", "render_template_string"],
      Path: ["open"],
      SSRF: ["requests.get", "http.get"],
      Redirect: ["res.redirect"],
      Deserialization: ["pickle.loads", "yaml.load"],
    },
    sanitizers: ["parameterized query", "escape", "validator/zod parse", "path.resolve + startsWith", "allowlist", "DOMPurify", "shlex.quote"],
  },
} as const;

const EMPTY_VALUE: AbstractValue = { traces: [] };

function normalizeFile(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function nodeText(node: AstNode): string {
  return node.text.replace(/\s+/g, " ").trim().slice(0, 400);
}

function sourceStep(file: string, node: AstNode, detail: string): DataFlowStep {
  return { file, line: node.line, snippet: nodeText(node), step: detail };
}

function cloneTraces(traces: TaintTrace[]): TaintTrace[] {
  return traces.slice(0, MAX_TRACES_PER_VALUE).map(trace => ({
    ...trace,
    path: trace.path.slice(0, MAX_PATH_STEPS),
    sanitizedFor: new Set(trace.sanitizedFor),
  }));
}

function mergeValues(...values: AbstractValue[]): AbstractValue {
  const traces = new Map<string, TaintTrace>();
  const properties = new Map<string, AbstractValue>();
  const elements: AbstractValue[] = [];
  for (const value of values) {
    for (const trace of value.traces) {
      const key = `${trace.sourceFile}:${trace.sourceLine}:${trace.path.at(-1)?.file}:${trace.path.at(-1)?.line}:${[...trace.sanitizedFor].sort().join(",")}`;
      if (!traces.has(key)) traces.set(key, trace);
    }
    for (const [key, nested] of value.properties ?? []) {
      properties.set(key, mergeValues(properties.get(key) ?? EMPTY_VALUE, nested));
    }
    if (value.elements) {
      for (let index = 0; index < value.elements.length; index++) {
        elements[index] = mergeValues(elements[index] ?? EMPTY_VALUE, value.elements[index]);
      }
    }
  }
  return {
    traces: [...traces.values()].slice(0, MAX_TRACES_PER_VALUE),
    properties: properties.size ? properties : undefined,
    elements: elements.length ? elements : undefined,
  };
}

function addStep(value: AbstractValue, file: string, node: AstNode, detail: string): AbstractValue {
  const step = sourceStep(file, node, detail);
  return {
    ...value,
    traces: cloneTraces(value.traces).map(trace => {
      const last = trace.path.at(-1);
      if (last?.file === step.file && last.line === step.line && last.step === step.step) return trace;
      return { ...trace, path: [...trace.path, step].slice(-MAX_PATH_STEPS) };
    }),
    properties: value.properties
      ? new Map([...value.properties].map(([key, nested]) => [key, addStep(nested, file, node, detail)]))
      : undefined,
    elements: value.elements?.map(nested => addStep(nested, file, node, detail)),
  };
}

function sanitizeFor(value: AbstractValue, vulnClass: TaintVulnerabilityClass): AbstractValue {
  const sanitize = (traces: TaintTrace[]) => traces.map(trace => ({
    ...trace,
    sanitizedFor: new Set([...trace.sanitizedFor, vulnClass]),
  }));
  return {
    ...value,
    traces: sanitize(value.traces),
    properties: value.properties
      ? new Map([...value.properties].map(([key, nested]) => [key, sanitizeFor(nested, vulnClass)]))
      : undefined,
    elements: value.elements?.map(nested => sanitizeFor(nested, vulnClass)),
  };
}

function sanitizeForAll(value: AbstractValue): AbstractValue {
  const allClasses: TaintVulnerabilityClass[] = ["SQL", "Command", "Code", "XSS", "Path", "SSRF", "Redirect", "Deserialization"];
  return allClasses.reduce((current, vulnClass) => sanitizeFor(current, vulnClass), value);
}

function unsanitizedTraces(value: AbstractValue, vulnClass: TaintVulnerabilityClass): TaintTrace[] {
  return value.traces.filter(trace => !trace.sanitizedFor.has(vulnClass));
}

function canonicalName(node: AstNode | undefined): string {
  if (!node) return "";
  if (node.kind === "identifier") return node.name ?? node.text;
  if (node.kind === "member") {
    const prefix = canonicalName(node.children[0]);
    return prefix ? `${prefix}.${node.name ?? ""}` : node.name ?? "";
  }
  if (node.kind === "index") {
    const base = canonicalName(node.children[0]);
    const index = node.children[1];
    const key = index?.kind === "literal" ? String(index.name ?? "").replace(/^['"`]|['"`]$/g, "") : "";
    return key ? `${base}.${key}` : base;
  }
  return "";
}

function getStaticProperty(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.kind === "identifier") return node.name;
  if (node.kind === "literal") return String(node.name ?? "").replace(/^['"`]|['"`]$/g, "");
  return undefined;
}

function walk(node: AstNode, callback: (node: AstNode) => void, seen = new Set<AstNode>()): void {
  if (seen.has(node)) return;
  seen.add(node);
  callback(node);
  if (node.target) walk(node.target, callback, seen);
  if (node.value) walk(node.value, callback, seen);
  if (node.callee) walk(node.callee, callback, seen);
  for (const child of node.children) walk(child, callback, seen);
  for (const child of node.args ?? []) walk(child, callback, seen);
  for (const child of node.params ?? []) walk(child, callback, seen);
  for (const child of node.body ?? []) walk(child, callback, seen);
}

function sourceDescription(name: string, language: ParsedFile["language"]): string | undefined {
  const normalized = name.toLowerCase();
  return LANGUAGE_TAINT_CONFIG[language].sourcePatterns.find(source => source.pattern.test(normalized))?.description;
}

function makeSource(file: string, node: AstNode, description: string): AbstractValue {
  return {
    traces: [{
      sourceFile: file,
      sourceLine: node.line,
      path: [sourceStep(file, node, `Source: ${description}`)],
      unresolvedImport: false,
      sanitizedFor: new Set(),
    }],
  };
}

function sourceFromNode(file: ParsedFile, node: AstNode): AbstractValue | undefined {
  const name = canonicalName(node);
  const description = sourceDescription(name, file.language);
  if (description) return makeSource(file.name, node, description);

  if (node.kind === "call") {
    const callee = canonicalName(node.callee).toLowerCase();
    if (file.language === "python" && /^request\.(?:args|form|get|post)\.get$/.test(callee)) {
      return makeSource(file.name, node, "Python request input");
    }
    if (file.language === "python" && /^request\.get_json$/.test(callee)) {
      return makeSource(file.name, node, "Python JSON request body");
    }
  }
  return undefined;
}

function literalText(node: AstNode | undefined): string {
  if (!node) return "";
  if (node.kind === "literal") return String(node.name ?? node.text);
  return node.text;
}

function sanitizerClass(node: AstNode): TaintVulnerabilityClass | "all" | undefined {
  const name = canonicalName(node).toLowerCase();
  const simpleName = name.split(".").at(-1) ?? name;
  if (/^(?:parse|safeparse|validate|validator|assertvalid)$/.test(simpleName)) return "all";
  if (/^(?:escape|escapeidentifier|escapeliteral|sqlstring\.escape|parameterize|bindparams)$/.test(simpleName)) return "SQL";
  if (/^(?:quote|shellquote|shellescape|escapeshellarg)$/.test(simpleName) || name.includes("shlex.quote")) return "Command";
  if (/^(?:sanitize|escapehtml|escapeHtml|sanitizetext)$/.test(simpleName)
    || name.includes("dompurify.sanitize") || name.includes("sanitize-html")) return "XSS";
  if (/^(?:safepath|validatepath|resolvewithin|ensurewithinroot)$/.test(simpleName)) return "Path";
  if (/^(?:validateurl|safeurl|isallowedurl|allowlistedhost|assertallowedhost)$/.test(simpleName)) return "SSRF";
  if (/^(?:saferedirect|validateredirect|isallowedredirect)$/.test(simpleName)) return "Redirect";
  if (/^(?:encodeuricomponent|encodeuri)$/.test(simpleName)) return "Redirect";
  if (/^(?:safe_load|safeload)$/.test(simpleName)) return "Deserialization";
  if (/^(?:isallowed|allowlisted|allowlist)$/.test(simpleName)) return "all";
  return undefined;
}

function getCallSink(node: AstNode): { vulnClass: TaintVulnerabilityClass; name: string; argIndexes?: number[] } | undefined {
  const name = canonicalName(node.callee);
  const normalized = name.toLowerCase();
  const simple = normalized.split(".").at(-1) ?? normalized;

  if (/^(?:query|execute|raw)$/.test(simple)
    && /(?:db|database|cursor|sequelize|knex|client|connection|pool|prisma|queryrunner|sql)$/i.test(name.split(".").slice(0, -1).join("."))) {
    return { vulnClass: "SQL", name, argIndexes: [0] };
  }
  if (/^(?:exec|execsync)$/.test(simple) || /^(?:os\.system|commands\.(?:getoutput|getstatusoutput))$/.test(normalized)) {
    return { vulnClass: "Command", name, argIndexes: [0] };
  }
  if (/^subprocess\.(?:run|call|popen|check_output)$/.test(normalized)) {
    const options = node.args?.find(arg => arg.kind === "object");
    const shellEnabled = Boolean(options?.children.some(property =>
      property.name === "shell" && /(?:true|1)/i.test(literalText(property.value)),
    ));
    if (shellEnabled) return { vulnClass: "Command", name, argIndexes: [0] };
  }
  if (simple === "spawn" || simple === "spawnsync") {
    const options = node.args?.find(arg => arg.kind === "object");
    const shellEnabled = Boolean(options?.children.some(property =>
      property.name === "shell" && /(?:true|1)/i.test(literalText(property.value)),
    ));
    if (shellEnabled) return { vulnClass: "Command", name, argIndexes: [0, 1] };
  }
  if (/^(?:eval|function)$/.test(simple) || /^vm\./.test(normalized)) {
    if (simple === "function") return { vulnClass: "Code", name, argIndexes: node.args?.map((_, index) => index) ?? [] };
    return { vulnClass: "Code", name, argIndexes: [0] };
  }
  if (/^document\.write$/.test(normalized) || /render_template_string$/.test(normalized)) {
    return { vulnClass: "XSS", name, argIndexes: [0] };
  }
  if (/^res\.(?:send|sendfile)$/.test(normalized) || /^(?:send|sendfile)$/.test(simple)) {
    const firstArg = node.args?.[0];
    if (firstArg && /<\s*\/?\s*[a-z!][^>]*>/i.test(firstArg.text)) return { vulnClass: "XSS", name, argIndexes: [0] };
  }
  if (/^(?:readfile|readfilesync|writefile|writefilesync|createreadstream|createwritestream|open|open_sync)$/.test(simple)
    && (/\bfs\b|filesystem|^open$|^os\.open$/.test(normalized))) {
    return { vulnClass: "Path", name, argIndexes: [0] };
  }
  if (/^(?:fetch|axios\.(?:get|post|put|patch|delete|request)|https?\.(?:get|request)|requests\.(?:get|post|put|patch|delete|request)|urlopen)$/.test(normalized)) {
    return { vulnClass: "SSRF", name, argIndexes: [0] };
  }
  if (/^(?:res\.)?redirect$/.test(normalized)) return { vulnClass: "Redirect", name, argIndexes: [0] };
  if (/^yaml\.load$/.test(normalized)) {
    const hasSafeLoader = node.args?.some(arg => arg.kind === "object" && arg.children.some(property =>
      property.name?.toLowerCase() === "loader" && /(?:safe|csafe)loader/i.test(property.value?.text ?? ""),
    ));
    if (hasSafeLoader) return undefined;
    return { vulnClass: "Deserialization", name, argIndexes: [0] };
  }
  if (/^(?:pickle\.loads|yaml\.unsafe_load)$/.test(normalized)) {
    return { vulnClass: "Deserialization", name, argIndexes: [0] };
  }
  return undefined;
}

function isParameterizedSqlCall(node: AstNode, argValues: AbstractValue[]): boolean {
  const firstArg = node.args?.[0];
  if (!firstArg || argValues[0]?.traces.length) return false;
  const name = canonicalName(node.callee).toLowerCase();
  if (!/(?:query|execute|raw)$/.test(name)) return false;
  const queryText = literalText(firstArg);
  const hasPlaceholders = /(?:\?|\$\d+|:\w+|%s|%\([^)]+\)s)/.test(queryText);
  return hasPlaceholders && argValues.slice(1).some(value => value.traces.length > 0);
}

function assignmentSink(node: AstNode): TaintVulnerabilityClass | undefined {
  const propertyName = node.target?.kind === "member" ? node.target.name?.toLowerCase() : undefined;
  if (propertyName === "innerhtml" || propertyName === "outerhtml") return "XSS";
  if (propertyName === "href" && /(?:^|\.)(?:location|window\.location)$/.test(canonicalName(node.target?.children[0]))) {
    return "Redirect";
  }
  return undefined;
}

function vulnClassFromDeterministicTitle(title: string): TaintVulnerabilityClass | undefined {
  if (/sql/i.test(title)) return "SQL";
  if (/command/i.test(title)) return "Command";
  if (/dynamic code|eval/i.test(title)) return "Code";
  if (/dom html/i.test(title)) return "XSS";
  if (/deserialization/i.test(title)) return "Deserialization";
  return undefined;
}

function resolveModuleFile(fromFile: string, moduleSpecifier: string, files: Map<string, ParsedFile>): string | undefined {
  const names = [...files.keys()];
  const normalizedSpec = moduleSpecifier.replace(/\\/g, "/");
  const baseDir = path.posix.dirname(normalizeFile(fromFile));
  let relativeBase: string;
  if (/\.pyi?$/i.test(fromFile) && normalizedSpec.startsWith(".")) {
    const relative = normalizedSpec.match(/^(\.+)(.*)$/);
    const parentDepth = Math.max(0, (relative?.[1].length ?? 1) - 1);
    const modulePath = (relative?.[2] ?? "").replace(/\./g, "/");
    relativeBase = path.posix.normalize(path.posix.join(baseDir, "../".repeat(parentDepth), modulePath));
  } else if (normalizedSpec.startsWith(".")) {
    relativeBase = path.posix.normalize(path.posix.join(baseDir, normalizedSpec));
  } else {
    relativeBase = normalizedSpec.replace(/^\.+/, "").replace(/\./g, "/");
  }
  const candidates = new Set<string>([
    relativeBase,
    `${relativeBase}.js`, `${relativeBase}.jsx`, `${relativeBase}.ts`, `${relativeBase}.tsx`,
    `${relativeBase}.mjs`, `${relativeBase}.cjs`, `${relativeBase}.py`,
    `${relativeBase}/index.js`, `${relativeBase}/index.ts`, `${relativeBase}/__init__.py`,
  ]);
  for (const candidate of candidates) {
    const match = names.find(name => normalizeFile(name) === candidate);
    if (match) return match;
  }
  const suffixes = [
    `/${relativeBase}.js`, `/${relativeBase}.jsx`, `/${relativeBase}.ts`,
    `/${relativeBase}.tsx`, `/${relativeBase}.py`, `/${relativeBase}/__init__.py`,
  ];
  return names.find(name => suffixes.some(suffix => normalizeFile(name).endsWith(suffix)));
}

function importBindingsForFile(file: ParsedFile): Map<string, ModuleBinding> {
  const bindings = new Map<string, ModuleBinding>();
  const topLevel = file.root.body ?? file.root.children;
  for (const node of topLevel) {
    if (node.kind === "import") {
      for (const binding of node.bindings ?? []) bindings.set(binding.local, { ...binding });
    }
    if (node.kind === "variable" && node.value?.kind === "call" && canonicalName(node.value.callee) === "require") {
      const moduleSpecifier = literalText(node.value.args?.[0]).replace(/^['"`]|['"`]$/g, "");
      if (!moduleSpecifier) continue;
      if (node.target?.kind === "identifier") {
        bindings.set(node.target.name ?? "", {
          local: node.target.name ?? "",
          imported: "*",
          moduleSpecifier,
          namespace: true,
        });
      } else if (node.target?.kind === "objectPattern") {
        for (const property of node.target.children) {
          if (property.target?.kind === "identifier") {
            const local = property.target.name ?? "";
            bindings.set(local, { local, imported: property.name ?? local, moduleSpecifier });
          }
        }
      }
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const node of topLevel) {
      if (node.kind !== "variable" || node.target?.kind !== "identifier" || node.value?.kind !== "identifier") continue;
      const source = bindings.get(node.value.name ?? "");
      if (source && !bindings.has(node.target.name ?? "")) {
        bindings.set(node.target.name ?? "", { ...source, local: node.target.name ?? "" });
      }
    }
  }
  return bindings;
}

function collectFunctions(file: ParsedFile): FunctionDefinition[] {
  const definitions: FunctionDefinition[] = [];
  const namesByNode = new Map<AstNode, Set<string>>();
  walk(file.root, node => {
    if (node.kind === "variable" && node.value?.kind === "function" && node.target?.kind === "identifier") {
      const aliases = namesByNode.get(node.value) ?? new Set<string>();
      aliases.add(node.target.name ?? "");
      namesByNode.set(node.value, aliases);
    }
    if (node.kind === "function") {
      const aliases = namesByNode.get(node) ?? new Set<string>();
      if (node.name && node.name !== "__anonymous__" && node.name !== "__lambda__") aliases.add(node.name);
      const firstAlias = aliases.values().next().value as string | undefined;
      const name = firstAlias ?? node.name ?? "__anonymous__";
      definitions.push({
        file,
        node,
        name,
        aliases,
        key: `${normalizeFile(file.name)}::${name}::${node.line}`,
      });
    }
  });
  return definitions;
}

function buildContext(parsedFiles: ParsedFile[]): AnalysisContext {
  const files = new Map(parsedFiles.map(file => [normalizeFile(file.name), file]));
  const functionsByFile = new Map<string, Map<string, FunctionDefinition[]>>();
  const importsByFile = new Map<string, Map<string, ModuleBinding>>();
  const unresolvedAliases = new Map<string, Set<string>>();
  for (const file of parsedFiles) {
    const normalized = normalizeFile(file.name);
    const defs = collectFunctions(file);
    const names = new Map<string, FunctionDefinition[]>();
    for (const definition of defs) {
      for (const alias of definition.aliases) {
        const list = names.get(alias) ?? [];
        list.push(definition);
        names.set(alias, list);
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      for (const node of file.root.body ?? []) {
        if (node.kind !== "variable" || node.target?.kind !== "identifier" || node.value?.kind !== "identifier") continue;
        const aliases = names.get(node.value.name ?? "");
        if (aliases && !names.has(node.target.name ?? "")) names.set(node.target.name ?? "", aliases);
      }
    }
    functionsByFile.set(normalized, names);
    const bindings = importBindingsForFile(file);
    for (const binding of bindings.values()) {
      binding.resolvedFile = resolveModuleFile(file.name, binding.moduleSpecifier, files);
      if (!binding.resolvedFile) {
        const unresolved = unresolvedAliases.get(normalized) ?? new Set<string>();
        unresolved.add(binding.local);
        unresolvedAliases.set(normalized, unresolved);
      }
    }
    importsByFile.set(normalized, bindings);
  }
  return {
    files,
    functionsByFile,
    importsByFile,
    unresolvedAliases,
    findings: [],
    invocationCount: 0,
  };
}

function resolveCalledFunctions(
  context: AnalysisContext,
  file: ParsedFile,
  callee: AstNode | undefined,
): { definitions: FunctionDefinition[]; unresolved: boolean } {
  const name = canonicalName(callee);
  const currentKey = normalizeFile(file.name);
  const localFunctions = context.functionsByFile.get(currentKey);
  const local = localFunctions?.get(name) ?? [];
  if (local.length) return { definitions: local, unresolved: false };

  const parts = name.split(".");
  const first = parts[0] ?? "";
  const binding = context.importsByFile.get(currentKey)?.get(first);
  if (binding) {
    if (!binding.resolvedFile) return { definitions: [], unresolved: true };
    const targetFile = normalizeFile(binding.resolvedFile);
    const targetFunctions = context.functionsByFile.get(targetFile);
    const importedName = binding.namespace ? parts.slice(1).join(".") : binding.imported;
    const definitions = targetFunctions?.get(importedName) ?? [];
    return { definitions, unresolved: !definitions.length };
  }
  if (context.unresolvedAliases.get(currentKey)?.has(first)) return { definitions: [], unresolved: true };
  return { definitions: [], unresolved: false };
}

function valueForProperty(value: AbstractValue, name: string | undefined): AbstractValue {
  if (name && value.properties?.has(name)) return value.properties.get(name)!;
  if (name && /^\d+$/.test(name) && value.elements?.[Number(name)]) return value.elements[Number(name)];
  return { traces: cloneTraces(value.traces) };
}

function updatePattern(
  pattern: AstNode | undefined,
  value: AbstractValue,
  env: Map<string, AbstractValue>,
  file: ParsedFile,
  statement: AstNode,
): void {
  if (!pattern) return;
  if (pattern.kind === "identifier") {
    const name = pattern.name ?? "";
    if (name) env.set(name, addStep(value, file.name, statement, `Assigned to ${name}`));
    return;
  }
  if (pattern.kind === "propertyPattern") {
    updatePattern(pattern.target, valueForProperty(value, pattern.name), env, file, statement);
    return;
  }
  if (pattern.kind === "objectPattern") {
    for (const child of pattern.children) updatePattern(child, value, env, file, statement);
    return;
  }
  if (pattern.kind === "arrayPattern") {
    pattern.children.forEach((child, index) => updatePattern(child, valueForProperty(value, String(index)), env, file, statement));
  }
}

function sanitizeCallResult(node: AstNode, value: AbstractValue): AbstractValue {
  const sanitizer = sanitizerClass(node.callee ?? node);
  if (!sanitizer) return value;
  if (sanitizer === "all") return EMPTY_VALUE;
  return sanitizeFor(value, sanitizer);
}

function pathGuardedVariable(node: AstNode): string | undefined {
  const condition = node.children[0]?.text ?? "";
  const block = [...(node.body ?? []), ...(node.params ?? [])].map(child => child.text).join(" ");
  const match = condition.match(/!?([\w$]+)\.startsWith\s*\(/i);
  if (!match || !/throw|return|abort|exit/i.test(block)) return undefined;
  if (!/^\s*!/.test(condition) && !/^\s*not\s+/i.test(condition)) return undefined;
  return match[1];
}

function allowlistGuardedVariable(node: AstNode): string | undefined {
  const condition = node.children[0]?.text ?? "";
  const block = [...(node.body ?? []), ...(node.params ?? [])].map(child => child.text).join(" ");
  if (!/throw|return|abort|exit/i.test(block)) return undefined;
  const match = condition.match(/^\s*!\s*(?:[\w$.]*(?:isallowed|allowlist|validate|checkallowed)[\w$.]*)\s*\(\s*([\w$]+)\s*\)/i)
    ?? condition.match(/^\s*not\s+(?:[\w$.]*(?:is_allowed|allowlist|validate|check_allowed)[\w$.]*)\s*\(\s*([\w$]+)\s*\)/i);
  return match?.[1];
}

function addSinkFinding(
  context: AnalysisContext,
  file: ParsedFile,
  node: AstNode,
  vulnClass: TaintVulnerabilityClass,
  sinkName: string,
  value: AbstractValue,
): void {
  const traces = unsanitizedTraces(value, vulnClass);
  for (const trace of traces) {
    if (context.findings.length >= MAX_FINDINGS) return;
    const sinkStep = sourceStep(file.name, node, `Sink: ${sinkName} (${vulnClass})`);
    const flow = [...trace.path, sinkStep].slice(0, MAX_PATH_STEPS);
    context.findings.push({
      sourceFile: trace.sourceFile,
      sourceLine: trace.sourceLine,
      sinkFile: file.name,
      sinkLine: node.line,
      vulnClass,
      confidence: trace.unresolvedImport ? "probable" : "confirmed",
      path: flow,
      codeSnippet: nodeText(node),
      sinkName,
    });
  }
}

function analyzeNode(
  context: AnalysisContext,
  file: ParsedFile,
  node: AstNode,
  env: Map<string, AbstractValue>,
  depth: number,
  callStack: Set<string>,
): AbstractValue {
  if (node.kind === "identifier") return env.get(node.name ?? "") ?? EMPTY_VALUE;

  if (node.kind === "member" || node.kind === "index") {
    const source = sourceFromNode(file, node);
    if (source) return source;
    const base = analyzeNode(context, file, node.children[0], env, depth, callStack);
    return addStep(valueForProperty(base, node.kind === "member" ? node.name : getStaticProperty(node.children[1])), file.name, node, "Read object property");
  }

  if (node.kind === "call") {
    const source = sourceFromNode(file, node);
    if (source) return source;

    const argValues = (node.args ?? []).map(arg => analyzeNode(context, file, arg, env, depth, callStack));
    const callValue = mergeValues(...argValues);
    const sink = getCallSink(node);
    if (sink) {
      if (sink.vulnClass === "SQL" && isParameterizedSqlCall(node, argValues)) {
        // Bound SQL parameters are data, not SQL syntax. Do not treat them as a taint sink.
      } else if (sink.vulnClass === "Command" && (canonicalName(node.callee).endsWith(".spawn") || canonicalName(node.callee).endsWith(".spawnSync"))) {
        const taintedCommand = argValues.some(value => value.traces.length > 0);
        if (taintedCommand) addSinkFinding(context, file, node, sink.vulnClass, sink.name, callValue);
      } else {
        const selected = sink.argIndexes?.map(index => argValues[index]).filter(Boolean) ?? argValues;
        addSinkFinding(context, file, node, sink.vulnClass, sink.name, mergeValues(...selected));
      }
    }

    const sanitized = sanitizeCallResult(node, callValue);
    if (sanitized !== callValue || sanitizerClass(node.callee ?? node)) return sanitized;

    const resolved = resolveCalledFunctions(context, file, node.callee);
    if (resolved.definitions.length && depth < MAX_CALL_DEPTH) {
      const returnValues: AbstractValue[] = [];
      for (const definition of resolved.definitions) {
        if (callStack.has(definition.key) || context.invocationCount >= MAX_FUNCTION_INVOCATIONS) continue;
        context.invocationCount++;
        const nextStack = new Set(callStack);
        nextStack.add(definition.key);
        returnValues.push(analyzeFunction(context, definition, argValues, depth + 1, nextStack));
      }
      return addStep(mergeValues(...returnValues), file.name, node, `Returned from ${canonicalName(node.callee)}`);
    }
    if (resolved.unresolved && callValue.traces.length) {
      return {
        ...addStep(callValue, file.name, node, `Passed through unresolved import ${canonicalName(node.callee)}`),
        traces: cloneTraces(callValue.traces).map(trace => ({ ...trace, unresolvedImport: true })),
      };
    }

    return addStep(callValue, file.name, node, `Passed through ${canonicalName(node.callee) || "function call"}`);
  }

  if (node.kind === "assign" || node.kind === "variable") {
    const value = node.value
      ? analyzeNode(context, file, node.value, env, depth, callStack)
      : EMPTY_VALUE;
    const taint = node.operator === "+=" && node.target
      ? mergeValues(env.get(node.target.name ?? "") ?? EMPTY_VALUE, value)
      : value;
    const sinkClass = assignmentSink(node);
    if (sinkClass) addSinkFinding(context, file, node, sinkClass, `${canonicalName(node.target)} =`, taint);
    updatePattern(node.target, taint, env, file, node);
    return taint;
  }

  if (node.kind === "return") {
    const value = node.value ? analyzeNode(context, file, node.value, env, depth, callStack) : EMPTY_VALUE;
    return addStep(value, file.name, node, "Returned from function");
  }

  if (node.kind === "object") {
    const properties = new Map<string, AbstractValue>();
    const values: AbstractValue[] = [];
    for (const property of node.children) {
      const value = property.value
        ? analyzeNode(context, file, property.value, env, depth, callStack)
        : analyzeNode(context, file, property, env, depth, callStack);
      if (property.name) properties.set(property.name, value);
      values.push(value);
      if (property.name?.toLowerCase() === "dangerouslysetinnerhtml") {
        addSinkFinding(context, file, property, "XSS", "dangerouslySetInnerHTML", value);
      }
    }
    const merged = mergeValues(...values);
    return { ...merged, properties };
  }

  if (node.kind === "property") {
    const value = node.value ? analyzeNode(context, file, node.value, env, depth, callStack) : EMPTY_VALUE;
    if (node.name?.toLowerCase() === "dangerouslysetinnerhtml") {
      addSinkFinding(context, file, node, "XSS", "dangerouslySetInnerHTML", value);
    }
    return value;
  }

  if (node.kind === "array") {
    const elements = node.children.map(child => analyzeNode(context, file, child, env, depth, callStack));
    return { ...mergeValues(...elements), elements };
  }

  if (node.kind === "binary" || node.kind === "template") {
    return addStep(
      mergeValues(...node.children.map(child => analyzeNode(context, file, child, env, depth, callStack))),
      file.name,
      node,
      node.kind === "template" ? "Interpolated into string template" : "Combined with another value",
    );
  }

  if (node.kind === "if") {
    if (node.children[0]) analyzeNode(context, file, node.children[0], env, depth, callStack);
    const before = new Map(env);
    const thenEnv = new Map(env);
    const elseEnv = new Map(env);
    const returns: AbstractValue[] = [];
    for (const statement of node.body ?? []) returns.push(analyzeNode(context, file, statement, thenEnv, depth, callStack));
    for (const statement of node.params ?? []) returns.push(analyzeNode(context, file, statement, elseEnv, depth, callStack));
    const guarded = pathGuardedVariable(node);
    const allowlisted = allowlistGuardedVariable(node);
    const allNames = new Set([...before.keys(), ...thenEnv.keys(), ...elseEnv.keys()]);
    for (const name of allNames) {
      let value = mergeValues(thenEnv.get(name) ?? EMPTY_VALUE, elseEnv.get(name) ?? EMPTY_VALUE);
      if (guarded === name) value = sanitizeFor(value, "Path");
      if (allowlisted === name) value = sanitizeForAll(value);
      env.set(name, value);
    }
    return mergeValues(...returns);
  }

  if (node.kind === "function" || node.kind === "import" || node.kind === "literal") return EMPTY_VALUE;

  const nested: AbstractValue[] = [];
  for (const child of node.children) nested.push(analyzeNode(context, file, child, env, depth, callStack));
  for (const child of node.body ?? []) nested.push(analyzeNode(context, file, child, env, depth, callStack));
  return mergeValues(...nested);
}

function analyzeFunction(
  context: AnalysisContext,
  definition: FunctionDefinition,
  args: AbstractValue[],
  depth: number,
  callStack: Set<string>,
): AbstractValue {
  const env = new Map<string, AbstractValue>();
  for (let index = 0; index < (definition.node.params ?? []).length; index++) {
    const parameter = definition.node.params![index];
    const passed = addStep(args[index] ?? EMPTY_VALUE, definition.file.name, parameter, `Argument passed to ${definition.name}`);
    updatePattern(parameter.target ?? (parameter.name ? { ...parameter, kind: "identifier" } : undefined), passed, env, definition.file, parameter);
  }
  const returned = analyzeFunctionBody(context, definition.file, definition.node.body ?? [], env, depth, callStack);
  return addStep(returned, definition.file.name, definition.node, `Function ${definition.name} returned`);
}

function analyzeFunctionBody(
  context: AnalysisContext,
  file: ParsedFile,
  statements: AstNode[],
  env: Map<string, AbstractValue>,
  depth: number,
  callStack: Set<string>,
): AbstractValue {
  const returnValues: AbstractValue[] = [];
  for (const statement of statements) {
    if (statement.kind === "return") {
      returnValues.push(analyzeNode(context, file, statement, env, depth, callStack));
      continue;
    }
    if (statement.kind === "if") {
      if (statement.children[0]) analyzeNode(context, file, statement.children[0], env, depth, callStack);
      const before = new Map(env);
      const thenEnv = new Map(env);
      const elseEnv = new Map(env);
      returnValues.push(analyzeFunctionBody(context, file, statement.body ?? [], thenEnv, depth, callStack));
      returnValues.push(analyzeFunctionBody(context, file, statement.params ?? [], elseEnv, depth, callStack));
      const pathGuard = pathGuardedVariable(statement);
      const allowlistGuard = allowlistGuardedVariable(statement);
      const names = new Set([...before.keys(), ...thenEnv.keys(), ...elseEnv.keys()]);
      for (const name of names) {
        let value = mergeValues(thenEnv.get(name) ?? EMPTY_VALUE, elseEnv.get(name) ?? EMPTY_VALUE);
        if (pathGuard === name) value = sanitizeFor(value, "Path");
        if (allowlistGuard === name) value = sanitizeForAll(value);
        env.set(name, value);
      }
      continue;
    }
    analyzeNode(context, file, statement, env, depth, callStack);
  }
  return mergeValues(...returnValues);
}

function issueKey(file: string, line: number, vulnClass: TaintVulnerabilityClass): string {
  return `${normalizeFile(file)}:${line}:${vulnClass}`;
}

function dedupeFindings(findings: TaintFinding[]): TaintFinding[] {
  const unique = new Map<string, TaintFinding>();
  for (const finding of findings) {
    const key = issueKey(finding.sinkFile, finding.sinkLine, finding.vulnClass);
    const previous = unique.get(key);
    if (!previous || (previous.confidence === "probable" && finding.confidence === "confirmed")) {
      unique.set(key, finding);
    }
  }
  return [...unique.values()];
}

export async function scanTaintFlows(
  files: Array<{ name: string; content: string }>,
): Promise<TaintScanResult> {
  const { parsed, skipped } = await parseSourceFiles(files);
  const context = buildContext(parsed);

  for (const file of parsed) {
    const normalized = normalizeFile(file.name);
    const definitions = [...(context.functionsByFile.get(normalized)?.values() ?? [])].flat();
    const uniqueDefinitions = new Map(definitions.map(definition => [definition.key, definition]));
    for (const definition of uniqueDefinitions.values()) {
      analyzeFunction(context, definition, [], 0, new Set([definition.key]));
    }

    // Module-level statements can contain direct source-to-sink flows as well.
    const env = new Map<string, AbstractValue>();
    for (const statement of file.root.body ?? file.root.children) {
      if (statement.kind === "function" || statement.kind === "import") continue;
      analyzeNode(context, file, statement, env, 0, new Set());
    }
  }

  return {
    findings: dedupeFindings(context.findings),
    parsedFiles: parsed.map(file => file.name),
    skippedFiles: skipped,
    parsedAst: parsed,
  };
}

export function taintFindingToIssue(finding: TaintFinding): Record<string, unknown> {
  const sinkDescription = finding.sinkName || finding.vulnClass;
  const fixes: Record<TaintVulnerabilityClass, string> = {
    SQL: "Use a parameterized query or prepared statement. Do not concatenate untrusted values into SQL text.",
    Command: "Avoid shell command construction. Use a fixed executable with an argument array and validate each argument.",
    Code: "Remove dynamic evaluation and use a data-only parser or an explicit allowlisted dispatch table.",
    XSS: "Render untrusted content as text or sanitize it with a context-appropriate HTML sanitizer.",
    Path: "Resolve the requested path against an allowed root and reject it unless the resolved path remains within that root.",
    SSRF: "Allowlist permitted schemes and hosts, then validate every redirect and resolved destination before making the request.",
    Redirect: "Allowlist local destinations or validate the redirect target against a trusted origin.",
    Deserialization: "Use a safe data-only deserializer and validate the resulting object against a schema.",
  };
  const sourceName = finding.path[0]?.snippet || "untrusted input";
  const findingClassLabel = finding.vulnClass === "SQL" ? "SQL injection"
    : finding.vulnClass === "Command" ? "Command injection"
      : finding.vulnClass === "Code" ? "Code injection"
        : finding.vulnClass === "XSS" ? "Cross-site scripting"
          : finding.vulnClass === "Path" ? "Path traversal"
            : finding.vulnClass === "SSRF" ? "Server-side request forgery"
              : finding.vulnClass === "Redirect" ? "Open redirect"
                : "Unsafe deserialization";
  return {
    title: `${findingClassLabel} data flow to ${sinkDescription}`,
    description: `Untrusted input reaches ${sinkDescription} without a matching sanitizer. The source-to-sink path is shown below.`,
    severity: finding.vulnClass === "SQL" || finding.vulnClass === "Command" || finding.vulnClass === "Code"
      || finding.vulnClass === "Deserialization" ? "high" : "medium",
    possibleCause: `${sourceName} is propagated into a ${finding.vulnClass} sink without a class-appropriate sanitizer.`,
    suggestedFix: fixes[finding.vulnClass],
    codeSnippet: finding.codeSnippet,
    filePath: finding.sinkFile,
    lineNumber: finding.sinkLine,
    detectionMethod: "taint-engine",
    confidence: finding.confidence,
    vulnClass: finding.vulnClass,
    dataFlowPath: finding.path,
    owasp: finding.vulnClass === "Deserialization" ? "A08:2021-Software and Data Integrity Failures" : "A03:2021-Injection",
    effortLevel: "medium",
    effortNote: "Trace the untrusted input through the reported path and apply the matching validation or safe API at the sink.",
  };
}

export function dedupeTaintAgainstDeterministic<T extends Record<string, unknown>>(
  taintIssues: T[],
  deterministicIssues: Array<Record<string, unknown>>,
): Array<T | Record<string, unknown>> {
  const taintByKey = new Map<string, T>();
  for (const issue of taintIssues) {
    const vulnClass = String(issue.vulnClass ?? "");
    const file = String(issue.filePath ?? "");
    const line = Number(issue.lineNumber ?? 0);
    if (vulnClass && file && line) taintByKey.set(issueKey(file, line, vulnClass as TaintVulnerabilityClass), issue);
  }

  const results: Array<T | Record<string, unknown>> = [];
  const replaced = new Set<string>();
  for (const issue of deterministicIssues) {
    const vulnClass = vulnClassFromDeterministicTitle(String(issue.title ?? ""));
    const key = vulnClass ? issueKey(String(issue.filePath ?? ""), Number(issue.lineNumber ?? 0), vulnClass) : "";
    const taint = key ? taintByKey.get(key) : undefined;
    if (taint) {
      if (!replaced.has(key)) results.push(taint);
      replaced.add(key);
    } else {
      results.push(issue);
    }
  }
  for (const [key, issue] of taintByKey) {
    if (!replaced.has(key)) results.push(issue);
  }
  return results;
}

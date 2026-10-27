import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceFiles } from "../src/lib/ast-parser";
import {
  buildSastChunks,
  findSnippetLineInChunk,
  selectSastChunksForAi,
  type SastChunk,
} from "../src/lib/sast-chunker";

test("creates function-level chunks with imports and original line headers", async () => {
  const files = [{
    name: "src/users.ts",
    content: [
      'import { query } from "./db";',
      "",
      "export function listUsers(req: Request) {",
      "  return query(req.query.id);",
      "}",
      "",
      "export function health() {",
      '  return "ok";',
      "}",
    ].join("\n"),
  }];
  const parserResult = await parseSourceFiles(files);
  const result = await buildSastChunks(files, [], parserResult);

  assert.equal(result.fallbackFiles.length, 0);
  assert.equal(result.chunks.length, 2);
  for (const chunk of result.chunks) {
    assert.ok(chunk.text.includes('import { query } from "./db";'));
    assert.ok(chunk.text.includes("File: \"src/users.ts\""));
    assert.ok(chunk.text.includes(`Original source lines: ${chunk.startLine}-${chunk.endLine}`));
  }
  assert.deepEqual(result.chunks.map(chunk => [chunk.startLine, chunk.endLine]), [[3, 5], [7, 9]]);
});

test("uses unique chunk identifiers across all uploaded files", async () => {
  const result = await buildSastChunks([
    { name: "a.ts", content: "function a() { return 1; }" },
    { name: "b.ts", content: "function b() { return 2; }" },
  ]);
  assert.equal(new Set(result.chunks.map(chunk => chunk.id)).size, result.chunks.length);
});

test("keeps module-level code and route handlers in the chunk set", async () => {
  const file = {
    name: "server.ts",
    content: [
      'import express from "express";',
      "const app = express();",
      "const prefix = '/api';",
      "app.get(`${prefix}/users`, (req, res) => {",
      "  res.send(req.query.id);",
      "});",
    ].join("\n"),
  };
  const result = await buildSastChunks([file]);

  assert.ok(result.chunks.some(chunk => chunk.text.includes("const app = express()")));
  assert.ok(result.chunks.some(chunk => chunk.text.includes("app.get") && chunk.text.includes("req.query.id")));
});

test("ranks source, sink, and taint-hint chunks above ordinary module code", async () => {
  const files = [
    { name: "src/plain.ts", content: "const version = 1;" },
    { name: "src/handler.ts", content: "function getUser(req: Request) { return db.query(req.query.id); }" },
  ];
  const result = await buildSastChunks(files, [
    { sourceFile: "src/handler.ts", sourceLine: 1, sinkFile: "src/handler.ts", sinkLine: 1 },
  ]);
  const plain = result.chunks.find(chunk => chunk.file === "src/plain.ts");
  const handler = result.chunks.find(chunk => chunk.file === "src/handler.ts");

  assert.ok(plain && handler);
  assert.ok(handler.priority > plain.priority);
  assert.ok(handler.priorityReasons.includes("existing taint finding"));
  assert.ok(handler.priorityReasons.includes("source signal"));
  assert.ok(handler.priorityReasons.includes("sink signal"));
});

test("splits Python class methods into separate chunks", async () => {
  const file = {
    name: "service.py",
    content: [
      "from db import query",
      "",
      "class Service:",
      "    def first(self, request):",
      '        return query(request.args.get("id"))',
      "",
      "    def second(self):",
      '        return "ok"',
    ].join("\n"),
  };
  const result = await buildSastChunks([file]);

  assert.ok(result.chunks.some(chunk => chunk.text.includes("def first") && chunk.text.includes("Original source lines: 4-5")));
  assert.ok(result.chunks.some(chunk => chunk.text.includes("def second") && chunk.text.includes("Original source lines: 7-8")));
});

test("splits oversized functions at AST statement boundaries with fifteen-line overlap", async () => {
  const statements = Array.from({ length: 240 }, (_, index) =>
    `  const value_${index} = ${index} + 1; // statement payload ${"x".repeat(22)}`,
  );
  const file = {
    name: "src/large.ts",
    content: [
      'import { query } from "./db";',
      "function largeHandler(req: Request) {",
      ...statements,
      "  return query(req.query.id);",
      "}",
    ].join("\n"),
  };
  const result = await buildSastChunks([file]);

  assert.ok(result.chunks.length > 1);
  assert.equal(result.fallbackFiles.length, 0);
  for (const chunk of result.chunks) {
    assert.ok(chunk.text.length <= 6_200, `chunk ${chunk.id} exceeded the approximate budget: ${chunk.text.length}`);
    assert.ok(chunk.text.includes('import { query } from "./db";'));
  }
  for (let index = 1; index < result.chunks.length; index++) {
    const previous = result.chunks[index - 1];
    const current = result.chunks[index];
    assert.ok(
      previous.endLine - current.startLine + 1 >= 15,
      `expected 15-line overlap, got ${previous.startLine}-${previous.endLine} then ${current.startLine}-${current.endLine}`,
    );
  }
  for (let line = 2; line <= file.content.split("\n").length; line++) {
    assert.ok(
      result.chunks.some(chunk => line >= chunk.startLine && line <= chunk.endLine),
      `original line ${line} was not covered`,
    );
  }
});

test("falls back to line-based overlapping chunks when AST parsing fails", async () => {
  const files = [{
    name: "broken.ts",
    content: [
      "function broken( {",
      ...Array.from({ length: 180 }, (_, index) => `// fallback line ${index + 1} ${"x".repeat(64)}`),
    ].join("\n"),
  }];
  const parserResult = await parseSourceFiles(files);
  assert.equal(parserResult.parsed.length, 0);
  assert.equal(parserResult.skipped.length, 1);

  const result = await buildSastChunks(files, [], parserResult);
  assert.equal(result.fallbackFiles.length, 1);
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks[0].text.includes("function broken( {"));
  for (let index = 1; index < result.chunks.length; index++) {
    const previous = result.chunks[index - 1];
    const current = result.chunks[index];
    assert.ok(
      previous.endLine - current.startLine + 1 >= 15,
      `expected fallback overlap, got ${previous.startLine}-${previous.endLine} then ${current.startLine}-${current.endLine}`,
    );
  }
});

test("splits a single oversized source line without looping or losing its range", async () => {
  const file = { name: "generated.js", content: `const payload = "${"x".repeat(18_000)}";` };
  const result = await buildSastChunks([file]);

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every(chunk => chunk.startLine === 1 && chunk.endLine === 1));
  assert.ok(result.chunks.every(chunk => chunk.text.length <= 6_200));
});

test("selects highest-priority chunks first and returns explicit omissions", () => {
  const chunks: SastChunk[] = [
    { id: "low", file: "low.ts", language: "TypeScript", startLine: 1, endLine: 1, text: "low", priority: 1, priorityReasons: [] },
    { id: "high", file: "high.ts", language: "TypeScript", startLine: 4, endLine: 7, text: "high", priority: 50, priorityReasons: ["source signal"] },
    { id: "mid", file: "mid.ts", language: "TypeScript", startLine: 2, endLine: 3, text: "mid", priority: 10, priorityReasons: [] },
  ];
  const result = selectSastChunksForAi(chunks, 7);

  assert.deepEqual(result.selected.map(chunk => chunk.id), ["high", "mid"]);
  assert.deepEqual(result.unscanned.map(chunk => chunk.file), ["low.ts"]);
  assert.ok(result.unscanned[0].reason.includes("context budget"));
});

test("maps chunk snippets to original file lines within the chunk range", () => {
  const source = Array.from({ length: 40 }, (_, index) => `line_${index + 1}`).join("\n");
  const sourceWithDuplicates = source.replace("line_5", "dangerousCall(userInput)").replace("line_30", "dangerousCall(userInput)");

  assert.equal(
    findSnippetLineInChunk(sourceWithDuplicates, "dangerousCall(userInput)", 25, 35, 5),
    30,
  );
});

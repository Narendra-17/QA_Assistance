import assert from "node:assert/strict";
import test from "node:test";
import { scanDeterministicSast } from "../src/lib/deterministic-sast";
import { redactSecretLines } from "../src/lib/secrets-detector";
import { scanTaintFlows } from "../src/lib/taint-engine";
import { buildSarif } from "../src/lib/sarif";

test("traces SQL injection across an aliased cross-file import", async () => {
  const result = await scanTaintFlows([
    {
      name: "routes/users.js",
      content: `
import { getUserById as loadUser } from "../db/queries.js";
export async function getUser(req, res) {
  const id = req.query.id;
  return loadUser(id);
}
`,
    },
    {
      name: "db/queries.js",
      content: `
export async function getUserById(id) {
  return db.query("SELECT * FROM users WHERE id = '" + id + "'");
}
`,
    },
  ]);

  const findings = result.findings.filter(finding => finding.vulnClass === "SQL");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, "confirmed");
  assert.equal(findings[0].sourceFile, "routes/users.js");
  assert.equal(findings[0].sinkFile, "db/queries.js");
  assert.ok(findings[0].path.some(step => step.file === "routes/users.js"));
  assert.ok(findings[0].path.some(step => step.file === "db/queries.js"));
});

test("propagates taint through destructuring and marks unresolved imports probable", async () => {
  const result = await scanTaintFlows([
    {
      name: "routes/redirect.js",
      content: `
import { normalizeUrl } from "./missing.js";
function redirectUser(req, res) {
  const { next } = req.query;
  const destination = normalizeUrl(next);
  res.redirect(destination);
}
`,
    },
  ]);
  const finding = result.findings.find(item => item.vulnClass === "Redirect");
  assert.ok(finding);
  assert.equal(finding?.confidence, "probable");
  assert.equal(finding?.sourceLine, 4);
});

test("does not report bound parameters as SQL injection", async () => {
  const result = await scanTaintFlows([
    {
      name: "users.js",
      content: `
function getUser(req) {
  const id = req.query.id;
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}
`,
    },
  ]);
  assert.equal(result.findings.filter(finding => finding.vulnClass === "SQL").length, 0);
});

test("stops XSS taint at DOMPurify sanitization", async () => {
  const result = await scanTaintFlows([
    {
      name: "render.ts",
      content: `
function render(req, element) {
  const html = DOMPurify.sanitize(req.query.html);
  element.innerHTML = html;
}
`,
    },
  ]);
  assert.equal(result.findings.filter(finding => finding.vulnClass === "XSS").length, 0);
});

test("treats a path.resolve plus startsWith rejection guard as a path sanitizer", async () => {
  const result = await scanTaintFlows([
    {
      name: "files.js",
      content: `
function readFile(req, root) {
  const target = path.resolve(root, req.query.path);
  if (!target.startsWith(root)) throw new Error("invalid path");
  return fs.readFile(target);
}
`,
    },
  ]);
  assert.equal(result.findings.filter(finding => finding.vulnClass === "Path").length, 0);
});

test("recognizes the Python path.resolve and startswith rejection guard", async () => {
  const result = await scanTaintFlows([
    {
      name: "files.py",
      content: `
def read_file(request, root):
    target = os.path.resolve(root, request.args.get("path"))
    if not target.startswith(root):
        raise ValueError("invalid path")
    return open(target).read()
`,
    },
  ]);
  assert.equal(result.findings.filter(finding => finding.vulnClass === "Path").length, 0);
});

test("requires shell=true for subprocess command sinks", async () => {
  const result = await scanTaintFlows([
    {
      name: "commands.py",
      content: `
def run(request):
    command = request.args.get("cmd")
    subprocess.run("echo " + command, shell=False)
    subprocess.run("echo " + command, shell=True)
`,
    },
  ]);
  const findings = result.findings.filter(finding => finding.vulnClass === "Command");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].sinkLine, 5);
});

test("parses Python request sources and detects SQL sinks", async () => {
  const result = await scanTaintFlows([
    {
      name: "views.py",
      content: `
def user(request):
    user_id = request.args.get("id")
    cursor.execute("SELECT * FROM users WHERE id = " + user_id)
`,
    },
  ]);
  const finding = result.findings.find(item => item.vulnClass === "SQL");
  assert.ok(finding);
  assert.equal(finding?.confidence, "confirmed");
  assert.equal(finding?.sinkFile, "views.py");
});

test("resolves relative Python imports across files", async () => {
  const result = await scanTaintFlows([
    {
      name: "app/views.py",
      content: `
from .queries import fetch_user as query_user
def view(request):
    user_id = request.GET.get("id")
    return query_user(user_id)
`,
    },
    {
      name: "app/queries.py",
      content: `
def fetch_user(user_id):
    return cursor.execute("SELECT * FROM users WHERE id = " + user_id)
`,
    },
  ]);
  const finding = result.findings.find(item => item.vulnClass === "SQL");
  assert.ok(finding);
  assert.equal(finding?.sourceFile, "app/views.py");
  assert.equal(finding?.sinkFile, "app/queries.py");
});

test("preserves the existing deterministic SAST sample findings and line numbers", () => {
  const content = [
    "const id = req.query.id;",
    'db.query(`SELECT * FROM users WHERE id=${id}`);',
    "exec(`echo ${id}`);",
    "const token = Math.random();",
    'const passwordHash = md5(password);',
  ].join("\n");
  const findings = scanDeterministicSast([{ name: "sample.js", content }]);
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map(finding => finding.lineNumber).sort((a, b) => a - b), [2, 3, 4, 5]);
});

test("exports a SARIF code flow for taint paths", () => {
  const sarif = buildSarif([{
    title: "SQL injection through query",
    description: "Untrusted data reaches the query.",
    severity: "high",
    filePath: "db/queries.js",
    lineNumber: 12,
    detectionMethod: "taint-engine",
    dataFlowPath: [
      { file: "routes/users.js", line: 4, snippet: "req.query.id", step: "Source" },
      { file: "db/queries.js", line: 12, snippet: "db.query(sql)", step: "Sink" },
    ],
  }], "test-run", "fixture");
  const result = (sarif as { runs: Array<{ results: Array<{ codeFlows?: Array<{ threadFlows: Array<{ locations: unknown[] }> }> }> }> })
    .runs[0].results[0];
  assert.equal(result.codeFlows?.[0].threadFlows[0].locations.length, 2);
});

test("redacts detected secret lines before prompt construction", () => {
  const source = "const token = 'never-send-this-value';\nconst safe = true;";
  const [redacted] = redactSecretLines(
    [{ name: "config.js", content: source }],
    [{ filePath: "config.js", lineNumber: 1 }],
  );
  assert.ok(!redacted.content.includes("never-send-this-value"));
  assert.ok(redacted.content.includes("const safe = true;"));
});

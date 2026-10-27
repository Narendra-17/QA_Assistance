import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

const execFileAsync = promisify(execFile);
const MAX_AST_NODES = 50_000;

export type AstNodeKind =
  | "program"
  | "function"
  | "variable"
  | "assign"
  | "return"
  | "call"
  | "identifier"
  | "member"
  | "index"
  | "literal"
  | "template"
  | "binary"
  | "object"
  | "array"
  | "property"
  | "objectPattern"
  | "arrayPattern"
  | "propertyPattern"
  | "parameter"
  | "import"
  | "if"
  | "other";

export interface AstImportBinding {
  local: string;
  imported: string;
  moduleSpecifier: string;
  namespace?: boolean;
}

export interface AstNode {
  kind: AstNodeKind;
  name?: string;
  text: string;
  line: number;
  endLine?: number;
  operator?: string;
  children: AstNode[];
  target?: AstNode;
  value?: AstNode;
  callee?: AstNode;
  args?: AstNode[];
  params?: AstNode[];
  body?: AstNode[];
  bindings?: AstImportBinding[];
  moduleSpecifier?: string;
}

export interface ParsedFile {
  name: string;
  language: "javascript" | "python";
  root: AstNode;
}

export interface ParseSourceFilesResult {
  parsed: ParsedFile[];
  skipped: Array<{ name: string; reason: string }>;
}

const pythonAstScript = String.raw`
import ast, base64, json, sys
source = base64.b64decode(sys.argv[1]).decode("utf-8", "replace")

def line_of(node):
    return int(getattr(node, "lineno", 1) or 1)

def start_line_of(node):
    lines = [line_of(node)]
    lines.extend(line_of(item) for item in getattr(node, "decorator_list", []))
    return min(lines)

def end_line_of(node):
    return int(getattr(node, "end_lineno", None) or line_of(node))

def text_of(node):
    try:
        value = ast.get_source_segment(source, node)
        if value:
            return value[:500]
    except Exception:
        pass
    return ast.dump(node, include_attributes=False)[:500]

def node(kind, raw, **fields):
    out = {
        "kind": kind,
        "text": text_of(raw),
        "line": start_line_of(raw),
        "endLine": end_line_of(raw),
        "children": [],
    }
    out.update(fields)
    return out

def pattern(raw):
    if isinstance(raw, ast.Name):
        return node("identifier", raw, name=raw.id)
    if isinstance(raw, (ast.Tuple, ast.List)):
        return node("arrayPattern", raw, children=[pattern(item) for item in raw.elts])
    if isinstance(raw, ast.Starred):
        return pattern(raw.value)
    if isinstance(raw, ast.Dict):
        fields = []
        for key, value in zip(raw.keys, raw.values):
            if key is None:
                fields.append(pattern(value))
            else:
                key_name = key.id if isinstance(key, ast.Name) else getattr(key, "value", text_of(key))
                fields.append(node("propertyPattern", value, name=str(key_name), target=pattern(value)))
        return node("objectPattern", raw, children=fields)
    return expr(raw)

def expression(raw):
    if isinstance(raw, ast.Name):
        return node("identifier", raw, name=raw.id)
    if isinstance(raw, ast.Attribute):
        return node("member", raw, name=raw.attr, children=[expression(raw.value)])
    if isinstance(raw, ast.Subscript):
        return node("index", raw, children=[expression(raw.value), expression(raw.slice)])
    if isinstance(raw, ast.Call):
        keyword_object = []
        for keyword in raw.keywords:
            key_name = keyword.arg or "**kwargs"
            keyword_object.append(node("property", keyword.value, name=key_name, value=expression(keyword.value)))
        args = [expression(arg) for arg in raw.args]
        if keyword_object:
            args.append(node("object", raw, children=keyword_object))
        return node("call", raw, callee=expression(raw.func),
                    args=args)
    if isinstance(raw, ast.Constant):
        return node("literal", raw, name=repr(raw.value))
    if isinstance(raw, ast.BinOp):
        operator = type(raw.op).__name__
        return node("binary", raw, operator=operator,
                    children=[expression(raw.left), expression(raw.right)])
    if isinstance(raw, ast.JoinedStr):
        return node("template", raw, children=[expression(item) for item in raw.values])
    if isinstance(raw, ast.FormattedValue):
        return expression(raw.value)
    if isinstance(raw, ast.Dict):
        items = []
        for key, value in zip(raw.keys, raw.values):
            key_name = getattr(key, "value", text_of(key)) if key is not None else "**"
            items.append(node("property", value, name=str(key_name), value=expression(value)))
        return node("object", raw, children=items)
    if isinstance(raw, (ast.List, ast.Tuple, ast.Set)):
        return node("array", raw, children=[expression(item) for item in raw.elts])
    if isinstance(raw, ast.Lambda):
        params = [node("parameter", arg, name=arg.arg) for arg in raw.args.args]
        return node("function", raw, name="__lambda__", params=params, body=[expression(raw.body)])
    if isinstance(raw, ast.NamedExpr):
        return node("assign", raw, target=pattern(raw.target), value=expression(raw.value), operator="=")
    if isinstance(raw, ast.Await):
        return expression(raw.value)
    if isinstance(raw, ast.UnaryOp):
        return node("other", raw, children=[expression(raw.operand)])
    if isinstance(raw, ast.IfExp):
        return node("other", raw, children=[expression(raw.test), expression(raw.body), expression(raw.orelse)])
    children = []
    for child in ast.iter_child_nodes(raw):
        if isinstance(child, ast.expr):
            children.append(expression(child))
    return node("other", raw, children=children)

def statement(raw):
    if isinstance(raw, (ast.FunctionDef, ast.AsyncFunctionDef)):
        args = raw.args
        all_args = list(getattr(args, "posonlyargs", [])) + list(args.args) + list(args.kwonlyargs)
        params = [node("parameter", arg, name=arg.arg) for arg in all_args]
        if args.vararg:
            params.append(node("parameter", args.vararg, name=args.vararg.arg))
        if args.kwarg:
            params.append(node("parameter", args.kwarg, name=args.kwarg.arg))
        return node("function", raw, name=raw.name, params=params,
                    body=[statement(item) for item in raw.body])
    if isinstance(raw, ast.Return):
        return node("return", raw, value=expression(raw.value) if raw.value else None)
    if isinstance(raw, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        value = raw.value
        targets = raw.targets if isinstance(raw, ast.Assign) else [raw.target]
        return node("assign", raw, target=pattern(targets[0]),
                    value=expression(value) if value else None,
                    operator=type(raw.op).__name__ if isinstance(raw, ast.AugAssign) else "=")
    if isinstance(raw, ast.Expr):
        return expression(raw.value)
    if isinstance(raw, ast.If):
        return node("if", raw, children=[expression(raw.test)],
                    body=[statement(item) for item in raw.body],
                    value=node("other", raw, text="else", line=line_of(raw), children=[]),
                    params=[statement(item) for item in raw.orelse])
    if isinstance(raw, ast.Import):
        bindings = []
        for alias in raw.names:
            local = alias.asname or alias.name.split(".")[0]
            bindings.append({"local": local, "imported": alias.name, "moduleSpecifier": alias.name, "namespace": True})
        return node("import", raw, bindings=bindings)
    if isinstance(raw, ast.ImportFrom):
        module = ("." * raw.level) + (raw.module or "")
        bindings = [
            {"local": alias.asname or alias.name, "imported": alias.name, "moduleSpecifier": module}
            for alias in raw.names
        ]
        return node("import", raw, moduleSpecifier=module, bindings=bindings)
    if isinstance(raw, (ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith, ast.Try)):
        body_nodes = []
        for field in ("body", "orelse", "finalbody", "handlers", "items"):
            for item in getattr(raw, field, []) or []:
                if isinstance(item, ast.stmt):
                    body_nodes.append(statement(item))
                elif isinstance(item, ast.withitem):
                    body_nodes.append(expression(item.context_expr))
        if hasattr(raw, "target"):
            body_nodes.append(node("assign", raw, target=pattern(raw.target),
                                   value=expression(getattr(raw, "iter", raw.target)), operator="="))
        return node("other", raw, children=body_nodes)
    children = []
    for child in ast.iter_child_nodes(raw):
        if isinstance(child, ast.stmt):
            children.append(statement(child))
        elif isinstance(child, ast.expr):
            children.append(expression(child))
    return node("other", raw, children=children)

try:
    tree = ast.parse(source)
    root = node("program", tree, body=[statement(item) for item in tree.body])
    print(json.dumps(root, separators=(",", ":")))
except SyntaxError as error:
    print(json.dumps({"parseError": "{} (line {})".format(error.msg, error.lineno or 1)}))
`;

function tsLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source, false)).line + 1;
}

function tsText(source: ts.SourceFile, node: ts.Node): string {
  return node.getText(source).slice(0, 500);
}

function tsNode(
  source: ts.SourceFile,
  kind: AstNodeKind,
  raw: ts.Node,
  fields: Partial<AstNode> = {},
): AstNode {
  const start = raw.getStart(source, false);
  const end = Math.max(start, raw.getEnd() - 1);
  return {
    kind,
    text: tsText(source, raw),
    line: source.getLineAndCharacterOfPosition(start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(end).line + 1,
    children: [],
    ...fields,
  };
}

function tsPattern(source: ts.SourceFile, raw: ts.BindingName): AstNode {
  if (ts.isIdentifier(raw)) return tsNode(source, "identifier", raw, { name: raw.text });
  if (ts.isArrayBindingPattern(raw)) {
    return tsNode(source, "arrayPattern", raw, {
      children: raw.elements.filter(ts.isBindingElement).map(element => tsPattern(source, element.name)),
    });
  }
  return tsNode(source, "objectPattern", raw, {
    children: raw.elements.map(element => {
      const target = tsPattern(source, element.name);
      const propertyName = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName))
        ? element.propertyName.text
        : ts.isIdentifier(element.name) ? element.name.text : target.text;
      return tsNode(source, "propertyPattern", element, { name: propertyName, target });
    }),
  });
}

function tsNestedStatements(source: ts.SourceFile, raw: ts.Node): AstNode[] {
  const statements: AstNode[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      statements.push(...node.statements.flatMap(statement => tsStatement(source, statement)));
      return;
    }
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      statements.push(...node.statements.flatMap(statement => tsStatement(source, statement)));
      return;
    }
    if (ts.isCatchClause(node)) {
      visit(node.block);
      return;
    }
    if (ts.isCaseBlock(node)) {
      node.clauses.forEach(visit);
      return;
    }
    if (ts.isStatement(node)) {
      statements.push(...tsStatement(source, node));
    }
  };
  raw.forEachChild(visit);
  return statements;
}

function tsExpression(source: ts.SourceFile, raw: ts.Node): AstNode {
  if (ts.isParenthesizedExpression(raw) || ts.isAsExpression(raw) || ts.isTypeAssertionExpression(raw)
    || ts.isNonNullExpression(raw) || ts.isSatisfiesExpression(raw)) {
    return tsExpression(source, raw.expression);
  }
  if (ts.isIdentifier(raw)) return tsNode(source, "identifier", raw, { name: raw.text });
  if (ts.isStringLiteralLike(raw) || ts.isNumericLiteral(raw) || raw.kind === ts.SyntaxKind.TrueKeyword
    || raw.kind === ts.SyntaxKind.FalseKeyword || raw.kind === ts.SyntaxKind.NullKeyword) {
    return tsNode(source, "literal", raw, { name: tsText(source, raw) });
  }
  if (ts.isPropertyAccessExpression(raw)) {
    return tsNode(source, "member", raw, { name: raw.name.text, children: [tsExpression(source, raw.expression)] });
  }
  if (ts.isElementAccessExpression(raw)) {
    return tsNode(source, "index", raw, {
      children: [tsExpression(source, raw.expression), ...(raw.argumentExpression ? [tsExpression(source, raw.argumentExpression)] : [])],
    });
  }
  if (ts.isCallExpression(raw) || ts.isNewExpression(raw)) {
    return tsNode(source, "call", raw, {
      callee: tsExpression(source, raw.expression),
      args: (raw.arguments ?? []).map(argument => tsExpression(source, argument)),
    });
  }
  if (ts.isBinaryExpression(raw)) {
    const kind = raw.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || raw.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
      ? "assign"
      : "binary";
    const common = {
      operator: raw.operatorToken.getText(source),
      children: [tsExpression(source, raw.left), tsExpression(source, raw.right)],
    };
    return kind === "assign"
      ? tsNode(source, kind, raw, { ...common, target: common.children[0], value: common.children[1] })
      : tsNode(source, kind, raw, common);
  }
  if (ts.isPrefixUnaryExpression(raw) || ts.isPostfixUnaryExpression(raw)) {
    return tsNode(source, "other", raw, { children: [tsExpression(source, raw.operand)] });
  }
  if (ts.isTemplateExpression(raw)) {
    return tsNode(source, "template", raw, {
      children: raw.templateSpans.map(span => tsExpression(source, span.expression)),
    });
  }
  if (ts.isNoSubstitutionTemplateLiteral(raw)) return tsNode(source, "literal", raw, { name: raw.text });
  if (ts.isArrayLiteralExpression(raw)) {
    return tsNode(source, "array", raw, { children: raw.elements.map(element => tsExpression(source, element)) });
  }
  if (ts.isObjectLiteralExpression(raw)) {
    return tsNode(source, "object", raw, {
      children: raw.properties.map(property => {
        if (ts.isPropertyAssignment(property)) {
          const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ? property.name.text
            : property.name.getText(source);
          return tsNode(source, "property", property, { name, value: tsExpression(source, property.initializer) });
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          const value = tsNode(source, "identifier", property.name, { name: property.name.text });
          return tsNode(source, "property", property, { name: property.name.text, value });
        }
        return tsNode(source, "other", property, {
          children: property.getChildren(source).filter(child => ts.isExpression(child)).map(child => tsExpression(source, child)),
        });
      }),
    });
  }
  if (ts.isArrowFunction(raw) || ts.isFunctionExpression(raw)) {
    return tsFunction(source, raw);
  }
  if (ts.isJsxExpression(raw)) {
    return raw.expression ? tsExpression(source, raw.expression) : tsNode(source, "other", raw);
  }
  if (ts.isJsxAttribute(raw)) {
    const attrName = raw.name.getText(source);
    const value = raw.initializer && ts.isJsxExpression(raw.initializer)
      ? (raw.initializer.expression ? tsExpression(source, raw.initializer.expression) : undefined)
      : undefined;
    return tsNode(source, "property", raw, { name: attrName, value });
  }
  const jsxAttributes: AstNode[] = [];
  if (ts.isJsxElement(raw) || ts.isJsxSelfClosingElement(raw) || ts.isJsxFragment(raw)) {
    const visitJsx = (child: ts.Node): void => {
      if (ts.isJsxAttribute(child)) {
        jsxAttributes.push(tsExpression(source, child));
        return;
      }
      child.forEachChild(visitJsx);
    };
    visitJsx(raw);
  }
  const children = raw.getChildren(source)
    .filter(child => ts.isExpression(child) || ts.isJsxAttribute(child) || ts.isJsxExpression(child))
    .map(child => tsExpression(source, child));
  return tsNode(source, "other", raw, { children: [...children, ...jsxAttributes] });
}

function tsStatement(source: ts.SourceFile, raw: ts.Statement): AstNode[] {
  if (ts.isFunctionDeclaration(raw) || ts.isClassDeclaration(raw)) {
    if (ts.isFunctionDeclaration(raw)) return [tsFunction(source, raw)];
    const members = raw.members.flatMap(member =>
      ts.isMethodDeclaration(member) && member.body ? [tsFunction(source, member)] : [],
    );
    return members;
  }
  if (ts.isVariableStatement(raw)) {
    return raw.declarationList.declarations.map(declaration =>
      tsNode(source, "variable", declaration, {
        target: tsPattern(source, declaration.name),
        value: declaration.initializer ? tsExpression(source, declaration.initializer) : undefined,
      }),
    );
  }
  if (ts.isImportDeclaration(raw) && ts.isStringLiteral(raw.moduleSpecifier)) {
    const specifier = raw.moduleSpecifier.text;
    const bindings: AstImportBinding[] = [];
    const clause = raw.importClause;
    if (clause?.name) bindings.push({ local: clause.name.text, imported: "default", moduleSpecifier: specifier });
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({ local: clause.namedBindings.name.text, imported: "*", moduleSpecifier: specifier, namespace: true });
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.push({
          local: element.name.text,
          imported: (element.propertyName ?? element.name).text,
          moduleSpecifier: specifier,
        });
      }
    }
    return [tsNode(source, "import", raw, { moduleSpecifier: specifier, bindings })];
  }
  if (ts.isExportDeclaration(raw) && raw.moduleSpecifier && ts.isStringLiteral(raw.moduleSpecifier)) {
    const specifier = raw.moduleSpecifier.text;
    const bindings = raw.exportClause && ts.isNamedExports(raw.exportClause)
      ? raw.exportClause.elements.map(element => ({
          local: element.name.text,
          imported: (element.propertyName ?? element.name).text,
          moduleSpecifier: specifier,
        }))
      : [];
    return [tsNode(source, "import", raw, { moduleSpecifier: specifier, bindings })];
  }
  if (ts.isReturnStatement(raw)) {
    return [tsNode(source, "return", raw, { value: raw.expression ? tsExpression(source, raw.expression) : undefined })];
  }
  if (ts.isBlock(raw)) return raw.statements.flatMap(statement => tsStatement(source, statement));
  if (ts.isIfStatement(raw)) {
    return [tsNode(source, "if", raw, {
      children: [tsExpression(source, raw.expression)],
      body: ts.isBlock(raw.thenStatement) ? raw.thenStatement.statements.flatMap(s => tsStatement(source, s)) : tsStatement(source, raw.thenStatement),
      params: raw.elseStatement
        ? (ts.isBlock(raw.elseStatement) ? raw.elseStatement.statements.flatMap(s => tsStatement(source, s)) : tsStatement(source, raw.elseStatement))
        : [],
    })];
  }
  if (ts.isExpressionStatement(raw)) return [tsExpression(source, raw.expression)];
  return [tsNode(source, "other", raw, {
    children: tsNestedStatements(source, raw),
  })];
}

function tsFunction(source: ts.SourceFile, raw: ts.FunctionLikeDeclaration): AstNode {
  const name = raw.name && ts.isIdentifier(raw.name) ? raw.name.text : "__anonymous__";
  return tsNode(source, "function", raw, {
    name,
    params: raw.parameters.map(parameter =>
      tsNode(source, "parameter", parameter, {
        target: tsPattern(source, parameter.name),
        name: ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
      }),
    ),
    body: raw.body
      ? ts.isBlock(raw.body)
        ? raw.body.statements.flatMap(statement => tsStatement(source, statement))
        : [tsExpression(source, raw.body)]
      : [],
  });
}

function isJsTs(name: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(name);
}

function isPython(name: string): boolean {
  return /\.pyi?$/i.test(name);
}

function countNodes(root: AstNode): number {
  let count = 0;
  const stack = [root];
  while (stack.length && count <= MAX_AST_NODES) {
    const current = stack.pop()!;
    count++;
    if (current.target) stack.push(current.target);
    if (current.value) stack.push(current.value);
    if (current.callee) stack.push(current.callee);
    if (current.args) stack.push(...current.args);
    if (current.params) stack.push(...current.params);
    if (current.body) stack.push(...current.body);
    stack.push(...current.children);
  }
  return count;
}

export async function parseSourceFiles(
  files: Array<{ name: string; content: string }>,
): Promise<ParseSourceFilesResult> {
  const results: Array<ParsedFile | { name: string; reason: string }> = new Array(files.length);
  let cursor = 0;
  const parseOne = async (file: { name: string; content: string }): Promise<ParsedFile | { name: string; reason: string }> => {
    try {
      let root: AstNode;
      let language: ParsedFile["language"];

      if (isJsTs(file.name)) {
        language = "javascript";
        const scriptKind = /\.tsx$/i.test(file.name) ? ts.ScriptKind.TSX
          : /\.jsx$/i.test(file.name) ? ts.ScriptKind.JSX
            : /\.tsx?$/i.test(file.name) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const source = ts.createSourceFile(file.name, file.content, ts.ScriptTarget.Latest, true, scriptKind);
        const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
        if (parseDiagnostics.length) {
          const diagnostic = parseDiagnostics[0];
          const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
          return { name: file.name, reason: `${message} (line ${position.line + 1})` };
        }
        root = tsNode(source, "program", source, {
          body: source.statements.flatMap(statement => tsStatement(source, statement)),
        });
      } else if (isPython(file.name)) {
        language = "python";
        const { stdout } = await execFileAsync("python3", [
          "-c",
          pythonAstScript,
          Buffer.from(file.content, "utf8").toString("base64"),
        ], {
          encoding: "utf8",
          timeout: 3_000,
          maxBuffer: 2_000_000,
        });
        const result = JSON.parse(stdout) as AstNode | { parseError?: string };
        if ("parseError" in result) throw new Error(result.parseError ?? "Python syntax parse failed");
        root = result as AstNode;
      } else {
        return { name: file.name, reason: "Unsupported language in Phase 1 (JavaScript/TypeScript and Python only)." };
      }

      if (countNodes(root) > MAX_AST_NODES) {
        return { name: file.name, reason: "AST node limit exceeded." };
      }
      return { name: file.name, language, root };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Parser failed";
      return { name: file.name, reason: message.slice(0, 300) };
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      results[index] = await parseOne(files[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, () => worker()));

  const parsed = results.filter((result): result is ParsedFile => "root" in result);
  const skipped = results.filter((result): result is { name: string; reason: string } => "reason" in result);
  return { parsed, skipped };
}

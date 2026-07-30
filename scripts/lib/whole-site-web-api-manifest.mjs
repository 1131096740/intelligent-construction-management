import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep
} from "node:path";

const require = createRequire(
  new URL("../../services/api/package.json", import.meta.url)
);
const ts = require("typescript");

const SCHEMA_VERSION = 1;
const API_ROOT = "apps/web-admin/src/api";
const WEB_SOURCE_ROOT = "apps/web-admin/src";
const NEST_MANIFEST_PATH =
  "docs/product/manifests/nest-business-routes.json";
const MAX_FINITE_VALUES = 32;
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT"
]);

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestError(code) {
  const error = new Error("Web API manifest inspection failed");
  error.code = code;
  return error;
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function isTestFile(path) {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:spec|test)\.[^.]+$/.test(
    path
  );
}

function isSourceFile(path) {
  return /\.(?:[cm]?[jt]sx?|vue)$/.test(path);
}

function isApiModule(path) {
  return path.startsWith(`${API_ROOT}/`) && path.endsWith(".api.ts");
}

function vueScript(source) {
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join("\n");
}

function sourceFileFor(path, source) {
  const scriptKind =
    extname(path) === ".tsx"
      ? ts.ScriptKind.TSX
      : extname(path) === ".jsx"
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS;
  return ts.createSourceFile(
    path,
    extname(path) === ".vue" ? vueScript(source) : source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
}

async function collectFiles(root, relativeRoot, predicate) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const path = posixPath(relative(root, target));
        if (predicate(path)) files.push(path);
      }
    }
  }
  await visit(join(root, relativeRoot));
  return files.sort(compareStrings);
}

function hasExportModifier(node) {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    ) ?? false
  );
}

function functionName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
}

function moduleFunctions(ast) {
  const functions = new Map();
  const exports = [];
  for (const statement of ast.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body
    ) {
      const definition = {
        name: statement.name.text,
        node: statement,
        body: statement.body,
        parameters: statement.parameters,
        exported: hasExportModifier(statement)
      };
      functions.set(definition.name, definition);
      if (definition.exported) exports.push(definition);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        (!ts.isArrowFunction(declaration.initializer) &&
          !ts.isFunctionExpression(declaration.initializer))
      ) {
        continue;
      }
      const definition = {
        name: declaration.name.text,
        node: declaration.initializer,
        body: declaration.initializer.body,
        parameters: declaration.initializer.parameters,
        exported: hasExportModifier(statement)
      };
      functions.set(definition.name, definition);
      if (definition.exported) exports.push(definition);
    }
  }
  exports.sort((left, right) => compareStrings(left.name, right.name));
  return { functions, exports };
}

function topLevelBindings(ast) {
  const bindings = new Map();
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        !ts.isArrowFunction(declaration.initializer) &&
        !ts.isFunctionExpression(declaration.initializer)
      ) {
        bindings.set(declaration.name.text, {
          expression: declaration.initializer,
          environment: bindings
        });
      }
    }
  }
  return bindings;
}

function moduleContainsTransport(
  path,
  sources,
  sourceFiles,
  seen = new Set()
) {
  if (!path || seen.has(path)) return false;
  const source = sources.get(path);
  if (typeof source !== "string") return false;
  const nextSeen = new Set(seen).add(path);
  const ast = sourceFileFor(path, source);
  let detected = false;
  function visit(node) {
    if (detected) return;
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name === "fetch" || name === "createApiFetch") {
        detected = true;
        return;
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["EventSource", "WebSocket", "XMLHttpRequest"].includes(
        node.expression.text
      )
    ) {
      detected = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (detected) return true;
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (
      /(?:^|\/)api-fetch$/.test(specifier) ||
      /(?:^|\/)(?:axios|http|https|client|fetch)(?:$|[-./])/i.test(
        specifier
      )
    ) {
      return true;
    }
    const resolved = resolveModuleSpecifier(path, specifier, sourceFiles);
    if (
      resolved &&
      moduleContainsTransport(
        resolved,
        sources,
        sourceFiles,
        nextSeen
      )
    ) {
      return true;
    }
  }
  return false;
}

function transportConfiguration(
  ast,
  path,
  sourceFiles,
  sources
) {
  const transportNames = new Set(["fetch"]);
  const delegatedTransportNames = new Set();
  const unknownTransportNames = new Set();
  const unknownTransportNamespaces = new Set();
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const isApiFetch = /(?:^|\/)api-fetch$/.test(specifier);
    const isApiDelegate = /\.api$/.test(specifier);
    const isKnownPureModule =
      specifier === "./error-message" ||
      specifier === "@jiangkong/shared-domain";
    const resolvedModule = resolveModuleSpecifier(
      path,
      specifier,
      sourceFiles
    );
    const isNetworkModule =
      !isApiFetch &&
      (/(?:^|\/)(?:axios|http|https|client|fetch)(?:$|[-./])/i.test(
        specifier
      ) ||
        moduleContainsTransport(
          resolvedModule,
          sources,
          sourceFiles
        ));
    if (
      clause.name &&
      (isApiFetch ||
        isApiDelegate ||
        isNetworkModule ||
        !isKnownPureModule)
    ) {
      unknownTransportNames.add(clause.name.text);
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (
        isApiFetch ||
        isApiDelegate ||
        isNetworkModule ||
        !isKnownPureModule
      ) {
        unknownTransportNamespaces.add(bindings.name.text);
      }
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      const local = element.name.text;
      if (isApiFetch && imported === "apiFetch") {
        transportNames.add(local);
      } else if (isApiDelegate) {
        delegatedTransportNames.add(local);
      } else if (isNetworkModule || !isKnownPureModule) {
        unknownTransportNames.add(local);
      }
    }
  }
  return {
    transportNames,
    delegatedTransportNames,
    unknownTransportNames,
    unknownTransportNamespaces
  };
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression?.(current) ||
      ts.isAwaitExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function finite(values) {
  const output = [...new Set(values)].sort(compareStrings);
  return output.length <= MAX_FINITE_VALUES ? output : [":param"];
}

function cartesian(left, right) {
  const output = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      output.push(`${leftValue}${rightValue}`);
      if (output.length > MAX_FINITE_VALUES) return [":param"];
    }
  }
  return finite(output);
}

function literalTypeValues(type) {
  if (!type) return [];
  if (ts.isLiteralTypeNode(type)) {
    const literal = type.literal;
    if (
      ts.isStringLiteralLike(literal) ||
      ts.isNumericLiteral(literal)
    ) {
      return [literal.text];
    }
    if (literal.kind === ts.SyntaxKind.TrueKeyword) return ["true"];
    if (literal.kind === ts.SyntaxKind.FalseKeyword) return ["false"];
    return [];
  }
  if (ts.isUnionTypeNode(type)) {
    return finite(type.types.flatMap((item) => literalTypeValues(item)));
  }
  return [];
}

function syntheticBinding(strings) {
  return { strings: finite(strings.length ? strings : [":param"]) };
}

function defaultParameterBinding(parameter, context) {
  const literals = literalTypeValues(parameter.type);
  if (literals.length) return syntheticBinding(literals);
  if (parameter.initializer) {
    return {
      expression: parameter.initializer,
      environment: context.topBindings
    };
  }
  return syntheticBinding([":param"]);
}

function bindingStrings(binding, context, seen) {
  if (!binding) return [":param"];
  if (binding.strings) return binding.strings;
  return stringValues(
    binding.expression,
    binding.environment,
    context,
    seen
  );
}

function identifierBinding(name, environment, context) {
  return environment.get(name) ?? context.topBindings.get(name);
}

function callName(expression) {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return null;
}

function functionArgumentBindings(definition, call, environment, context) {
  const bindings = new Map();
  for (let index = 0; index < definition.parameters.length; index += 1) {
    const parameter = definition.parameters[index];
    if (!ts.isIdentifier(parameter.name)) continue;
    const argument = call?.arguments?.[index];
    bindings.set(
      parameter.name.text,
      argument
        ? { expression: argument, environment }
        : defaultParameterBinding(parameter, context)
    );
  }
  return bindings;
}

function returnValuesFromStatement(statement, environment, context, trace) {
  if (ts.isReturnStatement(statement)) {
    return statement.expression
      ? stringValues(statement.expression, environment, context, trace)
      : [];
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        environment.set(declaration.name.text, {
          expression: declaration.initializer,
          environment: new Map(environment)
        });
      }
    }
    return [];
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = unwrapExpression(statement.expression);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expression.left)
    ) {
      environment.set(expression.left.text, {
        expression: expression.right,
        environment: new Map(environment)
      });
    }
    return [];
  }
  if (ts.isBlock(statement)) {
    return returnValuesFromStatements(
      statement.statements,
      new Map(environment),
      context,
      trace
    );
  }
  if (ts.isIfStatement(statement)) {
    return finite([
      ...returnValuesFromStatement(
        statement.thenStatement,
        new Map(environment),
        context,
        trace
      ),
      ...(statement.elseStatement
        ? returnValuesFromStatement(
            statement.elseStatement,
            new Map(environment),
            context,
            trace
          )
        : [])
    ]);
  }
  if (ts.isTryStatement(statement)) {
    return finite([
      ...returnValuesFromStatement(
        statement.tryBlock,
        new Map(environment),
        context,
        trace
      ),
      ...(statement.catchClause
        ? returnValuesFromStatement(
            statement.catchClause.block,
            new Map(environment),
            context,
            trace
          )
        : []),
      ...(statement.finallyBlock
        ? returnValuesFromStatement(
            statement.finallyBlock,
            new Map(environment),
            context,
            trace
          )
        : [])
    ]);
  }
  return [];
}

function returnValuesFromStatements(statements, environment, context, trace) {
  const values = [];
  for (const statement of statements) {
    values.push(
      ...returnValuesFromStatement(statement, environment, context, trace)
    );
  }
  return finite(values);
}

function functionReturnStrings(
  definition,
  call,
  callerEnvironment,
  context,
  trace
) {
  const key = `return:${definition.name}`;
  if (trace.has(key)) return [":param"];
  const nextTrace = new Set(trace).add(key);
  const environment = functionArgumentBindings(
    definition,
    call,
    callerEnvironment,
    context
  );
  if (!ts.isBlock(definition.body)) {
    return stringValues(definition.body, environment, context, nextTrace);
  }
  const values = returnValuesFromStatements(
    definition.body.statements,
    environment,
    context,
    nextTrace
  );
  return values.length ? values : [":param"];
}

function stringValues(expression, environment, context, seen = new Set()) {
  const node = unwrapExpression(expression);
  if (!node) return [":param"];
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return [node.text];
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return ["true"];
  if (node.kind === ts.SyntaxKind.FalseKeyword) return ["false"];
  if (node.kind === ts.SyntaxKind.NullKeyword) return [""];
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(node.text, environment, context);
    if (!binding || seen.has(binding)) return [":param"];
    return bindingStrings(binding, context, new Set(seen).add(binding));
  }
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      values = cartesian(
        values,
        stringValues(span.expression, environment, context, seen)
      );
      values = values.map((value) => `${value}${span.literal.text}`);
    }
    return finite(values);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return cartesian(
      stringValues(node.left, environment, context, seen),
      stringValues(node.right, environment, context, seen)
    );
  }
  if (ts.isConditionalExpression(node)) {
    return finite([
      ...stringValues(node.whenTrue, environment, context, seen),
      ...stringValues(node.whenFalse, environment, context, seen)
    ]);
  }
  if (ts.isCallExpression(node)) {
    const name = callName(node.expression);
    if (
      name === "encodeURIComponent" ||
      name === "String" ||
      name === "decodeURIComponent"
    ) {
      return node.arguments[0]
        ? stringValues(node.arguments[0], environment, context, seen)
        : [":param"];
    }
    if (name === "toString" || name === "trim") {
      const target = ts.isPropertyAccessExpression(
        unwrapExpression(node.expression)
      )
        ? unwrapExpression(node.expression).expression
        : null;
      return target
        ? stringValues(target, environment, context, seen)
        : [":param"];
    }
    const definition = name ? context.functions.get(name) : null;
    if (definition) {
      return functionReturnStrings(
        definition,
        node,
        environment,
        context,
        seen
      );
    }
    return [":param"];
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return [":param"];
  }
  return [":param"];
}

function returnExpressionsFromStatement(statement, output) {
  if (ts.isReturnStatement(statement) && statement.expression) {
    output.push(statement.expression);
    return;
  }
  ts.forEachChild(statement, (child) =>
    returnExpressionsFromStatement(child, output)
  );
}

function functionReturnExpressions(definition) {
  if (!ts.isBlock(definition.body)) return [definition.body];
  const output = [];
  for (const statement of definition.body.statements) {
    returnExpressionsFromStatement(statement, output);
  }
  return output;
}

function resolveObjectExpressions(expression, environment, context, seen = new Set()) {
  const node = unwrapExpression(expression);
  if (!node) return [];
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(node.text, environment, context);
    if (!binding?.expression || seen.has(binding)) return [];
    return resolveObjectExpressions(
      binding.expression,
      binding.environment,
      context,
      new Set(seen).add(binding)
    );
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...resolveObjectExpressions(node.whenTrue, environment, context, seen),
      ...resolveObjectExpressions(node.whenFalse, environment, context, seen)
    ];
  }
  if (ts.isCallExpression(node)) {
    const name = callName(node.expression);
    const definition = name ? context.functions.get(name) : null;
    if (!definition) return [];
    const key = `object-return:${definition.name}`;
    if (seen.has(key)) return [];
    const functionEnvironment = functionArgumentBindings(
      definition,
      node,
      environment,
      context
    );
    return functionReturnExpressions(definition).flatMap((returned) =>
      resolveObjectExpressions(
        returned,
        functionEnvironment,
        context,
        new Set(seen).add(key)
      )
    );
  }
  return [];
}

function propertyName(property) {
  if (
    ts.isIdentifier(property.name) ||
    ts.isStringLiteralLike(property.name) ||
    ts.isNumericLiteral(property.name)
  ) {
    return property.name.text;
  }
  return null;
}

function objectPropertyExpressions(expression, name, environment, context) {
  const values = [];
  for (const object of resolveObjectExpressions(
    expression,
    environment,
    context
  )) {
    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        propertyName(property) === name
      ) {
        values.push({
          expression: property.initializer,
          environment
        });
      } else if (
        ts.isShorthandPropertyAssignment(property) &&
        property.name.text === name
      ) {
        const binding = identifierBinding(property.name.text, environment, context);
        if (binding) values.push(binding);
      } else if (ts.isSpreadAssignment(property)) {
        values.push(
          ...objectPropertyExpressions(
            property.expression,
            name,
            environment,
            context
          )
        );
      }
    }
  }
  return values;
}

function bodyKindFromExpression(expression, environment, context, seen = new Set()) {
  const node = unwrapExpression(expression);
  if (!node) return "none";
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(node.text, environment, context);
    if (!binding || seen.has(binding)) {
      return node.text.toLowerCase().includes("form") ? "form_data" : "raw";
    }
    if (binding?.expression) {
      return bodyKindFromExpression(
        binding.expression,
        binding.environment,
        context,
        new Set(seen).add(binding)
      );
    }
    return node.text.toLowerCase().includes("form") ? "form_data" : "raw";
  }
  if (ts.isNewExpression(node) && callName(node.expression) === "FormData") {
    return "form_data";
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSON" &&
    node.expression.name.text === "stringify"
  ) {
    return "json";
  }
  if (ts.isConditionalExpression(node)) {
    const kinds = new Set([
      bodyKindFromExpression(node.whenTrue, environment, context, seen),
      bodyKindFromExpression(node.whenFalse, environment, context, seen)
    ]);
    if (kinds.has("json")) return "json";
    if (kinds.has("form_data")) return "form_data";
    if (kinds.has("raw")) return "raw";
    return "none";
  }
  return "raw";
}

function requestInit(expression, environment, context) {
  if (!expression) return { methods: ["GET"], bodyKind: "none" };
  const methodBindings = objectPropertyExpressions(
    expression,
    "method",
    environment,
    context
  );
  const methods = finite(
    methodBindings.length
      ? methodBindings.flatMap((binding) =>
          bindingStrings(binding, context, new Set())
        )
      : ["GET"]
  ).map((method) => method.toUpperCase());
  const bodyBindings = objectPropertyExpressions(
    expression,
    "body",
    environment,
    context
  );
  const bodyKinds = new Set(
    bodyBindings.map((binding) =>
      binding.expression
        ? bodyKindFromExpression(
            binding.expression,
            binding.environment,
            context
          )
        : "raw"
    )
  );
  const jsonHeaders = objectPropertyExpressions(
    expression,
    "headers",
    environment,
    context
  ).some(
    (binding) =>
      binding.expression &&
      /application\/json/i.test(binding.expression.getText())
  );
  const bodyKind = bodyKinds.has("json") || (jsonHeaders && bodyKinds.has("raw"))
    ? "json"
    : bodyKinds.has("form_data")
      ? "form_data"
      : bodyKinds.has("raw")
        ? "raw"
        : "none";
  return { methods, bodyKind };
}

export function normalizeWebApiPath(path) {
  if (typeof path !== "string") {
    throw manifestError("WEB_API_MANIFEST_INVALID_PATH");
  }
  const withoutApi = path.replace(/^\/api(?=\/|$)/, "");
  const withoutQuery = withoutApi.split("?")[0];
  const normalized = `/${withoutQuery}`
    .replace(/\/+/g, "/")
    .replace(
      /(^|\/):[A-Za-z_][A-Za-z0-9_]*(?:\([^/]*\))?[?+*]?/g,
      "$1:param"
    )
    .replace(/\/$/, "");
  return normalized || "/";
}

function ticketField(expression) {
  const node = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === "downloadPath" || node.name.text === "downloadUrl")
  ) {
    return node.name.text;
  }
  return null;
}

function addApiFetchRequest(call, environment, context, requests) {
  const sourceLine =
    context.ast.getLineAndCharacterOfPosition(call.getStart(context.ast)).line +
    1;
  const pathExpression = call.arguments[0];
  if (!pathExpression) {
    requests.push({
      kind: "main",
      sourceLine,
      method: "GET",
      path: null,
      normalizedPath: null,
      normalizedKey: null,
      bodyKind: "none",
      unresolvedReason: "missing_path"
    });
    return;
  }
  const followupField = ticketField(pathExpression);
  if (followupField) {
    requests.push({
      kind: "ticket_followup",
      sourceLine,
      method: "GET",
      ticketField: followupField,
      bodyKind: "none"
    });
    return;
  }
  const paths = finite(
    stringValues(pathExpression, environment, context, new Set())
  );
  const { methods, bodyKind } = requestInit(
    call.arguments[1],
    environment,
    context
  );
  for (const method of methods) {
    for (const path of paths) {
      const validMethod = HTTP_METHODS.has(method);
      const unresolved = !path.startsWith("/") || path === "/:param";
      const normalizedPath =
        unresolved || !validMethod ? null : normalizeWebApiPath(path);
      requests.push({
        kind: "main",
        sourceLine,
        method,
        path: unresolved ? null : path,
        normalizedPath,
        normalizedKey: normalizedPath
          ? `${method} ${normalizedPath}`
          : null,
        bodyKind,
        ...(!validMethod
          ? { unresolvedReason: "dynamic_method" }
          : unresolved
            ? { unresolvedReason: "dynamic_path" }
            : {})
      });
    }
  }
}

function addUnknownTransportRequest(node, context, requests, reason) {
  const sourceLine =
    context.ast.getLineAndCharacterOfPosition(node.getStart(context.ast)).line +
    1;
  requests.push({
    kind: "main",
    sourceLine,
    method: "UNKNOWN",
    path: null,
    normalizedPath: null,
    normalizedKey: null,
    bodyKind: "raw",
    unresolvedReason: reason
  });
}

function analyzeExpression(expression, environment, context, requests, trace) {
  const node = unwrapExpression(expression);
  if (!node) return;
  if (ts.isCallExpression(node)) {
    const name = callName(node.expression);
    if (name && context.transportNames.has(name)) {
      addApiFetchRequest(node, environment, context, requests);
      return;
    }
    if (
      (name && context.delegatedTransportNames.has(name)) ||
      (name && context.unknownTransportNames.has(name)) ||
      (ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        context.unknownTransportNamespaces.has(
          node.expression.expression.text
        ))
    ) {
      addUnknownTransportRequest(
        node,
        context,
        requests,
        "unknown_transport_delegate"
      );
      return;
    }
    const definition = name ? context.functions.get(name) : null;
    if (definition) {
      for (const argument of node.arguments) {
        analyzeExpression(
          argument,
          environment,
          context,
          requests,
          trace
        );
      }
      analyzeFunction(definition, node, environment, context, requests, trace);
      return;
    }
  }
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ["EventSource", "WebSocket", "XMLHttpRequest"].includes(
      node.expression.text
    )
  ) {
    addUnknownTransportRequest(
      node,
      context,
      requests,
      "unknown_network_primitive"
    );
    return;
  }
  ts.forEachChild(node, (child) =>
    analyzeExpression(child, environment, context, requests, trace)
  );
}

function analyzeStatement(statement, environment, context, requests, trace) {
  if (ts.isFunctionDeclaration(statement)) return;
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer) {
        analyzeExpression(
          declaration.initializer,
          environment,
          context,
          requests,
          trace
        );
      }
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        environment.set(declaration.name.text, {
          expression: declaration.initializer,
          environment: new Map(environment)
        });
      }
    }
    return;
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = unwrapExpression(statement.expression);
    analyzeExpression(expression, environment, context, requests, trace);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expression.left)
    ) {
      environment.set(expression.left.text, {
        expression: expression.right,
        environment: new Map(environment)
      });
    }
    return;
  }
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    if (statement.expression) {
      analyzeExpression(
        statement.expression,
        environment,
        context,
        requests,
        trace
      );
    }
    return;
  }
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      analyzeStatement(
        child,
        new Map(environment),
        context,
        requests,
        trace
      );
    }
    return;
  }
  if (ts.isIfStatement(statement)) {
    analyzeExpression(
      statement.expression,
      environment,
      context,
      requests,
      trace
    );
    analyzeStatement(
      statement.thenStatement,
      new Map(environment),
      context,
      requests,
      trace
    );
    if (statement.elseStatement) {
      analyzeStatement(
        statement.elseStatement,
        new Map(environment),
        context,
        requests,
        trace
      );
    }
    return;
  }
  if (ts.isTryStatement(statement)) {
    analyzeStatement(
      statement.tryBlock,
      new Map(environment),
      context,
      requests,
      trace
    );
    if (statement.catchClause) {
      analyzeStatement(
        statement.catchClause.block,
        new Map(environment),
        context,
        requests,
        trace
      );
    }
    if (statement.finallyBlock) {
      analyzeStatement(
        statement.finallyBlock,
        new Map(environment),
        context,
        requests,
        trace
      );
    }
    return;
  }
  if (
    ts.isForStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement)
  ) {
    if (statement.expression) {
      analyzeExpression(
        statement.expression,
        environment,
        context,
        requests,
        trace
      );
    }
    analyzeStatement(
      statement.statement,
      new Map(environment),
      context,
      requests,
      trace
    );
    return;
  }
  ts.forEachChild(statement, (child) => {
    if (ts.isExpression(child)) {
      analyzeExpression(child, environment, context, requests, trace);
    } else if (ts.isStatement(child)) {
      analyzeStatement(child, environment, context, requests, trace);
    }
  });
}

function analyzeFunction(
  definition,
  call,
  callerEnvironment,
  context,
  requests,
  trace
) {
  const key = `request:${definition.name}`;
  if (trace.has(key)) return;
  const nextTrace = new Set(trace).add(key);
  const environment = functionArgumentBindings(
    definition,
    call,
    callerEnvironment,
    context
  );
  if (ts.isBlock(definition.body)) {
    for (const statement of definition.body.statements) {
      analyzeStatement(
        statement,
        environment,
        context,
        requests,
        nextTrace
      );
    }
  } else {
    analyzeExpression(
      definition.body,
      environment,
      context,
      requests,
      nextTrace
    );
  }
}

function dedupeRequests(requests) {
  const byKey = new Map();
  for (const request of requests) {
    const key =
      request.kind === "ticket_followup"
        ? `ticket\0${request.ticketField}`
        : `main\0${request.method}\0${request.normalizedPath ?? request.unresolvedReason}\0${request.bodyKind}`;
    if (!byKey.has(key)) byKey.set(key, request);
  }
  return [...byKey.values()].sort((left, right) => {
    const leftKey =
      left.kind === "ticket_followup"
        ? `1 ${left.ticketField}`
        : `0 ${left.method} ${left.normalizedPath ?? ""}`;
    const rightKey =
      right.kind === "ticket_followup"
        ? `1 ${right.ticketField}`
        : `0 ${right.method} ${right.normalizedPath ?? ""}`;
    return compareStrings(leftKey, rightKey);
  });
}

function inspectApiModule(path, source, sourceFiles, sources) {
  const ast = sourceFileFor(path, source);
  const { functions, exports } = moduleFunctions(ast);
  const context = {
    ast,
    functions,
    topBindings: topLevelBindings(ast),
    ...transportConfiguration(ast, path, sourceFiles, sources)
  };
  return exports.map((definition) => {
    const requests = [];
    analyzeFunction(
      definition,
      null,
      new Map(),
      context,
      requests,
      new Set()
    );
    return {
      name: definition.name,
      apiFile: path,
      kind: requests.length ? "transport" : "pure",
      requests: dedupeRequests(requests)
    };
  });
}

function moduleCandidates(path) {
  return [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.js`,
    `${path}.mjs`,
    `${path}.vue`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
    `${path}/index.js`,
    `${path}/index.vue`
  ];
}

function resolveModuleSpecifier(fromPath, specifier, sourceFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = `${WEB_SOURCE_ROOT}/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    const parts = fromPath.split("/");
    parts.pop();
    for (const segment of specifier.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    base = parts.join("/");
  } else {
    return null;
  }
  const normalized = base.replace(/\/+/g, "/");
  return moduleCandidates(normalized).find((candidate) =>
    sourceFiles.has(candidate)
  ) ?? null;
}

function importedSpecifiers(ast) {
  const specifiers = [];
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return specifiers;
}

function expressionContainsAnyIdentifier(node, names) {
  let found = false;
  function visit(current) {
    if (
      found ||
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isTypeNode?.(current)
    ) {
      return;
    }
    if (ts.isIdentifier(current) && names.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function runtimeAliases(ast, name) {
  const aliases = new Set([name]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (
          ts.isIdentifier(node.name) &&
          !aliases.has(node.name.text) &&
          expressionContainsAnyIdentifier(node.initializer, aliases)
        ) {
          aliases.add(node.name.text);
          changed = true;
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        !aliases.has(node.left.text) &&
        expressionContainsAnyIdentifier(node.right, aliases)
      ) {
        aliases.add(node.left.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return aliases;
}

function runtimeUseContainer(identifier) {
  let current = identifier;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression?.(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current)
    ) {
      current = parent;
      continue;
    }
    break;
  }
  return current;
}

function hasRuntimeIdentifierUse(ast, aliases) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isTypeNode?.(node)
    ) {
      return;
    }
    if (ts.isIdentifier(node) && aliases.has(node.text)) {
      const parent = node.parent;
      if (
        ts.isCallExpression(parent) &&
        parent.expression === node
      ) {
        found = true;
        return;
      }
      const container = runtimeUseContainer(node);
      const consumer = container.parent;
      if (
        (ts.isCallExpression(consumer) &&
          consumer.arguments.includes(container) &&
          !(
            ts.isPropertyAccessExpression(consumer.expression) &&
            ts.isIdentifier(consumer.expression.expression) &&
            consumer.expression.expression.text === "console"
          )) ||
        (ts.isNewExpression(consumer) &&
          consumer.arguments?.includes(container))
      ) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

function vueTemplate(source) {
  return [...source.matchAll(/<template\b[^>]*>([\s\S]*?)<\/template>/gi)]
    .map((match) => match[1])
    .join("\n");
}

function hasVueTemplateRuntimeUse(source, name) {
  const template = vueTemplate(source);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directive =
    /(?:^|\s)(?:@|v-on:|:|v-bind:)[A-Za-z0-9_.:-]+\s*=\s*(["'])([\s\S]*?)\1/g;
  for (const match of template.matchAll(directive)) {
    if (new RegExp(`\\b${escaped}\\b`).test(match[2])) return true;
  }
  return false;
}

function consumerImports(path, source, ast, sourceFiles) {
  const imports = [];
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const apiFile = resolveModuleSpecifier(
      path,
      statement.moduleSpecifier.text,
      sourceFiles
    );
    if (!apiFile || !isApiModule(apiFile)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) {
      imports.push({
        apiFile,
        wrapper: null,
        issue: "default_api_import"
      });
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.push({
        apiFile,
        wrapper: null,
        issue: "namespace_api_import"
      });
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        const local = element.name.text;
        const aliases = runtimeAliases(ast, local);
        if (
          hasRuntimeIdentifierUse(ast, aliases) ||
          (extname(path) === ".vue" &&
            [...aliases].some((name) =>
              hasVueTemplateRuntimeUse(source, name)
            ))
        ) {
          imports.push({
            apiFile,
            wrapper: imported,
            issue: null
          });
        }
      }
    }
  }
  return imports;
}

function duplicateGroups(wrappers) {
  const groups = new Map();
  for (const wrapper of wrappers) {
    for (const request of wrapper.requests) {
      if (request.kind !== "main" || !request.normalizedKey) continue;
      const item = {
        apiFile: wrapper.apiFile,
        wrapper: wrapper.name
      };
      const values = groups.get(request.normalizedKey) ?? [];
      if (
        !values.some(
          (value) =>
            value.apiFile === item.apiFile && value.wrapper === item.wrapper
        )
      ) {
        values.push(item);
      }
      groups.set(request.normalizedKey, values);
    }
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([normalizedKey, values]) => ({
      normalizedKey,
      wrappers: values.sort(
        (left, right) =>
          compareStrings(left.apiFile, right.apiFile) ||
          compareStrings(left.wrapper, right.wrapper)
      )
    }))
    .sort((left, right) =>
      compareStrings(left.normalizedKey, right.normalizedKey)
    );
}

function directFetchMethod(call, environment, context) {
  return requestInit(call.arguments[1], environment, context).methods;
}

function inspectAuthTransportExceptions(path, source) {
  if (!source) return [];
  const ast = sourceFileFor(path, source);
  const context = {
    functions: moduleFunctions(ast).functions,
    topBindings: topLevelBindings(ast)
  };
  const exceptions = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (
        name === "postAuth" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const normalizedPath = normalizeWebApiPath(
          `/auth/${node.arguments[0].text}`
        );
        exceptions.push({
          method: "POST",
          normalizedPath,
          normalizedKey: `POST ${normalizedPath}`,
          sourceFile: path,
          transport: "auth_store_exception"
        });
      } else if (
        name === "fetch" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text.startsWith("/api/auth/")
      ) {
        const normalizedPath = normalizeWebApiPath(node.arguments[0].text);
        for (const method of directFetchMethod(node, new Map(), context)) {
          exceptions.push({
            method,
            normalizedPath,
            normalizedKey: `${method} ${normalizedPath}`,
            sourceFile: path,
            transport: "auth_store_exception"
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const byKey = new Map(
    exceptions.map((item) => [item.normalizedKey, item])
  );
  return [...byKey.values()].sort((left, right) =>
    compareStrings(left.normalizedKey, right.normalizedKey)
  );
}

function classifyBlockers({
  wrappers,
  duplicateNormalizedRoutes,
  consumerIssues,
  nestRouteKeys
}) {
  const orphanWrappers = wrappers
    .filter(
      (wrapper) =>
        wrapper.kind === "transport" &&
        wrapper.productionConsumers.length === 0
    )
    .map((wrapper) => ({
      apiFile: wrapper.apiFile,
      wrapper: wrapper.name,
      classification:
        wrapper.testConsumers.length > 0
          ? "test_only"
          : wrapper.unreachableConsumers.length > 0
            ? "unreachable_only"
            : "unreferenced"
    }));
  const unresolvedRequests = wrappers.flatMap((wrapper) =>
    wrapper.requests
      .filter(
        (request) => request.kind === "main" && !request.normalizedKey
      )
      .map((request) => ({
        apiFile: wrapper.apiFile,
        wrapper: wrapper.name,
        reason: request.unresolvedReason
      }))
  );
  const frontendWithoutBackend = wrappers.flatMap((wrapper) =>
    wrapper.requests
      .filter(
        (request) =>
          request.kind === "main" &&
          request.normalizedKey &&
          !nestRouteKeys.has(request.normalizedKey)
      )
      .map((request) => ({
        apiFile: wrapper.apiFile,
        wrapper: wrapper.name,
        normalizedKey: request.normalizedKey
      }))
  );
  return {
    orphanWrappers,
    duplicateWriteWrappers: duplicateNormalizedRoutes.filter(
      (group) => !group.normalizedKey.startsWith("GET ")
    ),
    unresolvedRequests,
    frontendWithoutBackend,
    consumerIssues
  };
}

export async function inspectWholeSiteWebApiManifest({ root }) {
  const resolvedRoot = resolve(root);
  const apiFiles = await collectFiles(
    resolvedRoot,
    API_ROOT,
    (path) => isApiModule(path) && !isTestFile(path)
  );
  const allSourceFiles = await collectFiles(
    resolvedRoot,
    WEB_SOURCE_ROOT,
    (path) => isSourceFile(path)
  );
  const sourceFileSet = new Set(allSourceFiles);
  const sources = new Map(
    await Promise.all(
      allSourceFiles.map(async (path) => [
        path,
        await readFile(join(resolvedRoot, path), "utf8")
      ])
    )
  );
  const asts = new Map(
    allSourceFiles.map((path) => [
      path,
      sourceFileFor(path, sources.get(path))
    ])
  );

  const wrappers = (
    await Promise.all(
      apiFiles.map(async (path) =>
        inspectApiModule(path, sources.get(path), sourceFileSet, sources)
      )
    )
  )
    .flat()
    .sort(
      (left, right) =>
        compareStrings(left.apiFile, right.apiFile) ||
        compareStrings(left.name, right.name)
    );

  const graph = new Map();
  for (const path of allSourceFiles) {
    graph.set(
      path,
      importedSpecifiers(asts.get(path))
        .map((specifier) =>
          resolveModuleSpecifier(path, specifier, sourceFileSet)
        )
        .filter(Boolean)
    );
  }
  const reachable = new Set();
  const pending = sourceFileSet.has(`${WEB_SOURCE_ROOT}/main.ts`)
    ? [`${WEB_SOURCE_ROOT}/main.ts`]
    : [];
  while (pending.length) {
    const path = pending.pop();
    if (reachable.has(path)) continue;
    reachable.add(path);
    for (const dependency of graph.get(path) ?? []) {
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }

  const wrapperByIdentity = new Map(
    wrappers.map((wrapper) => [
      `${wrapper.apiFile}\0${wrapper.name}`,
      wrapper
    ])
  );
  const consumerIssues = [];
  for (const path of allSourceFiles) {
    if (isApiModule(path)) continue;
    for (const imported of consumerImports(
      path,
      sources.get(path),
      asts.get(path),
      sourceFileSet
    )) {
      if (imported.issue) {
        consumerIssues.push({
          consumer: path,
          apiFile: imported.apiFile,
          issue: imported.issue
        });
        continue;
      }
      const wrapper = wrapperByIdentity.get(
        `${imported.apiFile}\0${imported.wrapper}`
      );
      if (!wrapper) {
        // API modules also export types, constants, and error classes. They are
        // outside the transport-wrapper manifest and remain covered by
        // TypeScript's ordinary import/export checks.
        continue;
      }
      const target =
        isTestFile(path)
          ? "testConsumers"
          : reachable.has(path)
          ? "productionConsumers"
          : "unreachableConsumers";
      wrapper[target] ??= [];
      wrapper[target].push(path);
    }
  }
  for (const wrapper of wrappers) {
    wrapper.productionConsumers = [
      ...new Set(wrapper.productionConsumers ?? [])
    ].sort(compareStrings);
    wrapper.testConsumers = [
      ...new Set(wrapper.testConsumers ?? [])
    ].sort(compareStrings);
    wrapper.unreachableConsumers = [
      ...new Set(wrapper.unreachableConsumers ?? [])
    ].sort(compareStrings);
  }

  let nestManifest;
  try {
    nestManifest = JSON.parse(
      await readFile(join(resolvedRoot, NEST_MANIFEST_PATH), "utf8")
    );
  } catch {
    throw manifestError("WEB_API_MANIFEST_NEST_MANIFEST_UNREADABLE");
  }
  if (
    nestManifest?.schemaVersion !== 1 ||
    !Array.isArray(nestManifest.routes)
  ) {
    throw manifestError("WEB_API_MANIFEST_NEST_MANIFEST_INVALID");
  }
  const nestRouteKeys = new Set(
    nestManifest.routes
      .map((route) => route?.normalizedKey)
      .filter((key) => typeof key === "string")
  );
  const duplicateNormalizedRoutes = duplicateGroups(wrappers);
  const blockers = classifyBlockers({
    wrappers,
    duplicateNormalizedRoutes,
    consumerIssues: consumerIssues.sort(
      (left, right) =>
        compareStrings(left.consumer, right.consumer) ||
        compareStrings(left.issue, right.issue)
    ),
    nestRouteKeys
  });
  const authPath = `${WEB_SOURCE_ROOT}/auth/auth.store.ts`;
  const authTransportExceptions = inspectAuthTransportExceptions(
    authPath,
    sources.get(authPath)
  );
  blockers.authWithoutBackend = authTransportExceptions
    .filter((item) => !nestRouteKeys.has(item.normalizedKey))
    .map((item) => ({
      sourceFile: item.sourceFile,
      normalizedKey: item.normalizedKey
    }));

  const transportWrappers = wrappers.filter(
    (wrapper) => wrapper.kind === "transport"
  );
  const mainRequests = transportWrappers.flatMap((wrapper) =>
    wrapper.requests.filter((request) => request.kind === "main")
  );
  const ticketFollowups = transportWrappers.flatMap((wrapper) =>
    wrapper.requests.filter(
      (request) => request.kind === "ticket_followup"
    )
  );
  const requestEdgeCount = new Set(
    transportWrappers.flatMap((wrapper) =>
      wrapper.requests.map(
        (request) =>
          `${wrapper.apiFile}\0${wrapper.name}\0${request.kind}\0${request.sourceLine}`
      )
    )
  ).size;
  const status = Object.values(blockers).some((items) => items.length > 0)
    ? "blocked"
    : "ready";
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    scope: {
      apiRoot: API_ROOT,
      productionEntrypoint: `${WEB_SOURCE_ROOT}/main.ts`,
      nestRouteManifest: NEST_MANIFEST_PATH
    },
    summary: {
      apiModuleCount: apiFiles.length,
      exportedFunctionCount: wrappers.length,
      transportWrapperCount: transportWrappers.length,
      pureExportCount: wrappers.length - transportWrappers.length,
      mainRequestBindingCount: mainRequests.length,
      ticketFollowupCount: ticketFollowups.length,
      requestEdgeCount,
      productionConsumerCount: transportWrappers.filter(
        (wrapper) => wrapper.productionConsumers.length > 0
      ).length,
      orphanWrapperCount: blockers.orphanWrappers.length,
      testOnlyWrapperCount: blockers.orphanWrappers.filter(
        (wrapper) => wrapper.classification === "test_only"
      ).length,
      unreferencedWrapperCount: blockers.orphanWrappers.filter(
        (wrapper) => wrapper.classification === "unreferenced"
      ).length,
      duplicateNormalizedRouteGroupCount:
        duplicateNormalizedRoutes.length,
      authTransportExceptionCount: authTransportExceptions.length
    },
    evidence: {
      productionModuleCount: allSourceFiles.filter(
        (path) => !isTestFile(path)
      ).length,
      reachableProductionModuleCount: [...reachable].filter(
        (path) => !isTestFile(path)
      ).length
    },
    wrappers,
    authTransportExceptions,
    duplicateNormalizedRoutes,
    blockers
  };
}

export function renderWholeSiteWebApiManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeOrCheckWholeSiteWebApiManifest({
  mode,
  targetPath,
  rendered
}) {
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered);
    return;
  }
  if (mode !== "check") {
    throw manifestError("WEB_API_MANIFEST_INVALID_MODE");
  }
  let existing;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch {
    throw manifestError("WEB_API_MANIFEST_MISSING");
  }
  if (existing !== rendered) {
    throw manifestError("WEB_API_MANIFEST_DRIFT");
  }
}

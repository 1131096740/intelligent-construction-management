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
const RETIRED_WRAPPER_REGISTRY_PATH =
  "docs/product/manifests/retired-web-api-wrappers.json";
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

function bindingNames(node, names) {
  if (!node) return;
  if (ts.isIdentifier(node)) {
    names.add(node.text);
    return;
  }
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const element of node.elements) {
      if (ts.isBindingElement(element)) {
        bindingNames(element.name, names);
      }
    }
  }
}

function bindingHasName(node, name) {
  const names = new Set();
  bindingNames(node, names);
  return names.has(name);
}

function isFunctionLikeNode(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function functionScopedVarBindsName(node, name) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (isFunctionLikeNode(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      !(node.parent.flags & ts.NodeFlags.BlockScoped) &&
      bindingHasName(node.name, name)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  if (node.body) {
    ts.forEachChild(node.body, visit);
  }
  return found;
}

function directBlockBindsName(block, name) {
  const statements = ts.isCaseBlock(block)
    ? block.clauses.flatMap((clause) => [...clause.statements])
    : [...block.statements];
  return statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) => bindingHasName(declaration.name, name)
      );
    }
    return (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    );
  });
}

function lexicalBindingShadowsIdentifier(identifier, definition) {
  const name = identifier.text;
  for (
    let current = identifier.parent;
    current;
    current = current.parent
  ) {
    if (isFunctionLikeNode(current)) {
      if (
        current.parameters.some((parameter) =>
          bindingHasName(parameter.name, name)
        ) ||
        ((ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current)) &&
          current.name?.text === name) ||
        functionScopedVarBindsName(current, name)
      ) {
        return true;
      }
    } else if (
      (ts.isBlock(current) || ts.isCaseBlock(current)) &&
      directBlockBindsName(current, name)
    ) {
      return true;
    } else if (
      ts.isCatchClause(current) &&
      current.variableDeclaration &&
      bindingHasName(current.variableDeclaration.name, name)
    ) {
      return true;
    } else if (
      (ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer) &&
      current.initializer.declarations.some((declaration) =>
        bindingHasName(declaration.name, name)
      )
    ) {
      return true;
    }
    if (current === definition.node) return false;
  }
  return true;
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

const GLOBAL_FETCH_RECEIVERS = new Set([
  "globalThis",
  "self",
  "window"
]);
const NETWORK_PRIMITIVE_CONSTRUCTORS = new Set([
  "EventSource",
  "WebSocket",
  "XMLHttpRequest"
]);

function staticAccessProperties(
  node,
  environment,
  context
) {
  if (ts.isPropertyAccessExpression(node)) {
    return [node.name.text];
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression
  ) {
    const values = finite(
      stringValues(
        node.argumentExpression,
        environment,
        context,
        new Set()
      )
    );
    return values.length > 0 &&
      values.every((value) => value !== ":param")
      ? values
      : null;
  }
  return [];
}

function mergeTransportKinds(kinds) {
  if (kinds.includes("unknown")) return "unknown";
  if (kinds.includes("unknown_network")) {
    return "unknown_network";
  }
  if (kinds.includes("known")) return "known";
  return null;
}

const MISSING_TRANSPORT_BINDING = Object.freeze({
  missing: true,
  transportKind: "none"
});
const UNKNOWN_TRANSPORT_BINDING = Object.freeze({
  transportKind: "unknown"
});

function mergeAlternativeTransportKinds(kinds) {
  const resolved = kinds.filter(Boolean);
  if (resolved.length === 0) return null;
  if (resolved.length !== kinds.length) return "unknown";
  return resolved.every((kind) => kind === resolved[0])
    ? resolved[0]
    : "unknown";
}

function alternativeTransportBinding(bindings) {
  const flattened = bindings.flatMap((binding) =>
    binding?.alternatives
      ? binding.alternatives
      : [binding ?? MISSING_TRANSPORT_BINDING]
  );
  return flattened.every(
    (binding) => binding === flattened[0]
  )
    ? flattened[0]
    : { alternatives: flattened };
}

function transportExpressionBinding(expression, environment) {
  return {
    expression,
    environment: new Map(environment)
  };
}

function transportBindingFromExpression(
  expression,
  environment,
  context,
  seen = new Set()
) {
  const node = unwrapExpression(expression);
  if (!node) return MISSING_TRANSPORT_BINDING;
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    if (binding) return binding;
    const kind = transportKindFromExpression(
      node,
      environment,
      context,
      seen
    );
    return kind
      ? { transportKind: kind }
      : transportExpressionBinding(node, environment);
  }
  if (ts.isConditionalExpression(node)) {
    const candidates = [
      transportBindingFromExpression(
        node.whenTrue,
        environment,
        context,
        seen
      ),
      transportBindingFromExpression(
        node.whenFalse,
        environment,
        context,
        seen
      )
    ];
    return candidates.some(
      (candidate) =>
        bindingTransportKind(candidate, context) ||
        bindingMayContainTransportProperties(candidate)
    )
      ? alternativeTransportBinding(candidates)
      : transportExpressionBinding(node, environment);
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.CommaToken ||
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
  ) {
    return transportBindingFromExpression(
      node.right,
      environment,
      context,
      seen
    );
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    if (
      isGlobalNavigatorExpression(
        node,
        environment,
        context
      )
    ) {
      return { globalNavigator: true };
    }
    const directKind = transportKindFromExpression(
      node,
      environment,
      context,
      seen
    );
    if (directKind) {
      return { transportKind: directKind };
    }
    const properties = staticAccessProperties(
      node,
      environment,
      context
    );
    if (properties === null) return UNKNOWN_TRANSPORT_BINDING;
    const sourceBinding = transportBindingFromExpression(
      node.expression,
      environment,
      context,
      seen
    );
    return alternativeTransportBinding(
      properties.map((property) =>
        transportPropertyBindingFromBinding(
          sourceBinding,
          property,
          context,
          seen
        )
      )
    );
  }
  return transportExpressionBinding(node, environment);
}

function transportPropertyBindingFromExpression(
  expression,
  property,
  environment,
  context,
  seen
) {
  const node = unwrapExpression(expression);
  if (!node) return MISSING_TRANSPORT_BINDING;
  if (
    property === "sendBeacon" &&
    isGlobalNavigatorExpression(node, environment, context)
  ) {
    return { transportKind: "unknown_network" };
  }
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    if (binding) {
      return transportPropertyBindingFromBinding(
        binding,
        property,
        context,
        seen
      );
    }
    if (GLOBAL_FETCH_RECEIVERS.has(node.text)) {
      if (property === "fetch") {
        return { transportKind: "known" };
      }
      if (NETWORK_PRIMITIVE_CONSTRUCTORS.has(property)) {
        return { transportKind: "unknown_network" };
      }
    }
    return MISSING_TRANSPORT_BINDING;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (let index = node.properties.length - 1; index >= 0; index -= 1) {
      const candidate = node.properties[index];
      if (ts.isSpreadAssignment(candidate)) {
        const spread = transportPropertyBindingFromExpression(
          candidate.expression,
          property,
          environment,
          context,
          seen
        );
        if (!spread.missing) return spread;
        continue;
      }
      const key =
        ts.isComputedPropertyName(candidate.name)
          ? staticAccessProperties(
              ts.factory.createElementAccessExpression(
                ts.factory.createIdentifier("_"),
                candidate.name.expression
              ),
              environment,
              context
            )
          : [propertyName(candidate)];
      if (key === null) return UNKNOWN_TRANSPORT_BINDING;
      if (!key.includes(property)) continue;
      if (key.length > 1) return UNKNOWN_TRANSPORT_BINDING;
      if (ts.isPropertyAssignment(candidate)) {
        return transportBindingFromExpression(
          candidate.initializer,
          environment,
          context,
          seen
        );
      }
      if (ts.isShorthandPropertyAssignment(candidate)) {
        return transportBindingFromExpression(
          candidate.name,
          environment,
          context,
          seen
        );
      }
      return MISSING_TRANSPORT_BINDING;
    }
    return MISSING_TRANSPORT_BINDING;
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (!/^(?:0|[1-9]\d*)$/.test(property)) {
      return MISSING_TRANSPORT_BINDING;
    }
    const element = node.elements[Number(property)];
    return element && !ts.isOmittedExpression(element)
      ? transportBindingFromExpression(
          ts.isSpreadElement(element)
            ? element.expression
            : element,
          environment,
          context,
          seen
        )
      : MISSING_TRANSPORT_BINDING;
  }
  if (ts.isConditionalExpression(node)) {
    return alternativeTransportBinding([
      transportPropertyBindingFromExpression(
        node.whenTrue,
        property,
        environment,
        context,
        seen
      ),
      transportPropertyBindingFromExpression(
        node.whenFalse,
        property,
        environment,
        context,
        seen
      )
    ]);
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const sourceBinding = transportBindingFromExpression(
      node,
      environment,
      context,
      seen
    );
    return transportPropertyBindingFromBinding(
      sourceBinding,
      property,
      context,
      seen
    );
  }
  return MISSING_TRANSPORT_BINDING;
}

function transportPropertyBindingFromBinding(
  binding,
  property,
  context,
  seen = new Set()
) {
  if (!binding || seen.has(binding)) {
    return MISSING_TRANSPORT_BINDING;
  }
  const nextSeen = new Set(seen).add(binding);
  if (binding.alternatives) {
    return alternativeTransportBinding(
      binding.alternatives.map((candidate) =>
        transportPropertyBindingFromBinding(
          candidate,
          property,
          context,
          nextSeen
        )
      )
    );
  }
  if (binding.globalNavigator) {
    return property === "sendBeacon"
      ? { transportKind: "unknown_network" }
      : MISSING_TRANSPORT_BINDING;
  }
  if (binding.restSource) {
    if (binding.excludedProperties?.has(property)) {
      return MISSING_TRANSPORT_BINDING;
    }
    return transportPropertyBindingFromBinding(
      binding.restSource,
      property,
      context,
      nextSeen
    );
  }
  if (binding.arrayRestSource) {
    if (!/^(?:0|[1-9]\d*)$/.test(property)) {
      return MISSING_TRANSPORT_BINDING;
    }
    return transportPropertyBindingFromBinding(
      binding.arrayRestSource,
      String(Number(property) + binding.arrayRestStart),
      context,
      nextSeen
    );
  }
  if (binding.propertyBindings) {
    if (binding.propertyBindings.has(property)) {
      return binding.propertyBindings.get(property);
    }
    if (binding.dynamicPropertyUnknown) {
      return UNKNOWN_TRANSPORT_BINDING;
    }
    if (binding.baseBinding) {
      return transportPropertyBindingFromBinding(
        binding.baseBinding,
        property,
        context,
        nextSeen
      );
    }
    return MISSING_TRANSPORT_BINDING;
  }
  if (binding.dynamicPropertyUnknown) {
    return UNKNOWN_TRANSPORT_BINDING;
  }
  if (binding.expression) {
    return transportPropertyBindingFromExpression(
      binding.expression,
      property,
      binding.environment,
      context,
      nextSeen
    );
  }
  if (
    binding.transportKind &&
    binding.transportKind !== "none"
  ) {
    return binding;
  }
  return MISSING_TRANSPORT_BINDING;
}

function transportPropertyKindFromBinding(
  binding,
  property,
  context,
  seen
) {
  return bindingTransportKind(
    transportPropertyBindingFromBinding(
      binding,
      property,
      context,
      seen
    ),
    context,
    seen
  );
}

function isUnboundGlobalReceiver(
  expression,
  environment,
  context
) {
  const node = unwrapExpression(expression);
  return (
    ts.isIdentifier(node) &&
    GLOBAL_FETCH_RECEIVERS.has(node.text) &&
    !identifierBinding(node.text, environment, context)
  );
}

function isGlobalNavigatorExpression(
  expression,
  environment,
  context
) {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) {
    return (
      node.text === "navigator" &&
      !identifierBinding(node.text, environment, context)
    );
  }
  if (
    !(
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) ||
    !isUnboundGlobalReceiver(
      node.expression,
      environment,
      context
    )
  ) {
    return false;
  }
  const properties = staticAccessProperties(
    node,
    environment,
    context
  );
  return (
    properties !== null &&
    properties.length > 0 &&
    properties.every((property) => property === "navigator")
  );
}

function transportPropertyKind(
  expression,
  property,
  environment,
  context,
  seen
) {
  const node = unwrapExpression(expression);
  if (!node || property === null) return null;
  if (
    property === "sendBeacon" &&
    isGlobalNavigatorExpression(node, environment, context)
  ) {
    return "unknown_network";
  }
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    if (binding) {
      return transportPropertyKindFromBinding(
        binding,
        property,
        context,
        seen
      );
    }
    if (GLOBAL_FETCH_RECEIVERS.has(node.text)) {
      if (property === "fetch") return "known";
      if (NETWORK_PRIMITIVE_CONSTRUCTORS.has(property)) {
        return "unknown_network";
      }
      return null;
    }
    return null;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (let index = node.properties.length - 1; index >= 0; index -= 1) {
      const candidate = node.properties[index];
      if (ts.isSpreadAssignment(candidate)) {
        const kind = transportPropertyKind(
          candidate.expression,
          property,
          environment,
          context,
          seen
        );
        if (kind) return kind;
        continue;
      }
      const key =
        ts.isComputedPropertyName(candidate.name) &&
        (ts.isStringLiteral(candidate.name.expression) ||
          ts.isNumericLiteral(candidate.name.expression))
          ? candidate.name.expression.text
          : propertyName(candidate);
      if (key !== property) continue;
      if (ts.isPropertyAssignment(candidate)) {
        return transportKindFromExpression(
          candidate.initializer,
          environment,
          context,
          seen
        );
      }
      if (ts.isShorthandPropertyAssignment(candidate)) {
        return transportKindFromExpression(
          candidate.name,
          environment,
          context,
          seen
        );
      }
      return null;
    }
    return null;
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (!/^(?:0|[1-9]\d*)$/.test(property)) return null;
    const element = node.elements[Number(property)];
    return element && !ts.isOmittedExpression(element)
      ? transportKindFromExpression(
          element,
          environment,
          context,
          seen
        )
      : null;
  }
  if (ts.isConditionalExpression(node)) {
    return mergeAlternativeTransportKinds([
      transportPropertyKind(
        node.whenTrue,
        property,
        environment,
        context,
        seen
      ),
      transportPropertyKind(
        node.whenFalse,
        property,
        environment,
        context,
        seen
      )
    ]);
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return transportPropertyKindFromBinding(
      transportBindingFromExpression(
        node,
        environment,
        context,
        seen
      ),
      property,
      context,
      seen
    );
  }
  return null;
}

function transportKindFromExpression(
  expression,
  environment,
  context,
  seen = new Set()
) {
  const node = unwrapExpression(expression);
  if (!node) return null;
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    if (binding) {
      return bindingTransportKind(
        binding,
        context,
        seen
      );
    }
    if (context.functions.has(node.text)) return null;
    if (NETWORK_PRIMITIVE_CONSTRUCTORS.has(node.text)) {
      return "unknown_network";
    }
    if (
      context.delegatedTransportNames.has(node.text) ||
      context.unknownTransportNames.has(node.text)
    ) {
      return "unknown";
    }
    if (context.transportNames.has(node.text)) return "known";
    return null;
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const properties = staticAccessProperties(
      node,
      environment,
      context
    );
    const receiver = unwrapExpression(node.expression);
    if (
      receiver &&
      ts.isIdentifier(receiver) &&
      context.unknownTransportNamespaces.has(receiver.text)
    ) {
      return "unknown";
    }
    if (properties === null) {
      return isUnboundGlobalReceiver(
        node.expression,
        environment,
        context
      )
        ? "unknown"
        : null;
    }
    const kinds = properties.map((property) =>
      transportPropertyKind(
        node.expression,
        property,
        environment,
        context,
        seen
      )
    );
    if (
      isUnboundGlobalReceiver(
        node.expression,
        environment,
        context
      ) &&
      kinds.some(Boolean) &&
      kinds.some((kind) => !kind)
    ) {
      return "unknown";
    }
    return mergeTransportKinds(kinds);
  }
  if (ts.isConditionalExpression(node)) {
    return mergeAlternativeTransportKinds([
      transportKindFromExpression(
        node.whenTrue,
        environment,
        context,
        seen
      ),
      transportKindFromExpression(
        node.whenFalse,
        environment,
        context,
        seen
      )
    ]);
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    return node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ? transportKindFromExpression(
          node.right,
          environment,
          context,
          seen
        )
      : "unknown";
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return transportKindFromExpression(
      node.right,
      environment,
      context,
      seen
    );
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "bind"
  ) {
    return transportKindFromExpression(
      node.expression.expression,
      environment,
      context,
      seen
    );
  }
  return null;
}

function staticPatternProperties(node, environment, context) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
    return [node.text];
  }
  if (ts.isComputedPropertyName(node)) {
    return staticAccessProperties(
      ts.factory.createElementAccessExpression(
        ts.factory.createIdentifier("_"),
        node.expression
      ),
      environment,
      context
    );
  }
  return null;
}

function transportBindingWithDefault(
  binding,
  initializer,
  environment,
  context
) {
  if (!initializer) return binding;
  const fallback = transportBindingFromExpression(
    initializer,
    environment,
    context
  );
  if (binding?.missing) return fallback;
  if (binding?.alternatives) {
    return alternativeTransportBinding(
      binding.alternatives.map((candidate) =>
        candidate.missing ? fallback : candidate
      )
    );
  }
  return binding;
}

function bindTransportBindingPattern(
  pattern,
  sourceBinding,
  environment,
  context
) {
  if (ts.isIdentifier(pattern)) {
    environment.set(pattern.text, sourceBinding);
    return;
  }
  if (ts.isObjectBindingPattern(pattern)) {
    const excludedProperties = new Set();
    for (const element of pattern.elements) {
      if (element.dotDotDotToken) {
        bindTransportBindingPattern(
          element.name,
          {
            restSource: sourceBinding,
            excludedProperties: new Set(excludedProperties)
          },
          environment,
          context
        );
        continue;
      }
      const propertyNode =
        element.propertyName ??
        (ts.isIdentifier(element.name)
          ? element.name
          : null);
      const properties = propertyNode
        ? staticPatternProperties(
            propertyNode,
            environment,
            context
          )
        : null;
      let binding;
      if (!properties || properties.length !== 1) {
        binding = UNKNOWN_TRANSPORT_BINDING;
      } else {
        excludedProperties.add(properties[0]);
        binding = transportPropertyBindingFromBinding(
          sourceBinding,
          properties[0],
          context
        );
      }
      bindTransportBindingPattern(
        element.name,
        transportBindingWithDefault(
          binding,
          element.initializer,
          environment,
          context
        ),
        environment,
        context
      );
    }
    return;
  }
  if (ts.isArrayBindingPattern(pattern)) {
    for (let index = 0; index < pattern.elements.length; index += 1) {
      const element = pattern.elements[index];
      if (ts.isOmittedExpression(element)) continue;
      const binding = element.dotDotDotToken
        ? {
            arrayRestSource: sourceBinding,
            arrayRestStart: index
          }
        : transportPropertyBindingFromBinding(
            sourceBinding,
            String(index),
            context
          );
      bindTransportBindingPattern(
        element.name,
        transportBindingWithDefault(
          binding,
          element.initializer,
          environment,
          context
        ),
        environment,
        context
      );
    }
  }
}

function bindTransportPattern(
  pattern,
  source,
  environment,
  context
) {
  bindTransportBindingPattern(
    pattern,
    transportBindingFromExpression(
      source,
      environment,
      context
    ),
    environment,
    context
  );
}

function functionArgumentBindings(definition, call, environment, context) {
  const bindings = new Map();
  for (let index = 0; index < definition.parameters.length; index += 1) {
    const parameter = definition.parameters[index];
    const argument = call?.arguments?.[index];
    const sourceBinding = argument
      ? transportBindingFromExpression(
          argument,
          environment,
          context
        )
      : parameter.initializer
        ? transportBindingFromExpression(
            parameter.initializer,
            bindings,
            context
          )
        : ts.isIdentifier(parameter.name)
          ? defaultParameterBinding(parameter, context)
          : { dynamicPropertyUnknown: true };
    bindTransportBindingPattern(
      parameter.name,
      sourceBinding,
      bindings,
      context
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

const RETURN_PROVENANCE = {
  transparent: "transparent_main_response",
  none: "none",
  unverified: "unverified"
};
const NONE_RETURN_VALUE = Object.freeze({ kind: "none" });
const UNVERIFIED_RETURN_VALUE = Object.freeze({
  kind: "unverified"
});
const TRANSPORT_RETURN_VALUE = Object.freeze({ kind: "transport" });
const CAPTURED_PROVENANCE_BINDINGS = Symbol(
  "capturedProvenanceBindings"
);

function provenanceEnvironment(
  entries = [],
  capturedNames = []
) {
  const environment = new Map(entries);
  environment[CAPTURED_PROVENANCE_BINDINGS] = new Set(
    capturedNames
  );
  return environment;
}

function cloneProvenanceEnvironment(environment) {
  return provenanceEnvironment(
    environment,
    environment[CAPTURED_PROVENANCE_BINDINGS] ?? []
  );
}

function markProvenancePatternLocal(name, environment) {
  const captured =
    environment[CAPTURED_PROVENANCE_BINDINGS];
  if (!captured) return;
  if (ts.isIdentifier(name)) {
    captured.delete(name.text);
    return;
  }
  if (
    ts.isObjectBindingPattern(name) ||
    ts.isArrayBindingPattern(name)
  ) {
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        markProvenancePatternLocal(
          element.name,
          environment
        );
      }
    }
  }
}

function transparentReturnValue(stage = "payload", origin = null) {
  return {
    kind: "transparent",
    invalidated: false,
    origin,
    stage
  };
}

function containerReturnValue(fields = new Map()) {
  return { kind: "container", fields };
}

function localFunctionReturnValue(node, environment) {
  return {
    kind: "function",
    definition: {
      name: "<local>",
      node,
      body: node.body,
      parameters: node.parameters
    },
    closureEnvironment: new Map(environment),
    invalidatesCallerEnvironment: true
  };
}

function returnProvenanceOf(value) {
  if (
    value?.kind === "transparent" &&
    value.invalidated === false
  ) {
    return RETURN_PROVENANCE.transparent;
  }
  if (value?.kind === "none") return RETURN_PROVENANCE.none;
  return RETURN_PROVENANCE.unverified;
}

function mergeReturnValues(values) {
  if (values.length === 0) return NONE_RETURN_VALUE;
  if (values.every((value) => value === values[0])) {
    return values[0];
  }
  if (
    values.every(
      (value) =>
        value?.kind === "function" &&
        value.definition === values[0].definition
    )
  ) {
    return values[0];
  }
  if (values.every((value) => value?.kind === "transport")) {
    return TRANSPORT_RETURN_VALUE;
  }
  if (
    values.every(
      (value) =>
        returnProvenanceOf(value) ===
        RETURN_PROVENANCE.transparent
    ) &&
    values[0].origin !== null &&
    values.every(
      (value) =>
        value.origin === values[0].origin &&
        value.stage === values[0].stage
    )
  ) {
    return values[0];
  }
  const provenances = new Set(values.map(returnProvenanceOf));
  if (
    provenances.size === 1 &&
    provenances.has(RETURN_PROVENANCE.transparent)
  ) {
    for (const value of values) {
      invalidateTransparentValue(value);
    }
    return UNVERIFIED_RETURN_VALUE;
  }
  if (
    provenances.size === 1 &&
    provenances.has(RETURN_PROVENANCE.none)
  ) {
    return NONE_RETURN_VALUE;
  }
  for (const value of values) {
    invalidateTransparentValue(value);
  }
  return UNVERIFIED_RETURN_VALUE;
}

function invalidateTransparentValue(value, seen = new Set()) {
  if (!value || seen.has(value)) return;
  seen.add(value);
  if (value.kind === "transparent") {
    value.invalidated = true;
    return;
  }
  if (value.kind === "container") {
    for (const child of value.fields.values()) {
      invalidateTransparentValue(child, seen);
    }
  }
}

function invalidateTransparentEnvironment(environment) {
  for (const value of environment.values()) {
    invalidateTransparentValue(value);
  }
}

function provenanceIdentifierValue(
  name,
  environment,
  context,
  activeFunctions,
  seenBindings
) {
  if (environment.has(name)) return environment.get(name);
  if (name === "undefined") return NONE_RETURN_VALUE;
  const definition = context.functions.get(name);
  if (definition) {
    return {
      kind: "function",
      definition,
      invalidatesCallerEnvironment: false
    };
  }
  if (
    context.delegatedTransportNames.has(name) ||
    context.unknownTransportNames.has(name)
  ) {
    return UNVERIFIED_RETURN_VALUE;
  }
  if (context.transportNames.has(name)) {
    return TRANSPORT_RETURN_VALUE;
  }
  const binding = context.topBindings.get(name);
  if (!binding || seenBindings.has(binding)) {
    return UNVERIFIED_RETURN_VALUE;
  }
  return provenanceExpressionValue(
    binding.expression,
    new Map(),
    context,
    activeFunctions,
    new Set(seenBindings).add(binding)
  );
}

function provenanceFunctionEnvironment(
  definition,
  argumentValues,
  context,
  activeFunctions,
  seenBindings,
  closureEnvironment = null
) {
  const environment = provenanceEnvironment(
    closureEnvironment ?? [],
    closureEnvironment?.keys() ?? []
  );
  for (let index = 0; index < definition.parameters.length; index += 1) {
    const parameter = definition.parameters[index];
    markProvenancePatternLocal(parameter.name, environment);
    let value = argumentValues[index];
    if (!value && parameter.initializer) {
      value = provenanceExpressionValue(
        parameter.initializer,
        environment,
        context,
        activeFunctions,
        seenBindings
      );
    }
    bindProvenancePattern(
      parameter.name,
      value ?? UNVERIFIED_RETURN_VALUE,
      environment
    );
  }
  return environment;
}

function provenanceFunctionValue(
  definition,
  argumentValues,
  context,
  activeFunctions,
  seenBindings,
  closureEnvironment = null
) {
  if (activeFunctions.has(definition)) {
    return UNVERIFIED_RETURN_VALUE;
  }
  const nextActiveFunctions = new Set(activeFunctions).add(
    definition
  );
  const environment = provenanceFunctionEnvironment(
    definition,
    argumentValues,
    context,
    nextActiveFunctions,
    seenBindings,
    closureEnvironment
  );
  if (!ts.isBlock(definition.body)) {
    return provenanceExpressionValue(
      definition.body,
      environment,
      context,
      nextActiveFunctions,
      seenBindings
    );
  }
  const flow = provenanceStatements(
    definition.body.statements,
    [environment],
    context,
    nextActiveFunctions,
    seenBindings
  );
  const returns = [
    ...flow.returns,
    ...(flow.continuing.length > 0 ? [NONE_RETURN_VALUE] : [])
  ];
  return mergeReturnValues(returns);
}

function invalidateEscapedReturnValue(
  value,
  context,
  activeFunctions,
  seenBindings,
  seenValues = new Set()
) {
  if (!value || seenValues.has(value)) return;
  seenValues.add(value);
  if (
    value.kind === "function" &&
    value.invalidatesCallerEnvironment
  ) {
    invalidateTransparentValue(
      provenanceFunctionValue(
        value.definition,
        [],
        context,
        activeFunctions,
        seenBindings,
        value.closureEnvironment
      )
    );
    return;
  }
  if (value.kind === "container") {
    for (const child of value.fields.values()) {
      invalidateEscapedReturnValue(
        child,
        context,
        activeFunctions,
        seenBindings,
        seenValues
      );
    }
    return;
  }
  invalidateTransparentValue(value);
}

function provenanceCallValue(
  call,
  environment,
  context,
  activeFunctions,
  seenBindings
) {
  const target = unwrapExpression(call.expression);
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "json"
  ) {
    const receiver = provenanceExpressionValue(
      target.expression,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    return returnProvenanceOf(receiver) ===
        RETURN_PROVENANCE.transparent &&
      receiver.stage === "response"
      ? transparentReturnValue("payload", receiver.origin)
      : UNVERIFIED_RETURN_VALUE;
  }
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "clone"
  ) {
    const receiver = provenanceExpressionValue(
      target.expression,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    return returnProvenanceOf(receiver) ===
        RETURN_PROVENANCE.transparent &&
      receiver.stage === "response"
      ? transparentReturnValue("response", receiver.origin)
      : UNVERIFIED_RETURN_VALUE;
  }

  if (
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target)
  ) {
    invalidateTransparentValue(
      provenanceExpressionValue(
        target.expression,
        environment,
        context,
        activeFunctions,
        seenBindings
      )
    );
  }

  const callable = provenanceExpressionValue(
    target,
    environment,
    context,
    activeFunctions,
    seenBindings
  );
  const argumentValues = call.arguments.map((argument) =>
    provenanceExpressionValue(
      argument,
      environment,
      context,
      activeFunctions,
      seenBindings
    )
  );
  if (callable?.kind === "transport") {
    return ticketField(call.arguments[0])
      ? UNVERIFIED_RETURN_VALUE
      : transparentReturnValue("response", call);
  }
  if (callable?.kind === "function") {
    if (
      !callable.invalidatesCallerEnvironment &&
      call.arguments.length === 0
    ) {
      invalidateTransparentEnvironment(environment);
    }
    return provenanceFunctionValue(
      callable.definition,
      argumentValues,
      context,
      activeFunctions,
      seenBindings,
      callable.closureEnvironment
    );
  }
  for (const value of argumentValues) {
    invalidateEscapedReturnValue(
      value,
      context,
      activeFunctions,
      seenBindings
    );
  }
  if (
    call.arguments.length === 0 &&
    target?.kind === ts.SyntaxKind.Identifier
  ) {
    invalidateTransparentEnvironment(environment);
  }
  return UNVERIFIED_RETURN_VALUE;
}

function provenanceExpressionValue(
  expression,
  environment,
  context,
  activeFunctions,
  seenBindings = new Set()
) {
  const node = unwrapExpression(expression);
  if (!node) return NONE_RETURN_VALUE;
  if (ts.isIdentifier(node)) {
    return provenanceIdentifierValue(
      node.text,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
  }
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  ) {
    return localFunctionReturnValue(node, environment);
  }
  if (ts.isNewExpression(node)) {
    const target = unwrapExpression(node.expression);
    if (ts.isClassExpression(target)) {
      const constructor = target.members.find(
        (member) =>
          ts.isConstructorDeclaration(member) &&
          member.body
      );
      if (constructor) {
        provenanceFunctionValue(
          {
            name: "<constructor>",
            node: constructor,
            body: constructor.body,
            parameters: constructor.parameters
          },
          (node.arguments ?? []).map((argument) =>
            provenanceExpressionValue(
              argument,
              environment,
              context,
              activeFunctions,
              seenBindings
            )
          ),
          context,
          activeFunctions,
          seenBindings,
          new Map(environment)
        );
      }
    } else {
      for (const argument of node.arguments ?? []) {
        invalidateTransparentValue(
          provenanceExpressionValue(
            argument,
            environment,
            context,
            activeFunctions,
            seenBindings
          )
        );
      }
    }
    return UNVERIFIED_RETURN_VALUE;
  }
  if (ts.isCallExpression(node)) {
    return provenanceCallValue(
      node,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const receiver = provenanceExpressionValue(
      node.expression,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    if (
      returnProvenanceOf(receiver) ===
      RETURN_PROVENANCE.transparent
    ) {
      return receiver.stage === "response"
        ? UNVERIFIED_RETURN_VALUE
        : receiver;
    }
    if (receiver?.kind === "container") {
      const property = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression &&
            (ts.isStringLiteral(node.argumentExpression) ||
              ts.isNumericLiteral(node.argumentExpression))
          ? node.argumentExpression.text
          : null;
      if (property === null) {
        invalidateTransparentValue(receiver);
        if (
          ts.isElementAccessExpression(node) &&
          node.argumentExpression
        ) {
          invalidateTransparentValue(
            provenanceExpressionValue(
              node.argumentExpression,
              environment,
              context,
              activeFunctions,
              seenBindings
            )
          );
        }
        return UNVERIFIED_RETURN_VALUE;
      }
      return (
        receiver.fields.get(property) ??
        UNVERIFIED_RETURN_VALUE
      );
    }
    return UNVERIFIED_RETURN_VALUE;
  }
  if (ts.isDeleteExpression(node)) {
    const operand = unwrapExpression(node.expression);
    if (
      ts.isPropertyAccessExpression(operand) ||
      ts.isElementAccessExpression(operand)
    ) {
      invalidateTransparentValue(
        provenanceExpressionValue(
          operand.expression,
          environment,
          context,
          activeFunctions,
          seenBindings
        )
      );
    } else {
      invalidateTransparentValue(
        provenanceExpressionValue(
          operand,
          environment,
          context,
          activeFunctions,
          seenBindings
        )
      );
    }
    return UNVERIFIED_RETURN_VALUE;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    const assignedValue = provenanceExpressionValue(
      node.right,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    const value =
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? assignedValue
        : UNVERIFIED_RETURN_VALUE;
    if (
      ts.isPropertyAccessExpression(node.left) ||
      ts.isElementAccessExpression(node.left)
    ) {
      invalidateTransparentValue(
        provenanceExpressionValue(
          node.left.expression,
          environment,
          context,
          activeFunctions,
          seenBindings
        )
      );
    } else {
      bindProvenanceAssignmentTarget(
        node.left,
        value,
        environment
      );
    }
    return value;
  }
  if (ts.isConditionalExpression(node)) {
    return mergeReturnValues([
      provenanceExpressionValue(
        node.whenTrue,
        cloneProvenanceEnvironment(environment),
        context,
        activeFunctions,
        seenBindings
      ),
      provenanceExpressionValue(
        node.whenFalse,
        cloneProvenanceEnvironment(environment),
        context,
        activeFunctions,
        seenBindings
      )
    ]);
  }
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken
    ].includes(node.operatorToken.kind)
  ) {
    return mergeReturnValues([
      provenanceExpressionValue(
        node.left,
        cloneProvenanceEnvironment(environment),
        context,
        activeFunctions,
        seenBindings
      ),
      provenanceExpressionValue(
        node.right,
        cloneProvenanceEnvironment(environment),
        context,
        activeFunctions,
        seenBindings
      )
    ]);
  }
  if (ts.isVoidExpression(node)) {
    provenanceExpressionValue(
      node.expression,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    return NONE_RETURN_VALUE;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const fields = new Map();
    let unsupportedShape = false;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        invalidateTransparentValue(
          provenanceExpressionValue(
            property.expression,
            environment,
            context,
            activeFunctions,
            seenBindings
          )
        );
        unsupportedShape = true;
        continue;
      }
      let key = null;
      let expression = null;
      if (ts.isPropertyAssignment(property)) {
        key = ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
          ? property.name.text
          : null;
        expression = property.initializer;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        key = property.name.text;
        expression = property.name;
      } else if (
        ts.isMethodDeclaration(property) &&
        property.body
      ) {
        key = ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
          ? property.name.text
          : null;
        if (key !== null) {
          fields.set(
            key,
            localFunctionReturnValue(property, environment)
          );
          continue;
        }
      }
      if (!expression) {
        unsupportedShape = true;
        invalidateTransparentEnvironment(environment);
        continue;
      }
      const value = provenanceExpressionValue(
        expression,
        environment,
        context,
        activeFunctions,
        seenBindings
      );
      if (key === null) {
        invalidateTransparentValue(value);
        if (
          ts.isPropertyAssignment(property) &&
          ts.isComputedPropertyName(property.name)
        ) {
          invalidateTransparentValue(
            provenanceExpressionValue(
              property.name.expression,
              environment,
              context,
              activeFunctions,
              seenBindings
            )
          );
        }
        unsupportedShape = true;
        continue;
      }
      fields.set(
        key,
        value
      );
    }
    if (unsupportedShape) {
      invalidateTransparentValue(containerReturnValue(fields));
      return UNVERIFIED_RETURN_VALUE;
    }
    return containerReturnValue(fields);
  }
  if (ts.isArrayLiteralExpression(node)) {
    const fields = new Map();
    for (let index = 0; index < node.elements.length; index += 1) {
      const element = node.elements[index];
      if (ts.isSpreadElement(element)) {
        invalidateTransparentValue(
          provenanceExpressionValue(
            element.expression,
            environment,
            context,
            activeFunctions,
            seenBindings
          )
        );
        return UNVERIFIED_RETURN_VALUE;
      }
      fields.set(
        String(index),
        provenanceExpressionValue(
          element,
          environment,
          context,
          activeFunctions,
          seenBindings
        )
      );
    }
    return containerReturnValue(fields);
  }
  return UNVERIFIED_RETURN_VALUE;
}

function provenancePatternValue(value, property) {
  if (
    returnProvenanceOf(value) ===
    RETURN_PROVENANCE.transparent
  ) {
    return value.stage === "response"
      ? UNVERIFIED_RETURN_VALUE
      : value;
  }
  return value?.kind === "container"
    ? value.fields.get(property) ?? UNVERIFIED_RETURN_VALUE
    : UNVERIFIED_RETURN_VALUE;
}

function bindProvenancePattern(name, value, environment) {
  if (ts.isIdentifier(name)) {
    environment.set(name.text, value);
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (element.dotDotDotToken) {
        invalidateTransparentValue(value);
        bindProvenancePattern(
          element.name,
          UNVERIFIED_RETURN_VALUE,
          environment
        );
        continue;
      }
      const propertyNode = element.propertyName ??
        (ts.isIdentifier(element.name) ? element.name : null);
      const property =
        propertyNode &&
        (ts.isIdentifier(propertyNode) ||
          ts.isStringLiteral(propertyNode) ||
          ts.isNumericLiteral(propertyNode))
          ? propertyNode.text
          : null;
      if (property === null) {
        invalidateTransparentValue(value);
      }
      bindProvenancePattern(
        element.name,
        property === null
          ? UNVERIFIED_RETURN_VALUE
          : provenancePatternValue(value, property),
        environment
      );
    }
    return;
  }
  if (ts.isArrayBindingPattern(name)) {
    for (let index = 0; index < name.elements.length; index += 1) {
      const element = name.elements[index];
      if (ts.isOmittedExpression(element)) continue;
      if (element.dotDotDotToken) {
        invalidateTransparentValue(value);
        bindProvenancePattern(
          element.name,
          UNVERIFIED_RETURN_VALUE,
          environment
        );
        continue;
      }
      bindProvenancePattern(
        element.name,
        provenancePatternValue(value, String(index)),
        environment
      );
    }
  }
}

function bindProvenanceAssignmentTarget(
  target,
  value,
  environment
) {
  const node = unwrapExpression(target);
  if (ts.isIdentifier(node)) {
    if (
      environment[CAPTURED_PROVENANCE_BINDINGS]?.has(
        node.text
      )
    ) {
      invalidateTransparentValue(environment.get(node.text));
    }
    environment.set(node.text, value);
    return true;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        invalidateTransparentValue(value);
        bindProvenanceAssignmentTarget(
          property.expression,
          UNVERIFIED_RETURN_VALUE,
          environment
        );
        continue;
      }
      let propertyName = null;
      let assignmentTarget = null;
      if (ts.isPropertyAssignment(property)) {
        propertyName =
          ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
            ? property.name.text
            : null;
        assignmentTarget = property.initializer;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        propertyName = property.name.text;
        assignmentTarget = property.name;
      }
      if (!assignmentTarget) {
        invalidateTransparentValue(value);
        continue;
      }
      if (propertyName === null) {
        invalidateTransparentValue(value);
      }
      bindProvenanceAssignmentTarget(
        assignmentTarget,
        propertyName === null
          ? UNVERIFIED_RETURN_VALUE
          : provenancePatternValue(value, propertyName),
        environment
      );
    }
    return true;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (let index = 0; index < node.elements.length; index += 1) {
      const element = node.elements[index];
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isSpreadElement(element)) {
        invalidateTransparentValue(value);
        bindProvenanceAssignmentTarget(
          element.expression,
          UNVERIFIED_RETURN_VALUE,
          environment
        );
        continue;
      }
      bindProvenanceAssignmentTarget(
        element,
        provenancePatternValue(value, String(index)),
        environment
      );
    }
    return true;
  }
  invalidateTransparentValue(value);
  return false;
}

function provenanceStatement(
  statement,
  environment,
  context,
  activeFunctions,
  seenBindings
) {
  if (ts.isFunctionDeclaration(statement)) {
    const nextEnvironment =
      cloneProvenanceEnvironment(environment);
    if (statement.name && statement.body) {
      markProvenancePatternLocal(
        statement.name,
        nextEnvironment
      );
      nextEnvironment.set(
        statement.name.text,
        localFunctionReturnValue(statement, environment)
      );
    }
    return { continuing: [nextEnvironment], returns: [] };
  }
  if (ts.isVariableStatement(statement)) {
    const nextEnvironment =
      cloneProvenanceEnvironment(environment);
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer
        ? provenanceExpressionValue(
            declaration.initializer,
            nextEnvironment,
            context,
            activeFunctions,
            seenBindings
          )
        : NONE_RETURN_VALUE;
      markProvenancePatternLocal(
        declaration.name,
        nextEnvironment
      );
      bindProvenancePattern(
        declaration.name,
        value,
        nextEnvironment
      );
    }
    return { continuing: [nextEnvironment], returns: [] };
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = unwrapExpression(statement.expression);
    const nextEnvironment =
      cloneProvenanceEnvironment(environment);
    if (
      ts.isBinaryExpression(expression) &&
      ts.isAssignmentOperator(expression.operatorToken.kind)
    ) {
      const assignedValue = provenanceExpressionValue(
        expression.right,
        nextEnvironment,
        context,
        activeFunctions,
        seenBindings
      );
      const value =
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? assignedValue
          : UNVERIFIED_RETURN_VALUE;
      if (
        ts.isPropertyAccessExpression(expression.left) ||
        ts.isElementAccessExpression(expression.left)
      ) {
        invalidateTransparentValue(
          provenanceExpressionValue(
            expression.left.expression,
            nextEnvironment,
            context,
            activeFunctions,
            seenBindings
          )
        );
      } else {
        bindProvenanceAssignmentTarget(
          expression.left,
          value,
          nextEnvironment
        );
      }
    } else {
      provenanceExpressionValue(
        expression,
        nextEnvironment,
        context,
        activeFunctions,
        seenBindings
      );
    }
    return { continuing: [nextEnvironment], returns: [] };
  }
  if (ts.isReturnStatement(statement)) {
    return {
      continuing: [],
      returns: [
        statement.expression
          ? provenanceExpressionValue(
              statement.expression,
              environment,
              context,
              activeFunctions,
              seenBindings
            )
          : NONE_RETURN_VALUE
      ]
    };
  }
  if (ts.isThrowStatement(statement)) {
    if (statement.expression) {
      provenanceExpressionValue(
        statement.expression,
        environment,
        context,
        activeFunctions,
        seenBindings
      );
    }
    return { continuing: [], returns: [] };
  }
  if (ts.isBlock(statement)) {
    return provenanceStatements(
      statement.statements,
      [cloneProvenanceEnvironment(environment)],
      context,
      activeFunctions,
      seenBindings
    );
  }
  if (ts.isIfStatement(statement)) {
    provenanceExpressionValue(
      statement.expression,
      environment,
      context,
      activeFunctions,
      seenBindings
    );
    const thenFlow = provenanceStatement(
      statement.thenStatement,
      cloneProvenanceEnvironment(environment),
      context,
      activeFunctions,
      seenBindings
    );
    const elseFlow = statement.elseStatement
      ? provenanceStatement(
          statement.elseStatement,
          cloneProvenanceEnvironment(environment),
          context,
          activeFunctions,
          seenBindings
        )
      : {
          continuing: [
            cloneProvenanceEnvironment(environment)
          ],
          returns: []
        };
    return {
      continuing: [
        ...thenFlow.continuing,
        ...elseFlow.continuing
      ],
      returns: [...thenFlow.returns, ...elseFlow.returns]
    };
  }
  if (ts.isTryStatement(statement)) {
    const tryFlow = provenanceStatement(
      statement.tryBlock,
      cloneProvenanceEnvironment(environment),
      context,
      activeFunctions,
      seenBindings
    );
    const catchFlow = statement.catchClause
      ? provenanceStatement(
          statement.catchClause.block,
          cloneProvenanceEnvironment(environment),
          context,
          activeFunctions,
          seenBindings
        )
      : { continuing: [], returns: [] };
    let flow = {
      continuing: [
        ...tryFlow.continuing,
        ...catchFlow.continuing
      ],
      returns: [...tryFlow.returns, ...catchFlow.returns]
    };
    if (statement.finallyBlock) {
      for (const returned of flow.returns) {
        invalidateTransparentValue(returned);
      }
      const returnPathFinalFlow =
        flow.returns.length > 0
          ? provenanceStatements(
              statement.finallyBlock.statements,
              [cloneProvenanceEnvironment(environment)],
              context,
              activeFunctions,
              seenBindings
            )
          : { continuing: [], returns: [] };
      const finalFlow = provenanceStatements(
        statement.finallyBlock.statements,
        flow.continuing,
        context,
        activeFunctions,
        seenBindings
      );
      flow = {
        continuing: finalFlow.continuing,
        returns: [
          ...flow.returns,
          ...returnPathFinalFlow.returns,
          ...finalFlow.returns
        ]
      };
    }
    return flow;
  }
  const nextEnvironment =
    cloneProvenanceEnvironment(environment);
  invalidateTransparentEnvironment(nextEnvironment);
  return { continuing: [nextEnvironment], returns: [] };
}

function provenanceStatements(
  statements,
  environments,
  context,
  activeFunctions,
  seenBindings
) {
  let continuing = environments;
  const returns = [];
  for (const statement of statements) {
    if (continuing.length === 0) break;
    const next = [];
    for (const environment of continuing) {
      const flow = provenanceStatement(
        statement,
        environment,
        context,
        activeFunctions,
        seenBindings
      );
      next.push(...flow.continuing);
      returns.push(...flow.returns);
    }
    continuing = next;
  }
  return { continuing, returns };
}

function inspectReturnProvenance(definition, context) {
  return returnProvenanceOf(
    provenanceFunctionValue(
      definition,
      [],
      context,
      new Set(),
      new Set()
    )
  );
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

function addApiFetchRequest(
  call,
  environment,
  context,
  requests,
  trace,
  requestArguments = call.arguments
) {
  const sourceLine =
    context.ast.getLineAndCharacterOfPosition(call.getStart(context.ast)).line +
    1;
  const localCallChain = trustedRequestLocalCallChain(trace);
  const pathExpression = requestArguments[0];
  if (!pathExpression) {
    requests.push({
      kind: "main",
      sourceLine,
      localCallChain,
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
      localCallChain,
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
    requestArguments[1],
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
        localCallChain,
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

const UNTRUSTED_LOCAL_CALL_EDGE =
  "request:__untrusted_local_call_edge__";

// Duplicate suppression may only use calls proven to resolve to unshadowed
// module-local functions. Unknown/property/shadowed calls still contribute
// requests, but an empty chain keeps duplicate classification fail-closed.
function trustedRequestLocalCallChain(trace) {
  if (
    !(trace instanceof Set) ||
    trace.has(UNTRUSTED_LOCAL_CALL_EDGE)
  ) {
    return null;
  }
  const chain = [...trace]
    .filter(
      (entry) =>
        typeof entry === "string" &&
        entry.startsWith("request:") &&
        entry !== UNTRUSTED_LOCAL_CALL_EDGE
    )
    .map((entry) => entry.slice("request:".length));
  return chain.length > 0 ? chain : null;
}

function addUnknownTransportRequest(
  node,
  context,
  requests,
  reason,
  trace
) {
  const sourceLine =
    context.ast.getLineAndCharacterOfPosition(node.getStart(context.ast)).line +
    1;
  requests.push({
    kind: "main",
    sourceLine,
    localCallChain: trustedRequestLocalCallChain(trace),
    method: "UNKNOWN",
    path: null,
    normalizedPath: null,
    normalizedKey: null,
    bodyKind: "raw",
    unresolvedReason: reason
  });
}

function staticArrayElements(
  expression,
  environment,
  context,
  seen = new Set()
) {
  const node = unwrapExpression(expression);
  if (!node) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(
      (element) =>
        !ts.isOmittedExpression(element) &&
        !ts.isSpreadElement(element)
    )
      ? [...node.elements]
      : null;
  }
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    if (!binding?.expression || seen.has(binding)) return null;
    return staticArrayElements(
      binding.expression,
      binding.environment,
      context,
      new Set(seen).add(binding)
    );
  }
  return null;
}

function transportAdapter(
  call,
  environment,
  context
) {
  const target = unwrapExpression(call.expression);
  if (
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target)
  ) {
    const properties = staticAccessProperties(
      target,
      environment,
      context
    );
    const property =
      properties?.length === 1 ? properties[0] : null;
    if (property === "call" || property === "apply") {
      const transportKind = transportKindFromExpression(
        target.expression,
        environment,
        context
      );
      if (transportKind) {
        return {
          transportKind,
          targetExpression: target.expression,
          requestArguments:
            property === "call"
              ? call.arguments.slice(1)
              : staticArrayElements(
                  call.arguments[1],
                  environment,
                  context
                )
        };
      }
    }
    if (
      property === "apply" &&
      ts.isIdentifier(unwrapExpression(target.expression)) &&
      unwrapExpression(target.expression).text === "Reflect" &&
      !identifierBinding("Reflect", environment, context)
    ) {
      const transportKind = transportKindFromExpression(
        call.arguments[0],
        environment,
        context
      );
      if (transportKind) {
        return {
          transportKind,
          targetExpression: call.arguments[0],
          requestArguments: staticArrayElements(
            call.arguments[2],
            environment,
            context
          )
        };
      }
    }
  }
  return null;
}

function containerTransportBindingWithProperty(
  binding,
  properties,
  value
) {
  const reusable =
    binding?.propertyBindings && binding.mutableContainerState;
  const next = reusable
    ? {
        ...binding,
        propertyBindings: new Map(binding.propertyBindings)
      }
    : {
        mutableContainerState: true,
        propertyBindings: new Map(),
        baseBinding: binding
      };
  if (!properties || properties.length !== 1) {
    next.dynamicPropertyUnknown = true;
    return next;
  }
  next.propertyBindings.set(properties[0], value);
  return next;
}

function markDynamicTransportContainer(
  expression,
  environment,
  context
) {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) {
    const binding = identifierBinding(
      node.text,
      environment,
      context
    );
    environment.set(
      node.text,
      containerTransportBindingWithProperty(
        binding,
        null,
        UNKNOWN_TRANSPORT_BINDING
      )
    );
    return;
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    markDynamicTransportContainer(
      node.expression,
      environment,
      context
    );
  }
}

function assignTransportProperty(
  receiverExpression,
  properties,
  value,
  environment,
  context
) {
  const receiver = unwrapExpression(receiverExpression);
  if (ts.isIdentifier(receiver)) {
    const binding = identifierBinding(
      receiver.text,
      environment,
      context
    );
    environment.set(
      receiver.text,
      containerTransportBindingWithProperty(
        binding,
        properties,
        value
      )
    );
    return;
  }
  if (
    ts.isPropertyAccessExpression(receiver) ||
    ts.isElementAccessExpression(receiver)
  ) {
    const parentProperties = staticAccessProperties(
      receiver,
      environment,
      context
    );
    if (!parentProperties || parentProperties.length !== 1) {
      markDynamicTransportContainer(
        receiver.expression,
        environment,
        context
      );
      return;
    }
    const parentBinding = transportBindingFromExpression(
      receiver.expression,
      environment,
      context
    );
    const childBinding =
      transportPropertyBindingFromBinding(
        parentBinding,
        parentProperties[0],
        context
      );
    assignTransportProperty(
      receiver.expression,
      parentProperties,
      containerTransportBindingWithProperty(
        childBinding,
        properties,
        value
      ),
      environment,
      context
    );
    return;
  }
  markDynamicTransportContainer(
    receiverExpression,
    environment,
    context
  );
}

function bindTransportAssignmentTarget(
  target,
  sourceBinding,
  environment,
  context
) {
  const node = unwrapExpression(target);
  if (ts.isIdentifier(node)) {
    environment.set(node.text, sourceBinding);
    return;
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const properties = staticAccessProperties(
      node,
      environment,
      context
    );
    assignTransportProperty(
      node.expression,
      properties,
      sourceBinding,
      environment,
      context
    );
    return;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    bindTransportAssignmentTarget(
      node.left,
      transportBindingWithDefault(
        sourceBinding,
        node.right,
        environment,
        context
      ),
      environment,
      context
    );
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const excludedProperties = new Set();
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        bindTransportAssignmentTarget(
          property.expression,
          {
            restSource: sourceBinding,
            excludedProperties: new Set(excludedProperties)
          },
          environment,
          context
        );
        continue;
      }
      const properties = staticPatternProperties(
        property.name,
        environment,
        context
      );
      let binding;
      if (!properties || properties.length !== 1) {
        binding = UNKNOWN_TRANSPORT_BINDING;
      } else {
        excludedProperties.add(properties[0]);
        binding = transportPropertyBindingFromBinding(
          sourceBinding,
          properties[0],
          context
        );
      }
      if (ts.isPropertyAssignment(property)) {
        bindTransportAssignmentTarget(
          property.initializer,
          binding,
          environment,
          context
        );
      } else if (ts.isShorthandPropertyAssignment(property)) {
        bindTransportAssignmentTarget(
          property.name,
          transportBindingWithDefault(
            binding,
            property.objectAssignmentInitializer,
            environment,
            context
          ),
          environment,
          context
        );
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (let index = 0; index < node.elements.length; index += 1) {
      const element = node.elements[index];
      if (ts.isOmittedExpression(element)) continue;
      const binding = ts.isSpreadElement(element)
        ? {
            arrayRestSource: sourceBinding,
            arrayRestStart: index
          }
        : transportPropertyBindingFromBinding(
            sourceBinding,
            String(index),
            context
          );
      bindTransportAssignmentTarget(
        ts.isSpreadElement(element)
          ? element.expression
          : element,
        binding,
        environment,
        context
      );
    }
    return;
  }
  invalidateTransportAssignmentShape(
    node,
    environment
  );
}

function invalidateTransportAssignmentShape(node, environment) {
  function visit(current) {
    if (ts.isIdentifier(current) && environment.has(current.text)) {
      environment.set(
        current.text,
        UNKNOWN_TRANSPORT_BINDING
      );
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
}

function analyzeTransportTargetPrefixes(
  expression,
  environment,
  context,
  requests,
  trace
) {
  const node = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== ts.SyntaxKind.CommaToken
  ) {
    if (
      ts.isConditionalExpression(node) ||
      (ts.isBinaryExpression(node) &&
        ts.isAssignmentOperator(node.operatorToken.kind))
    ) {
      analyzeExpression(
        node,
        environment,
        context,
        requests,
        trace
      );
    }
    return;
  }
  analyzeExpression(
    node.left,
    environment,
    context,
    requests,
    trace
  );
  analyzeTransportTargetPrefixes(
    node.right,
    environment,
    context,
    requests,
    trace
  );
}

function analyzeExpression(expression, environment, context, requests, trace) {
  const node = unwrapExpression(expression);
  if (!node) return;
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    analyzeExpression(
      node.right,
      environment,
      context,
      requests,
      trace
    );
    if (ts.isElementAccessExpression(node.left)) {
      analyzeExpression(
        node.left.argumentExpression,
        environment,
        context,
        requests,
        trace
      );
    }
    bindTransportAssignmentTarget(
      node.left,
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? transportBindingFromExpression(
            node.right,
            environment,
            context
          )
        : UNKNOWN_TRANSPORT_BINDING,
      environment,
      context
    );
    return;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    analyzeExpression(
      node.left,
      environment,
      context,
      requests,
      trace
    );
    analyzeExpression(
      node.right,
      environment,
      context,
      requests,
      trace
    );
    return;
  }
  if (ts.isConditionalExpression(node)) {
    analyzeExpression(
      node.condition,
      environment,
      context,
      requests,
      trace
    );
    const whenTrueEnvironment = new Map(environment);
    analyzeExpression(
      node.whenTrue,
      whenTrueEnvironment,
      context,
      requests,
      trace
    );
    const whenFalseEnvironment = new Map(environment);
    analyzeExpression(
      node.whenFalse,
      whenFalseEnvironment,
      context,
      requests,
      trace
    );
    mergeTransportEnvironments(
      environment,
      [whenTrueEnvironment, whenFalseEnvironment],
      context
    );
    return;
  }
  if (ts.isCallExpression(node)) {
    const adapter = transportAdapter(
      node,
      environment,
      context
    );
    if (adapter) {
      analyzeTransportTargetPrefixes(
        adapter.targetExpression,
        environment,
        context,
        requests,
        trace
      );
      if (
        adapter.transportKind === "known" &&
        adapter.requestArguments
      ) {
        addApiFetchRequest(
          node,
          environment,
          context,
          requests,
          trace,
          adapter.requestArguments
        );
      } else {
        addUnknownTransportRequest(
          node,
          context,
          requests,
          adapter.transportKind === "unknown_network"
            ? "unknown_network_primitive"
            : adapter.transportKind === "known"
              ? "unknown_transport_adapter"
              : "unknown_transport_delegate",
          trace
        );
      }
      return;
    }
    const name = callName(node.expression);
    const transportKind = transportKindFromExpression(
      node.expression,
      environment,
      context
    );
    if (transportKind === "known") {
      analyzeTransportTargetPrefixes(
        node.expression,
        environment,
        context,
        requests,
        trace
      );
      addApiFetchRequest(
        node,
        environment,
        context,
        requests,
        trace
      );
      return;
    }
    if (transportKind === "unknown") {
      analyzeTransportTargetPrefixes(
        node.expression,
        environment,
        context,
        requests,
        trace
      );
      addUnknownTransportRequest(
        node,
        context,
        requests,
        "unknown_transport_delegate",
        trace
      );
      return;
    }
    if (transportKind === "unknown_network") {
      analyzeTransportTargetPrefixes(
        node.expression,
        environment,
        context,
        requests,
        trace
      );
      addUnknownTransportRequest(
        node,
        context,
        requests,
        "unknown_network_primitive",
        trace
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
      const target = unwrapExpression(node.expression);
      const currentFunctionName = [...trace]
        .filter(
          (entry) =>
            typeof entry === "string" &&
            entry.startsWith("request:") &&
            entry !== UNTRUSTED_LOCAL_CALL_EDGE
        )
        .at(-1)
        ?.slice("request:".length);
      const currentDefinition = currentFunctionName
        ? context.functions.get(currentFunctionName)
        : null;
      const provenLocalCall =
        ts.isIdentifier(target) &&
        !identifierBinding(target.text, environment, context) &&
        currentDefinition &&
        !lexicalBindingShadowsIdentifier(
          target,
          currentDefinition
        );
      analyzeFunction(
        definition,
        node,
        environment,
        context,
        requests,
        provenLocalCall
          ? trace
          : new Set(trace).add(UNTRUSTED_LOCAL_CALL_EDGE)
      );
      return;
    }
  }
  if (ts.isNewExpression(node)) {
    const transportKind = transportKindFromExpression(
      node.expression,
      environment,
      context
    );
    if (transportKind === "unknown_network") {
      addUnknownTransportRequest(
        node,
        context,
        requests,
        "unknown_network_primitive",
        trace
      );
      return;
    }
  }
  ts.forEachChild(node, (child) =>
    analyzeExpression(child, environment, context, requests, trace)
  );
}

function bindingTransportKind(
  binding,
  context,
  seen = new Set()
) {
  if (!binding || seen.has(binding)) return null;
  const nextSeen = new Set(seen).add(binding);
  if (binding.alternatives) {
    return mergeAlternativeTransportKinds(
      binding.alternatives.map((candidate) =>
        bindingTransportKind(
          candidate,
          context,
          nextSeen
        )
      )
    );
  }
  if (binding.transportKind) {
    return binding.transportKind === "none"
      ? null
      : binding.transportKind;
  }
  if (!binding.expression) return null;
  return transportKindFromExpression(
    binding.expression,
    binding.environment,
    context,
    nextSeen
  );
}

function bindingMayContainTransportProperties(binding) {
  if (!binding) return false;
  if (
    binding.alternatives ||
    binding.propertyBindings ||
    binding.restSource ||
    binding.arrayRestSource ||
    binding.dynamicPropertyUnknown
  ) {
    return true;
  }
  const node = binding.expression
    ? unwrapExpression(binding.expression)
    : null;
  return (
    !!node &&
    (ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node))
  );
}

function mergeTransportEnvironments(
  environment,
  branchEnvironments,
  context
) {
  if (branchEnvironments.length === 0) return;
  const names = [...environment.keys()];
  if (branchEnvironments.length === 1) {
    const branch = branchEnvironments[0];
    for (const name of names) {
      if (branch.has(name)) {
        environment.set(name, branch.get(name));
      }
    }
    return;
  }
  for (const name of names) {
    const bindings = branchEnvironments.map((branch) =>
      branch.get(name)
    );
    if (
      bindings.every(
        (binding) => binding === bindings[0]
      )
    ) {
      environment.set(name, bindings[0]);
      continue;
    }
    const kinds = bindings.map((binding) =>
      bindingTransportKind(binding, context)
    );
    const transportKinds = kinds.filter(Boolean);
    if (transportKinds.length > 0) {
      const kind =
        kinds.every((candidate) => candidate === "known")
          ? "known"
          : transportKinds.every(
                (candidate) =>
                  candidate === "unknown_network"
              )
            ? "unknown_network"
            : "unknown";
      environment.set(name, { transportKind: kind });
      continue;
    }
    if (bindings.some(bindingMayContainTransportProperties)) {
      environment.set(
        name,
        alternativeTransportBinding(bindings)
      );
      continue;
    }
    environment.set(
      name,
      syntheticBinding(
        bindings.flatMap((binding) =>
          bindingStrings(binding, context, new Set())
        )
      )
    );
  }
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
        environment.set(
          declaration.name.text,
          transportBindingFromExpression(
            declaration.initializer,
            environment,
            context
          )
        );
      } else if (declaration.initializer) {
        bindTransportPattern(
          declaration.name,
          declaration.initializer,
          environment,
          context
        );
      }
    }
    return;
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = unwrapExpression(statement.expression);
    analyzeExpression(expression, environment, context, requests, trace);
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
    const blockEnvironment = new Map(environment);
    for (const child of statement.statements) {
      analyzeStatement(
        child,
        blockEnvironment,
        context,
        requests,
        trace
      );
    }
    mergeTransportEnvironments(
      environment,
      [blockEnvironment],
      context
    );
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
    const thenEnvironment = new Map(environment);
    analyzeStatement(
      statement.thenStatement,
      thenEnvironment,
      context,
      requests,
      trace
    );
    const elseEnvironment = new Map(environment);
    if (statement.elseStatement) {
      analyzeStatement(
        statement.elseStatement,
        elseEnvironment,
        context,
        requests,
        trace
      );
    }
    mergeTransportEnvironments(
      environment,
      [thenEnvironment, elseEnvironment],
      context
    );
    return;
  }
  if (ts.isTryStatement(statement)) {
    const tryEnvironment = new Map(environment);
    analyzeStatement(
      statement.tryBlock,
      tryEnvironment,
      context,
      requests,
      trace
    );
    const branchEnvironments = [tryEnvironment];
    if (statement.catchClause) {
      const catchEnvironment = new Map(environment);
      analyzeStatement(
        statement.catchClause.block,
        catchEnvironment,
        context,
        requests,
        trace
      );
      branchEnvironments.push(catchEnvironment);
    }
    const continuationEnvironment = new Map(environment);
    mergeTransportEnvironments(
      continuationEnvironment,
      branchEnvironments,
      context
    );
    if (statement.finallyBlock) {
      const finalEnvironment = new Map(
        continuationEnvironment
      );
      analyzeStatement(
        statement.finallyBlock,
        finalEnvironment,
        context,
        requests,
        trace
      );
      mergeTransportEnvironments(
        environment,
        [finalEnvironment],
        context
      );
    } else {
      mergeTransportEnvironments(
        environment,
        [continuationEnvironment],
        context
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
    const initialEnvironment = new Map(environment);
    const bodyEnvironment = new Map(environment);
    analyzeStatement(
      statement.statement,
      bodyEnvironment,
      context,
      requests,
      trace
    );
    mergeTransportEnvironments(
      environment,
      [initialEnvironment, bodyEnvironment],
      context
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
    const group = byKey.get(key) ?? {
      request,
      trusted: true,
      localCallChains: new Map()
    };
    if (!Array.isArray(request.localCallChain)) {
      group.trusted = false;
    } else {
      group.localCallChains.set(
        request.localCallChain.join("\0"),
        request.localCallChain
      );
    }
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .map(({ request, trusted, localCallChains }) => {
      const { localCallChain: _localCallChain, ...rest } = request;
      return {
        ...rest,
        localCallChains: trusted
          ? [...localCallChains.values()].sort((left, right) =>
              compareStrings(left.join("\0"), right.join("\0"))
            )
          : []
      };
    })
    .sort((left, right) => {
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
    const dedupedRequests = dedupeRequests(requests);
    const mainRequestSourceLines = new Set(
      dedupedRequests
        .filter((request) => request.kind === "main")
        .map((request) => request.sourceLine)
    );
    const returnProvenance = inspectReturnProvenance(
      definition,
      context
    );
    return {
      name: definition.name,
      apiFile: path,
      kind: requests.length ? "transport" : "pure",
      returnProvenance:
        returnProvenance === RETURN_PROVENANCE.transparent &&
        mainRequestSourceLines.size > 1
          ? RETURN_PROVENANCE.unverified
          : returnProvenance,
      requests: dedupedRequests
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

function requestDelegationIdentity(request) {
  return [
    request.method,
    request.normalizedKey,
    request.bodyKind,
    request.sourceLine
  ].join("\0");
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function canonicalOwnersForRequest(
  wrapper,
  request,
  wrappersByIdentity,
  sharedDelegateIdentities
) {
  const ownIdentity = `${wrapper.apiFile}\0${wrapper.name}`;
  const fallback = new Map([[ownIdentity, wrapper]]);
  if (
    !Array.isArray(request.localCallChains) ||
    request.localCallChains.length === 0
  ) {
    return fallback;
  }
  const owners = new Map();
  for (const chain of request.localCallChains) {
    if (
      !Array.isArray(chain) ||
      chain.length === 0 ||
      chain[0] !== wrapper.name
    ) {
      return fallback;
    }
    let owner = wrapper;
    const sharedBoundaryIndex = chain.findIndex(
      (name, index) =>
        index > 0 &&
        sharedDelegateIdentities.has(
          `${wrapper.apiFile}\0${name}`
        )
    );
    // Once independent callers converge at a shared delegate, neither that
    // node nor any deeper descendant can prove the callers are aliases.
    const deepestCandidateIndex =
      sharedBoundaryIndex === -1
        ? chain.length - 1
        : sharedBoundaryIndex - 1;
    for (
      let index = deepestCandidateIndex;
      index > 0;
      index -= 1
    ) {
      const candidate = wrappersByIdentity.get(
        `${wrapper.apiFile}\0${chain[index]}`
      );
      if (!candidate || candidate.kind !== "transport") continue;
      const suffix = chain.slice(index);
      // A delegated wrapper owns this request only when its independently
      // analyzed chain is the exact suffix and reaches the same transport site.
      const delegatedRequest = candidate.requests.some(
        (candidateRequest) =>
          candidateRequest.kind === "main" &&
          requestDelegationIdentity(candidateRequest) ===
            requestDelegationIdentity(request) &&
          Array.isArray(candidateRequest.localCallChains) &&
          candidateRequest.localCallChains.some(
            (candidateChain) =>
              Array.isArray(candidateChain) &&
              arraysEqual(candidateChain, suffix)
          )
      );
      if (delegatedRequest) {
        owner = candidate;
        break;
      }
    }
    owners.set(`${owner.apiFile}\0${owner.name}`, owner);
  }
  return owners.size > 0 ? owners : fallback;
}

export function deriveDuplicateWebApiRoutes(wrappers) {
  const wrappersByIdentity = new Map(
    wrappers.map((wrapper) => [
      `${wrapper.apiFile}\0${wrapper.name}`,
      wrapper
    ])
  );
  const delegateParents = new Map();
  for (const wrapper of wrappers) {
    const parentIdentity = `${wrapper.apiFile}\0${wrapper.name}`;
    for (const request of wrapper.requests) {
      if (
        request.kind !== "main" ||
        !request.normalizedKey ||
        !Array.isArray(request.localCallChains)
      ) {
        continue;
      }
      for (const chain of request.localCallChains) {
        if (
          !Array.isArray(chain) ||
          chain.length === 0 ||
          chain[0] !== wrapper.name
        ) {
          continue;
        }
        for (let index = 1; index < chain.length; index += 1) {
          const candidateIdentity =
            `${wrapper.apiFile}\0${chain[index]}`;
          if (candidateIdentity === parentIdentity) continue;
          const candidate = wrappersByIdentity.get(candidateIdentity);
          if (!candidate || candidate.kind !== "transport") continue;
          const suffix = chain.slice(index);
          const delegatedRequest = candidate.requests.some(
            (candidateRequest) =>
              candidateRequest.kind === "main" &&
              requestDelegationIdentity(candidateRequest) ===
                requestDelegationIdentity(request) &&
              Array.isArray(candidateRequest.localCallChains) &&
              candidateRequest.localCallChains.some(
                (candidateChain) =>
                  Array.isArray(candidateChain) &&
                  arraysEqual(candidateChain, suffix)
              )
          );
          if (!delegatedRequest) continue;
          const routeDelegateIdentity =
            `${request.normalizedKey}\0${candidateIdentity}`;
          const parents =
            delegateParents.get(routeDelegateIdentity) ?? new Set();
          let exportedParentIdentity = parentIdentity;
          for (
            let parentIndex = index - 1;
            parentIndex >= 0;
            parentIndex -= 1
          ) {
            const candidateParentIdentity =
              `${wrapper.apiFile}\0${chain[parentIndex]}`;
            if (
              wrappersByIdentity.get(candidateParentIdentity)
                ?.kind === "transport"
            ) {
              exportedParentIdentity =
                candidateParentIdentity;
              break;
            }
          }
          parents.add(exportedParentIdentity);
          delegateParents.set(routeDelegateIdentity, parents);
        }
      }
    }
  }
  const sharedDelegatesByRoute = new Map();
  for (const [identity, parents] of delegateParents) {
    if (parents.size < 2) continue;
    const separator = identity.indexOf("\0");
    const normalizedKey = identity.slice(0, separator);
    const candidateIdentity = identity.slice(separator + 1);
    const values =
      sharedDelegatesByRoute.get(normalizedKey) ?? new Set();
    values.add(candidateIdentity);
    sharedDelegatesByRoute.set(normalizedKey, values);
  }
  const groups = new Map();
  for (const wrapper of wrappers) {
    for (const request of wrapper.requests) {
      if (request.kind !== "main" || !request.normalizedKey) continue;
      const group = groups.get(request.normalizedKey) ?? new Map();
      for (const [identity, owner] of canonicalOwnersForRequest(
        wrapper,
        request,
        wrappersByIdentity,
        sharedDelegatesByRoute.get(request.normalizedKey) ??
          new Set()
      )) {
        group.set(identity, {
          apiFile: owner.apiFile,
          wrapper: owner.name
        });
      }
      groups.set(request.normalizedKey, group);
    }
  }
  return [...groups.entries()]
    .filter(([, group]) => group.size > 1)
    .map(([normalizedKey, group]) => ({
      normalizedKey,
      wrappers: [...group.values()].sort(
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

function wrapperIdentity(wrapper) {
  return `${wrapper.apiFile}\0${wrapper.wrapper}`;
}

async function readRetiredWrapperRegistry(root) {
  let parsed;
  try {
    parsed = JSON.parse(
      await readFile(join(root, RETIRED_WRAPPER_REGISTRY_PATH), "utf8")
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { entries: [], invalid: [] };
    }
    return {
      entries: [],
      invalid: [
        {
          apiFile: RETIRED_WRAPPER_REGISTRY_PATH,
          wrapper: "<registry>",
          reason: "Registry could not be read or parsed."
        }
      ]
    };
  }

  const invalid = [];
  const entries = [];
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    invalid.push({
      apiFile: RETIRED_WRAPPER_REGISTRY_PATH,
      wrapper: "<registry>",
      reason: "Registry schemaVersion or entries is invalid."
    });
    return { entries, invalid };
  }

  const seen = new Set();
  for (const group of parsed.entries) {
    const validGroup =
      typeof group?.apiFile === "string" &&
      typeof group?.classification === "string" &&
      typeof group?.reason === "string" &&
      group.reason.trim().length > 0 &&
      Array.isArray(group.wrappers) &&
      group.wrappers.length > 0;
    if (!validGroup) {
      invalid.push({
        apiFile: group?.apiFile ?? RETIRED_WRAPPER_REGISTRY_PATH,
        wrapper: "<entry>",
        reason: "Registry entry must declare apiFile, classification, reason, and wrappers."
      });
      continue;
    }
    for (const wrapper of group.wrappers) {
      const entry = {
        apiFile: group.apiFile,
        wrapper,
        classification: group.classification,
        reason: group.reason
      };
      const identity = wrapperIdentity(entry);
      if (typeof wrapper !== "string" || wrapper.length === 0 || seen.has(identity)) {
        invalid.push({
          apiFile: group.apiFile,
          wrapper: typeof wrapper === "string" ? wrapper : "<wrapper>",
          reason: seen.has(identity)
            ? "Registry contains a duplicate wrapper identity."
            : "Registry wrapper name must be a non-empty string."
        });
        continue;
      }
      seen.add(identity);
      entries.push(entry);
    }
  }
  return { entries, invalid };
}

function applyRetiredWrapperRegistry(orphanWrappers, registry) {
  const orphanByIdentity = new Map(
    orphanWrappers.map((wrapper) => [wrapperIdentity(wrapper), wrapper])
  );
  const registered = [];
  const registeredIdentities = new Set();
  const invalid = [...registry.invalid];
  for (const entry of registry.entries) {
    const actual = orphanByIdentity.get(wrapperIdentity(entry));
    if (!actual) {
      invalid.push({
        ...entry,
        reason: "Registry entry does not match a current orphan wrapper."
      });
      continue;
    }
    if (actual.classification !== entry.classification) {
      invalid.push({
        ...entry,
        reason: `Registry classification ${entry.classification} does not match ${actual.classification}.`
      });
      continue;
    }
    registeredIdentities.add(wrapperIdentity(entry));
    registered.push({ ...actual, reason: entry.reason });
  }
  return {
    retiredWrappers: registered,
    orphanWrappers: [
      ...orphanWrappers.filter(
        (wrapper) => !registeredIdentities.has(wrapperIdentity(wrapper))
      ),
      ...invalid.map((item) => ({
        apiFile: item.apiFile ?? RETIRED_WRAPPER_REGISTRY_PATH,
        wrapper: item.wrapper ?? "<registry>",
        classification: "registry_invalid",
        reason: item.reason
      }))
    ]
  };
}

function classifyBlockers({
  wrappers,
  duplicateNormalizedRoutes,
  consumerIssues,
  nestRouteKeys,
  retiredWrapperRegistry
}) {
  const detectedOrphanWrappers = wrappers
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
  const { orphanWrappers, retiredWrappers } = applyRetiredWrapperRegistry(
    detectedOrphanWrappers,
    retiredWrapperRegistry
  );
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
    consumerIssues,
    retiredWrappers
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
  const duplicateNormalizedRoutes =
    deriveDuplicateWebApiRoutes(wrappers);
  const retiredWrapperRegistry = await readRetiredWrapperRegistry(resolvedRoot);
  const blockers = classifyBlockers({
    wrappers,
    duplicateNormalizedRoutes,
    consumerIssues: consumerIssues.sort(
      (left, right) =>
        compareStrings(left.consumer, right.consumer) ||
        compareStrings(left.issue, right.issue)
    ),
    nestRouteKeys,
    retiredWrapperRegistry
  });
  const retiredWrappers = blockers.retiredWrappers;
  delete blockers.retiredWrappers;
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
    retiredWrappers,
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

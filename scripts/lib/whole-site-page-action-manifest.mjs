import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep
} from "node:path";

const webRequire = createRequire(
  new URL("../../apps/web-admin/package.json", import.meta.url)
);
const vueParser = webRequire("vue-eslint-parser");
const typescriptParser = webRequire("@typescript-eslint/parser");

const SCHEMA_VERSION = 1;
const WEB_SOURCE_ROOT = "apps/web-admin/src";
const PRODUCTION_ENTRYPOINT = `${WEB_SOURCE_ROOT}/main.ts`;
const ROUTER_INDEX_PATH = `${WEB_SOURCE_ROOT}/routes/index.ts`;
const ROUTE_RECORDS_PATH = `${WEB_SOURCE_ROOT}/routes/route-records.ts`;
const REGISTRY_PATH =
  "docs/product/manifests/web-page-actions.registry.json";
const WEB_MANIFEST_PATH =
  "docs/product/manifests/web-api-wrappers.json";
const NEST_MANIFEST_PATH =
  "docs/product/manifests/nest-business-routes.json";
const ACTION_USAGES = new Set(["page_action", "background"]);
const CAPABILITY_KINDS = new Set([
  "detail_action",
  "available_action_string",
  "server_boolean",
  "server_lease",
  "authenticated_self_exception",
  "client_role_or_status",
  "none"
]);
const SERVER_CAPABILITY_KINDS = new Set([
  "detail_action",
  "available_action_string",
  "server_boolean",
  "server_lease"
]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ROUTER_ALLOWED_MEMBER_CALLS = new Set([
  "afterEach",
  "beforeEach",
  "push",
  "replace"
]);
const ROUTER_FORBIDDEN_MEMBER_READS = new Set([
  "addRoute",
  "clearRoutes",
  "install",
  "removeRoute"
]);
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue"
];

function manifestError(code) {
  const error = new Error("Page action manifest inspection failed");
  error.code = code;
  return error;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function displayPath(root, value) {
  const path = posixPath(relative(root, value));
  return path.startsWith("../") || path === ".." ? basename(value) : path;
}

function inputPath(root, value, fallback) {
  return resolve(root, value ?? fallback);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(values) {
  return [...new Set(values)].sort(compareStrings);
}

function sortRecords(values, fields) {
  return values.sort((left, right) => {
    for (const field of fields) {
      const comparison = compareStrings(
        String(left?.[field] ?? ""),
        String(right?.[field] ?? "")
      );
      if (comparison) return comparison;
    }
    return 0;
  });
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw manifestError(code);
  }
}

function registryEntryIssue(entry) {
  if (!isRecord(entry)) return "entry_not_object";
  if (!isNonEmptyString(entry.id)) return "id_invalid";
  if (!ACTION_USAGES.has(entry.usage)) return "usage_invalid";
  if (
    !Array.isArray(entry.routePaths) ||
    entry.routePaths.some(
      (path) => !isNonEmptyString(path) || !path.startsWith("/")
    ) ||
    (entry.usage === "page_action" && entry.routePaths.length === 0)
  ) {
    return "route_paths_invalid";
  }
  if (!isNonEmptyString(entry.sourceFile)) return "source_file_invalid";
  if (
    !isRecord(entry.trigger) ||
    !isNonEmptyString(entry.trigger.element) ||
    !isNonEmptyString(entry.trigger.event) ||
    !isNonEmptyString(entry.trigger.handler) ||
    (entry.trigger.variant !== undefined &&
      !isNonEmptyString(entry.trigger.variant))
  ) {
    return "trigger_invalid";
  }
  if (!isNonEmptyString(entry.semantic)) return "semantic_invalid";
  if (
    !isRecord(entry.capability) ||
    !CAPABILITY_KINDS.has(entry.capability.kind) ||
    !isNonEmptyString(entry.capability.source) ||
    (entry.capability.key !== undefined &&
      !isNonEmptyString(entry.capability.key))
  ) {
    return "capability_invalid";
  }
  if (
    !Array.isArray(entry.wrappers) ||
    entry.wrappers.length === 0 ||
    entry.wrappers.some(
      (wrapper) =>
        !isRecord(wrapper) ||
        !isNonEmptyString(wrapper.apiFile) ||
        !isNonEmptyString(wrapper.name)
    )
  ) {
    return "wrappers_invalid";
  }
  return null;
}

function normalizeRegistry(registry) {
  if (
    !isRecord(registry) ||
    registry.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(registry.actions)
  ) {
    throw manifestError("PAGE_ACTION_REGISTRY_INVALID");
  }
  const invalidRegistryEntries = [];
  const valid = [];
  registry.actions.forEach((entry, index) => {
    const issue = registryEntryIssue(entry);
    if (issue) {
      invalidRegistryEntries.push({
        index,
        id: isNonEmptyString(entry?.id) ? entry.id : null,
        issue
      });
      return;
    }
    valid.push({
      id: entry.id.trim(),
      usage: entry.usage,
      routePaths: uniqueStrings(entry.routePaths),
      sourceFile: posixPath(entry.sourceFile),
      trigger: {
        element: entry.trigger.element.toLowerCase(),
        event: entry.trigger.event.toLowerCase(),
        handler: entry.trigger.handler,
        ...(entry.trigger.variant
          ? { variant: entry.trigger.variant }
          : {})
      },
      semantic: entry.semantic,
      capability: {
        kind: entry.capability.kind,
        source: entry.capability.source,
        ...(entry.capability.key
          ? { key: entry.capability.key }
          : {})
      },
      wrappers: entry.wrappers
        .map((wrapper) => ({
          apiFile: posixPath(wrapper.apiFile),
          name: wrapper.name
        }))
        .sort(
          (left, right) =>
            compareStrings(left.apiFile, right.apiFile) ||
            compareStrings(left.name, right.name)
        )
    });
  });
  valid.sort((left, right) => compareStrings(left.id, right.id));
  return { actions: valid, invalidRegistryEntries };
}

function duplicateRegistryEntries(actions) {
  const issues = [];
  const ids = new Map();
  const identities = new Map();
  for (const action of actions) {
    const identity = [
      action.sourceFile,
      action.trigger.element,
      action.trigger.event,
      action.trigger.handler,
      action.trigger.variant ?? "",
      action.capability.key ?? ""
    ].join("\u0000");
    for (const [kind, key, index] of [
      ["id", action.id, ids],
      ["trigger", identity, identities]
    ]) {
      const existing = index.get(key);
      if (existing) {
        issues.push({
          id: action.id,
          duplicateOf: existing,
          kind
        });
      } else {
        index.set(key, action.id);
      }
    }
  }
  return sortRecords(issues, ["id", "kind", "duplicateOf"]);
}

function isTestFile(path) {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:spec|test)\.[^.]+$/.test(
    path
  );
}

function isSourceFile(path) {
  return SOURCE_EXTENSIONS.includes(extname(path));
}

async function collectSourceFiles(root) {
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
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const path = posixPath(relative(root, target));
        if (isSourceFile(path) && !isTestFile(path)) files.push(path);
      }
    }
  }
  await visit(join(root, WEB_SOURCE_ROOT));
  return files.sort(compareStrings);
}

function parserOptions(path) {
  return {
    filePath: path,
    sourceType: "module",
    ecmaVersion: 2022,
    loc: true,
    range: true,
    comment: false,
    tokens: false
  };
}

function parseSource(path, source) {
  if (path.endsWith(".vue")) {
    return vueParser.parseForESLint(source, {
      ...parserOptions(path),
      parser: typescriptParser
    }).ast;
  }
  return typescriptParser.parseForESLint(
    source,
    parserOptions(path)
  ).ast;
}

function walkEstree(node, visitor, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "parent" ||
      key === "tokens" ||
      key === "comments" ||
      key === "loc" ||
      key === "range"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") {
          walkEstree(child, visitor, seen);
        }
      }
    } else if (value && typeof value.type === "string") {
      walkEstree(value, visitor, seen);
    }
  }
}

function literalString(node) {
  if (
    node?.type === "Literal" &&
    typeof node.value === "string"
  ) {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions?.length === 0
  ) {
    return node.quasis?.[0]?.value?.cooked ?? null;
  }
  return null;
}

function propertyKey(property) {
  if (!property || property.computed) return null;
  if (property.key?.type === "Identifier") return property.key.name;
  return literalString(property.key);
}

function objectProperty(object, name) {
  return object?.type === "ObjectExpression"
    ? object.properties.find(
        (property) =>
          property.type === "Property" &&
          property.kind === "init" &&
          propertyKey(property) === name
      )?.value ?? null
    : null;
}

function importedSpecifiers(ast) {
  const specifiers = [];
  walkEstree(ast, (node) => {
    if (node.type === "ImportDeclaration" && node.source) {
      const hasRuntimeBinding =
        node.importKind !== "type" &&
        ((node.specifiers ?? []).length === 0 ||
          (node.specifiers ?? []).some(
            (specifier) => specifier.importKind !== "type"
          ));
      if (!hasRuntimeBinding) return;
      const value = literalString(node.source);
      if (value) specifiers.push(value);
      return;
    }
    if (
      (node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      const hasRuntimeBinding =
        node.exportKind !== "type" &&
        (node.type === "ExportAllDeclaration" ||
          (node.specifiers ?? []).some(
            (specifier) => specifier.exportKind !== "type"
          ));
      if (!hasRuntimeBinding) return;
      const value = literalString(node.source);
      if (value) specifiers.push(value);
      return;
    }
    if (node.type === "ImportExpression") {
      const value = literalString(node.source);
      if (value) specifiers.push(value);
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Import" &&
      node.arguments?.length === 1
    ) {
      const value = literalString(node.arguments[0]);
      if (value) specifiers.push(value);
    }
  });
  return uniqueStrings(specifiers);
}

function resolveModuleSpecifier(fromPath, specifier, sourceFiles) {
  if (!isNonEmptyString(specifier)) return null;
  const clean = specifier.replace(/[?#].*$/, "");
  let base;
  if (clean.startsWith("@/")) {
    base = `${WEB_SOURCE_ROOT}/${clean.slice(2)}`;
  } else if (clean.startsWith(".")) {
    base = posixPath(
      join(posixPath(dirname(fromPath)), clean)
    );
  } else {
    return null;
  }
  const normalized = posixPath(base).replace(/^\.\//, "");
  const candidates = [
    normalized,
    ...SOURCE_EXTENSIONS.map((extension) => `${normalized}${extension}`),
    ...SOURCE_EXTENSIONS.map(
      (extension) => `${normalized}/index${extension}`
    )
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function routeImportSpecifier(componentNode) {
  let found = null;
  walkEstree(componentNode, (node) => {
    if (found) return;
    if (node.type === "ImportExpression") {
      found = literalString(node.source);
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Import" &&
      node.arguments?.length === 1
    ) {
      found = literalString(node.arguments[0]);
    }
  });
  return found;
}

function joinRoutePath(parentPath, ownPath) {
  if (ownPath.startsWith("/")) {
    return ownPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }
  const parent =
    parentPath && parentPath !== "/"
      ? parentPath.replace(/\/$/, "")
      : "";
  return `${parent}/${ownPath}`
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
}

function routeRootsFromArray({
  array,
  parentPath,
  sourcePath,
  sourceFiles,
  roots,
  declaredPaths,
  issues
}) {
  if (array?.type !== "ArrayExpression") {
    issues.push({
      code: "PAGE_ROUTE_DYNAMIC_STRUCTURE_UNSUPPORTED",
      sourceFile: sourcePath
    });
    return;
  }
  for (const [index, element] of (array.elements ?? []).entries()) {
    if (element?.type !== "ObjectExpression") {
      issues.push({
        code: "PAGE_ROUTE_DYNAMIC_STRUCTURE_UNSUPPORTED",
        sourceFile: sourcePath,
        routeIndex: index
      });
      continue;
    }
    const path = literalString(objectProperty(element, "path"));
    if (path === null) {
      issues.push({
        code: "PAGE_ROUTE_DYNAMIC_PATH_UNSUPPORTED",
        sourceFile: sourcePath,
        sourceLine: element.loc?.start?.line ?? null
      });
      continue;
    }
    const routePath = joinRoutePath(parentPath, path);
    declaredPaths.push({
      routePath,
      sourceLine: element.loc?.start?.line ?? null
    });
    const component = objectProperty(element, "component");
    const specifier = component
      ? routeImportSpecifier(component)
      : null;
    const sourceFile = specifier
      ? resolveModuleSpecifier(sourcePath, specifier, sourceFiles)
      : null;
    if (component && !sourceFile) {
      issues.push({
        code: "PAGE_ROUTE_COMPONENT_UNRESOLVED",
        sourceFile: sourcePath,
        sourceLine: component.loc?.start?.line ?? null,
        routePath
      });
    }
    if (sourceFile) {
      roots.push({ routePath, sourceFile });
    }
    const children = objectProperty(element, "children");
    if (children) {
      routeRootsFromArray({
        array: children,
        parentPath: routePath,
        sourcePath,
        sourceFiles,
        roots,
        declaredPaths,
        issues
      });
    }
  }
}

function routeRootsFromAst(path, ast, sourceFiles) {
  const roots = [];
  const declaredPaths = [];
  const issues = [];
  let declarations = 0;
  for (const statement of ast.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations ?? []) {
      if (
        item.id?.type !== "Identifier" ||
        item.id.name !== "webAdminRoutes"
      ) {
        continue;
      }
      declarations += 1;
      routeRootsFromArray({
        array: item.init,
        parentPath: null,
        sourcePath: path,
        sourceFiles,
        roots,
        declaredPaths,
        issues
      });
    }
  }
  if (declarations !== 1) {
    issues.push({
      code:
        declarations === 0
          ? "WEB_ADMIN_ROUTES_EXPORT_MISSING"
          : "WEB_ADMIN_ROUTES_EXPORT_DUPLICATE",
      sourceFile: path,
      declarationCount: declarations
    });
  }
  const pathCounts = new Map();
  for (const route of declaredPaths) {
    pathCounts.set(
      route.routePath,
      (pathCounts.get(route.routePath) ?? 0) + 1
    );
  }
  for (const [routePath, count] of pathCounts) {
    if (count > 1) {
      issues.push({
        code: "PAGE_ROUTE_PATH_DUPLICATE",
        sourceFile: path,
        routePath,
        count
      });
    }
  }
  return { roots, declaredPaths, issues };
}

function namedImportLocal({
  ast,
  sourcePath,
  expectedSourceFile,
  expectedExternal,
  importedName,
  sourceFiles
}) {
  const matches = [];
  for (const statement of ast?.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }
    const source = literalString(statement.source);
    const sourceMatches = expectedExternal
      ? source === expectedExternal
      : source &&
        resolveModuleSpecifier(
          sourcePath,
          source,
          sourceFiles
        ) === expectedSourceFile;
    if (!sourceMatches) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type !== "ImportSpecifier" ||
        specifier.importKind === "type"
      ) {
        continue;
      }
      const imported =
        specifier.imported?.type === "Identifier"
          ? specifier.imported.name
          : literalString(specifier.imported);
      if (imported === importedName && specifier.local?.name) {
        matches.push(specifier.local.name);
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function runtimeImportBindings({
  ast,
  sourcePath,
  expectedSourceFile,
  sourceFiles
}) {
  const bindings = [];
  for (const statement of ast?.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }
    const source = literalString(statement.source);
    if (
      !source ||
      resolveModuleSpecifier(
        sourcePath,
        source,
        sourceFiles
      ) !== expectedSourceFile
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.importKind === "type") continue;
      const binding = importedBinding(
        specifier,
        expectedSourceFile
      );
      if (binding) bindings.push(binding);
    }
  }
  return bindings;
}

function hasProtectedModuleEscape({
  ast,
  sourcePath,
  expectedSourceFile,
  exportedName,
  sourceFiles
}) {
  let escaped = false;
  walkEstree(ast, (node) => {
    if (escaped) return;
    if (
      node.type === "ImportExpression" ||
      (node.type === "CallExpression" &&
        node.callee?.type === "Import")
    ) {
      const source = literalString(
        node.type === "ImportExpression"
          ? node.source
          : node.arguments?.[0]
      );
      if (!source) {
        escaped = true;
        return;
      }
      if (
        resolveModuleSpecifier(
          sourcePath,
          source,
          sourceFiles
        ) === expectedSourceFile
      ) {
        escaped = true;
      }
      return;
    }
    if (
      node.type !== "ExportNamedDeclaration" &&
      node.type !== "ExportAllDeclaration"
    ) {
      return;
    }
    if (node.exportKind === "type") return;
    const source = literalString(node.source);
    if (
      !source ||
      resolveModuleSpecifier(
        sourcePath,
        source,
        sourceFiles
      ) !== expectedSourceFile
    ) {
      return;
    }
    if (node.type === "ExportAllDeclaration") {
      escaped = true;
      return;
    }
    escaped = (node.specifiers ?? []).some((specifier) => {
      if (specifier.exportKind === "type") return false;
      if (specifier.type === "ExportNamespaceSpecifier") {
        return true;
      }
      const imported =
        specifier.local?.type === "Identifier"
          ? specifier.local.name
          : literalString(specifier.local);
      return imported === exportedName;
    });
  });
  return escaped;
}

function exportedRouterInitializer(ast) {
  const matches = [];
  for (const statement of ast?.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    ) {
      continue;
    }
    for (const item of declaration.declarations ?? []) {
      if (
        item.id?.type === "Identifier" &&
        item.id.name === "router" &&
        item.init
      ) {
        matches.push(item.init);
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function exportedConstInitializer(ast, name) {
  const matches = [];
  for (const statement of ast?.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    ) {
      continue;
    }
    for (const item of declaration.declarations ?? []) {
      if (
        item.id?.type === "Identifier" &&
        item.id.name === name &&
        item.init
      ) {
        matches.push(item.init);
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function rootBindingName(node) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Identifier") return value.name;
  if (value?.type === "MemberExpression") {
    return rootBindingName(value.object);
  }
  return null;
}

function mutatedBindingRoots(node, aliases) {
  const roots = new Set();
  const visit = (candidate) => {
    const value = unwrapValueExpression(candidate);
    if (!value) return;
    if (
      value.type === "Identifier" ||
      value.type === "MemberExpression"
    ) {
      const name = rootBindingName(value);
      const root = name ? aliases.get(name) : null;
      if (root) roots.add(root);
      return;
    }
    if (value.type === "ObjectPattern") {
      for (const property of value.properties ?? []) {
        if (property.type === "Property") {
          visit(property.value);
        } else if (property.type === "RestElement") {
          visit(property.argument);
        }
      }
      return;
    }
    if (value.type === "ArrayPattern") {
      for (const element of value.elements ?? []) visit(element);
      return;
    }
    if (value.type === "AssignmentPattern") {
      visit(value.left);
      return;
    }
    if (value.type === "RestElement") {
      visit(value.argument);
    }
  };
  visit(node);
  return roots;
}

function referencedBindingRoots(node, aliases) {
  const roots = new Set();
  walkEstree(node, (candidate) => {
    if (candidate.type !== "Identifier") return;
    const root = aliases.get(candidate.name);
    if (root) roots.add(root);
  });
  return roots;
}

function topLevelCreateAppBindings(ast, createAppLocal) {
  const bindings = new Set();
  const aliases = new Map();
  for (const statement of ast?.body ?? []) {
    if (
      statement.type !== "VariableDeclaration" ||
      statement.kind !== "const"
    ) {
      continue;
    }
    for (const declaration of statement.declarations ?? []) {
      const initializer = unwrapValueExpression(declaration.init);
      if (
        declaration.id?.type === "Identifier" &&
        initializer?.type === "CallExpression" &&
        initializer.callee?.type === "Identifier" &&
        initializer.callee.name === createAppLocal
      ) {
        bindings.add(declaration.id.name);
        aliases.set(declaration.id.name, declaration.id.name);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of ast?.body ?? []) {
      if (statement.type !== "VariableDeclaration") continue;
      for (const declaration of statement.declarations ?? []) {
        if (declaration.id?.type !== "Identifier") continue;
        const sourceName = rootBindingName(declaration.init);
        const root = sourceName ? aliases.get(sourceName) : null;
        if (root && !aliases.has(declaration.id.name)) {
          aliases.set(declaration.id.name, root);
          changed = true;
        }
      }
    }
  }
  walkEstree(ast, (node) => {
    const mutated =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : node.type === "UnaryExpression" &&
              node.operator === "delete"
            ? node.argument
          : null;
    for (const root of mutatedBindingRoots(mutated, aliases)) {
      bindings.delete(root);
    }
    if (
      node.type === "VariableDeclarator" &&
      node.init &&
      rootBindingName(node.init) !== node.id?.name
    ) {
      for (const referencedRoot of referencedBindingRoots(
        node.init,
        aliases
      )) {
        bindings.delete(referencedRoot);
      }
    }
    if (node.type === "AssignmentExpression") {
      for (const referencedRoot of referencedBindingRoots(
        node.right,
        aliases
      )) {
        bindings.delete(referencedRoot);
      }
    }
    if (
      node.type === "CallExpression" ||
      node.type === "NewExpression"
    ) {
      for (const argument of node.arguments ?? []) {
        for (const referencedRoot of referencedBindingRoots(
          argument,
          aliases
        )) {
          bindings.delete(referencedRoot);
        }
      }
    }
  });
  const allowedCreateAppCallees = new Set();
  walkEstree(ast, (node) => {
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === createAppLocal
    ) {
      allowedCreateAppCallees.add(node.callee);
    }
  });
  if (
    !bindingUsageIsSafe(ast, createAppLocal, {
      allowedBareNodes: allowedCreateAppCallees
    })
  ) {
    return new Set();
  }
  for (const binding of [...bindings]) {
    if (
      !bindingUsageIsSafe(ast, binding, {
        allowedMemberCalls: new Set([
          "component",
          "directive",
          "mixin",
          "mount",
          "provide",
          "unmount",
          "use"
        ])
      })
    ) {
      bindings.delete(binding);
    }
  }
  return bindings;
}

function hasDirectEval(node) {
  let found = false;
  walkEstree(node, (candidate) => {
    if (
      candidate.type === "CallExpression" &&
      candidate.callee?.type === "Identifier" &&
      candidate.callee.name === "eval"
    ) {
      found = true;
    }
  });
  return found;
}

function bindingUsageIsSafe(
  node,
  bindingName,
  {
    allowedBareNodes = new Set(),
    allowedMemberCalls = new Set(),
    forbiddenMemberReads = new Set()
  } = {}
) {
  if (hasDirectEval(node)) return false;
  const aliases = new Map([[bindingName, bindingName]]);
  let mutationFound = false;
  walkEstree(node, (candidate) => {
    const target =
      candidate.type === "AssignmentExpression"
        ? candidate.left
        : candidate.type === "UpdateExpression"
          ? candidate.argument
          : candidate.type === "UnaryExpression" &&
              candidate.operator === "delete"
            ? candidate.argument
            : null;
    if (mutatedBindingRoots(target, aliases).size > 0) {
      mutationFound = true;
    }
  });
  if (mutationFound) return false;

  const visit = (candidate, allowMemberRoot = false) => {
    if (!candidate || typeof candidate !== "object") return true;
    if (allowedBareNodes.has(candidate)) return true;
    if (candidate.type === "ImportDeclaration") return true;
    if (candidate.type === "Identifier") {
      return candidate.name !== bindingName || allowMemberRoot;
    }
    if (candidate.type === "VariableDeclarator") {
      return visit(candidate.init, false);
    }
    if (candidate.type === "FunctionDeclaration") {
      return visit(candidate.body, false);
    }
    if (
      candidate.type === "FunctionExpression" ||
      candidate.type === "ArrowFunctionExpression"
    ) {
      return visit(candidate.body, false);
    }
    if (candidate.type === "Property") {
      return (
        (!candidate.computed || visit(candidate.key, false)) &&
        visit(candidate.value, false)
      );
    }
    if (
      candidate.type === "MemberExpression" ||
      candidate.type === "OptionalMemberExpression"
    ) {
      const root = rootBindingName(candidate.object);
      const member =
        !candidate.computed &&
        candidate.property?.type === "Identifier"
          ? candidate.property.name
          : literalString(candidate.property);
      if (
        root === bindingName &&
        member &&
        forbiddenMemberReads.has(member)
      ) {
        return false;
      }
      return (
        visit(candidate.object, true) &&
        (!candidate.computed || visit(candidate.property, false))
      );
    }
    if (
      [
        "TSAsExpression",
        "TSTypeAssertion",
        "TSNonNullExpression",
        "TSInstantiationExpression",
        "ChainExpression"
      ].includes(candidate.type)
    ) {
      return visit(candidate.expression, allowMemberRoot);
    }
    if (
      candidate.type === "CallExpression" ||
      candidate.type === "NewExpression"
    ) {
      const callee = unwrapValueExpression(candidate.callee);
      const root =
        callee?.type === "MemberExpression"
          ? rootBindingName(callee.object)
          : null;
      if (root === bindingName) {
        const member =
          !callee.computed &&
          callee.property?.type === "Identifier"
            ? callee.property.name
            : null;
        if (!member || !allowedMemberCalls.has(member)) {
          return false;
        }
      }
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (
        [
          "parent",
          "tokens",
          "comments",
          "loc",
          "range"
        ].includes(key)
      ) {
        continue;
      }
      if (
        ((candidate.type === "Property" && key === "key") ||
          (candidate.type === "MemberExpression" &&
            key === "property") ||
          (candidate.type === "MethodDefinition" && key === "key")) &&
        candidate.computed !== true
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (!visit(child, false)) return false;
        }
      } else if (!visit(value, false)) {
        return false;
      }
    }
    return true;
  };
  return visit(node, false);
}

function indexedCompletionDefinitions(node) {
  const definitions = new Map();
  walkEstree(node, (candidate) => {
    if (
      candidate.type === "FunctionDeclaration" &&
      candidate.id?.name
    ) {
      addIndexedNode(definitions, candidate.id.name, candidate);
      return;
    }
    if (
      candidate.type === "VariableDeclarator" &&
      candidate.id?.type === "Identifier" &&
      candidate.init
    ) {
      addIndexedNode(
        definitions,
        candidate.id.name,
        candidate.init
      );
    }
  });
  return definitions;
}

function completionTarget(
  node,
  definitions,
  seenNames = new Set()
) {
  const value = unwrapValueExpression(node);
  if (
    value?.type === "FunctionDeclaration" ||
    value?.type === "FunctionExpression" ||
    value?.type === "ArrowFunctionExpression"
  ) {
    return { definition: value, ambiguous: false };
  }
  if (value?.type === "Identifier") {
    const candidates = definitions.get(value.name) ?? [];
    if (candidates.length > 1 || seenNames.has(value.name)) {
      return { definition: null, ambiguous: true };
    }
    if (candidates.length === 0) {
      return { definition: null, ambiguous: false };
    }
    const nextSeen = new Set(seenNames);
    nextSeen.add(value.name);
    return completionTarget(
      candidates[0],
      definitions,
      nextSeen
    );
  }
  if (value?.type === "MemberExpression") {
    const memberName =
      !value.computed &&
      value.property?.type === "Identifier"
        ? value.property.name
        : literalString(value.property);
    if (!memberName) {
      return { definition: null, ambiguous: false };
    }
    const object = unwrapValueExpression(value.object);
    if (object?.type !== "Identifier") {
      return { definition: null, ambiguous: false };
    }
    const candidates = definitions.get(object.name) ?? [];
    if (candidates.length > 1) {
      return { definition: null, ambiguous: true };
    }
    const initializer = unwrapValueExpression(candidates[0]);
    if (initializer?.type !== "ObjectExpression") {
      return { definition: null, ambiguous: false };
    }
    const properties = (initializer.properties ?? []).filter(
      (property) =>
        property.type === "Property" &&
        property.kind === "init" &&
        propertyKey(property) === memberName
    );
    if (properties.length !== 1) {
      return {
        definition: null,
        ambiguous: properties.length > 1
      };
    }
    return completionTarget(
      properties[0].value,
      definitions,
      seenNames
    );
  }
  return { definition: null, ambiguous: false };
}

function expressionDefinitelyDoesNotComplete(
  node,
  definitions,
  seen
) {
  const value = unwrapValueExpression(node);
  if (!value) return false;
  if (value.type === "CallExpression") {
    for (const argument of value.arguments ?? []) {
      if (
        expressionDefinitelyDoesNotComplete(
          argument,
          definitions,
          seen
        )
      ) {
        return true;
      }
    }
    const target = completionTarget(
      value.callee,
      definitions
    );
    if (target.ambiguous) return true;
    const definition = target.definition;
    if (!definition || seen.has(definition)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(definition);
    return (
      functionCompletion(definition, definitions, nextSeen) ===
      "abrupt"
    );
  }
  if (value.type === "SequenceExpression") {
    return (value.expressions ?? []).some((expression) =>
      expressionDefinitelyDoesNotComplete(
        expression,
        definitions,
        seen
      )
    );
  }
  if (value.type === "ConditionalExpression") {
    const test = staticTruthiness(value.test);
    if (test.known) {
      return expressionDefinitelyDoesNotComplete(
        test.value ? value.consequent : value.alternate,
        definitions,
        seen
      );
    }
    return (
      expressionDefinitelyDoesNotComplete(
        value.consequent,
        definitions,
        seen
      ) &&
      expressionDefinitelyDoesNotComplete(
        value.alternate,
        definitions,
        seen
      )
    );
  }
  if (value.type === "LogicalExpression") {
    const left = staticTruthiness(value.left);
    if (!left.known) return false;
    const evaluatesRight =
      (value.operator === "&&" && left.value) ||
      (value.operator === "||" && !left.value);
    return (
      expressionDefinitelyDoesNotComplete(
        value.left,
        definitions,
        seen
      ) ||
      (evaluatesRight &&
        expressionDefinitelyDoesNotComplete(
          value.right,
          definitions,
          seen
        ))
    );
  }
  if (value.type === "AssignmentExpression") {
    return expressionDefinitelyDoesNotComplete(
      value.right,
      definitions,
      seen
    );
  }
  return false;
}

function classCompletion(node, definitions, seen) {
  if (
    node.superClass &&
    expressionDefinitelyDoesNotComplete(
      node.superClass,
      definitions,
      seen
    )
  ) {
    return "abrupt";
  }
  for (const element of node.body?.body ?? []) {
    if (
      element.computed &&
      expressionDefinitelyDoesNotComplete(
        element.key,
        definitions,
        seen
      )
    ) {
      return "abrupt";
    }
    if (element.type === "StaticBlock") {
      const completion = statementSequenceCompletion(
        element.body,
        definitions,
        seen
      );
      if (completion !== "normal") return completion;
      continue;
    }
    if (
      element.static === true &&
      expressionDefinitelyDoesNotComplete(
        element.value,
        definitions,
        seen
      )
    ) {
      return "abrupt";
    }
  }
  return "normal";
}

function statementCompletion(node, definitions, seen) {
  if (!node) return "normal";
  if (node.type === "ThrowStatement") return "abrupt";
  if (node.type === "ReturnStatement") {
    return expressionDefinitelyDoesNotComplete(
      node.argument,
      definitions,
      seen
    )
      ? "abrupt"
      : "return";
  }
  if (node.type === "BlockStatement") {
    return statementSequenceCompletion(
      node.body,
      definitions,
      seen
    );
  }
  if (node.type === "ExpressionStatement") {
    return expressionDefinitelyDoesNotComplete(
      node.expression,
      definitions,
      seen
    )
      ? "abrupt"
      : "normal";
  }
  if (node.type === "VariableDeclaration") {
    return (node.declarations ?? []).some((declaration) =>
      expressionDefinitelyDoesNotComplete(
        declaration.init,
        definitions,
        seen
      )
    )
      ? "abrupt"
      : "normal";
  }
  if (node.type === "IfStatement") {
    const test = staticTruthiness(node.test);
    if (test.known) {
      return statementCompletion(
        test.value ? node.consequent : node.alternate,
        definitions,
        seen
      );
    }
    const consequent = statementCompletion(
      node.consequent,
      definitions,
      seen
    );
    const alternate = statementCompletion(
      node.alternate,
      definitions,
      seen
    );
    return consequent === alternate ? consequent : "unknown";
  }
  if (node.type === "WhileStatement") {
    const test = staticTruthiness(node.test);
    if (!test.known) return "unknown";
    if (!test.value) return "normal";
    let exitsLoop = false;
    walkEstree(node.body, (candidate) => {
      if (
        candidate.type === "BreakStatement" ||
        candidate.type === "ReturnStatement"
      ) {
        exitsLoop = true;
      }
    });
    return exitsLoop ? "unknown" : "abrupt";
  }
  if (
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  ) {
    return classCompletion(node, definitions, seen);
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "EmptyStatement" ||
    node.type === "DebuggerStatement"
  ) {
    return "normal";
  }
  return "unknown";
}

function statementSequenceCompletion(
  statements,
  definitions,
  seen
) {
  for (const statement of statements ?? []) {
    const completion = statementCompletion(
      statement,
      definitions,
      seen
    );
    if (completion !== "normal") return completion;
  }
  return "normal";
}

function functionCompletion(node, definitions, seen) {
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    if (node.body?.type === "BlockStatement") {
      const completion = statementSequenceCompletion(
        node.body.body,
        definitions,
        seen
      );
      return completion === "normal" ? "return" : completion;
    }
    return expressionDefinitelyDoesNotComplete(
      node.body,
      definitions,
      seen
    )
      ? "abrupt"
      : "return";
  }
  return "unknown";
}

function topLevelUsesRouter(
  ast,
  routerLocal,
  createAppLocal
) {
  let found = false;
  let terminated = false;
  const appBindings = topLevelCreateAppBindings(
    ast,
    createAppLocal
  );
  const definitions = indexedCompletionDefinitions(ast);
  const isVueAppReceiver = (receiver) => {
    const value = unwrapValueExpression(receiver);
    if (
      value?.type === "Identifier" &&
      appBindings.has(value.name)
    ) {
      return true;
    }
    return (
      value?.type === "CallExpression" &&
      value.callee?.type === "Identifier" &&
      value.callee.name === createAppLocal
    );
  };
  const isRouterUseCall = (value) =>
    value?.type === "CallExpression" &&
    value.callee?.type === "MemberExpression" &&
    !value.callee.computed &&
    value.callee.property?.type === "Identifier" &&
    value.callee.property.name === "use" &&
    isVueAppReceiver(value.callee.object) &&
    value.arguments?.[0]?.type === "Identifier" &&
    value.arguments[0].name === routerLocal;
  const allowedRouterArguments = new Set();
  walkEstree(ast, (node) => {
    const value = unwrapValueExpression(node);
    if (isRouterUseCall(value)) {
      allowedRouterArguments.add(value.arguments[0]);
    }
  });
  if (
    !bindingUsageIsSafe(
      ast,
      routerLocal,
      {
        allowedBareNodes: allowedRouterArguments,
        allowedMemberCalls: ROUTER_ALLOWED_MEMBER_CALLS,
        forbiddenMemberReads: ROUTER_FORBIDDEN_MEMBER_READS
      }
    )
  ) {
    return false;
  }
  const visitExpression = (node) => {
    const value = unwrapValueExpression(node);
    if (!value || found) return;
    if (isRouterUseCall(value)) {
      found = true;
      return;
    }
    if (
      value.type === "CallExpression" &&
      expressionDefinitelyDoesNotComplete(
        value,
        definitions,
        new Set()
      )
    ) {
      terminated = true;
      return;
    }
    if (value.type === "CallExpression") {
      if (value.callee?.type === "MemberExpression") {
        visitExpression(value.callee.object);
      }
      return;
    }
    if (value.type === "SequenceExpression") {
      for (const expression of value.expressions ?? []) {
        visitExpression(expression);
        if (terminated || found) return;
      }
      return;
    }
    if (value.type === "AssignmentExpression") {
      if (value.operator === "=") {
        visitExpression(value.right);
      }
      return;
    }
    if (value.type === "LogicalExpression") {
      visitExpression(value.left);
      const left = staticTruthiness(value.left);
      if (
        left.known &&
        ((value.operator === "&&" && left.value) ||
          (value.operator === "||" && !left.value))
      ) {
        visitExpression(value.right);
      }
      return;
    }
    if (value.type === "ConditionalExpression") {
      const test = staticTruthiness(value.test);
      if (test.known) {
        visitExpression(
          test.value ? value.consequent : value.alternate
        );
      }
    }
  };
  for (const statement of ast?.body ?? []) {
    if (statement.type === "ImportDeclaration") continue;
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations ?? []) {
        visitExpression(declaration.init);
        if (found) return true;
        if (terminated) return false;
      }
      continue;
    }
    if (statement.type === "ExpressionStatement") {
      visitExpression(statement.expression);
      if (found) return true;
      if (terminated) return false;
      continue;
    }
    if (statement.type === "FunctionDeclaration") continue;
    if (
      statement.type === "EmptyStatement" ||
      statement.type === "DebuggerStatement"
    ) {
      continue;
    }
    return false;
  }
  return false;
}

function strictRoutesArgument(object, routesLocal) {
  if (object?.type !== "ObjectExpression") return null;
  let match = null;
  for (const property of object.properties ?? []) {
    if (
      property.type !== "Property" ||
      property.computed === true
    ) {
      return null;
    }
    if (propertyKey(property) !== "routes") continue;
    if (
      match ||
      property.kind !== "init" ||
      property.method === true ||
      property.value?.type !== "Identifier" ||
      property.value.name !== routesLocal
    ) {
      return null;
    }
    match = property.value;
  }
  return match;
}

function webAdminRoutesFeedConsumedRouter({
  asts,
  sourceFiles,
  reachable
}) {
  if (
    !reachable.has(ROUTER_INDEX_PATH) ||
    !reachable.has(ROUTE_RECORDS_PATH)
  ) {
    return false;
  }
  const routerAst = asts.get(ROUTER_INDEX_PATH);
  const routeRecordsAst = asts.get(ROUTE_RECORDS_PATH);
  const mainAst = asts.get(PRODUCTION_ENTRYPOINT);
  if (!routerAst || !routeRecordsAst || !mainAst) return false;
  if (
    !exportedConstInitializer(
      routeRecordsAst,
      "webAdminRoutes"
    ) ||
    !bindingUsageIsSafe(
      routeRecordsAst,
      "webAdminRoutes"
    )
  ) {
    return false;
  }
  const routesLocal = namedImportLocal({
    ast: routerAst,
    sourcePath: ROUTER_INDEX_PATH,
    expectedSourceFile: ROUTE_RECORDS_PATH,
    importedName: "webAdminRoutes",
    sourceFiles
  });
  const createRouterLocal = namedImportLocal({
    ast: routerAst,
    sourcePath: ROUTER_INDEX_PATH,
    expectedExternal: "vue-router",
    importedName: "createRouter",
    sourceFiles
  });
  const initializer = exportedRouterInitializer(routerAst);
  const routesArgument =
    initializer?.type === "CallExpression" &&
    initializer.callee?.type === "Identifier" &&
    initializer.callee.name === createRouterLocal
      ? strictRoutesArgument(
          initializer.arguments?.[0],
          routesLocal
        )
      : null;
  if (
    !routesLocal ||
    !createRouterLocal ||
    !routesArgument ||
    !bindingUsageIsSafe(
      routerAst,
      routesLocal,
      { allowedBareNodes: new Set([routesArgument]) }
    )
  ) {
    return false;
  }
  const allowedCreateRouterCallees = new Set();
  if (initializer?.callee?.type === "Identifier") {
    allowedCreateRouterCallees.add(initializer.callee);
  }
  if (
    !bindingUsageIsSafe(routerAst, createRouterLocal, {
      allowedBareNodes: allowedCreateRouterCallees
    }) ||
    !bindingUsageIsSafe(routerAst, "router", {
      allowedMemberCalls: ROUTER_ALLOWED_MEMBER_CALLS,
      forbiddenMemberReads: ROUTER_FORBIDDEN_MEMBER_READS
    })
  ) {
    return false;
  }
  for (const sourcePath of reachable) {
    const ast = asts.get(sourcePath);
    if (!ast) continue;
    if (
      hasProtectedModuleEscape({
        ast,
        sourcePath,
        expectedSourceFile: ROUTE_RECORDS_PATH,
        exportedName: "webAdminRoutes",
        sourceFiles
      }) ||
      hasProtectedModuleEscape({
        ast,
        sourcePath,
        expectedSourceFile: ROUTER_INDEX_PATH,
        exportedName: "router",
        sourceFiles
      })
    ) {
      return false;
    }
    const routeRecordBindings = runtimeImportBindings({
      ast,
      sourcePath,
      expectedSourceFile: ROUTE_RECORDS_PATH,
      sourceFiles
    });
    if (
      routeRecordBindings.some(
        (binding) =>
          binding.kind === "namespace" ||
          (binding.importedName === "webAdminRoutes" &&
            sourcePath !== ROUTER_INDEX_PATH)
      )
    ) {
      return false;
    }
    if (
      sourcePath === ROUTER_INDEX_PATH ||
      sourcePath === PRODUCTION_ENTRYPOINT
    ) {
      continue;
    }
    const routerBindings = runtimeImportBindings({
      ast,
      sourcePath,
      expectedSourceFile: ROUTER_INDEX_PATH,
      sourceFiles
    });
    if (
      routerBindings.some(
        (binding) => binding.kind === "namespace"
      )
    ) {
      return false;
    }
    for (const binding of routerBindings) {
      if (binding.importedName !== "router") continue;
      if (
        !bindingUsageIsSafe(ast, binding.localName, {
          allowedMemberCalls: ROUTER_ALLOWED_MEMBER_CALLS,
          forbiddenMemberReads: ROUTER_FORBIDDEN_MEMBER_READS
        })
      ) {
        return false;
      }
    }
  }
  const mainRouterLocal = namedImportLocal({
    ast: mainAst,
    sourcePath: PRODUCTION_ENTRYPOINT,
    expectedSourceFile: ROUTER_INDEX_PATH,
    importedName: "router",
    sourceFiles
  });
  const mainCreateAppLocal = namedImportLocal({
    ast: mainAst,
    sourcePath: PRODUCTION_ENTRYPOINT,
    expectedExternal: "vue",
    importedName: "createApp",
    sourceFiles
  });
  return (
    Boolean(mainRouterLocal) &&
    Boolean(mainCreateAppLocal) &&
    topLevelUsesRouter(
      mainAst,
      mainRouterLocal,
      mainCreateAppLocal
    )
  );
}

function reachableFrom(start, graph) {
  const reachable = new Set();
  const pending = start ? [start] : [];
  while (pending.length) {
    const path = pending.pop();
    if (!path || reachable.has(path)) continue;
    reachable.add(path);
    for (const dependency of graph.get(path) ?? []) {
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

function routeOwners(routeRoots, graph) {
  const owners = new Map();
  for (const root of routeRoots) {
    for (const path of reachableFrom(root.sourceFile, graph)) {
      const paths = owners.get(path) ?? new Set();
      paths.add(root.routePath);
      owners.set(path, paths);
    }
  }
  return new Map(
    [...owners].map(([path, paths]) => [
      path,
      [...paths].sort(compareStrings)
    ])
  );
}

function directiveName(attribute) {
  return attribute?.directive &&
    attribute.key?.name?.type === "VIdentifier"
    ? attribute.key.name.name
    : null;
}

function directiveArgument(attribute) {
  const argument = attribute?.key?.argument;
  return argument?.type === "VIdentifier" ? argument.name : null;
}

function directiveExpression(attribute) {
  return attribute?.value?.type === "VExpressionContainer"
    ? attribute.value.expression
    : null;
}

function elementDirective(element, name, argument = undefined) {
  return (element?.startTag?.attributes ?? []).find(
    (attribute) =>
      directiveName(attribute) === name &&
      (argument === undefined ||
        directiveArgument(attribute) === argument)
  ) ?? null;
}

function staticAttributeValue(element, name) {
  const attribute = (element?.startTag?.attributes ?? []).find(
    (candidate) =>
      !candidate.directive &&
      candidate.key?.name === name
  );
  return typeof attribute?.value?.value === "string"
    ? attribute.value.value
    : null;
}

function expressionText(source, node) {
  return node?.range && Number.isInteger(node.range[0])
    ? source.slice(node.range[0], node.range[1])
    : "";
}

function referencedIdentifiers(node) {
  const names = new Set();
  walkEstree(node, (candidate) => {
    if (candidate.type === "Identifier") names.add(candidate.name);
  });
  return [...names].sort(compareStrings);
}

function eventHandlerRoots(node) {
  const expression = unwrapValueExpression(node);
  if (!expression) return [];
  if (expression.type === "Identifier") {
    return [{ handler: expression.name, variants: [] }];
  }
  if (
    expression.type === "CallExpression" &&
    expression.callee?.type === "Identifier"
  ) {
    return [
      {
        handler: expression.callee.name,
        variants: uniqueStrings(
          (expression.arguments ?? [])
            .map(literalString)
            .filter((value) => value !== null)
        )
      }
    ];
  }
  if (
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "FunctionExpression"
  ) {
    if (expression.body?.type !== "BlockStatement") {
      return eventHandlerRoots(expression.body);
    }
    const executable = (expression.body.body ?? []).filter(
      (statement) => statement.type !== "EmptyStatement"
    );
    if (executable.length !== 1) return [];
    const statement = executable[0];
    if (statement.type === "ExpressionStatement") {
      return eventHandlerRoots(statement.expression);
    }
    if (statement.type === "ReturnStatement") {
      return eventHandlerRoots(statement.argument);
    }
  }
  if (expression.type === "VOnExpression") {
    const executable = (expression.body ?? []).filter(
      (statement) => statement.type !== "EmptyStatement"
    );
    if (executable.length !== 1) return [];
    const statement = executable[0];
    if (statement.type === "ExpressionStatement") {
      return eventHandlerRoots(statement.expression);
    }
    if (statement.type === "ReturnStatement") {
      return eventHandlerRoots(statement.argument);
    }
  }
  return [];
}

function addIndexedNode(index, name, node) {
  if (!isNonEmptyString(name) || !node) return;
  const values = index.get(name) ?? [];
  values.push(node);
  index.set(name, values);
}

function importedBinding(specifier, sourceFile) {
  if (
    specifier.type === "ImportSpecifier" &&
    specifier.local?.name
  ) {
    const importedName =
      specifier.imported?.type === "Identifier"
        ? specifier.imported.name
        : literalString(specifier.imported);
    return importedName
      ? {
          localName: specifier.local.name,
          importedName,
          sourceFile,
          kind: "named"
        }
      : null;
  }
  if (
    specifier.type === "ImportDefaultSpecifier" &&
    specifier.local?.name
  ) {
    return {
      localName: specifier.local.name,
      importedName: "default",
      sourceFile,
      kind: "default"
    };
  }
  if (
    specifier.type === "ImportNamespaceSpecifier" &&
    specifier.local?.name
  ) {
    return {
      localName: specifier.local.name,
      importedName: "*",
      sourceFile,
      kind: "namespace"
    };
  }
  return null;
}

function buildSymbolContext(ast, sourcePath, sourceFiles) {
  const definitions = new Map();
  const declarations = new Map();
  const imports = new Map();
  for (const statement of ast?.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }
    const specifierText = literalString(statement.source);
    const resolvedSource = specifierText
      ? resolveModuleSpecifier(
          sourcePath,
          specifierText,
          sourceFiles
        )
      : null;
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.importKind === "type" ||
        !resolvedSource
      ) {
        continue;
      }
      const binding = importedBinding(
        specifier,
        resolvedSource
      );
      if (binding) imports.set(binding.localName, binding);
    }
  }
  walkEstree(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id?.name) {
      addIndexedNode(definitions, node.id.name, node);
      addIndexedNode(declarations, node.id.name, node);
      return;
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.init
    ) {
      addIndexedNode(declarations, node.id.name, node.init);
      if (
        node.init.type === "ArrowFunctionExpression" ||
        node.init.type === "FunctionExpression"
      ) {
        addIndexedNode(definitions, node.id.name, node.init);
      }
    }
  });
  return { definitions, declarations, imports };
}

function uniqueIndexedNode(index, name) {
  const nodes = index.get(name) ?? [];
  return nodes.length === 1 ? nodes[0] : null;
}

function previousElementSibling(element) {
  const siblings = element?.parent?.children;
  if (!Array.isArray(siblings)) return null;
  const index = siblings.indexOf(element);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const sibling = siblings[cursor];
    if (sibling?.type === "VText" && !sibling.value.trim()) continue;
    if (sibling?.type === "VExpressionContainer") continue;
    return sibling?.type === "VElement" ? sibling : null;
  }
  return null;
}

function conditionalEvidence(element) {
  const evidence = [];
  let current = element;
  while (current?.type === "VElement") {
    const ownIf =
      elementDirective(current, "if") ??
      elementDirective(current, "else-if");
    if (ownIf) {
      const expression = directiveExpression(ownIf);
      if (expression) evidence.push({ expression, truthy: true });
    } else if (elementDirective(current, "else")) {
      const previous = previousElementSibling(current);
      const previousIf =
        elementDirective(previous, "if") ??
        elementDirective(previous, "else-if");
      const expression = directiveExpression(previousIf);
      if (expression) evidence.push({ expression, truthy: false });
    }
    current =
      current.parent?.type === "VElement" ? current.parent : null;
  }
  for (const attribute of element?.startTag?.attributes ?? []) {
    if (
      directiveName(attribute) === "bind" &&
      /(?:^|-)disabled$/.test(directiveArgument(attribute) ?? "")
    ) {
      const expression = directiveExpression(attribute);
      if (expression) evidence.push({ expression, truthy: false });
    }
  }
  return evidence;
}

function normalizedExpression(value) {
  return String(value)
    .replace(/\?\.?/g, ".")
    .replace(/\.value\b/g, "")
    .replace(/\s+/g, "");
}

function memberExpressionPath(node) {
  if (!node) return null;
  if (node.type === "ChainExpression") {
    return memberExpressionPath(node.expression);
  }
  if (node.type === "Identifier") return node.name;
  if (
    node.type !== "MemberExpression" ||
    (node.computed && literalString(node.property) === null)
  ) {
    return null;
  }
  const object = memberExpressionPath(node.object);
  const property = node.computed
    ? literalString(node.property)
    : node.property?.type === "Identifier"
      ? node.property.name
      : null;
  if (!object || !property) return null;
  return normalizedExpression(`${object}.${property}`);
}

function canonicalExpression(node) {
  if (!node) return null;
  if (node.type === "ChainExpression") {
    return canonicalExpression(node.expression);
  }
  const member = memberExpressionPath(node);
  if (member) return member;
  if (node.type === "CallExpression") {
    const callee = canonicalExpression(node.callee);
    if (!callee) return null;
    const args = (node.arguments ?? []).map((argument) => {
      const literal = literalString(argument);
      if (literal !== null) return JSON.stringify(literal);
      return canonicalExpression(argument) ?? "?";
    });
    return normalizedExpression(`${callee}(${args.join(",")})`);
  }
  return null;
}

function capabilityClosure(node, symbols) {
  const nodes = [];
  const seenNames = new Set();
  const seenNodes = new Set();
  const pendingNodes = node ? [node] : [];
  while (pendingNodes.length && seenNodes.size < 128) {
    const current = pendingNodes.shift();
    if (!current || seenNodes.has(current)) continue;
    seenNodes.add(current);
    nodes.push(current);
    for (const name of referencedIdentifiers(current)) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const declaration = uniqueIndexedNode(
        symbols.declarations,
        name
      );
      if (declaration) pendingNodes.push(declaration);
    }
  }
  return nodes;
}

function closureHasCanonicalExpression(nodes, expected) {
  const normalizedExpected = normalizedExpression(expected);
  let found = false;
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      if (
        !found &&
        canonicalExpression(candidate) === normalizedExpected
      ) {
        found = true;
      }
    });
    if (found) break;
  }
  return found;
}

function closureHasLiteral(nodes, expected) {
  let found = false;
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      if (!found && literalString(candidate) === expected) {
        found = true;
      }
    });
    if (found) break;
  }
  return found;
}

function closureHasEnabledCheck(nodes) {
  let found = false;
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      if (
        !found &&
        candidate.type === "MemberExpression" &&
        memberExpressionPath(candidate)?.split(".").at(-1) ===
          "enabled"
      ) {
        found = true;
      }
    });
    if (found) break;
  }
  return found;
}

function closureHasCollectionPredicate(nodes) {
  let found = false;
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      if (
        !found &&
        candidate.type === "CallExpression" &&
        candidate.callee?.type === "MemberExpression" &&
        ["includes", "some"].includes(
          memberExpressionPath(candidate.callee)?.split(".").at(-1)
        )
      ) {
        found = true;
      }
    });
    if (found) break;
  }
  return found;
}

function capabilitySourceRoot(source) {
  return normalizedExpression(source).match(
    /^[$A-Z_a-z][$\w]*/
  )?.[0] ?? null;
}

function unwrapValueExpression(node) {
  let current = node;
  while (
    current &&
    [
      "AwaitExpression",
      "ChainExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSNonNullExpression"
    ].includes(current.type)
  ) {
    current = current.argument ?? current.expression;
  }
  return current;
}

function expressionIsImportedReadResult(node, names) {
  const value = unwrapValueExpression(node);
  return (
    value?.type === "CallExpression" &&
    value.callee?.type === "Identifier" &&
    names.has(value.callee.name)
  );
}

function capabilityHasServerProvenance(capability, context) {
  const root = capabilitySourceRoot(capability.source);
  if (!root || context.symbols.imports.has(root)) return false;
  const declarations =
    context.symbols.declarations.get(root) ?? [];
  return (
    declarations.length === 1 &&
    expressionIsImportedReadResult(
      declarations[0],
      context.serverReadImports
    )
  );
}

function expressionHasCapability(node, capability, context) {
  if (!node || !SERVER_CAPABILITY_KINDS.has(capability.kind)) {
    return false;
  }
  const nodes = capabilityClosure(node, context.symbols);
  if (
    !closureHasCanonicalExpression(nodes, capability.source) ||
    !capabilityHasServerProvenance(capability, context)
  ) {
    return false;
  }
  if (
    capability.key &&
    !closureHasLiteral(nodes, capability.key)
  ) {
    return false;
  }
  if (capability.kind === "detail_action") {
    return closureHasEnabledCheck(nodes);
  }
  if (capability.kind === "available_action_string") {
    return closureHasCollectionPredicate(nodes);
  }
  return true;
}

function capabilityRequired(node, truthy, capability, context) {
  if (!node) return false;
  if (node.type === "ChainExpression") {
    return capabilityRequired(
      node.expression,
      truthy,
      capability,
      context
    );
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    return capabilityRequired(
      node.argument,
      !truthy,
      capability,
      context
    );
  }
  if (node.type === "LogicalExpression") {
    if (truthy && node.operator === "&&") {
      return (
        capabilityRequired(node.left, true, capability, context) ||
        capabilityRequired(node.right, true, capability, context)
      );
    }
    if (truthy && (node.operator === "||" || node.operator === "??")) {
      return (
        capabilityRequired(node.left, true, capability, context) &&
        capabilityRequired(node.right, true, capability, context)
      );
    }
    if (!truthy && (node.operator === "||" || node.operator === "??")) {
      return (
        capabilityRequired(node.left, false, capability, context) ||
        capabilityRequired(node.right, false, capability, context)
      );
    }
    if (!truthy && node.operator === "&&") {
      return (
        capabilityRequired(node.left, false, capability, context) &&
        capabilityRequired(node.right, false, capability, context)
      );
    }
  }
  if (node.type === "ConditionalExpression") {
    if (truthy) {
      const consequentImpossible =
        node.consequent.type === "Literal" &&
        node.consequent.value === false;
      const alternateImpossible =
        node.alternate.type === "Literal" &&
        node.alternate.value === false;
      const consequentProtected =
        consequentImpossible ||
        capabilityRequired(node.test, true, capability, context) ||
        capabilityRequired(
          node.consequent,
          true,
          capability,
          context
        );
      const alternateProtected =
        alternateImpossible ||
        capabilityRequired(node.test, false, capability, context) ||
        capabilityRequired(
          node.alternate,
          true,
          capability,
          context
        );
      return consequentProtected && alternateProtected;
    }
  }
  if (
    node.type === "Literal" &&
    ((truthy && node.value !== true) ||
      (!truthy && node.value !== false))
  ) {
    return false;
  }
  return expressionHasCapability(node, capability, context);
}

function actionCollectionEvidence(element) {
  return (element?.startTag?.attributes ?? [])
    .filter(
      (attribute) =>
        directiveName(attribute) === "bind" &&
        ["actions", "available-actions"].includes(
          directiveArgument(attribute)
        )
    )
    .map(directiveExpression)
    .filter(Boolean);
}

function capabilityDominates(candidate, capability, context) {
  if (!SERVER_CAPABILITY_KINDS.has(capability.kind)) return false;
  if (
    conditionalEvidence(candidate.elementNode).some(({ expression, truthy }) =>
      capabilityRequired(
        expression,
        truthy,
        capability,
        context
      )
    )
  ) {
    return true;
  }
  if (
    candidate.kind === "prop_callback" &&
    candidate.element === "business-draft-action" &&
    candidate.event === "execute" &&
    candidate.capabilityCollection &&
    context.businessDraftActionTrusted &&
    context.registryVariant &&
    context.registryVariant === capability.key &&
    actionCollectionEvidence(candidate.elementNode).some(
      (expression) =>
        expressionHasCapability(
          expression,
          capability,
          context
        )
    )
  ) {
    return true;
  }
  return false;
}

function businessDraftActionIsTrusted(source) {
  if (typeof source !== "string") return false;
  const normalized = normalizedExpression(source);
  return (
    normalized.includes(
      "enabledActionItems=computed(()=>actionItems.filter((action)=>action.enabled))"
    ) &&
    /v-for\s*=\s*["']action in enabledActionItems["']/.test(source) &&
    /:disabled\s*=\s*["'][^"']*!action\.enabled/.test(source) &&
    /props\.execute\s*\(\s*\{\s*action:\s*action\.key/.test(source)
  );
}

function candidateVariant(candidate, expected, capabilityKey) {
  if (!expected) return true;
  if (candidate.variants.includes(expected)) return true;
  return (
    candidate.kind === "prop_callback" &&
    candidate.capabilityCollection &&
    expected === capabilityKey
  ) || (
    candidate.kind === "background_call" &&
    candidate.variants.includes(expected)
  );
}

function normalizedElementName(node) {
  const raw = node?.rawName ?? node?.name ?? "";
  if (raw.includes("-")) return raw.toLowerCase();
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function inspectVueTemplate(path, source, ast) {
  const actions = [];
  const dynamicEventIssues = [];
  const unresolvedComponentForwards = [];
  const template = ast.templateBody;
  if (!template) return { actions, dynamicEventIssues, unresolvedComponentForwards };
  walkEstree(template, (node) => {
    if (node.type !== "VElement") return;
    const attributes = node.startTag?.attributes ?? [];
    for (const attribute of attributes) {
      if (directiveName(attribute) !== "on") continue;
      const event = directiveArgument(attribute);
      if (!event) {
        dynamicEventIssues.push({
          code: "DYNAMIC_TEMPLATE_EVENT_UNRESOLVED",
          sourceFile: path,
          sourceLine: attribute.loc?.start?.line ?? null
        });
        continue;
      }
      const expression = directiveExpression(attribute);
      if (!expression) {
        dynamicEventIssues.push({
          code: "TEMPLATE_EVENT_HANDLER_UNRESOLVED",
          sourceFile: path,
          sourceLine: attribute.loc?.start?.line ?? null,
          event
        });
        continue;
      }
      for (const root of eventHandlerRoots(expression)) {
        actions.push({
          kind: "event",
          sourceFile: path,
          sourceLine: attribute.loc?.start?.line ?? null,
          sourceColumn: attribute.loc?.start?.column ?? null,
          element: normalizedElementName(node),
          event: event.toLowerCase(),
          handler: root.handler,
          variants: root.variants,
          elementNode: node,
          expression,
          capabilityCollection: actionCollectionEvidence(node).length > 0
        });
      }
    }
    for (const attribute of attributes) {
      if (
        directiveName(attribute) !== "bind" ||
        !directiveArgument(attribute)
      ) {
        continue;
      }
      const expression = directiveExpression(attribute);
      if (!expression) continue;
      const event = directiveArgument(attribute).toLowerCase();
      if (
        ![
          "execute",
          "on-execute",
          "action-handler",
          "on-confirm"
        ].includes(event)
      ) {
        continue;
      }
      for (const root of eventHandlerRoots(expression)) {
        actions.push({
          kind: "prop_callback",
          sourceFile: path,
          sourceLine: attribute.loc?.start?.line ?? null,
          sourceColumn: attribute.loc?.start?.column ?? null,
          element: normalizedElementName(node),
          event: event.replace(/^on-/, ""),
          handler: root.handler,
          variants: root.variants,
          elementNode: node,
          expression,
          capabilityCollection: actionCollectionEvidence(node).length > 0
        });
      }
    }
    const spread = attributes.find(
      (attribute) =>
        directiveName(attribute) === "bind" &&
        !directiveArgument(attribute)
    );
    if (spread) {
      unresolvedComponentForwards.push({
        code: "COMPONENT_SPREAD_FORWARD_UNRESOLVED",
        sourceFile: path,
        sourceLine: spread.loc?.start?.line ?? null,
        element: normalizedElementName(node)
      });
    }
  });
  return {
    actions: sortRecords(actions, [
      "sourceFile",
      "sourceLine",
      "sourceColumn",
      "event",
      "handler"
    ]),
    dynamicEventIssues: sortRecords(dynamicEventIssues, [
      "sourceFile",
      "sourceLine",
      "event"
    ]),
    unresolvedComponentForwards: sortRecords(
      unresolvedComponentForwards,
      ["sourceFile", "sourceLine", "element"]
    )
  };
}

function wrapperIdentity(apiFile, name) {
  return `${apiFile}\u0000${name}`;
}

function sourceTriggerCandidate(action, ast, source) {
  if (
    action.usage !== "background" ||
    action.trigger.element !== "module" ||
    action.trigger.event !== "call" ||
    !ast
  ) {
    return null;
  }
  const matches = [];
  walkEstree(ast, (declaration) => {
    if (
      declaration.type === "FunctionDeclaration" &&
      declaration.id?.name === action.trigger.handler
    ) {
      const variants = [];
      walkEstree(declaration, (node) => {
        const value = literalString(node);
        if (value) variants.push(value);
      });
      matches.push({
        kind: "background_call",
        sourceFile: action.sourceFile,
        sourceLine: declaration.loc?.start?.line ?? null,
        sourceColumn: declaration.loc?.start?.column ?? null,
        element: "module",
        event: "call",
        handler: action.trigger.handler,
        variants: uniqueStrings(variants),
        elementNode: null,
        expression: declaration,
        capabilityCollection: false
      });
      return;
    }
    if (
      declaration.type === "VariableDeclarator" &&
      declaration.id?.type === "Identifier" &&
      declaration.id.name === action.trigger.handler &&
      declaration.init
    ) {
      const variants = [];
      walkEstree(declaration.init, (node) => {
        const value = literalString(node);
        if (value) variants.push(value);
      });
      matches.push({
        kind: "background_call",
        sourceFile: action.sourceFile,
        sourceLine: declaration.loc?.start?.line ?? null,
        sourceColumn: declaration.loc?.start?.column ?? null,
        element: "module",
        event: "call",
        handler: action.trigger.handler,
        variants: uniqueStrings(variants),
        elementNode: null,
        expression: declaration.init,
        capabilityCollection: false
      });
    }
  });
  return matches.length === 1 ? matches[0] : null;
}

function sanitizedTicketFollowup(request) {
  return {
    kind: "ticket_followup",
    sourceLine:
      Number.isInteger(request?.sourceLine) ? request.sourceLine : null,
    method:
      isNonEmptyString(request?.method)
        ? request.method.toUpperCase()
        : "GET",
    ...(isNonEmptyString(request?.ticketField)
      ? { ticketField: request.ticketField }
      : {}),
    bodyKind:
      isNonEmptyString(request?.bodyKind) ? request.bodyKind : "none"
  };
}

function sanitizedNestRoute(route) {
  if (!route) return null;
  return {
    method: route.method,
    path: route.path,
    normalizedKey: route.normalizedKey,
    controller: route.controller,
    handler: route.handler,
    sourceFile: route.sourceFile,
    authorizationScope:
      route.authorizationScope ?? "guard_metadata_only",
    authentication: route.authentication,
    guardAuthorization: route.guardAuthorization,
    isPublic: route.isPublic === true,
    requiredPositions: Array.isArray(route.requiredPositions)
      ? [...route.requiredPositions].sort(compareStrings)
      : [],
    requiredProjectAction:
      route.requiredProjectAction ?? null
  };
}

function normalizedMainRequests(wrapper) {
  return (wrapper?.requests ?? []).filter(
    (request) => request?.kind === "main"
  );
}

function ticketFollowups(wrapper) {
  return (wrapper?.requests ?? [])
    .filter((request) => request?.kind === "ticket_followup")
    .map(sanitizedTicketFollowup)
    .sort(
      (left, right) =>
        compareStrings(left.method, right.method) ||
        (left.sourceLine ?? 0) - (right.sourceLine ?? 0)
    );
}

function isMutationRequest(request) {
  return (
    isNonEmptyString(request?.method) &&
    !SAFE_METHODS.has(request.method.toUpperCase())
  );
}

function wrapperIsProductionMutation(wrapper) {
  return (
    wrapper?.kind === "transport" &&
    Array.isArray(wrapper.productionConsumers) &&
    wrapper.productionConsumers.length > 0 &&
    normalizedMainRequests(wrapper).some(isMutationRequest)
  );
}

function dependencyClosure(path, graph) {
  return reachableFrom(path, graph);
}

function staticTruthiness(node) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Literal") {
    return {
      known: true,
      value: Boolean(value.value)
    };
  }
  if (
    value?.type === "TemplateLiteral" &&
    (value.expressions ?? []).length === 0
  ) {
    return {
      known: true,
      value: Boolean(value.quasis?.[0]?.value?.cooked ?? "")
    };
  }
  if (
    value?.type === "UnaryExpression" &&
    value.operator === "void"
  ) {
    return { known: true, value: false };
  }
  if (
    value?.type === "UnaryExpression" &&
    value.operator === "!"
  ) {
    const argument = staticTruthiness(value.argument);
    return argument.known
      ? { known: true, value: !argument.value }
      : { known: false, value: false };
  }
  return { known: false, value: false };
}

function staticNullishness(node) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Literal") {
    return {
      known: true,
      value: value.value === null
    };
  }
  if (
    value?.type === "TemplateLiteral" &&
    (value.expressions ?? []).length === 0
  ) {
    return { known: true, value: false };
  }
  if (
    value?.type === "UnaryExpression" &&
    value.operator === "void"
  ) {
    return { known: true, value: true };
  }
  return { known: false, value: false };
}

function directCallTargets(
  node,
  definitions = indexedCompletionDefinitions(node)
) {
  const calls = [];
  let reliable = true;
  const visit = (candidate, isRoot = false) => {
    if (!candidate || typeof candidate !== "object") return false;
    if (
      !isRoot &&
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression"
      ].includes(candidate.type)
    ) {
      return false;
    }
    if (
      candidate.type === "ChainExpression" ||
      candidate.type === "OptionalCallExpression" ||
      candidate.type === "OptionalMemberExpression" ||
      (candidate.type === "CallExpression" &&
        (candidate.optional === true ||
          candidate.callee?.optional === true)) ||
      (candidate.type === "MemberExpression" &&
        candidate.optional === true)
    ) {
      reliable = false;
      return false;
    }
    if (
      candidate.type === "AssignmentExpression" &&
      ["&&=", "||=", "??="].includes(candidate.operator)
    ) {
      reliable = false;
      return false;
    }
    if (candidate.type === "AssignmentPattern") {
      reliable = false;
      return false;
    }
    if (
      [
        "PropertyDefinition",
        "ClassProperty",
        "ClassPrivateProperty",
        "AccessorProperty",
        "ClassAccessorProperty"
      ].includes(candidate.type) &&
      candidate.static !== true
    ) {
      reliable = false;
      return false;
    }
    if (
      candidate.type === "CallExpression" &&
      candidate.callee?.type === "Identifier" &&
      candidate.callee.name === "eval"
    ) {
      reliable = false;
      return false;
    }
    if (candidate.type === "ClassBody") {
      for (const element of candidate.body ?? []) {
        if (element.type === "StaticBlock") {
          for (const statement of element.body ?? []) {
            if (visit(statement, false)) return true;
          }
          continue;
        }
        if (visit(element, false)) return true;
      }
      return false;
    }
    if (candidate.type === "BlockStatement") {
      for (const statement of candidate.body ?? []) {
        if (visit(statement, false)) return true;
      }
      return false;
    }
    if (
      candidate.type === "ReturnStatement" ||
      candidate.type === "ThrowStatement"
    ) {
      visit(candidate.argument, false);
      return true;
    }
    if (candidate.type === "IfStatement") {
      visit(candidate.test, false);
      const truthiness = staticTruthiness(candidate.test);
      if (truthiness.known) {
        return visit(
          truthiness.value
            ? candidate.consequent
            : candidate.alternate,
          false
        );
      }
      reliable = false;
      return false;
    }
    if (candidate.type === "LogicalExpression") {
      visit(candidate.left, false);
      if (candidate.operator === "??") {
        const left = staticNullishness(candidate.left);
        if (!left.known) {
          reliable = false;
          return false;
        }
        if (left.value) visit(candidate.right, false);
        return false;
      }
      const left = staticTruthiness(candidate.left);
      if (!left.known) {
        reliable = false;
        return false;
      }
      if (
        (candidate.operator === "&&" && left.value) ||
        (candidate.operator === "||" && !left.value)
      ) {
        visit(candidate.right, false);
      }
      return false;
    }
    if (candidate.type === "ConditionalExpression") {
      visit(candidate.test, false);
      const test = staticTruthiness(candidate.test);
      if (test.known) {
        visit(
          test.value
            ? candidate.consequent
            : candidate.alternate,
          false
        );
      } else {
        reliable = false;
      }
      return false;
    }
    if (candidate.type === "WhileStatement") {
      visit(candidate.test, false);
      const test = staticTruthiness(candidate.test);
      if (!test.known) {
        reliable = false;
        return false;
      }
      if (!test.value) return false;
      const bodyTerminates = visit(candidate.body, false);
      return bodyTerminates || reliable;
    }
    if (candidate.type === "ForStatement") {
      visit(candidate.init, false);
      visit(candidate.test, false);
      const test = candidate.test
        ? staticTruthiness(candidate.test)
        : { known: true, value: true };
      if (test.known && !test.value) return false;
      reliable = false;
      return false;
    }
    if (
      [
        "SwitchStatement",
        "TryStatement",
        "DoWhileStatement",
        "ForInStatement",
        "ForOfStatement",
        "BreakStatement",
        "ContinueStatement",
        "LabeledStatement",
        "WithStatement",
        "YieldExpression"
      ].includes(candidate.type)
    ) {
      reliable = false;
      return false;
    }
    if (candidate.type === "CallExpression") {
      if (candidate.callee?.type === "Identifier") {
        calls.push({
          kind: "identifier",
          localName: candidate.callee.name
        });
      } else if (
        candidate.callee?.type === "MemberExpression" &&
        !candidate.callee.computed &&
        candidate.callee.object?.type === "Identifier" &&
        candidate.callee.property?.type === "Identifier"
      ) {
        calls.push({
          kind: "member",
          localName: candidate.callee.object.name,
          memberName: candidate.callee.property.name
        });
      }
      if (
        expressionDefinitelyDoesNotComplete(
          candidate,
          definitions,
          new Set()
        )
      ) {
        return true;
      }
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (
        [
          "parent",
          "tokens",
          "comments",
          "loc",
          "range"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            if (visit(child, false)) return true;
          }
        }
      } else if (value && typeof value.type === "string") {
        if (visit(value, false)) return true;
      }
    }
    return false;
  };
  visit(node, true);
  return { calls, reliable };
}

function importedCallMatchesWrapper(call, wrapper, symbols) {
  const binding = symbols.imports.get(call.localName);
  if (!binding || binding.sourceFile !== wrapper.apiFile) {
    return false;
  }
  if (call.kind === "identifier") {
    return (
      binding.kind === "named" &&
      binding.importedName === wrapper.name
    );
  }
  return (
    call.kind === "member" &&
    binding.kind === "namespace" &&
    call.memberName === wrapper.name
  );
}

function wrapperCausalProof(handler, wrapper, symbols) {
  const initialImport = symbols.imports.get(handler);
  if (
    initialImport &&
    importedCallMatchesWrapper(
      { kind: "identifier", localName: handler },
      wrapper,
      symbols
    )
  ) {
    return {
      verified: true,
      localCallChain: [handler]
    };
  }
  const pending = [{ name: handler, chain: [handler] }];
  const visited = new Set();
  let verifiedChain = null;
  while (pending.length && visited.size < 128) {
    const current = pending.shift();
    if (visited.has(current.name)) continue;
    visited.add(current.name);
    const definition = uniqueIndexedNode(
      symbols.definitions,
      current.name
    );
    if (!definition) continue;
    const analysis = directCallTargets(
      definition,
      symbols.declarations
    );
    if (!analysis.reliable) {
      return {
        verified: false,
        localCallChain: [handler]
      };
    }
    for (const call of analysis.calls) {
      if (importedCallMatchesWrapper(call, wrapper, symbols)) {
        verifiedChain ??= [
            ...current.chain,
            call.kind === "identifier"
              ? call.localName
              : `${call.localName}.${call.memberName}`
          ];
      }
      if (
        call.kind === "identifier" &&
        uniqueIndexedNode(
          symbols.definitions,
          call.localName
        )
      ) {
        pending.push({
          name: call.localName,
          chain: [...current.chain, call.localName]
        });
      }
    }
  }
  if (pending.length > 0) {
    return {
      verified: false,
      localCallChain: [handler]
    };
  }
  if (verifiedChain) {
    return {
      verified: true,
      localCallChain: verifiedChain
    };
  }
  return {
    verified: false,
    localCallChain: [handler]
  };
}

function serverReadImportNames(symbols, wrapperIndex, sourceFile) {
  const names = new Set();
  for (const [localName, binding] of symbols.imports) {
    if (binding.kind !== "named") continue;
    const wrapper = wrapperIndex.get(
      wrapperIdentity(
        binding.sourceFile,
        binding.importedName
      )
    );
    if (
      !wrapper ||
      !Array.isArray(wrapper.productionConsumers) ||
      !wrapper.productionConsumers.includes(sourceFile)
    ) {
      continue;
    }
    const mainRequests = normalizedMainRequests(wrapper);
    if (
      mainRequests.length > 0 &&
      mainRequests.every(
        (request) =>
          isNonEmptyString(request.method) &&
          ["GET", "HEAD"].includes(request.method.toUpperCase())
      )
    ) {
      names.add(localName);
    }
  }
  return names;
}

function wrapperReferencedFromAction({
  wrapper,
  action,
  graph
}) {
  const dependencies = dependencyClosure(action.sourceFile, graph);
  return uniqueStrings(
    (wrapper.productionConsumers ?? []).filter((consumer) =>
      dependencies.has(consumer)
    )
  );
}

function triggerCandidates(action, templateActions) {
  return templateActions.filter(
    (candidate) =>
      candidate.sourceFile === action.sourceFile &&
      candidate.element === action.trigger.element &&
      candidate.event === action.trigger.event &&
      candidate.handler === action.trigger.handler &&
      candidateVariant(
        candidate,
        action.trigger.variant,
        action.capability.key
      )
  );
}

function actionBindings({
  action,
  wrapperIndex,
  nestRouteIndex,
  blockers,
  graph,
  symbols,
  candidate
}) {
  const bindings = [];
  for (const declared of action.wrappers) {
    const identity = wrapperIdentity(
      declared.apiFile,
      declared.name
    );
    const wrapper = wrapperIndex.get(identity);
    if (!wrapper) {
      blockers.unresolvedWrappers.push({
        code: "WRAPPER_NOT_IN_MANIFEST",
        actionId: action.id,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
      continue;
    }
    const relatedConsumers = wrapperReferencedFromAction({
      wrapper,
      action,
      graph
    });
    if (relatedConsumers.length === 0) {
      blockers.unresolvedWrappers.push({
        code: "WRAPPER_NOT_REFERENCED_BY_ACTION_SOURCE",
        actionId: action.id,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
    }
    const causalProof = candidate
      ? wrapperCausalProof(
          action.trigger.handler,
          {
            ...wrapper,
            apiFile: posixPath(wrapper.apiFile)
          },
          symbols
        )
      : {
          verified: false,
          localCallChain: [action.trigger.handler]
        };
    if (!causalProof.verified) {
      blockers.unresolvedWrappers.push({
        code: "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED",
        actionId: action.id,
        sourceFile: action.sourceFile,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
    }
    const mainRequests = normalizedMainRequests(wrapper);
    if (mainRequests.length === 0) {
      blockers.unresolvedWrappers.push({
        code: "WRAPPER_MAIN_REQUEST_UNRESOLVED",
        actionId: action.id,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
      continue;
    }
    const followups = ticketFollowups(wrapper);
    for (const followup of followups) {
      if (!["GET", "HEAD"].includes(followup.method)) {
        blockers.unresolvedRoutes.push({
          code: "TICKET_FOLLOWUP_MUTATION_UNRESOLVED",
          actionId: action.id,
          apiFile: declared.apiFile,
          wrapper: declared.name,
          method: followup.method
        });
      }
    }
    for (const request of mainRequests) {
      const normalizedKey = request.normalizedKey;
      const nestRoute = isNonEmptyString(normalizedKey)
        ? nestRouteIndex.get(normalizedKey)
        : null;
      if (!nestRoute) {
        blockers.unresolvedRoutes.push({
          code: "WRAPPER_ROUTE_MISSING",
          actionId: action.id,
          apiFile: declared.apiFile,
          wrapper: declared.name,
          normalizedKey:
            isNonEmptyString(normalizedKey) ? normalizedKey : null
        });
      }
      bindings.push({
        apiFile: declared.apiFile,
        wrapper: declared.name,
        method:
          isNonEmptyString(request.method)
            ? request.method.toUpperCase()
            : null,
        path: isNonEmptyString(request.path) ? request.path : null,
        normalizedKey:
          isNonEmptyString(normalizedKey) ? normalizedKey : null,
        bodyKind:
          isNonEmptyString(request.bodyKind)
            ? request.bodyKind
            : "unknown",
        nestRoute: sanitizedNestRoute(nestRoute),
        productionConsumers: relatedConsumers,
        acceptedProductionConsumers: [],
        causalVerified: causalProof.verified,
        causalProof: {
          localCallChain: causalProof.localCallChain
        },
        ticketFollowups: followups
      });
    }
  }
  return bindings.sort(
    (left, right) =>
      compareStrings(left.apiFile, right.apiFile) ||
      compareStrings(left.wrapper, right.wrapper) ||
      compareStrings(
        String(left.normalizedKey),
        String(right.normalizedKey)
      )
  );
}

function normalizedRequestIdentity(request) {
  if (
    !isNonEmptyString(request?.method) ||
    !isNonEmptyString(request?.path) ||
    !isNonEmptyString(request?.normalizedKey)
  ) {
    return null;
  }
  const method = request.method.toUpperCase();
  const normalizedPath = isNonEmptyString(request.normalizedPath)
    ? request.normalizedPath
    : request.path.split("?")[0];
  return `${method} ${normalizedPath}`;
}

function normalizeRouteIdentityPath(path) {
  return String(path)
    .split("?")[0]
    .replace(/:[^/]+/g, ":param");
}

function validateUpstreamWebManifest({
  manifest,
  sourceFiles,
  reachable,
  blockers
}) {
  const issues = blockers.upstreamManifestIssues;
  if (manifest.status !== "ready") {
    issues.push({
      code: "UPSTREAM_WEB_MANIFEST_BLOCKED",
      status: manifest.status ?? null
    });
  }
  if (!isRecord(manifest.blockers)) {
    issues.push({
      code: "UPSTREAM_WEB_MANIFEST_SHAPE_INVALID",
      field: "blockers"
    });
  } else {
    let hasBlockers = false;
    for (const [name, entries] of Object.entries(
      manifest.blockers
    )) {
      if (!Array.isArray(entries)) {
        issues.push({
          code: "UPSTREAM_WEB_MANIFEST_SHAPE_INVALID",
          field: `blockers.${name}`
        });
      } else if (entries.length > 0) {
        hasBlockers = true;
      }
    }
    if (hasBlockers) {
      issues.push({
        code: "UPSTREAM_WEB_MANIFEST_BLOCKED",
        status: manifest.status ?? null,
        reason: "non_empty_blockers"
      });
    }
  }
  const expectedScope = {
    apiRoot: `${WEB_SOURCE_ROOT}/api`,
    productionEntrypoint: PRODUCTION_ENTRYPOINT,
    nestRouteManifest: NEST_MANIFEST_PATH
  };
  if (
    !isRecord(manifest.scope) ||
    Object.entries(expectedScope).some(
      ([key, value]) => manifest.scope[key] !== value
    )
  ) {
    issues.push({
      code: "UPSTREAM_WEB_MANIFEST_SCOPE_MISMATCH"
    });
  }
  if (
    !isRecord(manifest.evidence) ||
    manifest.evidence.productionModuleCount !==
      sourceFiles.length ||
    manifest.evidence.reachableProductionModuleCount !==
      reachable.size
  ) {
    issues.push({
      code: "UPSTREAM_WEB_MANIFEST_EVIDENCE_MISMATCH",
      expectedProductionModuleCount: sourceFiles.length,
      expectedReachableProductionModuleCount: reachable.size
    });
  }
  const identities = new Set();
  for (const [index, wrapper] of (
    Array.isArray(manifest.wrappers)
      ? manifest.wrappers
      : []
  ).entries()) {
    if (
      !isNonEmptyString(wrapper?.apiFile) ||
      !isNonEmptyString(wrapper?.name) ||
      !Array.isArray(wrapper?.requests) ||
      !Array.isArray(wrapper?.productionConsumers)
    ) {
      issues.push({
        code: "UPSTREAM_WEB_WRAPPER_SHAPE_INVALID",
        wrapperIndex: index
      });
      continue;
    }
    const identity = wrapperIdentity(
      posixPath(wrapper.apiFile),
      wrapper.name
    );
    if (identities.has(identity)) {
      issues.push({
        code: "UPSTREAM_WEB_WRAPPER_DUPLICATE",
        apiFile: posixPath(wrapper.apiFile),
        wrapper: wrapper.name
      });
    }
    identities.add(identity);
    const requestIdentities = new Set();
    for (const request of wrapper.requests) {
      if (request?.kind === "main") {
        const expected = normalizedRequestIdentity(request);
        if (!expected || expected !== request.normalizedKey) {
          issues.push({
            code: "UPSTREAM_WEB_REQUEST_IDENTITY_INVALID",
            apiFile: posixPath(wrapper.apiFile),
            wrapper: wrapper.name,
            normalizedKey: request?.normalizedKey ?? null
          });
          continue;
        }
        if (requestIdentities.has(expected)) {
          issues.push({
            code: "UPSTREAM_WEB_REQUEST_DUPLICATE",
            apiFile: posixPath(wrapper.apiFile),
            wrapper: wrapper.name,
            normalizedKey: expected
          });
        }
        requestIdentities.add(expected);
      } else if (
        request?.kind === "ticket_followup" &&
        (!isNonEmptyString(request.method) ||
          !["GET", "HEAD"].includes(request.method.toUpperCase()))
      ) {
        issues.push({
          code: "TICKET_FOLLOWUP_MUTATION_UNRESOLVED",
          apiFile: posixPath(wrapper.apiFile),
          wrapper: wrapper.name,
          method: request?.method ?? null
        });
      } else if (
        !["main", "ticket_followup"].includes(request?.kind)
      ) {
        issues.push({
          code: "UPSTREAM_WEB_REQUEST_SHAPE_INVALID",
          apiFile: posixPath(wrapper.apiFile),
          wrapper: wrapper.name
        });
      }
    }
  }
}

function validateUpstreamNestManifest(manifest, blockers) {
  const issues = blockers.upstreamManifestIssues;
  if (manifest.authorizationScope !== "guard_metadata_only") {
    issues.push({
      code: "UPSTREAM_NEST_AUTHORIZATION_SCOPE_INVALID",
      authorizationScope: manifest.authorizationScope ?? null
    });
  }
  const normalizedKeys = new Set();
  const identities = new Set();
  for (const [index, route] of (
    Array.isArray(manifest.routes) ? manifest.routes : []
  ).entries()) {
    if (
      !isNonEmptyString(route?.method) ||
      !isNonEmptyString(route?.path) ||
      !isNonEmptyString(route?.normalizedKey)
    ) {
      issues.push({
        code: "UPSTREAM_NEST_ROUTE_SHAPE_INVALID",
        routeIndex: index
      });
      continue;
    }
    const expected = `${route.method.toUpperCase()} ${normalizeRouteIdentityPath(
      route.path
    )}`;
    if (
      route.method !== route.method.toUpperCase() ||
      route.normalizedKey !== expected
    ) {
      issues.push({
        code: "UPSTREAM_NEST_ROUTE_IDENTITY_INVALID",
        normalizedKey: route.normalizedKey
      });
    }
    if (
      normalizedKeys.has(route.normalizedKey) ||
      identities.has(expected)
    ) {
      issues.push({
        code: "UPSTREAM_NEST_ROUTE_DUPLICATE",
        normalizedKey: route.normalizedKey
      });
    }
    normalizedKeys.add(route.normalizedKey);
    identities.add(expected);
  }
}

function emptyBlockers() {
  return {
    upstreamManifestIssues: [],
    routeDiscoveryIssues: [],
    invalidRegistryEntries: [],
    duplicateRegistryEntries: [],
    staleRegistryEntries: [],
    unresolvedHandlers: [],
    unresolvedWrappers: [],
    unresolvedRoutes: [],
    writeWithoutServerCapability: [],
    clientRoleOrStatusGates: [],
    uncoveredMutationWrappers: [],
    parseIssues: [],
    dynamicEventIssues: [],
    unresolvedComponentForwards: []
  };
}

function blockerCount(blockers) {
  return Object.values(blockers).reduce(
    (total, entries) =>
      total + (Array.isArray(entries) ? entries.length : 0),
    0
  );
}

function sortBlockers(blockers) {
  for (const [key, entries] of Object.entries(blockers)) {
    blockers[key] = sortRecords(entries, [
      "actionId",
      "id",
      "sourceFile",
      "sourceLine",
      "apiFile",
      "wrapper",
      "normalizedKey",
      "code"
    ]);
  }
  return blockers;
}

export async function inspectWholeSitePageActionManifest({
  root,
  registryPath,
  webManifestPath,
  nestManifestPath
}) {
  if (!isNonEmptyString(root)) {
    throw manifestError("PAGE_ACTION_MANIFEST_ROOT_INVALID");
  }
  const resolvedRoot = resolve(root);
  const resolvedRegistryPath = inputPath(
    resolvedRoot,
    registryPath,
    REGISTRY_PATH
  );
  const resolvedWebManifestPath = inputPath(
    resolvedRoot,
    webManifestPath,
    WEB_MANIFEST_PATH
  );
  const resolvedNestManifestPath = inputPath(
    resolvedRoot,
    nestManifestPath,
    NEST_MANIFEST_PATH
  );
  const [registryJson, webManifest, nestManifest, sourceFiles] =
    await Promise.all([
      readJson(
        resolvedRegistryPath,
        "PAGE_ACTION_REGISTRY_UNREADABLE"
      ),
      readJson(
        resolvedWebManifestPath,
        "PAGE_ACTION_WEB_MANIFEST_UNREADABLE"
      ),
      readJson(
        resolvedNestManifestPath,
        "PAGE_ACTION_NEST_MANIFEST_UNREADABLE"
      ),
      collectSourceFiles(resolvedRoot)
    ]);
  if (
    !isRecord(webManifest) ||
    webManifest.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(webManifest.wrappers)
  ) {
    throw manifestError("PAGE_ACTION_WEB_MANIFEST_INVALID");
  }
  if (
    !isRecord(nestManifest) ||
    nestManifest.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(nestManifest.routes)
  ) {
    throw manifestError("PAGE_ACTION_NEST_MANIFEST_INVALID");
  }
  const {
    actions: registryActions,
    invalidRegistryEntries
  } = normalizeRegistry(registryJson);
  const blockers = emptyBlockers();
  blockers.invalidRegistryEntries.push(
    ...invalidRegistryEntries.map((entry) => ({
      code: "REGISTRY_ENTRY_INVALID",
      ...entry
    }))
  );
  blockers.duplicateRegistryEntries.push(
    ...duplicateRegistryEntries(registryActions).map((entry) => ({
      code: "REGISTRY_ENTRY_DUPLICATE",
      ...entry
    }))
  );

  const sourceFileSet = new Set(sourceFiles);
  const sources = new Map();
  const asts = new Map();
  for (const path of sourceFiles) {
    const source = await readFile(join(resolvedRoot, path), "utf8");
    sources.set(path, source);
    try {
      const ast = parseSource(path, source);
      asts.set(path, ast);
      if (Array.isArray(ast.errors) && ast.errors.length > 0) {
        blockers.parseIssues.push({
          code: "SOURCE_PARSE_UNRESOLVED",
          sourceFile: path
        });
      }
    } catch {
      blockers.parseIssues.push({
        code: "SOURCE_PARSE_UNRESOLVED",
        sourceFile: path
      });
    }
  }

  const graph = new Map();
  for (const path of sourceFiles) {
    const ast = asts.get(path);
    graph.set(
      path,
      ast
        ? importedSpecifiers(ast)
            .map((specifier) =>
              resolveModuleSpecifier(
                path,
                specifier,
                sourceFileSet
              )
            )
            .filter(Boolean)
            .sort(compareStrings)
        : []
    );
  }
  const reachable = reachableFrom(
    sourceFileSet.has(PRODUCTION_ENTRYPOINT)
      ? PRODUCTION_ENTRYPOINT
      : null,
    graph
  );
  const ownershipGraph = new Map(
    [...graph].map(([path, dependencies]) => [
      path,
      dependencies.filter(
        (dependency) =>
          dependency !== PRODUCTION_ENTRYPOINT &&
          !dependency.startsWith(`${WEB_SOURCE_ROOT}/routes/`)
      )
    ])
  );
  blockers.parseIssues = blockers.parseIssues.filter(
    (issue) =>
      reachable.has(issue.sourceFile) ||
      registryActions.some(
        (action) => action.sourceFile === issue.sourceFile
      )
  );
  if (!sourceFileSet.has(PRODUCTION_ENTRYPOINT)) {
    blockers.parseIssues.push({
      code: "PRODUCTION_ENTRYPOINT_MISSING",
      sourceFile: PRODUCTION_ENTRYPOINT
    });
  }

  validateUpstreamWebManifest({
    manifest: webManifest,
    sourceFiles,
    reachable,
    blockers
  });
  validateUpstreamNestManifest(nestManifest, blockers);
  const upstreamManifestsValid =
    blockers.upstreamManifestIssues.length === 0;

  let routeRoots = [];
  if (
    !webAdminRoutesFeedConsumedRouter({
      asts,
      sourceFiles: sourceFileSet,
      reachable
    })
  ) {
    blockers.routeDiscoveryIssues.push({
      code: "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED",
      sourceFile: ROUTER_INDEX_PATH
    });
  }
  if (
    !sourceFileSet.has(ROUTE_RECORDS_PATH) ||
    !reachable.has(ROUTE_RECORDS_PATH) ||
    !asts.has(ROUTE_RECORDS_PATH)
  ) {
    blockers.routeDiscoveryIssues.push({
      code: "WEB_ADMIN_ROUTE_ANCHOR_UNRESOLVED",
      sourceFile: ROUTE_RECORDS_PATH
    });
  } else {
    const routeInspection = routeRootsFromAst(
      ROUTE_RECORDS_PATH,
      asts.get(ROUTE_RECORDS_PATH),
      sourceFileSet
    );
    routeRoots = routeInspection.roots;
    blockers.routeDiscoveryIssues.push(
      ...routeInspection.issues
    );
  }
  routeRoots.sort(
    (left, right) =>
      compareStrings(left.routePath, right.routePath) ||
      compareStrings(left.sourceFile, right.sourceFile)
  );
  const routesByPath = new Map(
    routeRoots.map((route) => [route.routePath, route])
  );
  const owners = routeOwners(routeRoots, ownershipGraph);

  const templateActions = [];
  for (const path of [...reachable]
    .filter((candidate) => candidate.endsWith(".vue"))
    .sort(compareStrings)) {
    const source = sources.get(path);
    const ast = asts.get(path);
    if (!ast || typeof source !== "string") continue;
    const inspected = inspectVueTemplate(path, source, ast);
    templateActions.push(...inspected.actions);
    blockers.dynamicEventIssues.push(
      ...inspected.dynamicEventIssues
    );
    blockers.unresolvedComponentForwards.push(
      ...inspected.unresolvedComponentForwards
    );
  }

  const wrapperIndex = new Map();
  for (const wrapper of webManifest.wrappers) {
    if (
      isNonEmptyString(wrapper?.apiFile) &&
      isNonEmptyString(wrapper?.name)
    ) {
      wrapperIndex.set(
        wrapperIdentity(
          posixPath(wrapper.apiFile),
          wrapper.name
        ),
        wrapper
      );
    }
  }
  const nestRouteIndex = new Map();
  for (const route of nestManifest.routes) {
    if (isNonEmptyString(route?.normalizedKey)) {
      nestRouteIndex.set(route.normalizedKey, route);
    }
  }

  const manifestActions = [];
  const candidateConsumerPairs = new Set();
  const coveredConsumerPairs = new Set();
  const productionMutationConsumerPairs = new Set();
  for (const wrapper of webManifest.wrappers) {
    if (!wrapperIsProductionMutation(wrapper)) continue;
    const identity = wrapperIdentity(
      posixPath(wrapper.apiFile),
      wrapper.name
    );
    for (const consumer of uniqueStrings(
      wrapper.productionConsumers ?? []
    )) {
      productionMutationConsumerPairs.add(
        `${identity}\u0000${consumer}`
      );
    }
  }
  const businessDraftActionTrusted = businessDraftActionIsTrusted(
    sources.get(
      `${WEB_SOURCE_ROOT}/components/BusinessDraftAction.vue`
    )
  );
  for (const action of registryActions) {
    const source = sources.get(action.sourceFile);
    const ast = asts.get(action.sourceFile);
    const ownerRoutePaths = owners.get(action.sourceFile) ?? [];
    if (!sourceFileSet.has(action.sourceFile)) {
      blockers.staleRegistryEntries.push({
        code: "REGISTRY_SOURCE_MISSING",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    } else if (!reachable.has(action.sourceFile)) {
      blockers.staleRegistryEntries.push({
        code: "REGISTRY_SOURCE_UNREACHABLE",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    }
    for (const routePath of action.routePaths) {
      if (!routesByPath.has(routePath)) {
        blockers.unresolvedRoutes.push({
          code: "PAGE_ROUTE_MISSING",
          actionId: action.id,
          sourceFile: action.sourceFile,
          routePath
        });
      } else if (!ownerRoutePaths.includes(routePath)) {
        blockers.staleRegistryEntries.push({
          code: "REGISTRY_ROUTE_SOURCE_MISMATCH",
          actionId: action.id,
          sourceFile: action.sourceFile,
          routePath
        });
      }
    }

    const backgroundCandidate = sourceTriggerCandidate(
      action,
      ast,
      source
    );
    const candidates = backgroundCandidate &&
      candidateVariant(
        backgroundCandidate,
        action.trigger.variant,
        action.capability.key
      )
      ? [backgroundCandidate]
      : triggerCandidates(action, templateActions);
    const candidate = candidates[0] ?? null;
    if (!candidate) {
      blockers.staleRegistryEntries.push({
        code:
          action.trigger.element === "business-draft-action" &&
          action.trigger.event === "execute"
            ? "PROP_CALLBACK_TRIGGER_UNRESOLVED"
            : "REGISTRY_TRIGGER_MISSING",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    }
    const symbols = ast
      ? buildSymbolContext(
          ast,
          action.sourceFile,
          sourceFileSet
        )
      : {
          definitions: new Map(),
          declarations: new Map(),
          imports: new Map()
        };
    if (
      candidate &&
      !symbols.definitions.has(action.trigger.handler) &&
      !symbols.imports.has(action.trigger.handler)
    ) {
      blockers.unresolvedHandlers.push({
        code: "ACTION_HANDLER_UNRESOLVED",
        actionId: action.id,
        sourceFile: action.sourceFile,
        handler: action.trigger.handler
      });
    }
    const bindings = actionBindings({
      action,
      wrapperIndex,
      nestRouteIndex,
      blockers,
      graph: ownershipGraph,
      symbols,
      candidate
    });
    for (const binding of bindings) {
      const boundWrapper = wrapperIndex.get(
        wrapperIdentity(
          binding.apiFile,
          binding.wrapper
        )
      );
      if (!boundWrapper || !wrapperIsProductionMutation(boundWrapper)) {
        continue;
      }
      for (const consumer of binding.productionConsumers) {
        candidateConsumerPairs.add(
          `${wrapperIdentity(
            binding.apiFile,
            binding.wrapper
          )}\u0000${consumer}`
        );
      }
    }
    const writes = bindings.some((binding) =>
      isMutationRequest(binding)
    );
    const capabilityContext = {
      symbols,
      serverReadImports: serverReadImportNames(
        symbols,
        wrapperIndex,
        action.sourceFile
      ),
      registryVariant: action.trigger.variant,
      businessDraftActionTrusted
    };
    const dominatesTrigger =
      Boolean(candidate && source) &&
      capabilityDominates(
        candidate,
        action.capability,
        capabilityContext
      );
    let capabilityAccepted =
      !writes || dominatesTrigger;
    if (action.capability.kind === "client_role_or_status") {
      capabilityAccepted = false;
      blockers.clientRoleOrStatusGates.push({
        code: "CLIENT_ROLE_OR_STATUS_GATE",
        actionId: action.id,
        sourceFile: action.sourceFile,
        capabilitySource: action.capability.source
      });
    } else if (action.capability.kind === "none") {
      capabilityAccepted = false;
      blockers.writeWithoutServerCapability.push({
        code: "WRITE_WITHOUT_SERVER_CAPABILITY",
        actionId: action.id,
        sourceFile: action.sourceFile,
        reason: "capability_none"
      });
    } else if (
      action.capability.kind ===
      "authenticated_self_exception"
    ) {
      capabilityAccepted = false;
      blockers.writeWithoutServerCapability.push({
        code: "AUTHENTICATED_SELF_EXCEPTION_UNVERIFIED",
        actionId: action.id,
        sourceFile: action.sourceFile,
        reason: "authenticated_self_not_a_server_capability"
      });
    } else if (
      writes &&
      candidate &&
      source &&
      !dominatesTrigger
    ) {
      capabilityAccepted = false;
      blockers.writeWithoutServerCapability.push({
        code:
          ["detail_action", "available_action_string"].includes(
            action.capability.kind
          )
            ? "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
            : "WRITE_WITHOUT_SERVER_CAPABILITY",
        actionId: action.id,
        sourceFile: action.sourceFile,
        reason: "capability_not_dominating"
      });
    }
    const routeOwnershipAccepted =
      action.routePaths.length > 0 &&
      action.routePaths.every(
        (routePath) =>
          routesByPath.has(routePath) &&
          ownerRoutePaths.includes(routePath)
      );
    if (
      action.usage === "background" &&
      !routeOwnershipAccepted
    ) {
      blockers.staleRegistryEntries.push({
        code: "BACKGROUND_ROUTE_OWNERSHIP_MISSING",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    }
    const actionAcceptedForCoverage =
      upstreamManifestsValid &&
      Boolean(candidate) &&
      reachable.has(action.sourceFile) &&
      sourceFileSet.has(action.sourceFile) &&
      routeOwnershipAccepted &&
      capabilityAccepted &&
      bindings.length > 0 &&
      bindings.every(
        (binding) =>
          binding.causalVerified &&
          Boolean(binding.nestRoute) &&
          isNonEmptyString(binding.normalizedKey) &&
          binding.ticketFollowups.every((followup) =>
            ["GET", "HEAD"].includes(followup.method)
          )
      );
    if (actionAcceptedForCoverage) {
      for (const binding of bindings) {
        const accepted = [];
        const wrapper = wrapperIndex.get(
          wrapperIdentity(
            binding.apiFile,
            binding.wrapper
          )
        );
        if (wrapper && wrapperIsProductionMutation(wrapper)) {
          for (const consumer of binding.productionConsumers) {
            coveredConsumerPairs.add(
              `${wrapperIdentity(
                binding.apiFile,
                binding.wrapper
              )}\u0000${consumer}`
            );
            accepted.push(consumer);
          }
        }
        binding.acceptedProductionConsumers =
          accepted.sort(compareStrings);
      }
    }
    manifestActions.push({
      id: action.id,
      usage: action.usage,
      routePaths: action.routePaths,
      ownerRoutePaths,
      sourceFile: action.sourceFile,
      trigger: {
        ...action.trigger,
        kind: candidate?.kind ?? "unresolved",
        sourceLine: candidate?.sourceLine ?? null,
        sourceColumn: candidate?.sourceColumn ?? null
      },
      semantic: action.semantic,
      capability: {
        ...action.capability,
        serverDerived: SERVER_CAPABILITY_KINDS.has(
          action.capability.kind
        ),
        dominatesTrigger
      },
      bindings
    });
  }

  for (const wrapper of webManifest.wrappers) {
    if (!wrapperIsProductionMutation(wrapper)) continue;
    const identity = wrapperIdentity(
      posixPath(wrapper.apiFile),
      wrapper.name
    );
    for (const consumer of uniqueStrings(
      wrapper.productionConsumers ?? []
    )) {
      if (
        coveredConsumerPairs.has(
          `${identity}\u0000${consumer}`
        )
      ) {
        continue;
      }
      blockers.uncoveredMutationWrappers.push({
        code:
          "PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION",
        apiFile: posixPath(wrapper.apiFile),
        wrapper: wrapper.name,
        sourceFile: consumer,
        normalizedKeys: uniqueStrings(
          normalizedMainRequests(wrapper)
            .filter(isMutationRequest)
            .map((request) => request.normalizedKey)
            .filter(isNonEmptyString)
        )
      });
    }
  }

  sortBlockers(blockers);
  manifestActions.sort((left, right) =>
    compareStrings(left.id, right.id)
  );
  const totalBlockers = blockerCount(blockers);
  return {
    schemaVersion: SCHEMA_VERSION,
    status: totalBlockers === 0 ? "ready" : "blocked",
    scope: {
      registry: displayPath(resolvedRoot, resolvedRegistryPath),
      webApiManifest: displayPath(
        resolvedRoot,
        resolvedWebManifestPath
      ),
      nestRouteManifest: displayPath(
        resolvedRoot,
        resolvedNestManifestPath
      ),
      productionEntrypoint: PRODUCTION_ENTRYPOINT,
      authorizationScope: "ui_capability_binding_only"
    },
    summary: {
      registeredActionCount: manifestActions.length,
      pageActionCount: manifestActions.filter(
        (action) => action.usage === "page_action"
      ).length,
      backgroundActionCount: manifestActions.filter(
        (action) => action.usage === "background"
      ).length,
      reachableVueFileCount: [...reachable].filter((path) =>
        path.endsWith(".vue")
      ).length,
      routeRootCount: routeRoots.length,
      totalVueFileCount: sourceFiles.filter((path) =>
        path.endsWith(".vue")
      ).length,
      parsedVueFileCount: sourceFiles.filter(
        (path) => path.endsWith(".vue") && asts.has(path)
      ).length,
      reachableProductionModuleCount: reachable.size,
      templateEventDirectiveCount: new Set(
        templateActions
          .filter((action) => action.kind === "event")
          .map(
            (action) =>
              `${action.sourceFile}\u0000${action.sourceLine}\u0000${action.sourceColumn}\u0000${action.event}`
          )
      ).size,
      propCallbackDirectiveCount: new Set(
        templateActions
          .filter((action) => action.kind === "prop_callback")
          .map(
            (action) =>
              `${action.sourceFile}\u0000${action.sourceLine}\u0000${action.sourceColumn}\u0000${action.event}`
          )
      ).size,
      coveredProductionMutationConsumerCount:
        coveredConsumerPairs.size,
      candidateProductionMutationConsumerCount:
        candidateConsumerPairs.size,
      acceptedProductionMutationConsumerCount:
        coveredConsumerPairs.size,
      productionMutationConsumerPairCount:
        productionMutationConsumerPairs.size,
      blockerCount: totalBlockers
    },
    evidence: {
      totalProductionModuleCount: sourceFiles.length,
      reachableProductionModuleCount: reachable.size,
      totalVueFileCount: sourceFiles.filter((path) =>
        path.endsWith(".vue")
      ).length,
      parsedVueFileCount: sourceFiles.filter(
        (path) => path.endsWith(".vue") && asts.has(path)
      ).length
    },
    actions: manifestActions,
    blockers
  };
}

export function renderWholeSitePageActionManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeOrCheckWholeSitePageActionManifest({
  mode,
  targetPath,
  rendered
}) {
  if (!isNonEmptyString(targetPath) || typeof rendered !== "string") {
    throw manifestError("PAGE_ACTION_MANIFEST_OUTPUT_INVALID");
  }
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered);
    return;
  }
  if (mode !== "check") {
    throw manifestError("PAGE_ACTION_MANIFEST_INVALID_MODE");
  }
  let existing;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch {
    throw manifestError("PAGE_ACTION_MANIFEST_MISSING");
  }
  if (existing !== rendered) {
    throw manifestError("PAGE_ACTION_MANIFEST_DRIFT");
  }
}

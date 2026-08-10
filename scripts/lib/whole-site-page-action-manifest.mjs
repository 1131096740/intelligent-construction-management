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
const scopeManagersByAst = new WeakMap();

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
const CONTRACT_WORKBENCH_PAGE_PATH =
  `${WEB_SOURCE_ROOT}/pages/contracts/ContractWorkbenchPage.vue`;
const CONTRACT_DRAFT_COMPOSABLE_PATH =
  `${WEB_SOURCE_ROOT}/pages/contracts/workbench/use-contract-draft.ts`;
const CONTRACT_WORKBENCH_API_PATH =
  `${WEB_SOURCE_ROOT}/api/contract-workbench.api.ts`;
const PERMISSIONS_SOURCE_PATH =
  "packages/shared-domain/src/permissions.ts";
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
const WEB_RETURN_PROVENANCE = new Set([
  "transparent_main_response",
  "none",
  "unverified"
]);
const CAPABILITY_COLLECTION_CALLBACK_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some"
]);
const CAPABILITY_REFERENCE_DERIVING_METHODS = new Set([
  "at",
  "concat",
  "entries",
  "filter",
  "find",
  "findLast",
  "flat",
  "flatMap",
  "map",
  "next",
  "reduce",
  "reduceRight",
  "slice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "valueOf",
  "values",
  "with"
]);
const CAPABILITY_READONLY_METHODS = new Set([
  ...CAPABILITY_COLLECTION_CALLBACK_METHODS,
  ...CAPABILITY_REFERENCE_DERIVING_METHODS,
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "toLocaleString",
  "toString"
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
        !isNonEmptyString(wrapper.name) ||
        (wrapper.variant !== undefined &&
          !isNonEmptyString(wrapper.variant))
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
          name: wrapper.name,
          ...(wrapper.variant
            ? { variant: wrapper.variant }
            : {})
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
  let parsed;
  if (path.endsWith(".vue")) {
    parsed = vueParser.parseForESLint(source, {
      ...parserOptions(path),
      parser: typescriptParser
    });
  } else {
    parsed = typescriptParser.parseForESLint(
      source,
      parserOptions(path)
    );
  }
  if (parsed.scopeManager) {
    scopeManagersByAst.set(parsed.ast, parsed.scopeManager);
  }
  return parsed.ast;
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
  if (
    (typeof name === "string"
      ? !isNonEmptyString(name)
      : !name) ||
    !node
  ) {
    return;
  }
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
  const writes = new Map();
  const writesByBinding = new Map();
  const vueRefImports = new Set();
  const vueComputedImports = new Set();
  const scopeManager = scopeManagersByAst.get(ast) ?? null;
  const scopeBindings =
    scopeBindingsByIdentifier(scopeManager);
  const scopeReferenceIdentifiers =
    referenceIdentifiersByScope(scopeManager);
  for (const statement of ast?.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }
    const specifierText = literalString(statement.source);
    if (specifierText === "vue") {
      for (const specifier of statement.specifiers ?? []) {
        if (
          specifier.type !== "ImportSpecifier" ||
          specifier.importKind === "type" ||
          !specifier.local?.name
        ) {
          continue;
        }
        const importedName =
          specifier.imported?.type === "Identifier"
            ? specifier.imported.name
            : literalString(specifier.imported);
        if (["ref", "shallowRef"].includes(importedName)) {
          vueRefImports.add(specifier.local.name);
        }
        if (importedName === "computed") {
          vueComputedImports.add(specifier.local.name);
        }
      }
    }
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
  const recordWrite = (root, identifier, write) => {
    if (root) addIndexedNode(writes, root, write);
    const binding = identifier
      ? scopeBindings?.get(identifier)
      : null;
    if (binding) {
      addIndexedNode(writesByBinding, binding, write);
    }
  };
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
      return;
    }
    if (node.type === "AssignmentExpression") {
      const path =
        node.left?.type === "Identifier"
          ? node.left.name
          : memberExpressionWritePath(node.left);
      const root = path?.split(".")[0];
      if (root) {
        recordWrite(
          root,
          referenceRootIdentifier(node.left),
          {
          kind: "assignment",
          operator: node.operator,
          path,
          value: node.right
          }
        );
      }
      return;
    }
    if (node.type === "UpdateExpression") {
      const path =
        node.argument?.type === "Identifier"
          ? node.argument.name
          : memberExpressionWritePath(node.argument);
      const root = path?.split(".")[0];
      if (root) {
        recordWrite(
          root,
          referenceRootIdentifier(node.argument),
          {
          kind: "update",
          operator: node.operator,
          path,
          value: null
          }
        );
      }
      return;
    }
    if (
      node.type === "UnaryExpression" &&
      node.operator === "delete"
    ) {
      const path =
        node.argument?.type === "Identifier"
          ? node.argument.name
          : memberExpressionWritePath(node.argument);
      const root = path?.split(".")[0];
      if (root) {
        recordWrite(
          root,
          referenceRootIdentifier(node.argument),
          {
          kind: "delete",
          operator: "delete",
          path,
          value: null
          }
        );
      }
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
    ) {
      const calleePath = memberExpressionWritePath(node.callee);
      const mutationMethods = new Set([
        "copyWithin",
        "fill",
        "pop",
        "push",
        "reverse",
        "shift",
        "sort",
        "splice",
        "unshift"
      ]);
      const method = calleePath?.split(".").at(-1);
      if (method && mutationMethods.has(method)) {
        const targetPath = calleePath
          ?.split(".")
          .slice(0, -1)
          .join(".");
        const root = targetPath?.split(".")[0];
        if (root) {
          recordWrite(
            root,
            referenceRootIdentifier(
              node.callee.object
            ),
            {
              kind: "mutation_call",
              operator: method,
              path: targetPath,
              value: null
            }
          );
        }
      }
      if (
        calleePath === "Object.assign" &&
        node.arguments?.[0]
      ) {
        const targetPath = memberExpressionWritePath(
          node.arguments[0]
        );
        const root = targetPath?.split(".")[0];
        if (root) {
          recordWrite(
            root,
            referenceRootIdentifier(
              node.arguments[0]
            ),
            {
              kind: "mutation_call",
              operator: "Object.assign",
              path: targetPath,
              value: null
            }
          );
        }
      }
    }
  });
  const definitionsByBinding = new Map();
  const declarationsByBinding = new Map();
  if (scopeBindings) {
    walkEstree(ast, (node) => {
      if (
        node.type === "FunctionDeclaration" &&
        node.id?.type === "Identifier"
      ) {
        const binding = scopeBindings.get(node.id);
        if (binding) {
          addIndexedNode(
            definitionsByBinding,
            binding,
            node
          );
          addIndexedNode(
            declarationsByBinding,
            binding,
            node
          );
        }
        return;
      }
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        node.init
      ) {
        const binding = scopeBindings.get(node.id);
        if (!binding) return;
        addIndexedNode(
          declarationsByBinding,
          binding,
          node.init
        );
        if (
          [
            "ArrowFunctionExpression",
            "FunctionExpression"
          ].includes(node.init.type)
        ) {
          addIndexedNode(
            definitionsByBinding,
            binding,
            node.init
          );
        }
      }
    });
  }
  const importVariablesByName = new Map();
  const importsByBinding = new Map();
  for (const [localName, imported] of imports) {
    const bindings = topLevelScopeVariables(
      scopeManager,
      localName
    );
    if (bindings.length !== 1) continue;
    const binding = bindings[0];
    importVariablesByName.set(localName, binding);
    importsByBinding.set(binding, imported);
  }
  const vueRefImportBindings = new Set(
    Array.from(vueRefImports).flatMap((name) => {
      const bindings = topLevelScopeVariables(
        scopeManager,
        name
      );
      return bindings.length === 1 ? bindings : [];
    })
  );
  const vueComputedImportBindings = new Set(
    Array.from(vueComputedImports).flatMap((name) => {
      const bindings = topLevelScopeVariables(
        scopeManager,
        name
      );
      return bindings.length === 1 ? bindings : [];
    })
  );
  return {
    ast,
    definitions,
    definitionsByBinding,
    declarations,
    declarationsByBinding,
    imports,
    importsByBinding,
    importVariablesByName,
    scopeManager,
    scopeBindings,
    scopeReferenceIdentifiers,
    vueRefImports,
    vueRefImportBindings,
    vueComputedImports,
    vueComputedImportBindings,
    writes,
    writesByBinding
  };
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

function memberExpressionWritePath(node) {
  if (!node) return null;
  if (node.type === "ChainExpression") {
    return memberExpressionWritePath(node.expression);
  }
  if (node.type === "Identifier") return node.name;
  if (
    node.type !== "MemberExpression" ||
    (node.computed && literalString(node.property) === null)
  ) {
    return null;
  }
  const object = memberExpressionWritePath(node.object);
  const property = node.computed
    ? literalString(node.property)
    : node.property?.type === "Identifier"
      ? node.property.name
      : null;
  return object && property ? `${object}.${property}` : null;
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

function nodeIsInsideVueTemplate(node) {
  let current = node;
  while (current) {
    if (
      current.type === "VExpressionContainer" ||
      current.type === "VElement"
    ) {
      return true;
    }
    if (current.type === "Program") return false;
    current = current.parent;
  }
  return false;
}

function resolvedReferenceBinding(identifier, symbols) {
  if (identifier?.type !== "Identifier") return null;
  if (nodeIsInsideVueTemplate(identifier)) {
    const bindings = topLevelScopeVariables(
      symbols.scopeManager,
      identifier.name
    );
    return bindings.length === 1 ? bindings[0] : null;
  }
  if (
    !symbols.scopeReferenceIdentifiers?.has(identifier)
  ) {
    return null;
  }
  return symbols.scopeBindings?.get(identifier) ?? null;
}

function capabilityClosure(node, symbols) {
  const nodes = [];
  const seenBindings = new Set();
  const seenNodes = new Set();
  const pendingNodes = node ? [node] : [];
  while (pendingNodes.length && seenNodes.size < 128) {
    const current = pendingNodes.shift();
    if (!current || seenNodes.has(current)) continue;
    seenNodes.add(current);
    nodes.push(current);
    walkEstree(current, (candidate) => {
      if (candidate.type !== "Identifier") return;
      const binding = resolvedReferenceBinding(
        candidate,
        symbols
      );
      if (!binding || seenBindings.has(binding)) return;
      seenBindings.add(binding);
      const declaration = uniqueIndexedNode(
        symbols.declarationsByBinding,
        binding
      );
      if (declaration) pendingNodes.push(declaration);
    });
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

function capabilitySourceBindings(nodes, expected, symbols) {
  const normalizedExpected = normalizedExpression(expected);
  const bindings = new Set();
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      if (canonicalExpression(candidate) !== normalizedExpected) return;
      const root = referenceRootIdentifier(candidate);
      const binding = resolvedReferenceBinding(root, symbols);
      if (binding) bindings.add(binding);
    });
  }
  return bindings;
}

function closureHasLiteral(
  nodes,
  expected,
  literalBindings = new Map(),
  symbols = null
) {
  let found = false;
  for (const node of nodes) {
    walkEstree(node, (candidate) => {
      const binding =
        candidate.type === "Identifier"
          ? symbols?.scopeBindings?.get(candidate)
          : null;
      if (
        !found &&
        (literalString(candidate) === expected ||
          (binding &&
            literalBindings.get(binding) === expected))
      ) {
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
      "TSInstantiationExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
      "TSNonNullExpression"
    ].includes(current.type)
  ) {
    current = current.argument ?? current.expression;
  }
  return current;
}

function referenceRootIdentifier(node) {
  let current = unwrapValueExpression(node);
  while (current?.type === "MemberExpression") {
    current = unwrapValueExpression(current.object);
  }
  return current?.type === "Identifier" ? current : null;
}

function importedReadSource(node, sources, symbols) {
  const value = unwrapValueExpression(node);
  if (
    value?.type === "CallExpression" &&
    value.callee?.type === "Identifier"
  ) {
    const binding = symbols.scopeBindings?.get(
      value.callee
    );
    return binding ? sources.get(binding) ?? null : null;
  }
  return null;
}

function expressionIsEmptyCapabilityState(node) {
  const value = unwrapValueExpression(node);
  return (
    !value ||
    (value.type === "Literal" && value.value === null) ||
    (value.type === "Identifier" &&
      value.name === "undefined")
  );
}

function expressionIsEmptyVueRef(node, symbols) {
  const value = unwrapValueExpression(node);
  if (
    value?.type !== "CallExpression" ||
    value.callee?.type !== "Identifier"
  ) {
    return false;
  }
  const binding = symbols.scopeBindings?.get(
    value.callee
  );
  if (
    !binding ||
    !symbols.vueRefImportBindings?.has(binding)
  ) {
    return false;
  }
  return (
    (value.arguments ?? []).length === 0 ||
    (value.arguments ?? []).every((argument) =>
      expressionIsEmptyCapabilityState(argument)
    )
  );
}

function expressionServerReadSources(
  node,
  context,
  seen = new Set()
) {
  const value = unwrapValueExpression(node);
  if (!value) return null;
  const importedSource = importedReadSource(
    value,
    context.serverReadImports,
    context.symbols
  );
  if (importedSource) return new Set([importedSource]);
  if (value.type === "MemberExpression") {
    return expressionServerReadSources(
      value.object,
      context,
      seen
    );
  }
  if (value.type !== "Identifier") {
    return null;
  }
  const binding = context.symbols.scopeBindings?.get(value);
  if (!binding || seen.has(binding)) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(binding);
  const declaration = uniqueIndexedNode(
    context.symbols.declarationsByBinding,
    binding
  );
  const writes =
    context.symbols.writesByBinding.get(binding) ?? [];
  if (
    writes.some(
      (write) =>
        write.kind !== "assignment" ||
        write.operator !== "=" ||
        write.path !== value.name
    )
  ) {
    return null;
  }
  const candidates = [
    ...(declaration &&
    !expressionIsEmptyCapabilityState(declaration)
      ? [declaration]
      : []),
    ...writes
      .map((write) => write.value)
      .filter(
        (candidate) =>
          !expressionIsEmptyCapabilityState(candidate)
      )
  ];
  if (candidates.length === 0) return null;
  const sources = new Set();
  for (const candidate of candidates) {
    const candidateSources = expressionServerReadSources(
      candidate,
      context,
      nextSeen
    );
    if (!candidateSources) return null;
    for (const source of candidateSources) sources.add(source);
  }
  return sources.size > 0 ? sources : null;
}

function scopeBindingsByIdentifier(scopeManager) {
  if (!scopeManager) return null;
  const bindings = new WeakMap();
  for (const scope of scopeManager.scopes ?? []) {
    for (const variable of scope.variables ?? []) {
      for (const identifier of variable.identifiers ?? []) {
        bindings.set(identifier, variable);
      }
      for (const reference of variable.references ?? []) {
        if (reference.identifier) {
          bindings.set(reference.identifier, variable);
        }
      }
    }
  }
  return bindings;
}

function referenceIdentifiersByScope(scopeManager) {
  const identifiers = new WeakSet();
  for (const scope of scopeManager?.scopes ?? []) {
    for (const variable of scope.variables ?? []) {
      for (const reference of variable.references ?? []) {
        if (reference.identifier) {
          identifiers.add(reference.identifier);
        }
      }
    }
    for (const reference of scope.through ?? []) {
      if (reference.identifier) {
        identifiers.add(reference.identifier);
      }
    }
  }
  return identifiers;
}

function uniqueScopeVariable(scopeManager, name) {
  const candidates = (scopeManager?.scopes ?? [])
    .flatMap((scope) => scope.variables ?? [])
    .filter(
      (variable) =>
        variable.name === name &&
        (variable.identifiers ?? []).length > 0
    );
  return candidates.length === 1 ? candidates[0] : null;
}

function topLevelScopeVariables(scopeManager, name) {
  const scopes = (scopeManager?.scopes ?? []).filter(
    (scope) =>
      scope.type === "module" &&
      scope.block?.type === "Program"
  );
  const candidateScopes =
    scopes.length > 0
      ? scopes
      : (scopeManager?.scopes ?? []).filter(
          (scope) =>
            scope.type === "global" &&
            scope.block?.type === "Program"
        );
  return candidateScopes
    .flatMap((scope) => scope.variables ?? [])
    .filter(
      (variable) =>
        variable.name === name &&
        (variable.identifiers ?? []).length > 0
    );
}

const PROTECTED_RUNTIME_GLOBALS = new Set([
  "globalThis",
  "self",
  "window"
]);
const PROTECTED_RUNTIME_CONSTRUCTORS = new Set([
  "Array",
  "Boolean",
  "Date",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "WeakMap",
  "WeakSet"
]);
const RUNTIME_TARGET_MUTATORS = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "deleteProperty",
  "set",
  "setPrototypeOf"
]);
const RUNTIME_INTRINSIC_CALLBACK_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "some"
]);
const RUNTIME_INTRINSIC_CALLBACK_CONSTRUCTORS = new Set([
  "constructor:Boolean",
  "constructor:Number",
  "constructor:String"
]);

function unshadowedRuntimeGlobal(
  identifier,
  names,
  scopeBindings
) {
  if (
    identifier?.type !== "Identifier" ||
    !names.has(identifier.name)
  ) {
    return false;
  }
  const binding = scopeBindings?.get(identifier);
  return (
    !binding ||
    (binding.identifiers ?? []).length === 0
  );
}

function runtimeIntrinsicIntegrityIssue(
  ast,
  {
    sourcePath = null,
    sourceFiles = null,
    asts = null
  } = {}
) {
  const scopeManager = scopeManagersByAst.get(ast) ?? null;
  const scopeBindings =
    scopeBindingsByIdentifier(scopeManager);
  if (!scopeBindings) return ast;
  const summaries = new Map();
  const targetSummary = (target) => ({
    kind: "target",
    target
  });
  const mutatorSummary = (method) => ({
    kind: "mutator",
    method
  });
  const unknownAuthoritySummary = () => ({
    kind: "unknown_authority"
  });
  const objectSummary = (fields = new Map()) => ({
    kind: "object",
    fields
  });
  const helperSummary = (indexes) => ({
    kind: "helper",
    indexes
  });
  const parameterSummary = (indexes) => ({
    kind: "parameter",
    indexes
  });
  const callableSummary = (descriptor) => ({
    kind: "callable",
    descriptor
  });
  const dynamicCodeSummary = (source) => ({
    kind: "dynamic_code",
    source
  });
  const stringCodeSchedulerSummary = (source) => ({
    kind: "string_code_scheduler",
    source
  });
  const summaryHasRuntimeAuthority = (
    summary,
    seen = new Set()
  ) => {
    if (!summary || seen.has(summary)) return false;
    if (
      [
        "target",
        "mutator",
        "helper",
        "dynamic_code",
        "string_code_scheduler",
        "unknown_authority",
        "parameter"
      ].includes(
        summary.kind
      )
    ) {
      return true;
    }
    if (summary.kind !== "object") return false;
    seen.add(summary);
    return [...summary.fields.values()].some((child) =>
      summaryHasRuntimeAuthority(child, seen)
    );
  };
  const runtimeProperty = (node) => {
    const property = staticMemberProperty(node);
    if (property !== null) return property;
    const value =
      node?.computed && node.property?.type === "Literal"
        ? node.property.value
        : null;
    return typeof value === "number" &&
      Number.isFinite(value)
      ? String(value)
      : null;
  };
  const summaryField = (summary, property) => {
    if (!summary) return null;
    if (property === null) {
      return summaryHasRuntimeAuthority(summary)
        ? unknownAuthoritySummary()
        : null;
    }
    if (
      summary.kind === "target" &&
      ["constructor:Object", "constructor:Reflect"].includes(
        summary.target
      ) &&
      RUNTIME_TARGET_MUTATORS.has(property)
    ) {
      return mutatorSummary(property);
    }
    if (
      summary.kind === "target" &&
      summary.target === "global" &&
      ["eval", "Function"].includes(property)
    ) {
      return dynamicCodeSummary(property);
    }
    if (
      summary.kind === "target" &&
      summary.target === "global" &&
      ["setInterval", "setTimeout"].includes(property)
    ) {
      return stringCodeSchedulerSummary(property);
    }
    if (
      summary.kind === "target" &&
      summary.target === "global" &&
      PROTECTED_RUNTIME_CONSTRUCTORS.has(property)
    ) {
      return targetSummary(`constructor:${property}`);
    }
    if (
      summary.kind === "dynamic_code" &&
      ["apply", "bind", "call", "constructor"].includes(
        property
      )
    ) {
      return summary;
    }
    if (
      summary.kind === "string_code_scheduler" &&
      ["apply", "bind", "call"].includes(property)
    ) {
      return summary;
    }
    if (property === "constructor") {
      return dynamicCodeSummary("constructor");
    }
    if (
      summary.kind === "target" &&
      summary.target.startsWith("constructor:") &&
      property === "prototype"
    ) {
      return targetSummary("prototype");
    }
    if (summary.kind === "parameter") {
      return summary;
    }
    return summary.kind === "object"
      ? summary.fields.get(property) ?? null
      : null;
  };
  const descriptorContexts = new WeakMap();
  const descriptorContext = (targetAst) => {
    if (!targetAst) return null;
    const cached = descriptorContexts.get(targetAst);
    if (cached) return cached;
    const targetScopeManager =
      scopeManagersByAst.get(targetAst) ?? null;
    const targetBindings =
      scopeBindingsByIdentifier(targetScopeManager);
    const context = {
      ast: targetAst,
      bindings: targetBindings,
      definitionsByBinding: new Map(),
      initializersByBinding: new Map(),
      descriptorByDefinition: new WeakMap(),
      activeDefinitions: new WeakSet(),
      activeDescriptorByDefinition: new WeakMap()
    };
    descriptorContexts.set(targetAst, context);
    if (!targetBindings) return context;
    walkEstree(targetAst, (node) => {
      if (
        node.type === "FunctionDeclaration" &&
        node.id?.type === "Identifier"
      ) {
        const binding = targetBindings.get(node.id);
        if (binding) {
          context.definitionsByBinding.set(binding, node);
        }
        return;
      }
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        node.init
      ) {
        const binding = targetBindings.get(node.id);
        if (!binding) return;
        context.initializersByBinding.set(
          binding,
          node.init
        );
        if (
          [
            "ArrowFunctionExpression",
            "FunctionExpression"
          ].includes(node.init.type)
        ) {
          context.definitionsByBinding.set(
            binding,
            node.init
          );
        }
      }
    });
    return context;
  };
  const descriptorParameterIndexes = (
    summary,
    seen = new Set()
  ) => {
    if (!summary || seen.has(summary)) return new Set();
    if (summary.kind === "parameter") {
      return new Set(summary.indexes);
    }
    if (summary.kind !== "object") return new Set();
    seen.add(summary);
    return new Set(
      [...summary.fields.values()].flatMap((child) => [
        ...descriptorParameterIndexes(child, seen)
      ])
    );
  };
  const descriptorHasFixedRuntimeAuthority = (
    summary,
    seen = new Set()
  ) => {
    if (!summary || seen.has(summary)) return false;
    if (
      [
        "target",
        "mutator",
        "helper",
        "dynamic_code",
        "string_code_scheduler",
        "unknown_authority"
      ].includes(summary.kind)
    ) {
      return true;
    }
    if (summary.kind !== "object") return false;
    seen.add(summary);
    return [...summary.fields.values()].some((child) =>
      descriptorHasFixedRuntimeAuthority(child, seen)
    );
  };
  const mergeDescriptorSummaries = (values) => {
    const summariesToMerge = values.filter(Boolean);
    if (summariesToMerge.length === 0) return null;
    if (summariesToMerge.length === 1) {
      return summariesToMerge[0];
    }
    if (
      summariesToMerge.some((summary) =>
        descriptorHasFixedRuntimeAuthority(summary)
      )
    ) {
      return unknownAuthoritySummary();
    }
    const parameterIndexes = new Set(
      summariesToMerge.flatMap((summary) => [
        ...descriptorParameterIndexes(summary)
      ])
    );
    if (parameterIndexes.size > 0) {
      return parameterSummary(
        parameterIndexes
      );
    }
    return null;
  };
  const substituteDescriptorSummary = (
    summary,
    argumentsForCall,
    evaluateArgument
  ) => {
    if (!summary) return null;
    if (summary.kind === "parameter") {
      return mergeDescriptorSummaries(
        [...summary.indexes].map((index) =>
          evaluateArgument(argumentsForCall?.[index])
        )
      );
    }
    if (summary.kind === "object") {
      const fields = new Map();
      for (const [key, value] of summary.fields) {
        const substituted = substituteDescriptorSummary(
          value,
          argumentsForCall,
          evaluateArgument
        );
        if (substituted) fields.set(key, substituted);
      }
      return objectSummary(fields);
    }
    return summary;
  };
  let descriptorExpressionSummary;
  const callableDescriptors = new Set();
  const propagateStringCodeParameters = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const descriptor of callableDescriptors) {
        for (const dependency of
          descriptor.stringCodeDependencies ?? []) {
          for (const calleeIndex of
            dependency.calleeDescriptor
              ?.stringCodeParameterIndexes ?? []) {
            for (const callerIndex of
              dependency.argumentParameterIndexes[
                calleeIndex
              ] ?? []) {
              if (
                descriptor.stringCodeParameterIndexes.has(
                  callerIndex
                )
              ) {
                continue;
              }
              descriptor.stringCodeParameterIndexes.add(
                callerIndex
              );
              changed = true;
            }
          }
        }
      }
    }
  };
  const callableDescriptor = (targetAst, definition) => {
    const context = descriptorContext(targetAst);
    if (!context || !definition) return null;
    const cached =
      context.descriptorByDefinition.get(definition);
    if (cached) return cached;
    if (context.activeDefinitions.has(definition)) {
      const activeDescriptor =
        context.activeDescriptorByDefinition.get(
          definition
        );
      return {
        result: parameterSummary(
          new Set(
            (definition.params ?? []).map(
              (_parameter, index) => index
            )
          )
        ),
        stringCodeParameterIndexes:
          activeDescriptor?.stringCodeParameterIndexes ??
          new Set()
      };
    }
    context.activeDefinitions.add(definition);
    const descriptor = {
      result: null,
      stringCodeParameterIndexes: new Set(),
      stringCodeDependencies: []
    };
    callableDescriptors.add(descriptor);
    context.activeDescriptorByDefinition.set(
      definition,
      descriptor
    );
    const parameterSummaries = new Map();
    for (
      let index = 0;
      index < (definition.params ?? []).length;
      index += 1
    ) {
      const parameter = unwrapValueExpression(
        definition.params[index]
      );
      if (parameter?.type !== "Identifier") continue;
      const binding = context.bindings?.get(parameter);
      if (binding) {
        parameterSummaries.set(
          binding,
          parameterSummary(new Set([index]))
        );
      }
    }
    const stringCodeParameterIndexes =
      descriptor.stringCodeParameterIndexes;
    const rememberStringCodeParameters = (summary) => {
      for (const index of descriptorParameterIndexes(summary)) {
        stringCodeParameterIndexes.add(index);
      }
    };
    const visitStringCodeCalls = (
      candidate,
      root = false
    ) => {
      if (!candidate || typeof candidate.type !== "string") {
        return;
      }
      if (
        !root &&
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression"
        ].includes(candidate.type)
      ) {
        return;
      }
      if (candidate.type === "CallExpression") {
        const calleeSummary = descriptorExpressionSummary(
          targetAst,
          candidate.callee,
          parameterSummaries,
          new Set()
        );
        if (
          calleeSummary?.kind === "string_code_scheduler"
        ) {
          const callee = unwrapValueExpression(
            candidate.callee
          );
          const adapter =
            callee?.type === "MemberExpression"
              ? runtimeProperty(callee)
              : null;
          let callback = candidate.arguments?.[0] ?? null;
          if (adapter === "call" || adapter === "bind") {
            callback = candidate.arguments?.[1] ?? null;
          } else if (adapter === "apply") {
            const applied = unwrapValueExpression(
              candidate.arguments?.[1]
            );
            callback =
              applied?.type === "ArrayExpression"
                ? applied.elements?.[0] ?? null
                : null;
          }
          rememberStringCodeParameters(
            descriptorExpressionSummary(
              targetAst,
              callback,
              parameterSummaries,
              new Set()
            )
          );
        } else if (calleeSummary?.kind === "callable") {
          descriptor.stringCodeDependencies.push({
            calleeDescriptor: calleeSummary.descriptor,
            argumentParameterIndexes: (
              candidate.arguments ?? []
            ).map(
              (argument) =>
                new Set(
                  descriptorParameterIndexes(
                    descriptorExpressionSummary(
                      targetAst,
                      argument,
                      parameterSummaries,
                      new Set()
                    )
                  )
                )
            )
          });
          for (const index of
            calleeSummary.descriptor
              ?.stringCodeParameterIndexes ?? []) {
            rememberStringCodeParameters(
              descriptorExpressionSummary(
                targetAst,
                candidate.arguments?.[index],
                parameterSummaries,
                new Set()
              )
            );
          }
        }
      }
      for (const [key, child] of Object.entries(candidate)) {
        if (
          [
            "comments",
            "loc",
            "parent",
            "range",
            "tokens"
          ].includes(key)
        ) {
          continue;
        }
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry && typeof entry.type === "string") {
              visitStringCodeCalls(entry);
            }
          }
        } else if (child && typeof child.type === "string") {
          visitStringCodeCalls(child);
        }
      }
    };
    visitStringCodeCalls(definition.body, true);
    const returnExpressions =
      definition.body?.type === "BlockStatement"
        ? directCallableReturnStatements(definition).map(
            (statement) => statement.argument
          )
        : [definition.body];
    descriptor.result = mergeDescriptorSummaries(
      returnExpressions.map((expression) =>
        descriptorExpressionSummary(
          targetAst,
          expression,
          parameterSummaries,
          new Set()
        )
      )
    );
    context.activeDefinitions.delete(definition);
    context.activeDescriptorByDefinition.delete(
      definition
    );
    context.descriptorByDefinition.set(
      definition,
      descriptor
    );
    propagateStringCodeParameters();
    return descriptor;
  };
  descriptorExpressionSummary = (
    targetAst,
    node,
    parameterSummaries = new Map(),
    seenBindings = new Set()
  ) => {
    const value = unwrapValueExpression(node);
    if (!value) return null;
    const context = descriptorContext(targetAst);
    const targetBindings = context?.bindings;
    if (value.type === "Identifier") {
      const binding = targetBindings?.get(value);
      if (binding && parameterSummaries.has(binding)) {
        return parameterSummaries.get(binding);
      }
      if (
        binding &&
        context.definitionsByBinding.has(binding)
      ) {
        return callableSummary(
          callableDescriptor(
            targetAst,
            context.definitionsByBinding.get(binding)
          )
        );
      }
      if (
        binding &&
        context.initializersByBinding.has(binding) &&
        !seenBindings.has(binding)
      ) {
        const nextSeen = new Set(seenBindings);
        nextSeen.add(binding);
        return descriptorExpressionSummary(
          targetAst,
          context.initializersByBinding.get(binding),
          parameterSummaries,
          nextSeen
        );
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          PROTECTED_RUNTIME_GLOBALS,
          targetBindings
        )
      ) {
        return targetSummary("global");
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          new Set(["eval", "Function"]),
          targetBindings
        )
      ) {
        return dynamicCodeSummary(value.name);
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          new Set(["setInterval", "setTimeout"]),
          targetBindings
        )
      ) {
        return stringCodeSchedulerSummary(value.name);
      }
      return unshadowedRuntimeGlobal(
        value,
        PROTECTED_RUNTIME_CONSTRUCTORS,
        targetBindings
      )
        ? targetSummary(`constructor:${value.name}`)
        : null;
    }
    if (
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(value.type)
    ) {
      return callableSummary(
        callableDescriptor(targetAst, value)
      );
    }
    if (value.type === "SequenceExpression") {
      return descriptorExpressionSummary(
        targetAst,
        value.expressions?.at(-1),
        parameterSummaries,
        seenBindings
      );
    }
    if (
      value.type === "ConditionalExpression" ||
      value.type === "LogicalExpression"
    ) {
      const branches =
        value.type === "ConditionalExpression"
          ? [value.consequent, value.alternate]
          : [value.left, value.right];
      return mergeDescriptorSummaries(
        branches.map((branch) =>
          descriptorExpressionSummary(
            targetAst,
            branch,
            parameterSummaries,
            seenBindings
          )
        )
      );
    }
    if (value.type === "MemberExpression") {
      if (runtimeProperty(value) === "constructor") {
        return dynamicCodeSummary("constructor");
      }
      return summaryField(
        descriptorExpressionSummary(
          targetAst,
          value.object,
          parameterSummaries,
          seenBindings
        ),
        runtimeProperty(value)
      );
    }
    if (value.type === "ObjectExpression") {
      const fields = new Map();
      for (const property of value.properties ?? []) {
        if (property.type === "SpreadElement") {
          const spread = descriptorExpressionSummary(
            targetAst,
            property.argument,
            parameterSummaries,
            seenBindings
          );
          if (spread?.kind !== "object") return null;
          for (const [key, summary] of spread.fields) {
            fields.set(key, summary);
          }
          continue;
        }
        if (
          property.type !== "Property" ||
          property.kind !== "init"
        ) {
          return null;
        }
        const key = property.computed
          ? property.key?.type === "Literal" &&
              typeof property.key.value === "number"
            ? String(property.key.value)
            : literalString(property.key)
          : property.key?.type === "Identifier"
            ? property.key.name
            : literalString(property.key);
        if (key === null) return null;
        const summary = descriptorExpressionSummary(
          targetAst,
          property.value,
          parameterSummaries,
          seenBindings
        );
        if (summary) fields.set(key, summary);
      }
      return objectSummary(fields);
    }
    if (value.type === "ArrayExpression") {
      const fields = new Map();
      for (
        let index = 0;
        index < (value.elements ?? []).length;
        index += 1
      ) {
        const element = value.elements[index];
        if (!element || element.type === "SpreadElement") {
          return null;
        }
        const summary = descriptorExpressionSummary(
          targetAst,
          element,
          parameterSummaries,
          seenBindings
        );
        if (summary) fields.set(String(index), summary);
      }
      return objectSummary(fields);
    }
    if (value.type === "TaggedTemplateExpression") {
      const tag = descriptorExpressionSummary(
        targetAst,
        value.tag,
        parameterSummaries,
        seenBindings
      );
      return tag?.kind === "dynamic_code" ? tag : null;
    }
    if (
      value.type === "CallExpression" ||
      value.type === "NewExpression"
    ) {
      const constructor = descriptorExpressionSummary(
        targetAst,
        value.callee,
        parameterSummaries,
        seenBindings
      );
      const target = descriptorExpressionSummary(
        targetAst,
        value.arguments?.[0],
        parameterSummaries,
        seenBindings
      );
      if (
        constructor?.kind === "target" &&
        constructor.target === "constructor:Proxy" &&
        summaryHasRuntimeAuthority(target)
      ) {
        return target;
      }
      if (
        value.type === "CallExpression" &&
        value.callee?.type === "MemberExpression"
      ) {
        const owner = descriptorExpressionSummary(
          targetAst,
          value.callee.object,
          parameterSummaries,
          seenBindings
        );
        const method = runtimeProperty(value.callee);
        if (
          owner?.kind === "target" &&
          owner.target === "constructor:Proxy" &&
          method === "revocable"
        ) {
          return summaryHasRuntimeAuthority(target)
            ? objectSummary(
                new Map([["proxy", target]])
              )
            : null;
        }
        if (
          owner?.kind === "target" &&
          owner.target === "constructor:Reflect" &&
          method === "construct"
        ) {
          const proxyConstructor =
            descriptorExpressionSummary(
              targetAst,
              value.arguments?.[0],
              parameterSummaries,
              seenBindings
            );
          const argumentsList = unwrapValueExpression(
            value.arguments?.[1]
          );
          const proxiedTarget =
            argumentsList?.type === "ArrayExpression"
              ? descriptorExpressionSummary(
                  targetAst,
                  argumentsList.elements?.[0],
                  parameterSummaries,
                  seenBindings
                )
              : null;
          if (
            proxyConstructor?.kind === "target" &&
            proxyConstructor.target ===
              "constructor:Proxy" &&
            summaryHasRuntimeAuthority(proxiedTarget)
          ) {
            return proxiedTarget;
          }
        }
      }
      if (constructor?.kind === "dynamic_code") {
        return constructor;
      }
      if (constructor?.kind === "callable") {
        return substituteDescriptorSummary(
          constructor.descriptor?.result,
          value.arguments,
          (argument) =>
            descriptorExpressionSummary(
              targetAst,
              argument,
              parameterSummaries,
              seenBindings
            )
        );
      }
    }
    return null;
  };
  const typeAnnotationProvesCallable = (identifier) => {
    let annotation =
      identifier?.typeAnnotation?.typeAnnotation ?? null;
    while (annotation?.type === "TSParenthesizedType") {
      annotation = annotation.typeAnnotation;
    }
    return annotation?.type === "TSFunctionType";
  };
  const bindingIsPromiseExecutorParameter = (
    binding,
    targetBindings
  ) =>
    (binding?.identifiers ?? []).some((identifier) => {
      const callable = identifier.parent;
      if (
        ![
          "ArrowFunctionExpression",
          "FunctionExpression"
        ].includes(callable?.type)
      ) {
        return false;
      }
      const parameterIndex = (callable.params ?? []).findIndex(
        (parameter) =>
          unwrapValueExpression(parameter) === identifier
      );
      if (parameterIndex < 0 || parameterIndex > 1) {
        return false;
      }
      const invocation = callable.parent;
      return (
        invocation?.type === "NewExpression" &&
        invocation.arguments?.[0] === callable &&
        unshadowedRuntimeGlobal(
          unwrapValueExpression(invocation.callee),
          new Set(["Promise"]),
          targetBindings
        )
      );
    });
  const bindingHasPostInitializationWrite = (binding) =>
    (binding?.references ?? []).some(
      (reference) =>
        typeof reference.isWrite === "function" &&
        reference.isWrite() &&
        reference.init !== true
    );
  const staticallyProvenCallable = (
    node,
    targetAst = ast,
    seenBindings = new Set()
  ) => {
    const value = unwrapValueExpression(node);
    if (!value) return false;
    if (
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(value.type)
    ) {
      return true;
    }
    if (value.type === "SequenceExpression") {
      return staticallyProvenCallable(
        value.expressions?.at(-1),
        targetAst,
        seenBindings
      );
    }
    if (
      value.type === "ConditionalExpression" ||
      value.type === "LogicalExpression"
    ) {
      const branches =
        value.type === "ConditionalExpression"
          ? [value.consequent, value.alternate]
          : [value.left, value.right];
      return branches.every((branch) =>
        staticallyProvenCallable(
          branch,
          targetAst,
          seenBindings
        )
      );
    }
    const context = descriptorContext(targetAst);
    if (value.type === "Identifier") {
      const binding = context?.bindings?.get(value);
      if (bindingHasPostInitializationWrite(binding)) {
        return false;
      }
      if (
        typeAnnotationProvesCallable(value) ||
        (binding?.identifiers ?? []).some(
          typeAnnotationProvesCallable
        ) ||
        bindingIsPromiseExecutorParameter(
          binding,
          context?.bindings
        )
      ) {
        return true;
      }
      if (!binding || seenBindings.has(binding)) {
        return false;
      }
      if (context.definitionsByBinding.has(binding)) {
        return true;
      }
      const initializer =
        context.initializersByBinding.get(binding);
      if (!initializer) return false;
      const nextSeen = new Set(seenBindings);
      nextSeen.add(binding);
      return staticallyProvenCallable(
        initializer,
        targetAst,
        nextSeen
      );
    }
    return (
      descriptorExpressionSummary(
        targetAst,
        value,
        new Map(),
        seenBindings
      )?.kind === "callable"
    );
  };
  const exportedCallableDefinition = (
    targetAst,
    exportedName
  ) => {
    const context = descriptorContext(targetAst);
    if (!context) return null;
    for (const statement of targetAst.body ?? []) {
      if (
        statement.type === "ExportDefaultDeclaration" &&
        exportedName === "default"
      ) {
        const declaration = statement.declaration;
        if (
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression"
          ].includes(declaration?.type)
        ) {
          return declaration;
        }
        if (declaration?.type === "Identifier") {
          const binding = context.bindings?.get(declaration);
          return (
            context.definitionsByBinding.get(binding) ?? null
          );
        }
      }
      if (statement.type !== "ExportNamedDeclaration") {
        continue;
      }
      const declaration = statement.declaration;
      if (
        declaration?.type === "FunctionDeclaration" &&
        declaration.id?.name === exportedName
      ) {
        return declaration;
      }
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations ?? []) {
          if (
            declarator.id?.type === "Identifier" &&
            declarator.id.name === exportedName &&
            [
              "ArrowFunctionExpression",
              "FunctionExpression"
            ].includes(declarator.init?.type)
          ) {
            return declarator.init;
          }
        }
      }
      for (const specifier of statement.specifiers ?? []) {
        const exported =
          specifier.exported?.type === "Identifier"
            ? specifier.exported.name
            : literalString(specifier.exported);
        if (
          exported !== exportedName ||
          specifier.local?.type !== "Identifier"
        ) {
          continue;
        }
        const binding = context.bindings?.get(
          specifier.local
        );
        const definition =
          context.definitionsByBinding.get(binding);
        if (definition) return definition;
      }
    }
    return null;
  };
  const exportedValueExpression = (
    targetAst,
    exportedName
  ) => {
    const context = descriptorContext(targetAst);
    if (!context) return null;
    for (const statement of targetAst.body ?? []) {
      if (
        statement.type === "ExportDefaultDeclaration" &&
        exportedName === "default"
      ) {
        const declaration = statement.declaration;
        if (declaration?.type !== "Identifier") {
          return declaration ?? null;
        }
        const binding = context.bindings?.get(declaration);
        return (
          context.initializersByBinding.get(binding) ??
          declaration
        );
      }
      if (statement.type !== "ExportNamedDeclaration") {
        continue;
      }
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations ?? []) {
          if (
            declarator.id?.type === "Identifier" &&
            declarator.id.name === exportedName
          ) {
            return declarator.init ?? null;
          }
        }
      }
      for (const specifier of statement.specifiers ?? []) {
        const exported =
          specifier.exported?.type === "Identifier"
            ? specifier.exported.name
            : literalString(specifier.exported);
        if (
          exported !== exportedName ||
          specifier.local?.type !== "Identifier"
        ) {
          continue;
        }
        const binding = context.bindings?.get(
          specifier.local
        );
        return (
          context.initializersByBinding.get(binding) ??
          specifier.local
        );
      }
    }
    return null;
  };
  const runtimeSymbols =
    sourcePath && sourceFiles
      ? buildSymbolContext(ast, sourcePath, sourceFiles)
      : null;
  const importedCallableSummary = (node) => {
    const value = unwrapValueExpression(node);
    if (!value || !runtimeSymbols || !asts) return null;
    let imported = null;
    let exportedName = null;
    if (value.type === "Identifier") {
      const binding = scopeBindings.get(value);
      imported =
        runtimeSymbols.importsByBinding?.get(binding) ?? null;
      if (imported && imported.kind !== "namespace") {
        exportedName = imported.importedName;
      }
    } else if (
      value.type === "MemberExpression" &&
      value.object?.type === "Identifier"
    ) {
      const binding = scopeBindings.get(value.object);
      imported =
        runtimeSymbols.importsByBinding?.get(binding) ?? null;
      if (imported?.kind === "namespace") {
        exportedName = runtimeProperty(value);
      }
    }
    if (!imported || !exportedName) return null;
    const targetAst = asts.get(imported.sourceFile);
    const definition = exportedCallableDefinition(
      targetAst,
      exportedName
    );
    if (definition) {
      return callableSummary(
        callableDescriptor(targetAst, definition)
      );
    }
    const expression = exportedValueExpression(
      targetAst,
      exportedName
    );
    return expression
      ? descriptorExpressionSummary(targetAst, expression)
      : null;
  };
  const helperTargetParametersByDefinition = new WeakMap();
  const summarize = (node, seenBindings = new Set()) => {
    const value = unwrapValueExpression(node);
    if (!value) return null;
    if (value.type === "Identifier") {
      const binding = scopeBindings.get(value);
      if (binding && summaries.has(binding)) {
        return summaries.get(binding);
      }
      const imported = importedCallableSummary(value);
      if (imported) return imported;
      const definition =
        descriptorContext(ast)?.definitionsByBinding.get(
          binding
        );
      if (definition) {
        return callableSummary(
          callableDescriptor(ast, definition)
        );
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          PROTECTED_RUNTIME_GLOBALS,
          scopeBindings
        )
      ) {
        return targetSummary("global");
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          new Set(["eval", "Function"]),
          scopeBindings
        )
      ) {
        return dynamicCodeSummary(value.name);
      }
      if (
        unshadowedRuntimeGlobal(
          value,
          new Set(["setInterval", "setTimeout"]),
          scopeBindings
        )
      ) {
        return stringCodeSchedulerSummary(value.name);
      }
      return unshadowedRuntimeGlobal(
        value,
        PROTECTED_RUNTIME_CONSTRUCTORS,
        scopeBindings
      )
        ? targetSummary(`constructor:${value.name}`)
        : null;
    }
    if (
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(value.type)
    ) {
      return callableSummary(
        callableDescriptor(ast, value)
      );
    }
    if (
      value.type === "SequenceExpression"
    ) {
      return summarize(
        value.expressions?.at(-1),
        seenBindings
      );
    }
    if (
      value.type === "ConditionalExpression" ||
      value.type === "LogicalExpression"
    ) {
      const branches =
        value.type === "ConditionalExpression"
          ? [value.consequent, value.alternate]
          : [value.left, value.right];
      const branchSummaries = branches
        .map((branch) => summarize(branch, seenBindings))
        .filter(Boolean);
      const protectedTarget = branchSummaries.find(
        (summary) => summary.kind === "target"
      );
      if (protectedTarget) return protectedTarget;
      const dynamicCode = branchSummaries.find(
        (summary) => summary.kind === "dynamic_code"
      );
      if (dynamicCode) return dynamicCode;
      const stringCodeScheduler = branchSummaries.find(
        (summary) =>
          summary.kind === "string_code_scheduler"
      );
      if (stringCodeScheduler) {
        return stringCodeScheduler;
      }
      const first = branchSummaries[0] ?? null;
      return branchSummaries.length === 2 &&
        first?.kind === "mutator" &&
        branchSummaries[1]?.kind === "mutator" &&
        first.method === branchSummaries[1].method
        ? first
        : null;
    }
    if (value.type === "MemberExpression") {
      const imported = importedCallableSummary(value);
      if (imported) return imported;
      if (runtimeProperty(value) === "constructor") {
        return dynamicCodeSummary("constructor");
      }
      return summaryField(
        summarize(value.object, seenBindings),
        runtimeProperty(value)
      );
    }
    if (
      value.type === "CallExpression" &&
      value.callee?.type === "MemberExpression"
    ) {
      const owner = summarize(
        value.callee.object,
        seenBindings
      );
      const method = runtimeProperty(value.callee);
      if (
        owner?.kind === "target" &&
        owner.target === "constructor:Proxy" &&
        method === "revocable"
      ) {
        const target = summarize(
          value.arguments?.[0],
          seenBindings
        );
        return target?.kind === "target"
          ? objectSummary(new Map([["proxy", target]]))
          : null;
      }
      if (
        owner?.kind === "target" &&
        owner.target === "constructor:Reflect" &&
        method === "construct"
      ) {
        const constructor = summarize(
          value.arguments?.[0],
          seenBindings
        );
        const argumentsList = unwrapValueExpression(
          value.arguments?.[1]
        );
        const target =
          argumentsList?.type === "ArrayExpression"
            ? summarize(
                argumentsList.elements?.[0],
                seenBindings
              )
            : null;
        return constructor?.kind === "target" &&
          constructor.target === "constructor:Proxy" &&
          target?.kind === "target"
          ? target
          : null;
      }
    }
    if (
      value.type === "CallExpression" &&
      value.callee?.type === "MemberExpression" &&
      runtimeProperty(value.callee) === "bind"
    ) {
      const bound = summarize(
        value.callee.object,
        seenBindings
      );
      return bound?.kind === "mutator" ||
        bound?.kind === "dynamic_code" ||
        bound?.kind === "string_code_scheduler" ||
        (bound?.kind === "target" &&
          bound.target === "constructor:Proxy")
        ? bound
        : null;
    }
    if (value.type === "CallExpression") {
      const constructor = summarize(
        value.callee,
        seenBindings
      );
      const target = summarize(
        value.arguments?.[0],
        seenBindings
      );
      if (
        constructor?.kind === "target" &&
        constructor.target === "constructor:Proxy" &&
        target?.kind === "target"
      ) {
        return target;
      }
      if (constructor?.kind === "dynamic_code") {
        return constructor;
      }
      if (constructor?.kind === "callable") {
        return substituteDescriptorSummary(
          constructor.descriptor?.result,
          value.arguments,
          (argument) =>
            summarize(argument, seenBindings)
        );
      }
    }
    if (
      value.type === "NewExpression"
    ) {
      const constructor = summarize(
        value.callee,
        seenBindings
      );
      const target = summarize(
        value.arguments?.[0],
        seenBindings
      );
      return constructor?.kind === "target" &&
        constructor.target === "constructor:Proxy" &&
        target?.kind === "target"
        ? target
        : constructor?.kind === "dynamic_code"
          ? constructor
        : null;
    }
    if (value.type === "ObjectExpression") {
      const fields = new Map();
      for (const property of value.properties ?? []) {
        if (property.type === "SpreadElement") {
          const spread = summarize(
            property.argument,
            seenBindings
          );
          if (spread?.kind !== "object") return null;
          for (const [key, summary] of spread.fields) {
            fields.set(key, summary);
          }
          continue;
        }
        if (
          property.type !== "Property" ||
          property.kind !== "init"
        ) {
          return null;
        }
        const key = property.computed
          ? property.key?.type === "Literal" &&
              typeof property.key.value === "number"
            ? String(property.key.value)
            : literalString(property.key)
          : property.key?.type === "Identifier"
            ? property.key.name
            : literalString(property.key);
        if (key === null) return null;
        const helperIndexes =
          helperTargetParametersByDefinition.get(
            property.value
          );
        const summary = helperIndexes
          ? helperSummary(helperIndexes)
          : summarize(
              property.value,
              seenBindings
            );
        if (summary) fields.set(key, summary);
        else fields.delete(key);
      }
      return objectSummary(fields);
    }
    if (value.type === "ArrayExpression") {
      const fields = new Map();
      for (
        let index = 0;
        index < (value.elements ?? []).length;
        index += 1
      ) {
        const element = value.elements[index];
        if (!element || element.type === "SpreadElement") {
          return null;
        }
        const summary = summarize(element, seenBindings);
        if (summary) fields.set(String(index), summary);
      }
      return objectSummary(fields);
    }
    if (value.type === "TaggedTemplateExpression") {
      const tag = summarize(value.tag, seenBindings);
      return tag?.kind === "dynamic_code" ? tag : null;
    }
    return null;
  };
  const location = (node) => {
    const value = unwrapValueExpression(node);
    if (value?.type === "Identifier") {
      const binding = scopeBindings.get(value);
      return binding
        ? { binding, properties: [] }
        : null;
    }
    if (value?.type !== "MemberExpression") return null;
    const owner = location(value.object);
    const property = runtimeProperty(value);
    return owner && property !== null
      ? {
          binding: owner.binding,
          properties: [...owner.properties, property]
        }
      : null;
  };
  const locationSummary = (target) => {
    const resolved = location(target);
    if (!resolved) return null;
    let current = summaries.get(resolved.binding) ?? null;
    for (const property of resolved.properties) {
      if (current?.kind !== "object") return null;
      current = current.fields.get(property) ?? null;
    }
    return current;
  };
  const setLocationSummary = (
    target,
    summary,
    allowSafeOverwrite = true
  ) => {
    const resolved = location(target);
    if (!resolved) return;
    if (resolved.properties.length === 0) {
      const current = summaries.get(resolved.binding);
      if (
        !allowSafeOverwrite &&
        summaryHasRuntimeAuthority(current) &&
        !summaryHasRuntimeAuthority(summary)
      ) {
        return;
      }
      if (summary) summaries.set(resolved.binding, summary);
      else summaries.delete(resolved.binding);
      return;
    }
    const root = summaries.get(resolved.binding);
    if (root?.kind !== "object") return;
    let current = root;
    for (const property of resolved.properties.slice(0, -1)) {
      const next = current.fields.get(property);
      if (next?.kind !== "object") return;
      current = next;
    }
    const property = resolved.properties.at(-1);
    const existing = current.fields.get(property);
    if (
      !allowSafeOverwrite &&
      summaryHasRuntimeAuthority(existing) &&
      !summaryHasRuntimeAuthority(summary)
    ) {
      return;
    }
    if (summary) current.fields.set(property, summary);
    else current.fields.delete(property);
  };
  const setPatternSummaries = (
    pattern,
    summary,
    allowSafeOverwrite = true
  ) => {
    const target = unwrapValueExpression(pattern);
    if (!target) return;
    if (
      target.type === "Identifier" ||
      target.type === "MemberExpression"
    ) {
      setLocationSummary(
        target,
        summary,
        allowSafeOverwrite
      );
      return;
    }
    if (target.type === "AssignmentPattern") {
      setPatternSummaries(
        target.left,
        summary,
        allowSafeOverwrite
      );
      return;
    }
    if (target.type === "RestElement") {
      setPatternSummaries(
        target.argument,
        summaryHasRuntimeAuthority(summary)
          ? unknownAuthoritySummary()
          : null,
        allowSafeOverwrite
      );
      return;
    }
    if (target.type === "ObjectPattern") {
      for (const property of target.properties ?? []) {
        if (property.type === "RestElement") {
          setPatternSummaries(
            property.argument,
            summaryHasRuntimeAuthority(summary)
              ? unknownAuthoritySummary()
              : null,
            allowSafeOverwrite
          );
          continue;
        }
        setPatternSummaries(
          property.value,
          summaryField(summary, propertyKey(property)),
          allowSafeOverwrite
        );
      }
      return;
    }
    if (target.type === "ArrayPattern") {
      for (
        let index = 0;
        index < (target.elements ?? []).length;
        index += 1
      ) {
        const element = target.elements[index];
        if (!element) continue;
        setPatternSummaries(
          element,
          summaryField(summary, String(index)),
          allowSafeOverwrite
        );
      }
    }
  };
  const isTopLevelUnconditionalWrite = (node) => {
    if (node?.type === "AssignmentExpression") {
      return (
        node.parent?.type === "ExpressionStatement" &&
        node.parent.parent?.type === "Program"
      );
    }
    if (node?.type === "VariableDeclarator") {
      return (
        node.parent?.type === "VariableDeclaration" &&
        node.parent.parent?.type === "Program"
      );
    }
    return false;
  };
  const helperTargetParameters = new Map();
  const recordHelper = (definition, identifier = null) => {
    const binding = identifier
      ? scopeBindings.get(identifier)
      : null;
    if (
      (identifier && !binding) ||
      !definition?.body ||
      !Array.isArray(definition.params)
    ) {
      return;
    }
    const parameterBindings = new Map();
    for (
      let index = 0;
      index < definition.params.length;
      index += 1
    ) {
      const parameter = definition.params[index];
      if (parameter?.type !== "Identifier") continue;
      const parameterBinding = scopeBindings.get(parameter);
      if (parameterBinding) {
        parameterBindings.set(parameterBinding, index);
      }
    }
    const parameterOrigins = new Map(
      [...parameterBindings].map(([binding, index]) => [
        binding,
        new Set([index])
      ])
    );
    const indexes = new Set();
    const visit = (candidate, root = false) => {
      if (!candidate || typeof candidate.type !== "string") {
        return;
      }
      if (
        !root &&
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression"
        ].includes(candidate.type)
      ) {
        return;
      }
      if (
        candidate.type === "VariableDeclarator" &&
        candidate.id?.type === "Identifier"
      ) {
        const binding = scopeBindings.get(candidate.id);
        const source = unwrapValueExpression(candidate.init);
        const sourceBinding =
          source?.type === "Identifier"
            ? scopeBindings.get(source)
            : null;
        const origins = parameterOrigins.get(sourceBinding);
        if (binding && origins) {
          parameterOrigins.set(binding, new Set(origins));
        }
      }
      if (
        candidate.type === "AssignmentExpression" &&
        candidate.operator === "="
      ) {
        const target = unwrapValueExpression(candidate.left);
        const source = unwrapValueExpression(candidate.right);
        const targetBinding =
          target?.type === "Identifier"
            ? scopeBindings.get(target)
            : null;
        const sourceBinding =
          source?.type === "Identifier"
            ? scopeBindings.get(source)
            : null;
        const origins = parameterOrigins.get(sourceBinding);
        if (targetBinding && origins) {
          const existing =
            parameterOrigins.get(targetBinding) ?? new Set();
          parameterOrigins.set(
            targetBinding,
            new Set([...existing, ...origins])
          );
        }
      }
      if (candidate.type === "CallExpression") {
        const callee = unwrapValueExpression(candidate.callee);
        const method =
          callee?.type === "MemberExpression"
            ? staticMemberProperty(callee)
            : null;
        const receiver =
          callee?.type === "MemberExpression"
            ? unwrapValueExpression(callee.object)
            : null;
        if (
          method &&
          RUNTIME_TARGET_MUTATORS.has(method) &&
          receiver?.type === "Identifier" &&
          unshadowedRuntimeGlobal(
            receiver,
            new Set(["Object", "Reflect"]),
            scopeBindings
          )
        ) {
          const target = unwrapValueExpression(
            candidate.arguments?.[0]
          );
          const parameterBinding =
            target?.type === "Identifier"
              ? scopeBindings.get(target)
              : null;
          for (const index of
            parameterOrigins.get(parameterBinding) ?? []) {
            indexes.add(index);
          }
        }
      }
      for (const [key, child] of Object.entries(candidate)) {
        if (
          [
            "comments",
            "loc",
            "parent",
            "range",
            "tokens"
          ].includes(key)
        ) {
          continue;
        }
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry && typeof entry.type === "string") {
              visit(entry);
            }
          }
        } else if (child && typeof child.type === "string") {
          visit(child);
        }
      }
    };
    visit(definition.body, true);
    if (indexes.size > 0) {
      if (binding) {
        helperTargetParameters.set(binding, indexes);
      }
      helperTargetParametersByDefinition.set(
        definition,
        indexes
      );
    }
  };
  walkEstree(ast, (node) => {
    if (
      node.type === "FunctionDeclaration" &&
      node.id?.type === "Identifier"
    ) {
      recordHelper(node, node.id);
      return;
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(node.init?.type)
    ) {
      recordHelper(node.init, node.id);
      return;
    }
    if (
      node.type === "Property" &&
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(node.value?.type)
    ) {
      recordHelper(node.value);
    }
  });
  let issue = null;
  walkEstree(ast, (node) => {
    if (issue) return;
    if (
      ["CallExpression", "NewExpression"].includes(
        node.type
      )
    ) {
      let dynamicCode = false;
      walkEstree(node.callee, (candidate) => {
        if (
          candidate.type === "Identifier" &&
          unshadowedRuntimeGlobal(
            candidate,
            new Set(["eval", "Function"]),
            scopeBindings
          )
        ) {
          dynamicCode = true;
        }
      });
      if (dynamicCode) {
        issue = node;
        return;
      }
    }
    if (node.type === "VariableDeclarator") {
      setPatternSummaries(
        node.id,
        summarize(node.init)
      );
      return;
    }
    if (node.type === "AssignmentExpression") {
      const target = unwrapValueExpression(node.left);
      if (
        target?.type === "MemberExpression" &&
        summaryHasRuntimeAuthority(
          summarize(target.object)
        )
      ) {
        issue = node;
        return;
      }
      if (node.operator === "=") {
        setPatternSummaries(
          node.left,
          summarize(node.right),
          isTopLevelUnconditionalWrite(node)
        );
      } else if (
        location(node.left)
      ) {
        setLocationSummary(
          node.left,
          null,
          isTopLevelUnconditionalWrite(node)
        );
      }
      return;
    }
    if (
      node.type === "UpdateExpression" ||
      (node.type === "UnaryExpression" &&
        node.operator === "delete")
    ) {
      const target = unwrapValueExpression(node.argument);
      if (
        target?.type === "MemberExpression" &&
        summaryHasRuntimeAuthority(
          summarize(target.object)
        )
      ) {
        issue = node;
      }
      return;
    }
    if (
      node.type === "NewExpression" &&
      ["dynamic_code", "unknown_authority"].includes(
        summarize(node.callee)?.kind
      )
    ) {
      issue = node;
      return;
    }
    if (node.type !== "CallExpression") return;
    if (node.callee?.type === "MemberExpression") {
      const receiver = unwrapValueExpression(
        node.callee.object
      );
      const method = staticMemberProperty(node.callee);
      if (
        method &&
        ["__defineGetter__", "__defineSetter__"].includes(
          method
        ) &&
        summaryHasRuntimeAuthority(
          summarize(receiver)
        )
      ) {
        issue = node;
        return;
      }
    }
    const callee = unwrapValueExpression(node.callee);
    const helper = summarize(node.callee);
    if (helper?.kind === "dynamic_code") {
      issue = node;
      return;
    }
    if (helper?.kind === "string_code_scheduler") {
      const adapter =
        callee?.type === "MemberExpression"
          ? runtimeProperty(callee)
          : null;
      let callback = node.arguments?.[0] ?? null;
      if (adapter === "call" || adapter === "bind") {
        callback = node.arguments?.[1] ?? null;
      } else if (adapter === "apply") {
        const applied = unwrapValueExpression(
          node.arguments?.[1]
        );
        callback =
          applied?.type === "ArrayExpression"
            ? applied.elements?.[0] ?? null
            : null;
      }
      if (!staticallyProvenCallable(callback)) {
        issue = node;
        return;
      }
    }
    if (
      helper?.kind === "callable" &&
      [...(helper.descriptor
        ?.stringCodeParameterIndexes ?? [])].some(
        (index) =>
          !staticallyProvenCallable(
            node.arguments?.[index]
          )
      )
    ) {
      issue = node;
      return;
    }
    const argumentSummaries = (node.arguments ?? []).map(
      (argument) => summarize(argument)
    );
    const authorityArgumentSummaries =
      argumentSummaries.filter((summary) =>
        summaryHasRuntimeAuthority(summary)
      );
    const authorityArgument =
      authorityArgumentSummaries.length > 0;
    const memberOwner =
      callee?.type === "MemberExpression"
        ? summarize(callee.object)
        : null;
    const memberMethod =
      callee?.type === "MemberExpression"
        ? runtimeProperty(callee)
        : null;
    const calleeBindingIdentifier =
      callee?.type === "Identifier"
        ? callee
        : callee?.type === "MemberExpression" &&
            callee.object?.type === "Identifier"
          ? callee.object
          : null;
    const calleeBinding = calleeBindingIdentifier
      ? scopeBindings.get(calleeBindingIdentifier)
      : null;
    const importedCallee =
      calleeBinding &&
      runtimeSymbols?.importsByBinding?.has(calleeBinding);
    const locallyBoundCallee =
      calleeBinding && !importedCallee;
    const knownProxyAuthorityConsumer =
      (helper?.kind === "target" &&
        helper.target === "constructor:Proxy") ||
      (memberOwner?.kind === "target" &&
        memberOwner.target === "constructor:Proxy" &&
        memberMethod === "revocable") ||
      (memberOwner?.kind === "target" &&
        memberOwner.target === "constructor:Reflect" &&
        memberMethod === "construct" &&
        summarize(node.arguments?.[0])?.target ===
          "constructor:Proxy");
    const knownIntrinsicCallback =
      callee?.type === "MemberExpression" &&
      RUNTIME_INTRINSIC_CALLBACK_METHODS.has(memberMethod) &&
      authorityArgumentSummaries.every(
        (summary) =>
          summary.kind === "target" &&
          RUNTIME_INTRINSIC_CALLBACK_CONSTRUCTORS.has(
            summary.target
          )
      );
    if (
      authorityArgument &&
      !knownProxyAuthorityConsumer &&
      !knownIntrinsicCallback &&
      (importedCallee || !locallyBoundCallee)
    ) {
      issue = node;
      return;
    }
    if (helper?.kind === "unknown_authority") {
      issue = node;
      return;
    }
    if (
      helper?.kind === "helper" &&
      [...helper.indexes].some(
        (index) =>
          summaryHasRuntimeAuthority(
            summarize(node.arguments?.[index])
          )
      )
    ) {
      issue = node;
      return;
    }
    if (callee?.type === "Identifier") {
      const binding = scopeBindings.get(callee);
      const parameterIndexes =
        helperTargetParameters.get(binding);
      if (
        parameterIndexes &&
        [...parameterIndexes].some(
          (index) =>
            summaryHasRuntimeAuthority(
              summarize(node.arguments?.[index])
            )
        )
      ) {
        issue = node;
        return;
      }
    }
    let mutator = summarize(node.callee);
    let target = node.arguments?.[0] ?? null;
    if (
      callee?.type === "MemberExpression" &&
      ["apply", "bind", "call"].includes(
        runtimeProperty(callee)
      )
    ) {
      const adapter = runtimeProperty(callee);
      const adapted = summarize(callee.object);
      if (adapted?.kind === "mutator") {
        mutator = adapter === "bind" ? null : adapted;
        if (adapter === "apply") {
          const values = unwrapValueExpression(
            node.arguments?.[1]
          );
          target =
            values?.type === "ArrayExpression"
              ? values.elements?.[0] ?? null
              : null;
        } else if (adapter === "call") {
          target = node.arguments?.[1] ?? null;
        }
      }
    }
    if (
      mutator?.kind === "mutator" &&
      summaryHasRuntimeAuthority(summarize(target))
    ) {
      issue = node;
    }
  });
  return issue;
}

function staticMemberProperty(node) {
  if (node?.type !== "MemberExpression") return null;
  return node.computed
    ? literalString(node.property)
    : node.property?.type === "Identifier"
      ? node.property.name
      : null;
}

function directCallableReturnStatements(node) {
  const callable = unwrapValueExpression(node);
  if (
    ![
      "ArrowFunctionExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(callable?.type) ||
    callable.body?.type !== "BlockStatement"
  ) {
    return [];
  }
  const returns = [];
  const visit = (candidate, root = false) => {
    if (!candidate || typeof candidate.type !== "string") return;
    if (
      !root &&
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(candidate.type)
    ) {
      return;
    }
    if (candidate.type === "ReturnStatement") {
      returns.push(candidate);
      return;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            visit(child);
          }
        }
      } else if (value && typeof value.type === "string") {
        visit(value);
      }
    }
  };
  visit(callable.body, true);
  return returns;
}

function singleCallableReturnExpression(node) {
  const callable = unwrapValueExpression(node);
  if (
    ![
      "ArrowFunctionExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(callable?.type)
  ) {
    return null;
  }
  if (
    callable.type === "ArrowFunctionExpression" &&
    callable.expression
  ) {
    return callable.body;
  }
  if (callable.body?.type !== "BlockStatement") {
    return null;
  }
  const statements = callable.body.body ?? [];
  const returns = directCallableReturnStatements(callable);
  const terminal = statements.at(-1);
  return returns.length === 1 &&
    terminal?.type === "ReturnStatement" &&
    terminal.argument
    ? terminal.argument
    : null;
}

function callableSummaryReferencePath(
  node,
  scopeBindings,
  callableReturns
) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    if (!binding) return null;
    return callableReturns?.functions?.get(binding) ?? null;
  }
  if (value?.type === "MemberExpression") {
    const object = unwrapValueExpression(value.object);
    const property = staticMemberProperty(value);
    if (object?.type !== "Identifier" || !property) return null;
    const binding = scopeBindings?.get(object);
    const path = binding
      ? callableReturns?.members
          ?.get(binding)
          ?.get(property)
      : null;
    return typeof path === "string" ? path : null;
  }
  return null;
}

function callableSummaryTargetIsKnown(
  node,
  scopeBindings,
  callableReturns,
  expectedPath = null
) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    if (!binding) return false;
    const functionPath =
      callableReturns?.functions?.get(binding);
    const members = callableReturns?.members?.get(binding);
    if (typeof expectedPath === "string") {
      return (
        functionPath === expectedPath ||
        Array.from(members?.values() ?? []).some(
          (path) => path === expectedPath
        )
      );
    }
    return Boolean(functionPath || members);
  }
  if (value?.type === "MemberExpression") {
    const object = unwrapValueExpression(value.object);
    const property = staticMemberProperty(value);
    if (object?.type !== "Identifier" || !property) {
      return false;
    }
    const binding = scopeBindings?.get(object);
    const path = binding
      ? callableReturns?.members
          ?.get(binding)
          ?.get(property)
      : null;
    return typeof expectedPath === "string"
      ? path === expectedPath
      : path !== undefined;
  }
  return false;
}

const MAX_CALLABLE_SUMMARY_DEPTH = 16;
const SAFE_CALLABLE_MEMBER = Symbol(
  "safe_callable_member"
);
const SELF_CALLABLE_MEMBER = Symbol(
  "self_callable_member"
);

function protectedCallableMemberPath(members) {
  return Array.from(members?.values() ?? []).find(
    (path) => typeof path === "string"
  );
}

function callableReferencesReceiver(node) {
  const callable = unwrapValueExpression(node);
  if (callable?.type !== "FunctionExpression") {
    return false;
  }
  const bodyContainsReceiver = (
    candidate,
    root = false
  ) => {
    if (!candidate || typeof candidate.type !== "string") {
      return false;
    }
    if (candidate.type === "ThisExpression") return true;
    if (
      !root &&
      [
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(candidate.type)
    ) {
      return false;
    }
    return Object.entries(candidate).some(([key, value]) => {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some((child) =>
          bodyContainsReceiver(child)
        );
      }
      return bodyContainsReceiver(value);
    });
  };
  return bodyContainsReceiver(callable.body, true);
}

function callableLexicallyReferencesIdentifier(
  node,
  name
) {
  const callable = unwrapValueExpression(node);
  if (
    ![
      "ArrowFunctionExpression",
      "FunctionExpression"
    ].includes(callable?.type)
  ) {
    return false;
  }
  const visit = (candidate, root = false) => {
    if (!candidate || typeof candidate.type !== "string") {
      return false;
    }
    if (
      candidate.type === "Identifier" &&
      candidate.name === name
    ) {
      return true;
    }
    if (
      !root &&
      [
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(candidate.type)
    ) {
      return false;
    }
    return Object.entries(candidate).some(([key, value]) => {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some((child) => visit(child));
      }
      return visit(value);
    });
  };
  return visit(callable.body, true);
}

function callableEscapeReferencePath(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns,
  seen = new WeakSet(),
  depth = 0
) {
  const value = unwrapValueExpression(node);
  if (!value) return null;
  if (depth > MAX_CALLABLE_SUMMARY_DEPTH) {
    return protectedPath;
  }
  if (seen.has(value)) {
    return protectedPath;
  }
  seen.add(value);
  const summaryPath = callableSummaryReferencePath(
    value,
    scopeBindings,
    callableReturns
  );
  if (summaryPath) return summaryPath;
  if (value.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    const members = binding
      ? callableReturns?.members?.get(binding)
      : null;
    const memberPath = Array.from(
      members?.values() ?? []
    ).find((path) => typeof path === "string");
    if (memberPath) return memberPath;
  }
  if (value.type === "MemberExpression") {
    const object = unwrapValueExpression(value.object);
    const property = staticMemberProperty(value);
    if (object?.type === "Identifier" && property) {
      const binding = scopeBindings?.get(object);
      const members = binding
        ? callableReturns?.members?.get(binding)
        : null;
      if (members?.has(property)) {
        const path = members.get(property);
        if (path === SELF_CALLABLE_MEMBER) {
          return protectedCallableMemberPath(members) ?? null;
        }
        return typeof path === "string" ? path : null;
      }
    }
    return callableEscapeReferencePath(
      value.object,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns,
      seen,
      depth + 1
    );
  }
  if (
    value.type === "CallExpression" ||
    value.type === "NewExpression"
  ) {
    const callee = unwrapValueExpression(value.callee);
    if (value.type === "NewExpression") {
      const constructedPath = callableSummaryReferencePath(
        callee,
        scopeBindings,
        callableReturns
      );
      if (constructedPath) return constructedPath;
    }
    const receiver =
      callee?.type === "MemberExpression"
        ? unwrapValueExpression(callee.object)
        : null;
    if (receiver?.type === "Identifier") {
      const binding = scopeBindings?.get(receiver);
      const members = binding
        ? callableReturns?.members?.get(binding)
        : null;
      const method = staticMemberProperty(callee);
      const functionPath = binding
        ? callableReturns?.functions?.get(binding)
        : null;
      if (
        typeof functionPath === "string" &&
        ["apply", "bind", "call"].includes(method)
      ) {
        return functionPath;
      }
      const protectedMemberPath =
        protectedCallableMemberPath(members);
      if (
        method &&
        members?.get(method) === SELF_CALLABLE_MEMBER
      ) {
        return protectedMemberPath ?? null;
      }
      if (
        protectedMemberPath &&
        (!method || !members?.has(method))
      ) {
        return protectedMemberPath;
      }
    }
    if (receiver && receiver.type !== "Identifier") {
      return callableEscapeReferencePath(
        receiver,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
    }
    if (
      callee &&
      !["Identifier", "MemberExpression"].includes(
        callee.type
      )
    ) {
      return callableEscapeReferencePath(
        callee,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
    }
  }
  if (
    [
      "ArrowFunctionExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(value.type)
  ) {
    const returnPath = callableReturnReferencePath(
      value,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (returnPath) return returnPath;
    const returnValues =
      value.type === "ArrowFunctionExpression" &&
      value.expression
        ? [value.body]
        : directCallableReturnStatements(value)
            .map((statement) => statement.argument)
            .filter(Boolean);
    for (const returnValue of returnValues) {
      const escapedPath = callableEscapeReferencePath(
        returnValue,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
      if (escapedPath) return escapedPath;
    }
    return null;
  }
  if (value.type === "ObjectExpression") {
    const memberPaths = new Map();
    const unknownPaths = [];
    for (const property of value.properties ?? []) {
      if (property.type === "SpreadElement") {
        const source = unwrapValueExpression(
          property.argument
        );
        const sourceBinding =
          source?.type === "Identifier"
            ? scopeBindings?.get(source)
            : null;
        const sourceMembers = sourceBinding
          ? callableReturns?.members?.get(sourceBinding)
          : null;
        if (sourceMembers) {
          for (const [name, path] of sourceMembers) {
            if (typeof path === "string") {
              memberPaths.set(name, path);
            } else {
              memberPaths.delete(name);
            }
          }
          continue;
        }
        const path = callableEscapeReferencePath(
          property.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns,
          seen,
          depth + 1
        );
        if (path) unknownPaths.push(path);
        continue;
      }
      if (property.type !== "Property") continue;
      const name = property.computed
        ? literalString(property.key)
        : property.key?.type === "Identifier"
          ? property.key.name
          : literalString(property.key);
      const path = callableEscapeReferencePath(
        property.value,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
      if (!name) {
        if (path) unknownPaths.push(path);
      } else if (path) {
        memberPaths.set(name, path);
      } else {
        memberPaths.delete(name);
      }
    }
    return (
      unknownPaths[0] ??
      memberPaths.values().next().value ??
      null
    );
  }
  let candidates = [];
  if (value.type === "ArrayExpression") {
    candidates = (value.elements ?? [])
      .filter(Boolean)
      .map((element) =>
        element.type === "SpreadElement"
          ? element.argument
          : element
      );
  } else if (value.type === "ConditionalExpression") {
    candidates = [value.consequent, value.alternate];
  } else if (value.type === "LogicalExpression") {
    candidates = [value.left, value.right];
  } else if (value.type === "SequenceExpression") {
    candidates = value.expressions ?? [];
  }
  for (const candidate of candidates) {
    const candidatePath = callableEscapeReferencePath(
      candidate,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns,
      seen,
      depth + 1
    );
    if (candidatePath) return candidatePath;
  }
  return null;
}

function objectInitializerCapturesCallableEscapes(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns
) {
  const value = unwrapValueExpression(node);
  if (value?.type !== "ObjectExpression") return false;
  let captured = false;
  for (const property of value.properties ?? []) {
    if (property.type === "SpreadElement") {
      const source = unwrapValueExpression(property.argument);
      const sourceBinding =
        source?.type === "Identifier"
          ? scopeBindings?.get(source)
          : null;
      const sourceMembers = sourceBinding
        ? callableReturns?.members?.get(sourceBinding)
        : null;
      if (sourceMembers) {
        captured =
          captured ||
          Array.from(sourceMembers.values()).some(
            (path) => typeof path === "string"
          );
        continue;
      }
      if (
        callableEscapeReferencePath(
          property.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        )
      ) {
        return false;
      }
      continue;
    }
    if (property.type !== "Property") continue;
    const escapedPath = callableEscapeReferencePath(
      property.value,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (!escapedPath) continue;
    const directPath = callableReturnReferencePath(
      property.value,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (directPath !== escapedPath) return false;
    captured = true;
  }
  return captured;
}

function computedGetterReturnReferencePath(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns,
  seen = new WeakSet(),
  depth = 0
) {
  const value = unwrapValueExpression(node);
  if (
    !value ||
    depth > MAX_CALLABLE_SUMMARY_DEPTH ||
    seen.has(value)
  ) {
    return null;
  }
  seen.add(value);
  if (value.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    const getterPath = binding
      ? callableReturns?.members?.get(binding)?.get("get")
      : null;
    if (typeof getterPath === "string") return getterPath;
  }
  if (value.type === "ObjectExpression") {
    let getterPath = null;
    for (const property of value.properties ?? []) {
      if (property.type === "SpreadElement") {
        const source = unwrapValueExpression(
          property.argument
        );
        const sourceBinding =
          source?.type === "Identifier"
            ? scopeBindings?.get(source)
            : null;
        const sourceMembers = sourceBinding
          ? callableReturns?.members?.get(sourceBinding)
          : null;
        const sourceGetterPath = sourceBinding
          ? sourceMembers?.get("get")
          : computedGetterReturnReferencePath(
              property.argument,
              aliases,
              scopeBindings,
              protectedPath,
              callableReturns,
              seen,
              depth + 1
            );
        if (sourceBinding && sourceMembers?.has("get")) {
          getterPath =
            typeof sourceGetterPath === "string"
              ? sourceGetterPath
              : null;
        } else if (typeof sourceGetterPath === "string") {
          getterPath = sourceGetterPath;
        }
        continue;
      }
      if (
        property.type === "Property" &&
        (property.computed
          ? literalString(property.key)
          : property.key?.type === "Identifier"
            ? property.key.name
            : literalString(property.key)) === "get"
      ) {
        getterPath = callableReturnReferencePath(
          property.value,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      }
    }
    return getterPath;
  }
  let candidates = [];
  if (value.type === "ConditionalExpression") {
    candidates = [value.consequent, value.alternate];
  } else if (value.type === "LogicalExpression") {
    candidates = [value.left, value.right];
  } else if (value.type === "SequenceExpression") {
    candidates = value.expressions ?? [];
  }
  if (candidates.length > 0) {
    for (const candidate of candidates) {
      const getterPath = computedGetterReturnReferencePath(
        candidate,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
      if (getterPath) return getterPath;
    }
    return null;
  }
  return callableReturnReferencePath(
    value,
    aliases,
    scopeBindings,
    protectedPath,
    callableReturns
  );
}

function computedArgumentCallableEscapePath(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns,
  seen = new WeakSet(),
  depth = 0
) {
  const value = unwrapValueExpression(node);
  if (!value) return null;
  if (depth > MAX_CALLABLE_SUMMARY_DEPTH) {
    return protectedPath;
  }
  if (seen.has(value)) {
    return protectedPath;
  }
  seen.add(value);
  if (value.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    const members = binding
      ? callableReturns?.members?.get(binding)
      : null;
    for (const [name, path] of members ?? []) {
      if (name !== "get" && typeof path === "string") {
        return path;
      }
    }
    return null;
  }
  if (value.type === "ObjectExpression") {
    const memberPaths = new Map();
    const unknownPaths = [];
    for (const property of value.properties ?? []) {
      if (property.type === "SpreadElement") {
        const source = unwrapValueExpression(
          property.argument
        );
        const sourceBinding =
          source?.type === "Identifier"
            ? scopeBindings?.get(source)
            : null;
        const sourceMembers = sourceBinding
          ? callableReturns?.members?.get(sourceBinding)
          : null;
        if (sourceMembers) {
          for (const [name, path] of sourceMembers) {
            if (typeof path === "string") {
              memberPaths.set(name, path);
            } else {
              memberPaths.delete(name);
            }
          }
          continue;
        }
        const path = computedArgumentCallableEscapePath(
          property.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns,
          seen,
          depth + 1
        );
        if (path) unknownPaths.push(path);
        continue;
      }
      if (property.type !== "Property") continue;
      const name = property.computed
        ? literalString(property.key)
        : property.key?.type === "Identifier"
          ? property.key.name
          : literalString(property.key);
      if (name === "get") {
        memberPaths.delete("get");
        continue;
      }
      const path = callableEscapeReferencePath(
        property.value,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns,
        seen,
        depth + 1
      );
      if (!name) {
        if (path) unknownPaths.push(path);
      } else if (path) {
        memberPaths.set(name, path);
      } else {
        memberPaths.delete(name);
      }
    }
    memberPaths.delete("get");
    return (
      unknownPaths[0] ??
      memberPaths.values().next().value ??
      null
    );
  }
  let candidates = [];
  if (value.type === "ConditionalExpression") {
    candidates = [value.consequent, value.alternate];
  } else if (value.type === "LogicalExpression") {
    candidates = [value.left, value.right];
  } else if (value.type === "SequenceExpression") {
    candidates = value.expressions ?? [];
  }
  for (const candidate of candidates) {
    const path = computedArgumentCallableEscapePath(
      candidate,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns,
      seen,
      depth + 1
    );
    if (path) return path;
  }
  return null;
}

function callableReturnReferencePath(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns
) {
  const callable = unwrapValueExpression(node);
  const summaryPath = callableSummaryReferencePath(
    callable,
    scopeBindings,
    callableReturns
  );
  if (summaryPath) return summaryPath;
  let candidates = [];
  if (callable?.type === "ConditionalExpression") {
    candidates = [callable.consequent, callable.alternate];
  } else if (callable?.type === "LogicalExpression") {
    candidates = [callable.left, callable.right];
  } else if (callable?.type === "SequenceExpression") {
    candidates = callable.expressions ?? [];
  }
  for (const candidate of candidates) {
    const candidatePath = callableReturnReferencePath(
      candidate,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (candidatePath) return candidatePath;
  }
  if (
    callable?.type === "ArrowFunctionExpression" &&
    callable.expression
  ) {
    return referencePathThroughAliases(
      callable.body,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
  }
  const returns = directCallableReturnStatements(callable);
  if (returns.length !== 1 || !returns[0]?.argument) return null;
  const path = referencePathThroughAliases(
    returns[0].argument,
    aliases,
    scopeBindings,
    protectedPath,
    callableReturns
  );
  if (path) {
    callableReturns?.safeReturnStatements?.add(returns[0]);
  }
  return path;
}

function referencePathThroughAliases(
  node,
  aliases,
  scopeBindings,
  protectedPath,
  callableReturns
) {
  const value = unwrapValueExpression(node);
  if (!value) return null;
  if (value.type === "Identifier") {
    const binding = scopeBindings?.get(value);
    return binding ? aliases.get(binding) ?? null : null;
  }
  if (value.type === "MemberExpression") {
    const object = unwrapValueExpression(value.object);
    const summaryProperty = staticMemberProperty(value);
    if (object?.type === "Identifier" && summaryProperty) {
      const binding = scopeBindings?.get(object);
      const members = binding
        ? callableReturns?.members?.get(binding)
        : null;
      if (
        members?.get(summaryProperty) ===
        SELF_CALLABLE_MEMBER
      ) {
        return protectedCallableMemberPath(members) ?? null;
      }
    }
    const objectPath = referencePathThroughAliases(
      value.object,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (!objectPath) return null;
    const property = value.computed
      ? literalString(value.property) ??
        (value.property?.type === "Literal" &&
        ["bigint", "number"].includes(
          typeof value.property.value
        )
          ? String(value.property.value)
          : "*")
      : value.property?.type === "Identifier"
        ? value.property.name
        : null;
    return property
      ? capabilityReferenceChildPath(objectPath, property)
      : null;
  }
  if (value.type === "CallExpression") {
    const callee = unwrapValueExpression(value.callee);
    if (
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(callee?.type)
    ) {
      return callableReturnReferencePath(
        callee,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
    }
    if (callee?.type === "Identifier") {
      const binding = scopeBindings?.get(callee);
      if (callableReturns?.computedBindings?.has(binding)) {
        return computedGetterReturnReferencePath(
          value.arguments?.[0],
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      }
      const returnPath = binding
        ? callableReturns?.functions?.get(binding)
        : null;
      if (returnPath) return returnPath;
    }
    if (callee?.type !== "MemberExpression") return null;
    const method = staticMemberProperty(callee);
    const object = unwrapValueExpression(callee.object);
    if (object?.type === "Identifier" && method) {
      const binding = scopeBindings?.get(object);
      const members = binding
        ? callableReturns?.members?.get(binding)
        : null;
      const returnPath = members?.get(method);
      if (typeof returnPath === "string") return returnPath;
      if (returnPath === SELF_CALLABLE_MEMBER) {
        return protectedCallableMemberPath(members) ?? null;
      }
    }
    const receiverPath = referencePathThroughAliases(
      callee.object,
      aliases,
      scopeBindings,
      protectedPath,
      callableReturns
    );
    if (receiverPath && !method) {
      return `${receiverPath}.*`;
    }
    if (receiverPath && method === "valueOf") {
      return receiverPath;
    }
    return receiverPath &&
      method &&
      CAPABILITY_REFERENCE_DERIVING_METHODS.has(method)
      ? `${receiverPath}.*`
      : null;
  }
  if (value.type === "ArrayExpression") {
    for (const element of value.elements ?? []) {
      if (!element) continue;
      const elementPath = referencePathThroughAliases(
        element.type === "SpreadElement"
          ? element.argument
          : element,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (elementPath) {
        return element.type === "SpreadElement"
          ? `${elementPath}.*`
          : elementPath;
      }
    }
  }
  const compositeCandidates = [];
  if (value.type === "ObjectExpression") {
    for (const property of value.properties ?? []) {
      const candidate =
        property.type === "Property"
          ? property.value
          : property.type === "SpreadElement"
            ? property.argument
            : null;
      const candidatePath = referencePathThroughAliases(
        candidate,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (candidatePath) compositeCandidates.push(candidatePath);
    }
  } else if (value.type === "ConditionalExpression") {
    for (const candidate of [
      value.consequent,
      value.alternate
    ]) {
      const candidatePath = referencePathThroughAliases(
        candidate,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (candidatePath) compositeCandidates.push(candidatePath);
    }
  } else if (value.type === "LogicalExpression") {
    for (const candidate of [value.left, value.right]) {
      const candidatePath = referencePathThroughAliases(
        candidate,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (candidatePath) compositeCandidates.push(candidatePath);
    }
  } else if (value.type === "SequenceExpression") {
    for (const candidate of value.expressions ?? []) {
      const candidatePath = referencePathThroughAliases(
        candidate,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (candidatePath) compositeCandidates.push(candidatePath);
    }
  }
  if (compositeCandidates.length > 0) {
    const root = protectedPath?.split(".")[0];
    return (
      (root &&
        protectedPath &&
        compositeCandidates.find((candidate) =>
          capabilityRefObjectEscapes(
            candidate,
            root,
            protectedPath
          )
        )) ??
      compositeCandidates[0]
    );
  }
  return null;
}

function capabilityRefProtectedPath(
  root,
  source,
  vueRefRoot = true
) {
  const normalizedSource = normalizedExpression(source);
  if (!vueRefRoot) {
    return normalizedSource === root ||
      normalizedSource.startsWith(`${root}.`)
      ? normalizedSource
      : root;
  }
  if (normalizedSource === root) return `${root}.value`;
  return normalizedSource.startsWith(`${root}.`)
    ? `${root}.value${normalizedSource.slice(root.length)}`
    : `${root}.value`;
}

const CAPABILITY_ORIGIN_PROJECTION_PREFIX =
  "__capability_origin_projection__:";

function encodedCapabilityProjectionPart(value) {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

function capabilityOriginProjectionPath(
  protectedPath,
  parts
) {
  return `${CAPABILITY_ORIGIN_PROJECTION_PREFIX}${encodedCapabilityProjectionPart(
    protectedPath
  )}:${parts
    .map(encodedCapabilityProjectionPart)
    .join(",")}`;
}

function capabilityReferenceChildPath(path, property) {
  return `${path}.${
    path.startsWith(CAPABILITY_ORIGIN_PROJECTION_PREFIX)
      ? encodedCapabilityProjectionPart(property)
      : property
  }`;
}

function parsedCapabilityOriginProjection(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith(CAPABILITY_ORIGIN_PROJECTION_PREFIX)
  ) {
    return null;
  }
  const separator = path.indexOf(".");
  const descriptor =
    separator < 0 ? path : path.slice(0, separator);
  const traversed =
    separator < 0
      ? []
      : path
          .slice(separator + 1)
          .split(".")
          .map((part) => decodeURIComponent(part));
  const payload = descriptor.slice(
    CAPABILITY_ORIGIN_PROJECTION_PREFIX.length
  );
  const delimiter = payload.indexOf(":");
  if (delimiter < 0) return null;
  try {
    return {
      protectedPath: decodeURIComponent(
        payload.slice(0, delimiter)
      ),
      expected: payload
        .slice(delimiter + 1)
        .split(",")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part)),
      traversed
    };
  } catch {
    return null;
  }
}

function capabilityOriginProjectionDescriptor(
  expression,
  scopeBindings
) {
  let value = unwrapValueExpression(expression);
  const parts = [];
  while (value?.type === "MemberExpression") {
    const property = value.computed
      ? literalString(value.property) ??
        (value.property?.type === "Literal" &&
        ["bigint", "number"].includes(
          typeof value.property.value
        )
          ? String(value.property.value)
          : "*")
      : value.property?.type === "Identifier"
        ? value.property.name
        : null;
    if (!property) return null;
    parts.unshift(property);
    value = unwrapValueExpression(value.object);
  }
  if (value?.type !== "Identifier" || parts.length === 0) {
    return null;
  }
  const binding = scopeBindings.get(value);
  return binding ? { binding, parts } : null;
}

function capabilityRefObjectEscapes(
  path,
  root,
  protectedPath
) {
  if (typeof path !== "string") return false;
  const projection = parsedCapabilityOriginProjection(path);
  if (projection) {
    if (projection.protectedPath !== protectedPath) {
      return false;
    }
    const sharedLength = Math.min(
      projection.expected.length,
      projection.traversed.length
    );
    return Array.from(
      { length: sharedLength },
      (_, index) =>
        projection.expected[index] ===
          projection.traversed[index] ||
        projection.expected[index] === "*" ||
        projection.traversed[index] === "*"
    ).every(Boolean);
  }
  if (path === root || path === `${root}.value`) return true;
  const pathParts = path.split(".");
  const protectedParts = protectedPath.split(".");
  const sharedLength = Math.min(
    pathParts.length,
    protectedParts.length
  );
  const overlapsProtectedPath = Array.from(
    { length: sharedLength },
    (_, index) =>
      pathParts[index] === protectedParts[index] ||
      pathParts[index] === "*" ||
      protectedParts[index] === "*"
  ).every(Boolean);
  return overlapsProtectedPath;
}

function capabilityRefUsageIsSafe(
  root,
  source,
  context,
  {
    originExpressions = [],
    vueRefRoot = true,
    rootBinding: explicitRootBinding = null
  } = {}
) {
  const ast = context.symbols.ast;
  const scopeManager = context.symbols.scopeManager;
  if (!ast || !scopeManager) return false;
  const scopeBindings =
    scopeBindingsByIdentifier(scopeManager);
  const rootBinding =
    explicitRootBinding ?? uniqueScopeVariable(scopeManager, root);
  if (!scopeBindings || !rootBinding) return false;
  const parentByNode = new WeakMap();
  const indexParents = (
    node,
    parent = null,
    seen = new Set()
  ) => {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (parent) parentByNode.set(node, parent);
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            indexParents(child, node, seen);
          }
        }
      } else if (value && typeof value.type === "string") {
        indexParents(value, node, seen);
      }
    }
  };
  indexParents(ast);
  const memberUses = new Map();
  walkEstree(ast, (node) => {
    if (node.type !== "MemberExpression") return;
    const object = unwrapValueExpression(node.object);
    const property = staticMemberProperty(node);
    if (object?.type !== "Identifier" || !property) return;
    const binding = scopeBindings.get(object);
    if (!binding) return;
    const parent = parentByNode.get(node);
    if (
      parent?.type === "AssignmentExpression" &&
      parent.left === node
    ) {
      return;
    }
    const byProperty = memberUses.get(binding) ?? new Map();
    const uses = byProperty.get(property) ?? [];
    uses.push(node);
    byProperty.set(property, uses);
    memberUses.set(binding, byProperty);
  });
  const bareBindingEscapeUses = new Map();
  const identifierIsTypeOnly = (identifier) => {
    let current = identifier;
    let parent = parentByNode.get(current);
    while (parent?.type?.startsWith("TS")) {
      if (
        [
          "TSAsExpression",
          "TSInstantiationExpression",
          "TSSatisfiesExpression",
          "TSTypeAssertion",
          "TSNonNullExpression"
        ].includes(parent.type) &&
        (parent.argument === current ||
          parent.expression === current)
      ) {
        current = parent;
        parent = parentByNode.get(current);
        continue;
      }
      return true;
    }
    return false;
  };
  const valueUseRoot = (identifier) => {
    let current = identifier;
    let parent = parentByNode.get(current);
    while (
      parent &&
      [
        "AwaitExpression",
        "ChainExpression",
        "TSAsExpression",
        "TSInstantiationExpression",
        "TSSatisfiesExpression",
        "TSTypeAssertion",
        "TSNonNullExpression"
      ].includes(parent.type) &&
      (parent.argument === current ||
        parent.expression === current)
    ) {
      current = parent;
      parent = parentByNode.get(current);
    }
    return { current, parent };
  };
  const bareBindingUseIsTracked = (identifier) => {
    if (identifierIsTypeOnly(identifier)) return true;
    const { current, parent } = valueUseRoot(identifier);
    if (
      parent?.type === "MemberExpression" &&
      parent.object === current
    ) {
      const memberParent = parentByNode.get(parent);
      return Boolean(
        staticMemberProperty(parent) &&
          memberParent?.type === "AssignmentExpression" &&
          memberParent.left === parent
      );
    }
    if (
      parent?.type === "VariableDeclarator" &&
      parent.id === current
    ) {
      return true;
    }
    if (
      parent?.type === "AssignmentExpression" &&
      parent.left === current
    ) {
      return true;
    }
    if (
      parent?.type === "VariableDeclarator" &&
      parent.init === current &&
      parent.id?.type === "Identifier"
    ) {
      return true;
    }
    if (
      parent?.type === "AssignmentExpression" &&
      parent.operator === "=" &&
      parent.right === current &&
      unwrapValueExpression(parent.left)?.type ===
        "Identifier"
    ) {
      return true;
    }
    if (
      parent?.type === "UnaryExpression" &&
      ["typeof", "void"].includes(parent.operator)
    ) {
      return true;
    }
    return parent?.type === "ExpressionStatement";
  };
  for (const scope of scopeManager.scopes ?? []) {
    for (const binding of scope.variables ?? []) {
      for (const reference of binding.references ?? []) {
        const identifier = reference.identifier;
        if (
          !identifier ||
          bareBindingUseIsTracked(identifier)
        ) {
          continue;
        }
        const uses =
          bareBindingEscapeUses.get(binding) ?? [];
        uses.push(identifier);
        bareBindingEscapeUses.set(binding, uses);
      }
    }
  }
  const isInsideDeferredCallable = (node) => {
    let current = parentByNode.get(node);
    while (current) {
      if (
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression"
        ].includes(current.type)
      ) {
        return true;
      }
      current = parentByNode.get(current);
    }
    return false;
  };
  const safeMemberAssignmentDominatesUses = (
    assignment,
    member
  ) => {
    const statement = parentByNode.get(assignment);
    if (
      statement?.type !== "ExpressionStatement" ||
      parentByNode.get(statement)?.type !== "Program"
    ) {
      return false;
    }
    const object = unwrapValueExpression(member.object);
    const property = staticMemberProperty(member);
    const binding =
      object?.type === "Identifier"
        ? scopeBindings.get(object)
        : null;
    const assignmentEnd = assignment.range?.[1];
    if (
      !binding ||
      !property ||
      !Number.isInteger(assignmentEnd)
    ) {
      return false;
    }
    const memberIdentity =
      callableReturns.members.get(binding);
    const equivalentBindings = new Set([binding]);
    if (memberIdentity) {
      for (const [candidate, members] of
        callableReturns.members) {
        if (members === memberIdentity) {
          equivalentBindings.add(candidate);
        }
      }
    }
    const uses = Array.from(equivalentBindings).flatMap(
      (candidate) =>
        memberUses.get(candidate)?.get(property) ?? []
    );
    const escapeUses = Array.from(
      equivalentBindings
    ).flatMap(
      (candidate) =>
        bareBindingEscapeUses.get(candidate) ?? []
    );
    return [...uses, ...escapeUses].every(
      (use) =>
        Number.isInteger(use.range?.[0]) &&
        use.range[0] >= assignmentEnd &&
        !isInsideDeferredCallable(use)
    );
  };
  const safeBindingAssignmentDominatesUses = (
    assignment,
    binding
  ) => {
    const statement = parentByNode.get(assignment);
    const assignmentEnd = assignment.range?.[1];
    if (
      statement?.type !== "ExpressionStatement" ||
      parentByNode.get(statement)?.type !== "Program" ||
      !binding ||
      !Number.isInteger(assignmentEnd)
    ) {
      return false;
    }
    const uses = Array.from(
      memberUses.get(binding)?.values() ?? []
    )
      .flat()
      .concat(
        bareBindingEscapeUses.get(binding) ?? []
      );
    return uses.every(
      (use) =>
        Number.isInteger(use.range?.[0]) &&
        use.range[0] >= assignmentEnd &&
        !isInsideDeferredCallable(use)
    );
  };
  const protectedPath = capabilityRefProtectedPath(
    root,
    source,
    vueRefRoot
  );
  const aliases = new Map([[rootBinding, root]]);
  const templateProtectedOrigins = new Map([
    [root, root]
  ]);
  const pendingOriginExpressions = [...originExpressions];
  const seenOriginExpressions = new Set();
  while (pendingOriginExpressions.length > 0) {
    const expression = pendingOriginExpressions.shift();
    if (
      !expression ||
      seenOriginExpressions.has(expression)
    ) {
      continue;
    }
    seenOriginExpressions.add(expression);
    const originProjection =
      protectedPath === `${root}.value`
        ? capabilityOriginProjectionDescriptor(
            expression,
            scopeBindings
          )
        : null;
    walkEstree(expression, (candidate) => {
      if (candidate.type !== "Identifier") return;
      const binding = scopeBindings.get(candidate);
      if (
        !binding ||
        binding === rootBinding ||
        context.symbols.importsByBinding?.has(binding)
      ) {
        return;
      }
      const sources = expressionServerReadSources(
        candidate,
        context
      );
      if (sources?.size !== 1) return;
      const aliasPath =
        binding === originProjection?.binding
          ? capabilityOriginProjectionPath(
              protectedPath,
              originProjection.parts
            )
          : protectedPath;
      aliases.set(binding, aliasPath);
      templateProtectedOrigins.set(
        candidate.name,
        aliasPath
      );
      const declaration = uniqueIndexedNode(
        context.symbols.declarationsByBinding,
        binding
      );
      if (
        declaration &&
        !seenOriginExpressions.has(declaration)
      ) {
        pendingOriginExpressions.push(declaration);
      }
    });
  }
  const vueComputedBindings = new Set(
    context.symbols.vueComputedImportBindings ?? []
  );
  const callableReturns = {
    computedBindings: vueComputedBindings,
    functions: new Map(),
    members: new Map(),
    safeReturnStatements: new WeakSet()
  };
  let unsafeCallablePatternEscape = false;
  let unsafeCallbackParameterEscape = false;
  const mapEntriesEqual = (left, right) =>
    left.size === right.size &&
    Array.from(left).every(
      ([key, value]) => right.get(key) === value
    );
  const memberMapsEqual = (left, right) =>
    left.size === right.size &&
    Array.from(left).every(([binding, members]) => {
      const other = right.get(binding);
      return other && mapEntriesEqual(members, other);
    });
  let changed = true;
  while (changed) {
    const aliasesBefore = new Map(aliases);
    const functionsBefore = new Map(
      callableReturns.functions
    );
    const membersBefore = new Map(
      Array.from(
        callableReturns.members,
        ([binding, members]) => [
          binding,
          new Map(members)
        ]
      )
    );
    changed = false;
    walkEstree(ast, (node) => {
      const rememberFunctionReturnPath = (identifier, path) => {
        if (identifier?.type !== "Identifier" || !path) return;
        const binding = scopeBindings.get(identifier);
        if (
          binding &&
          callableReturns.functions.get(binding) !== path
        ) {
          callableReturns.functions.set(binding, path);
          changed = true;
        }
      };
      const conciseReturnPath = (expression) => {
        return callableReturnReferencePath(
          expression,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      };
      const extractedMemberReturnPath = (expression) => {
        const member = unwrapValueExpression(expression);
        if (member?.type !== "MemberExpression") return null;
        const object = unwrapValueExpression(member.object);
        const property = staticMemberProperty(member);
        if (object?.type !== "Identifier" || !property) return null;
        const binding = scopeBindings.get(object);
        const path = binding
          ? callableReturns.members.get(binding)?.get(property)
          : null;
        return typeof path === "string" ? path : null;
      };
      const rememberFunctionReturn = (identifier, expression) => {
        rememberFunctionReturnPath(
          identifier,
          conciseReturnPath(expression) ??
            extractedMemberReturnPath(expression)
        );
      };
      const rememberMemberReturnPath = (
        objectIdentifier,
        property,
        path
      ) => {
        if (
          objectIdentifier?.type !== "Identifier" ||
          !property
        ) {
          return;
        }
        const binding = scopeBindings.get(objectIdentifier);
        if (!binding) return;
        const members =
          callableReturns.members.get(binding) ?? new Map();
        const nextPath =
          typeof path === "string" ||
          path === SELF_CALLABLE_MEMBER
            ? path
            : SAFE_CALLABLE_MEMBER;
        if (members.get(property) === nextPath) return;
        members.set(property, nextPath);
        callableReturns.members.set(binding, members);
        changed = true;
      };
      const replaceMemberReturns = (
        objectIdentifier,
        nextMembers
      ) => {
        if (objectIdentifier?.type !== "Identifier") return;
        const binding = scopeBindings.get(objectIdentifier);
        if (!binding) return;
        const current =
          callableReturns.members.get(binding) ?? new Map();
        const isEqual =
          current.size === nextMembers.size &&
          Array.from(nextMembers).every(
            ([name, path]) => current.get(name) === path
          );
        if (isEqual) return;
        if (nextMembers.size === 0) {
          callableReturns.members.delete(binding);
        } else {
          callableReturns.members.set(
            binding,
            nextMembers
          );
        }
        changed = true;
      };
      const copyMemberReturns = (
        targetExpression,
        sourceExpression,
        assignment = null
      ) => {
        const targetIdentifier =
          unwrapValueExpression(targetExpression);
        const sourceIdentifier =
          unwrapValueExpression(sourceExpression);
        if (
          targetIdentifier?.type !== "Identifier" ||
          sourceIdentifier?.type !== "Identifier"
        ) {
          return;
        }
        const targetBinding = scopeBindings.get(targetIdentifier);
        const sourceBinding = scopeBindings.get(sourceIdentifier);
        const sourceMembers = sourceBinding
          ? callableReturns.members.get(sourceBinding)
          : null;
        if (!targetBinding || !sourceMembers) return;
        const currentMembers =
          callableReturns.members.get(targetBinding);
        const currentHasProtectedMember =
          currentMembers &&
          Array.from(currentMembers.values()).some(
            (path) => typeof path === "string"
          );
        if (
          assignment &&
          currentHasProtectedMember &&
          !safeBindingAssignmentDominatesUses(
            assignment,
            targetBinding
          )
        ) {
          const nextMembers = new Map(currentMembers);
          for (const [property, path] of sourceMembers) {
            if (typeof path === "string") {
              nextMembers.set(property, path);
            }
          }
          if (!mapEntriesEqual(currentMembers, nextMembers)) {
            callableReturns.members.set(
              targetBinding,
              nextMembers
            );
            changed = true;
          }
          return;
        }
        if (currentMembers !== sourceMembers) {
          callableReturns.members.set(
            targetBinding,
            sourceMembers
          );
          changed = true;
        }
      };
      const rememberDestructuredMemberReturns = (
        pattern,
        sourceExpression
      ) => {
        if (pattern?.type !== "ObjectPattern") return;
        const sourceIdentifier =
          unwrapValueExpression(sourceExpression);
        if (sourceIdentifier?.type !== "Identifier") return;
        const sourceBinding = scopeBindings.get(sourceIdentifier);
        const sourceMembers = sourceBinding
          ? callableReturns.members.get(sourceBinding)
          : null;
        if (!sourceMembers) return;
        for (const property of pattern.properties ?? []) {
          if (property.type === "RestElement") {
            unsafeCallablePatternEscape = true;
            continue;
          }
          if (property.type !== "Property") {
            unsafeCallablePatternEscape = true;
            continue;
          }
          const propertyName = property.computed
            ? literalString(property.key)
            : property.key?.type === "Identifier"
              ? property.key.name
              : literalString(property.key);
          const target =
            property.value?.type === "AssignmentPattern"
              ? property.value.left
              : property.value;
          const returnPath = propertyName
            ? sourceMembers.get(propertyName)
            : null;
          if (
            typeof returnPath === "string" &&
            target?.type === "Identifier"
          ) {
            rememberFunctionReturnPath(target, returnPath);
          } else if (typeof returnPath === "string") {
            unsafeCallablePatternEscape = true;
          }
        }
      };

      if (node.type === "VariableDeclarator") {
        rememberFunctionReturn(node.id, node.init);
        if (
          node.id?.type === "Identifier" &&
          node.init?.type === "ObjectExpression"
        ) {
          const nextMembers = new Map();
          let hasUnknownMember = false;
          for (const property of node.init.properties ?? []) {
            if (property.type === "SpreadElement") {
              const sourceIdentifier =
                unwrapValueExpression(property.argument);
              const sourceBinding =
                sourceIdentifier?.type === "Identifier"
                  ? scopeBindings.get(sourceIdentifier)
                  : null;
              const sourceMembers = sourceBinding
                ? callableReturns.members.get(sourceBinding)
                : null;
              if (sourceMembers) {
                for (const [name, returnPath] of
                  sourceMembers) {
                  nextMembers.set(name, returnPath);
                }
              } else if (
                callableEscapeReferencePath(
                  property.argument,
                  aliases,
                  scopeBindings,
                  protectedPath,
                  callableReturns
                )
              ) {
                hasUnknownMember = true;
              }
              continue;
            }
            if (property.type !== "Property") continue;
            const propertyName = property.computed
              ? literalString(property.key)
                : property.key?.type === "Identifier"
                  ? property.key.name
                  : literalString(property.key);
            const returnPath = conciseReturnPath(
              property.value
            );
            const returnsReceiver =
              callableReferencesReceiver(property.value);
            if (!propertyName) {
              if (returnPath || returnsReceiver) {
                hasUnknownMember = true;
              }
            } else if (returnPath) {
              nextMembers.set(propertyName, returnPath);
            } else if (returnsReceiver) {
              nextMembers.set(
                propertyName,
                SELF_CALLABLE_MEMBER
              );
            } else {
              nextMembers.set(
                propertyName,
                SAFE_CALLABLE_MEMBER
              );
            }
          }
          replaceMemberReturns(node.id, nextMembers);
          if (hasUnknownMember) {
            unsafeCallablePatternEscape = true;
          }
        }
        copyMemberReturns(node.id, node.init);
        rememberDestructuredMemberReturns(
          node.id,
          node.init
        );
      }
      if (
        node.type === "AssignmentExpression" &&
        node.operator === "="
      ) {
        rememberFunctionReturn(node.left, node.right);
        copyMemberReturns(node.left, node.right, node);
        rememberDestructuredMemberReturns(
          node.left,
          node.right
        );
        const left = unwrapValueExpression(node.left);
        if (left?.type === "MemberExpression") {
          const returnPath = conciseReturnPath(node.right);
          const memberReturn =
            returnPath ??
            (callableReferencesReceiver(node.right)
              ? SELF_CALLABLE_MEMBER
              : null);
          if (
            memberReturn ||
            safeMemberAssignmentDominatesUses(node, left)
          ) {
            rememberMemberReturnPath(
              unwrapValueExpression(left.object),
              staticMemberProperty(left),
              memberReturn
            );
          }
        }
      }
    });
    walkEstree(ast, (node) => {
      const rememberAliasPath = (binding, path) => {
        if (!binding || !path) return;
        const existing = aliases.get(binding);
        if (
          existing &&
          (existing === path ||
            capabilityRefObjectEscapes(
              existing,
              root,
              protectedPath
            ) ||
            !capabilityRefObjectEscapes(
              path,
              root,
              protectedPath
            ))
        ) {
          return;
        }
        aliases.set(binding, path);
        changed = true;
      };
      const target =
        node.type === "VariableDeclarator"
          ? node.id
          : node.type === "AssignmentExpression" &&
              node.operator === "="
            ? unwrapValueExpression(node.left)
            : null;
      const sourceExpression =
        node.type === "VariableDeclarator"
          ? node.init
          : node.type === "AssignmentExpression"
            ? node.right
            : null;
      const targetBinding =
        target?.type === "Identifier"
          ? scopeBindings.get(target)
          : null;
      const sourceValue =
        unwrapValueExpression(sourceExpression);
      const sourceBinding =
        sourceValue?.type === "Identifier"
          ? scopeBindings.get(sourceValue)
          : null;
      const targetPath = targetBinding
        ? aliases.get(targetBinding)
        : null;
      if (targetPath && sourceBinding) {
        rememberAliasPath(sourceBinding, targetPath);
      }
      if (!targetBinding) return;
      const path = referencePathThroughAliases(
        sourceExpression,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      rememberAliasPath(targetBinding, path);
    });
    walkEstree(ast, (node) => {
      if (
        node.type !== "CallExpression" ||
        node.callee?.type !== "MemberExpression"
      ) {
        return;
      }
      const receiverPath = referencePathThroughAliases(
        node.callee.object,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      const method = node.callee.computed
        ? literalString(node.callee.property)
        : node.callee.property?.type === "Identifier"
          ? node.callee.property.name
          : null;
      if (
        !receiverPath ||
        !method ||
        !CAPABILITY_COLLECTION_CALLBACK_METHODS.has(method)
      ) {
        return;
      }
      const callback = unwrapValueExpression(
        node.arguments?.[0]
      );
      if (
        ![
          "ArrowFunctionExpression",
          "FunctionExpression"
        ].includes(callback?.type)
      ) {
        return;
      }
      if (
        callback.type === "FunctionExpression" &&
        callableLexicallyReferencesIdentifier(
          callback,
          "arguments"
        )
      ) {
        unsafeCallbackParameterEscape = true;
      }
      const elementParameter =
        callback.params?.[
          ["reduce", "reduceRight"].includes(method) ? 1 : 0
        ];
      const derivedParameters = [
        {
          parameter: elementParameter,
          path: `${receiverPath}.*`
        }
      ];
      if (
        ["reduce", "reduceRight"].includes(method) &&
        (node.arguments ?? []).length < 2
      ) {
        derivedParameters.push({
          parameter: callback.params?.[0],
          path: `${receiverPath}.*`
        });
      }
      derivedParameters.push({
        parameter:
          callback.params?.[
            ["reduce", "reduceRight"].includes(method) ? 3 : 2
          ],
        path: receiverPath
      });
      for (const { parameter, path } of derivedParameters) {
        if (!parameter) continue;
        const bindingTarget =
          parameter.type === "AssignmentPattern"
            ? parameter.left
            : parameter.type === "RestElement"
              ? parameter.argument
              : parameter;
        if (bindingTarget?.type !== "Identifier") {
          unsafeCallbackParameterEscape = true;
          continue;
        }
        const parameterBinding =
          scopeBindings.get(bindingTarget);
        if (
          parameterBinding &&
          !aliases.has(parameterBinding)
        ) {
          aliases.set(
            parameterBinding,
            parameter.type === "RestElement"
              ? `${receiverPath}.*`
              : path
          );
          changed = true;
        }
      }
    });
    walkEstree(ast, (node) => {
      if (node.type !== "ForOfStatement") return;
      const iterablePath =
        referencePathThroughAliases(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
        callableEscapeReferencePath(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      if (!iterablePath) return;
      const target =
        node.left?.type === "VariableDeclaration"
          ? node.left.declarations?.[0]?.id
          : node.left;
      if (target?.type !== "Identifier") return;
      const targetBinding = scopeBindings.get(target);
      if (targetBinding && !aliases.has(targetBinding)) {
        aliases.set(targetBinding, `${iterablePath}.*`);
        changed = true;
      }
    });
    changed =
      !mapEntriesEqual(aliasesBefore, aliases) ||
      !mapEntriesEqual(
        functionsBefore,
        callableReturns.functions
      ) ||
      !memberMapsEqual(
        membersBefore,
        callableReturns.members
      );
  }
  const normalizedProtectedPath =
    normalizedExpression(protectedPath);
  const normalizedTemplateReferencePath = (path) =>
    typeof path === "string"
      ? normalizedExpression(path).replace(
          /\.(?:0|[1-9]\d*)(?=\.|$)/g,
          ".*"
        )
      : null;
  const templateReferencePath = (
    node,
    templateAliases = new Map()
  ) => {
    const value = unwrapValueExpression(node);
    if (!value) return null;
    if (value.type === "Identifier") {
      if (templateAliases.has(value.name)) {
        return normalizedTemplateReferencePath(
          templateAliases.get(value.name)
        );
      }
      const bindings = topLevelScopeVariables(
        scopeManager,
        value.name
      );
      if (bindings.length > 1) {
        return normalizedProtectedPath;
      }
      const binding = bindings[0] ?? null;
      return normalizedTemplateReferencePath(
        (binding ? aliases.get(binding) : null) ??
          value.name
      );
    }
    if (value.type === "MemberExpression") {
      const objectPath = templateReferencePath(
        value.object,
        templateAliases
      );
      if (!objectPath) return null;
      const property = value.computed
        ? literalString(value.property) ??
          (value.property?.type === "Literal" &&
          ["bigint", "number"].includes(
            typeof value.property.value
          )
            ? "*"
            : "*")
        : value.property?.type === "Identifier"
          ? value.property.name
          : null;
      return property
        ? normalizedTemplateReferencePath(
            capabilityReferenceChildPath(
              objectPath,
              property
            )
          )
        : null;
    }
    if (value.type === "CallExpression") {
      const callee = unwrapValueExpression(value.callee);
      if (callee?.type === "Identifier") {
        const bindings = topLevelScopeVariables(
          scopeManager,
          callee.name
        );
        if (bindings.length > 1) {
          return normalizedProtectedPath;
        }
        const binding = bindings[0] ?? null;
        return normalizedTemplateReferencePath(
          binding
            ? callableReturns.functions.get(binding)
            : null
        );
      }
      if (callee?.type !== "MemberExpression") {
        return null;
      }
      const receiverPath = templateReferencePath(
        callee.object,
        templateAliases
      );
      const method = staticMemberProperty(callee);
      const receiver =
        unwrapValueExpression(callee.object);
      if (receiver?.type === "Identifier" && method) {
        const bindings = topLevelScopeVariables(
          scopeManager,
          receiver.name
        );
        if (bindings.length > 1) {
          return normalizedProtectedPath;
        }
        const binding = bindings[0] ?? null;
        const members = binding
          ? callableReturns.members.get(binding)
          : null;
        const memberPath = members?.get(method);
        if (typeof memberPath === "string") {
          return normalizedTemplateReferencePath(memberPath);
        }
        if (memberPath === SELF_CALLABLE_MEMBER) {
          return normalizedTemplateReferencePath(
            protectedCallableMemberPath(members)
          );
        }
      }
      return receiverPath &&
        method &&
        CAPABILITY_REFERENCE_DERIVING_METHODS.has(method)
        ? `${receiverPath}.*`
        : null;
    }
    return null;
  };
  const templatePathEscapesProtected = (path) =>
    capabilityRefObjectEscapes(
      path,
      root,
      normalizedProtectedPath
    );
  const templatePrimitiveCapabilityFields = new Set([
    "code",
    "disabledReason",
    "enabled",
    "key",
    "label",
    "length",
    "name",
    "reason",
    "variant"
  ]);
  const templatePathCarriesProtectedObject = (path) => {
    if (!templatePathEscapesProtected(path)) return false;
    const pathParts = path.split(".");
    const protectedParts =
      normalizedProtectedPath.split(".");
    if (pathParts.length <= protectedParts.length) {
      return true;
    }
    const suffix = pathParts.slice(protectedParts.length);
    if (
      templatePrimitiveCapabilityFields.has(
        suffix.at(-1)
      )
    ) {
      return false;
    }
    return true;
  };
  const templatePatternIdentifiers = (pattern) => {
    const value = unwrapValueExpression(pattern);
    if (!value) return [];
    if (value.type === "Identifier") return [value.name];
    if (value.type === "RestElement") {
      return templatePatternIdentifiers(value.argument);
    }
    if (value.type === "AssignmentPattern") {
      return templatePatternIdentifiers(value.left);
    }
    if (value.type === "ArrayPattern") {
      return (value.elements ?? []).flatMap(
        templatePatternIdentifiers
      );
    }
    if (value.type === "ObjectPattern") {
      return (value.properties ?? []).flatMap((property) =>
        property.type === "RestElement"
          ? templatePatternIdentifiers(property.argument)
          : property.type === "Property"
            ? templatePatternIdentifiers(property.value)
            : []
      );
    }
    return [];
  };
  const templateElementAncestors = (node) => {
    const elements = [];
    let current = node;
    while (current) {
      if (current.type === "VElement") {
        elements.push(current);
      }
      current = current.parent;
    }
    return elements.reverse();
  };
  const templateAliasesForNode = (node) => {
    const aliases = new Map(templateProtectedOrigins);
    for (const element of templateElementAncestors(node)) {
      const forDirective = elementDirective(element, "for");
      const forExpression =
        directiveExpression(forDirective);
      if (forExpression?.type !== "VForExpression") {
        continue;
      }
      const iterablePath = templateReferencePath(
        forExpression.right,
        aliases
      );
      if (
        !iterablePath ||
        !templatePathEscapesProtected(iterablePath)
      ) {
        continue;
      }
      for (const name of templatePatternIdentifiers(
        forExpression.left?.[0]
      )) {
        aliases.set(name, `${iterablePath}.*`);
      }
    }
    return aliases;
  };
  const templateNodeContainsProtectedReference = (
    node,
    aliases,
    objectOnly = false
  ) => {
    let found = false;
    walkEstree(node, (candidate) => {
      if (found) return;
      if (
        ![
          "CallExpression",
          "Identifier",
          "MemberExpression"
        ].includes(candidate.type)
      ) {
        return;
      }
      const parent = candidate.parent;
      if (
        candidate.type === "Identifier" &&
        (parent?.type === "MemberExpression" ||
          (parent?.type === "Property" &&
            parent.key === candidate &&
            parent.value !== candidate &&
            !parent.computed) ||
          parent?.type === "VForExpression")
      ) {
        return;
      }
      if (
        candidate.type === "MemberExpression" &&
        ((parent?.type === "MemberExpression" &&
          parent.object === candidate) ||
          (parent?.type === "CallExpression" &&
            parent.callee === candidate))
      ) {
        return;
      }
      const path = templateReferencePath(
        candidate,
        aliases
      );
      found = objectOnly
        ? Boolean(
            path &&
              templatePathCarriesProtectedObject(path)
          )
        : Boolean(
            path && templatePathEscapesProtected(path)
          );
    });
    return found;
  };
  const templateCapabilityUsageIsSafe = () => {
    const template = ast.templateBody;
    if (!template) return true;
    let safe = true;
    walkEstree(template, (node) => {
      if (!safe || node.type !== "VExpressionContainer") {
        return;
      }
      const expression = node.expression;
      if (!expression) return;
      const attribute =
        node.parent?.type === "VAttribute"
          ? node.parent
          : null;
      const element =
        attribute?.parent?.parent?.type === "VElement"
          ? attribute.parent.parent
          : null;
      const aliases = templateAliasesForNode(node);
      const directive = directiveName(attribute);
      const argument = directiveArgument(attribute);
      const trustedActionCollection =
        directive === "bind" &&
        ["actions", "available-actions"].includes(
          argument ?? ""
        ) &&
        normalizedElementName(element) ===
          "business-draft-action" &&
        context.businessDraftActionTrusted;
      if (
        directive === "model" &&
        templateNodeContainsProtectedReference(
          expression,
          aliases
        )
      ) {
        safe = false;
        return;
      }
      if (
        directive &&
        ![
          "bind",
          "cloak",
          "else",
          "else-if",
          "for",
          "html",
          "if",
          "memo",
          "model",
          "on",
          "once",
          "pre",
          "show",
          "slot",
          "text"
        ].includes(directive) &&
        templateNodeContainsProtectedReference(
          expression,
          aliases,
          true
        )
      ) {
        safe = false;
        return;
      }
      if (
        directive === "bind" &&
        !trustedActionCollection &&
        templateNodeContainsProtectedReference(
          expression,
          aliases,
          true
        )
      ) {
        safe = false;
        return;
      }
      walkEstree(expression, (candidate) => {
        if (!safe) return;
        if (
          candidate.type === "AssignmentExpression" &&
          templateNodeContainsProtectedReference(
            candidate.left,
            aliases
          )
        ) {
          safe = false;
          return;
        }
        if (
          (candidate.type === "UpdateExpression" ||
            (candidate.type === "UnaryExpression" &&
              candidate.operator === "delete")) &&
          templateNodeContainsProtectedReference(
            candidate.argument,
            aliases
          )
        ) {
          safe = false;
          return;
        }
        if (
          ![
            "CallExpression",
            "NewExpression"
          ].includes(candidate.type)
        ) {
          return;
        }
        if (
          (candidate.arguments ?? []).some((argumentNode) =>
            templateNodeContainsProtectedReference(
              argumentNode?.type === "SpreadElement"
                ? argumentNode.argument
                : argumentNode,
              aliases,
              true
            )
          )
        ) {
          safe = false;
          return;
        }
        const callee = unwrapValueExpression(
          candidate.callee
        );
        if (callee?.type !== "MemberExpression") return;
        const receiverPath = templateReferencePath(
          callee.object,
          aliases
        );
        if (
          !receiverPath ||
          !templatePathEscapesProtected(receiverPath)
        ) {
          return;
        }
        const method = staticMemberProperty(callee);
        const readonlyMethod =
          method &&
          CAPABILITY_READONLY_METHODS.has(method);
        if (!readonlyMethod) {
          safe = false;
          return;
        }
        for (const argumentNode of candidate.arguments ?? []) {
          const callback = unwrapValueExpression(
            argumentNode?.type === "SpreadElement"
              ? argumentNode.argument
              : argumentNode
          );
          if (
            ![
              "ArrowFunctionExpression",
              "FunctionExpression"
            ].includes(callback?.type)
          ) {
            continue;
          }
          walkEstree(callback.body, (bodyNode) => {
            if (
              bodyNode.type === "AssignmentExpression" ||
              bodyNode.type === "UpdateExpression" ||
              (bodyNode.type === "UnaryExpression" &&
                bodyNode.operator === "delete")
            ) {
              safe = false;
            }
          });
        }
      });
    });
    return safe;
  };
  const templateUsageSafe =
    templateCapabilityUsageIsSafe();
  let escaped =
    unsafeCallablePatternEscape ||
    unsafeCallbackParameterEscape ||
    !templateUsageSafe;
  const assignmentTargetExpressions = (target) => {
    const value = unwrapValueExpression(target);
    if (!value) return [];
    if (value.type === "MemberExpression") return [value];
    if (value.type === "RestElement") {
      return assignmentTargetExpressions(value.argument);
    }
    if (value.type === "AssignmentPattern") {
      return assignmentTargetExpressions(value.left);
    }
    if (value.type === "ArrayPattern") {
      return (value.elements ?? []).flatMap((element) =>
        assignmentTargetExpressions(element)
      );
    }
    if (value.type === "ObjectPattern") {
      return (value.properties ?? []).flatMap((property) =>
        property.type === "RestElement"
          ? assignmentTargetExpressions(property.argument)
          : property.type === "Property"
            ? assignmentTargetExpressions(property.value)
            : []
      );
    }
    return [];
  };
  const assignmentTargetMutatesProtectedObject = (
    target,
    allowRootPopulation = false
  ) =>
    assignmentTargetExpressions(target).some(
      (assignmentTarget) => {
        const directlyPopulatesRoot =
          allowRootPopulation &&
          assignmentTarget.type === "MemberExpression" &&
          !assignmentTarget.computed &&
          assignmentTarget.object?.type === "Identifier" &&
          scopeBindings.get(assignmentTarget.object) ===
            rootBinding &&
          assignmentTarget.property?.type === "Identifier" &&
          assignmentTarget.property.name === "value";
        if (directlyPopulatesRoot) return false;
        return capabilityRefObjectEscapes(
          referencePathThroughAliases(
            assignmentTarget,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ) ??
            callableEscapeReferencePath(
              assignmentTarget,
              aliases,
              scopeBindings,
              protectedPath,
              callableReturns
            ),
          root,
          protectedPath
        );
      }
    );
  walkEstree(ast, (node) => {
    if (escaped) return;
    const directCallee =
      node.type === "CallExpression"
        ? unwrapValueExpression(node.callee)
        : null;
    if (
      directCallee?.type === "Identifier" &&
      directCallee.name === "eval"
    ) {
      escaped = true;
      return;
    }
    if (
      ["ForInStatement", "ForOfStatement"].includes(
        node.type
      ) &&
      node.left?.type !== "VariableDeclaration" &&
      assignmentTargetMutatesProtectedObject(node.left)
    ) {
      escaped = true;
      return;
    }
    if (node.type === "ForOfStatement") {
      const directIterablePath =
        referencePathThroughAliases(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      const callableIterablePath =
        callableEscapeReferencePath(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      const iterablePath =
        directIterablePath ?? callableIterablePath;
      const target =
        node.left?.type === "VariableDeclaration"
          ? node.left.declarations?.[0]?.id
          : node.left;
      if (
        (target?.type !== "Identifier" ||
          (!directIterablePath &&
            Boolean(callableIterablePath))) &&
        capabilityRefObjectEscapes(
          iterablePath,
          root,
          protectedPath
        )
      ) {
        escaped = true;
        return;
      }
    }
    if (
      node.type === "AssignmentExpression" &&
      assignmentTargetMutatesProtectedObject(
        node.left,
        vueRefRoot
      )
    ) {
        escaped = true;
        return;
    }
    if (
      (node.type === "UpdateExpression" ||
        (node.type === "UnaryExpression" &&
          node.operator === "delete")) &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.argument,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      ["ThrowStatement", "YieldExpression"].includes(
        node.type
      ) &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.argument,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      node.type === "AssignmentPattern" &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.right,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type !== "Identifier" &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.init,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.init,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier"
    ) {
      const callablePath = callableEscapeReferencePath(
        node.init,
        aliases,
        scopeBindings,
        protectedPath,
        callableReturns
      );
      if (
        capabilityRefObjectEscapes(
          callablePath,
          root,
          protectedPath
        ) &&
        !callableSummaryTargetIsKnown(
          node.id,
          scopeBindings,
          callableReturns,
          callablePath
        ) &&
        !callableSummaryTargetIsKnown(
          node.init,
          scopeBindings,
          callableReturns,
          callablePath
        ) &&
        !objectInitializerCapturesCallableEscapes(
          node.init,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        )
      ) {
        escaped = true;
        return;
      }
    }
    if (
      node.type === "ArrowFunctionExpression" &&
      node.expression &&
      capabilityRefObjectEscapes(
        callableEscapeReferencePath(
          node.body,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      [
        "PropertyDefinition",
        "ClassProperty",
        "ClassPrivateProperty",
        "AccessorProperty",
        "ClassAccessorProperty"
      ].includes(node.type) &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.value,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.value,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      ["ClassDeclaration", "ClassExpression"].includes(
        node.type
      ) &&
      node.superClass &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.superClass,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.superClass,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (
      [
        "ExportDefaultDeclaration",
        "ExportNamedDeclaration"
      ].includes(node.type) &&
      node.exportKind !== "type"
    ) {
      const exportedValues = [];
      if (node.declaration?.type === "VariableDeclaration") {
        for (const declaration of
          node.declaration.declarations ?? []) {
          if (declaration.init) {
            exportedValues.push(declaration.init);
          }
        }
      } else if (node.declaration) {
        exportedValues.push(node.declaration);
      }
      for (const specifier of node.specifiers ?? []) {
        if (
          specifier.exportKind !== "type" &&
          specifier.local
        ) {
          exportedValues.push(specifier.local);
        }
      }
      if (
        exportedValues.some((value) =>
          capabilityRefObjectEscapes(
            referencePathThroughAliases(
              value,
              aliases,
              scopeBindings,
              protectedPath,
              callableReturns
            ) ??
              callableEscapeReferencePath(
                value,
                aliases,
                scopeBindings,
                protectedPath,
                callableReturns
              ),
            root,
            protectedPath
          )
        )
      ) {
        escaped = true;
        return;
      }
    }
    const isTrustedComputedCall =
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      callableReturns.computedBindings.has(
        scopeBindings.get(node.callee)
      );
    const isTrustedStructuredClone =
      node.type === "CallExpression" &&
      node.arguments?.length === 1 &&
      unwrapValueExpression(node.callee)?.type ===
        "Identifier" &&
      unwrapValueExpression(node.callee).name ===
        "structuredClone" &&
      !scopeBindings.get(unwrapValueExpression(node.callee));
    const collectionCallbackMethod =
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
        ? staticMemberProperty(node.callee)
        : null;
    const collectionCallbackReceiverPath =
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
        ? referencePathThroughAliases(
            node.callee.object,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          )
        : null;
    const hasTrustedCollectionCallback =
      collectionCallbackMethod &&
      CAPABILITY_COLLECTION_CALLBACK_METHODS.has(
        collectionCallbackMethod
      ) &&
      capabilityRefObjectEscapes(
        collectionCallbackReceiverPath,
        root,
        protectedPath
      );
    if (
      node.type === "TaggedTemplateExpression" &&
      [node.tag, ...(node.quasi?.expressions ?? [])].some(
        (value) =>
          capabilityRefObjectEscapes(
            referencePathThroughAliases(
              value,
              aliases,
              scopeBindings,
              protectedPath,
              callableReturns
            ) ??
              callableEscapeReferencePath(
                value,
                aliases,
                scopeBindings,
                protectedPath,
                callableReturns
              ),
            root,
            protectedPath
          )
      )
    ) {
      escaped = true;
      return;
    }
    if (
      (node.type === "CallExpression" ||
        node.type === "NewExpression") &&
      (node.arguments ?? []).some((argument, index) => {
        if (isTrustedStructuredClone && index === 0) {
          return false;
        }
        const value =
          argument?.type === "SpreadElement"
            ? argument.argument
            : argument;
        const path = referencePathThroughAliases(
          value,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
        const computedGetterPath =
          isTrustedComputedCall && index === 0
            ? computedGetterReturnReferencePath(
                value,
                aliases,
                scopeBindings,
                protectedPath,
                callableReturns
              )
            : null;
        const isTrustedCollectionCallback =
          hasTrustedCollectionCallback &&
          index === 0 &&
          [
            "ArrowFunctionExpression",
            "FunctionExpression"
          ].includes(unwrapValueExpression(value)?.type);
        const callablePath = isTrustedCollectionCallback
          ? null
          : computedGetterPath
            ? computedArgumentCallableEscapePath(
                value,
                aliases,
                scopeBindings,
                protectedPath,
                callableReturns
              )
            : callableEscapeReferencePath(
                value,
                aliases,
                scopeBindings,
                protectedPath,
                callableReturns
              );
        return capabilityRefObjectEscapes(
          path ?? callablePath,
          root,
          protectedPath
        );
      })
    ) {
      escaped = true;
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
    ) {
      const receiverPath =
        referencePathThroughAliases(
          node.callee.object,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
        callableEscapeReferencePath(
          node.callee.object,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      const method = node.callee.computed
        ? literalString(node.callee.property)
        : node.callee.property?.type === "Identifier"
          ? node.callee.property.name
          : null;
      if (
        capabilityRefObjectEscapes(
          receiverPath,
          root,
          protectedPath
        ) &&
        (!method ||
          !CAPABILITY_READONLY_METHODS.has(method))
      ) {
        escaped = true;
        return;
      }
      if (
        method &&
        CAPABILITY_COLLECTION_CALLBACK_METHODS.has(method) &&
        capabilityRefObjectEscapes(
          receiverPath,
          root,
          protectedPath
        )
      ) {
        const callback = unwrapValueExpression(
          node.arguments?.[0]
        );
        if (
          ![
            "ArrowFunctionExpression",
            "FunctionExpression"
          ].includes(callback?.type)
        ) {
          escaped = true;
          return;
        }
      }
    }
    if (
      node.type === "ReturnStatement" &&
      !callableReturns.safeReturnStatements.has(node) &&
      capabilityRefObjectEscapes(
        referencePathThroughAliases(
          node.argument,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
          callableEscapeReferencePath(
            node.argument,
            aliases,
            scopeBindings,
            protectedPath,
            callableReturns
          ),
        root,
        protectedPath
      )
    ) {
      escaped = true;
      return;
    }
    if (node.type === "AssignmentExpression") {
      const assignedCallablePath =
        referencePathThroughAliases(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) ??
        callableEscapeReferencePath(
          node.right,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        );
      if (
        capabilityRefObjectEscapes(
          assignedCallablePath,
          root,
          protectedPath
        ) &&
        !referencePathThroughAliases(
          node.left,
          aliases,
          scopeBindings,
          protectedPath,
          callableReturns
        ) &&
        !(
          unwrapValueExpression(node.left)?.type ===
            "Identifier" &&
          callableSummaryTargetIsKnown(
            node.left,
            scopeBindings,
            callableReturns,
            assignedCallablePath
          ) &&
          (callableSummaryTargetIsKnown(
            node.right,
            scopeBindings,
            callableReturns,
            assignedCallablePath
          ) ||
            callableReturnReferencePath(
              node.right,
              aliases,
              scopeBindings,
              protectedPath,
              callableReturns
            ) === assignedCallablePath)
        )
      ) {
        escaped = true;
      }
    }
  });
  return !escaped;
}

function capabilityServerProvenanceSources(
  capability,
  context
) {
  const root = capabilitySourceRoot(capability.source);
  if (
    !root ||
    context.symbols.importVariablesByName?.has(root)
  ) {
    return null;
  }
  const discoveredBindings =
    context.capabilitySourceBindings ??
    context.discoveredCapabilitySourceBindings;
  const rootBindings = discoveredBindings?.size > 0
    ? [...discoveredBindings]
    : topLevelScopeVariables(
        context.symbols.scopeManager,
        root
      );
  if (rootBindings.length !== 1) return null;
  const rootBinding = rootBindings[0];
  const declaration = uniqueIndexedNode(
    context.symbols.declarationsByBinding,
    rootBinding
  );
  if (!declaration) return null;
  const directSources = expressionServerReadSources(
    declaration,
    context
  );
  if (directSources?.size === 1) {
    return capabilityRefUsageIsSafe(
      root,
      capability.source,
      context,
      {
        originExpressions: [declaration],
        vueRefRoot: false,
        rootBinding
      }
    )
      ? directSources
      : null;
  }
  if (!expressionIsEmptyVueRef(declaration, context.symbols)) {
    return null;
  }
  const writes =
    context.symbols.writesByBinding.get(rootBinding) ?? [];
  if (
    writes.some(
      (write) =>
        write.kind !== "assignment" ||
        write.operator !== "=" ||
        write.path !== `${root}.value`
    )
  ) {
    return null;
  }
  const populated = writes
    .map((write) => write.value)
    .filter(
      (candidate) =>
        !expressionIsEmptyCapabilityState(candidate)
    );
  if (populated.length === 0) return null;
  if (
    !capabilityRefUsageIsSafe(
      root,
      capability.source,
      context,
      { originExpressions: populated, rootBinding }
    )
  ) {
    return null;
  }
  const sources = new Set();
  for (const candidate of populated) {
    const candidateSources = expressionServerReadSources(
      candidate,
      context,
      new Set([rootBinding])
    );
    if (!candidateSources) return null;
    for (const source of candidateSources) sources.add(source);
  }
  return sources.size === 1 ? sources : null;
}

function uniqueVariableBinding(ast, name, symbols) {
  const bindings = new Set();
  walkEstree(ast, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.id.name === name
    ) {
      const binding = symbols.scopeBindings?.get(node.id);
      if (binding) bindings.add(binding);
    }
  });
  return bindings.size === 1 ? [...bindings][0] : null;
}

function isServerReadAwait(
  expression,
  symbols,
  serverReadBinding
) {
  const awaited = unwrapPreflightExpression(expression);
  const call = awaited?.type === "AwaitExpression"
    ? unwrapPreflightExpression(awaited.argument)
    : null;
  return call?.type === "CallExpression" &&
    call.callee?.type === "Identifier" &&
    symbols.scopeBindings?.get(call.callee) === serverReadBinding &&
    (call.arguments ?? []).every(
      (argument) => argument?.type !== "SpreadElement"
    );
}

function immutableServerReadBinding(
  identifier,
  symbols,
  serverReadBinding
) {
  const binding = symbols.scopeBindings?.get(identifier);
  if (!binding) return false;
  const sources = [];
  const declaration = uniqueIndexedNode(
    symbols.declarationsByBinding,
    binding
  );
  if (declaration) {
    if (!isServerReadAwait(declaration, symbols, serverReadBinding)) {
      return false;
    }
    sources.push(declaration);
  }
  for (const write of symbols.writesByBinding.get(binding) ?? []) {
    if (
      write.kind !== "assignment" ||
      write.operator !== "=" ||
      write.path !== identifier.name ||
      !isServerReadAwait(write.value, symbols, serverReadBinding)
    ) {
      return false;
    }
    sources.push(write.value);
  }
  return sources.length === 1;
}

function trustedAuthoritySnapshotReceipt(
  composableAst,
  symbols,
  serverReadBinding
) {
  const receiptBinding = uniqueVariableBinding(
    composableAst,
    "workbenchReceipt",
    symbols
  );
  if (!receiptBinding) return false;
  const writes = symbols.writesByBinding.get(receiptBinding) ?? [];
  if (writes.length === 0) return false;
  return writes.every((write) => {
    if (
      write.kind !== "assignment" ||
      write.operator !== "=" ||
      write.path !== "workbenchReceipt.value"
    ) {
      return false;
    }
    const value = unwrapPreflightExpression(write.value);
    if (value?.type === "Literal" && value.value === null) return true;
    if (
      value?.type !== "CallExpression" ||
      value.callee?.type !== "Identifier" ||
      value.callee.name !== "structuredClone" ||
      value.arguments?.length !== 1 ||
      value.arguments[0]?.type !== "Identifier"
    ) {
      return false;
    }
    return immutableServerReadBinding(
      value.arguments[0],
      symbols,
      serverReadBinding
    );
  });
}

function contractDraftAuthoritySnapshotProvenance(
  capability,
  context
) {
  if (
    capability.kind !== "detail_action" ||
    capability.source !== "contractDraftAvailableActions" ||
    context.sourceFile !== CONTRACT_WORKBENCH_PAGE_PATH ||
    !isNonEmptyString(context.source)
  ) {
    return null;
  }
  const collectionBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    "contractDraftAvailableActions"
  );
  if (
    collectionBindings.length !== 1 ||
    (context.symbols.writesByBinding.get(collectionBindings[0]) ?? [])
      .length > 0
  ) {
    return null;
  }
  const draftImport = context.symbols.imports.get("useContractDraft");
  if (
    draftImport?.sourceFile !== CONTRACT_DRAFT_COMPOSABLE_PATH ||
    draftImport.importedName !== "useContractDraft" ||
    !/const\s+draft\s*=\s*useContractDraft\s*\(/.test(
      context.source
    ) ||
    !/const\s*\{[\s\S]*?\bauthoritySnapshot\b[\s\S]*?\}\s*=\s*draft\s*;/.test(
      context.source
    ) ||
    !/const\s+contractDraftAvailableActions\s*=\s*computed\s*\(\s*\(\s*\)\s*=>\s*authoritySnapshot\.value\?\.availableActions\s*\?\?\s*null\s*\)\s*;/.test(
      context.source
    )
  ) {
    return null;
  }
  const composableSource = context.sources.get(
    CONTRACT_DRAFT_COMPOSABLE_PATH
  );
  const composableAst = context.asts.get(
    CONTRACT_DRAFT_COMPOSABLE_PATH
  );
  if (!isNonEmptyString(composableSource) || !composableAst) return null;
  const authoritySnapshotStart = composableSource.indexOf(
    "const authoritySnapshot"
  );
  const authoritySnapshotEnd = composableSource.indexOf(
    "function hasAuthorityOperation",
    authoritySnapshotStart
  );
  const authoritySnapshotSource =
    authoritySnapshotStart >= 0 && authoritySnapshotEnd > authoritySnapshotStart
      ? composableSource.slice(authoritySnapshotStart, authoritySnapshotEnd)
      : "";
  const composableSymbols = buildSymbolContext(
    composableAst,
    CONTRACT_DRAFT_COMPOSABLE_PATH,
    context.sourceFileSet
  );
  const workbenchImport = composableSymbols.imports.get(
    "fetchContractDraftWorkbench"
  );
  const workbenchImportBinding =
    composableSymbols.importVariablesByName.get(
      "fetchContractDraftWorkbench"
    );
  if (
    workbenchImport?.sourceFile !== CONTRACT_WORKBENCH_API_PATH ||
    workbenchImport.importedName !== "fetchContractDraftWorkbench" ||
    !/const\s+workbenchReceipt\s*=\s*ref(?:\s*<[\s\S]*?>)?\s*\(\s*null\s*\)\s*;/.test(
      composableSource
    ) ||
    !/const\s+authoritySnapshot\s*=\s*computed(?:\s*<[\s\S]*?>)?\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?const\s+currentWorkbench\s*=\s*workbenchReceipt\.value\s*;/.test(
      authoritySnapshotSource
    ) ||
    !/const\s+receiptAvailableActions\s*=\s*Object\.freeze\s*\(\s*Array\.isArray\s*\(\s*currentWorkbench\.availableActions\s*\)/.test(
      authoritySnapshotSource
    ) ||
    !/const\s+availableActions\s*=\s*refreshRequired\s*\?\s*Object\.freeze\s*\(\s*\[\s*\]\s*\)\s*:\s*receiptAvailableActions\s*;/.test(
      authoritySnapshotSource
    ) ||
    !/return\s+Object\.freeze\s*\(\s*\{[\s\S]*?\bavailableActions\s*,[\s\S]*?\}\s*\)\s*;/.test(
      authoritySnapshotSource
    ) ||
    !/result\s*=\s*await\s+fetchContractDraftWorkbench\s*\(\s*requestedVersionId\s*\)\s*;/.test(
      composableSource
    ) ||
    !/fresh\s*=\s*await\s+fetchContractDraftWorkbench\s*\(\s*conflictingVersionId\s*\)\s*;/.test(
      composableSource
    )
  ) {
    return null;
  }
  if (
    !workbenchImportBinding ||
    !trustedAuthoritySnapshotReceipt(
      composableAst,
      composableSymbols,
      workbenchImportBinding
    )
  ) {
    return null;
  }
  const sourceIdentity = wrapperIdentity(
    CONTRACT_WORKBENCH_API_PATH,
    "fetchContractDraftWorkbench"
  );
  return {
    sources: new Set([sourceIdentity]),
    sourceFiles: new Map([
      [sourceIdentity, CONTRACT_DRAFT_COMPOSABLE_PATH]
    ])
  };
}

function capabilityServerProvenance(capability, context) {
  const sources = capabilityServerProvenanceSources(
    capability,
    context
  );
  if (sources?.size === 1) {
    return {
      sources,
      sourceFiles: new Map(
        [...sources].map((sourceIdentity) => [
          sourceIdentity,
          context.sourceFile
        ])
      )
    };
  }
  return contractDraftAuthoritySnapshotProvenance(
    capability,
    context
  );
}

function capabilityHasServerProvenance(capability, context) {
  return (
    capabilityServerProvenance(capability, context)
      ?.sources
      ?.size === 1
  );
}

function callbackReturnExpression(node) {
  const callback = unwrapValueExpression(node);
  if (
    ![
      "ArrowFunctionExpression",
      "FunctionExpression"
    ].includes(callback?.type)
  ) {
    return null;
  }
  return singleCallableReturnExpression(callback);
}

function bindingMemberIs(
  node,
  binding,
  property,
  symbols
) {
  const value = unwrapValueExpression(node);
  if (
    value?.type !== "MemberExpression" ||
    staticMemberProperty(value) !== property
  ) {
    return false;
  }
  const object = unwrapValueExpression(value.object);
  return (
    object?.type === "Identifier" &&
    symbols.scopeBindings?.get(object) === binding
  );
}

function predicateRequires(
  node,
  atom,
  truthy = true
) {
  const value = unwrapValueExpression(node);
  if (!value) return false;
  if (
    value.type === "UnaryExpression" &&
    value.operator === "!"
  ) {
    return predicateRequires(value.argument, atom, !truthy);
  }
  if (value.type === "SequenceExpression") {
    return predicateRequires(
      value.expressions?.at(-1),
      atom,
      truthy
    );
  }
  if (value.type === "LogicalExpression") {
    if (truthy && value.operator === "&&") {
      return (
        predicateRequires(value.left, atom, true) ||
        predicateRequires(value.right, atom, true)
      );
    }
    if (
      truthy &&
      ["||", "??"].includes(value.operator)
    ) {
      return (
        predicateRequires(value.left, atom, true) &&
        predicateRequires(value.right, atom, true)
      );
    }
    return false;
  }
  return atom(value, truthy);
}

function collectionPredicateIsTrusted(
  node,
  capability,
  context,
  literalBindings
) {
  const value = unwrapValueExpression(node);
  if (
    value?.type !== "CallExpression" ||
    value.callee?.type !== "MemberExpression" ||
    staticMemberProperty(value.callee) !== "some" ||
    normalizedExpression(
      memberExpressionPath(value.callee.object) ?? ""
    ) !== normalizedExpression(capability.source)
  ) {
    return false;
  }
  const callback = unwrapValueExpression(value.arguments?.[0]);
  const predicate = callbackReturnExpression(callback);
  const parameter =
    callback?.params?.[0]?.type === "Identifier"
      ? callback.params[0]
      : null;
  const itemBinding = parameter
    ? context.symbols.scopeBindings?.get(parameter)
    : null;
  if (!predicate || !itemBinding) return false;
  const requiresKey = predicateRequires(
    predicate,
    (candidate, truthy) => {
      if (
        !truthy ||
        candidate.type !== "BinaryExpression" ||
        !["==", "==="].includes(candidate.operator)
      ) {
        return false;
      }
      const leftIsKey = bindingMemberIs(
        candidate.left,
        itemBinding,
        "key",
        context.symbols
      );
      const rightIsKey = bindingMemberIs(
        candidate.right,
        itemBinding,
        "key",
        context.symbols
      );
      const compared = leftIsKey
        ? candidate.right
        : rightIsKey
          ? candidate.left
          : null;
      return (
        compared !== null &&
        argumentStringValue(
          compared,
          literalBindings,
          context.symbols
        ) === capability.key
      );
    }
  );
  const requiresEnabled = predicateRequires(
    predicate,
    (candidate, truthy) => {
      if (
        bindingMemberIs(
          candidate,
          itemBinding,
          "enabled",
          context.symbols
        )
      ) {
        return truthy;
      }
      if (
        candidate.type !== "BinaryExpression" ||
        !["==", "===", "!=", "!=="].includes(
          candidate.operator
        )
      ) {
        return false;
      }
      const leftIsEnabled = bindingMemberIs(
        candidate.left,
        itemBinding,
        "enabled",
        context.symbols
      );
      const rightIsEnabled = bindingMemberIs(
        candidate.right,
        itemBinding,
        "enabled",
        context.symbols
      );
      const compared = leftIsEnabled
        ? candidate.right
        : rightIsEnabled
          ? candidate.left
          : null;
      const comparedValue =
        unwrapValueExpression(compared);
      if (
        comparedValue?.type !== "Literal" ||
        typeof comparedValue.value !== "boolean"
      ) {
        return false;
      }
      const equality = ["==", "==="].includes(
        candidate.operator
      );
      const enabledWhenTrue =
        equality === comparedValue.value;
      return truthy ? enabledWhenTrue : !enabledWhenTrue;
    }
  );
  return requiresKey && requiresEnabled;
}

function collectionIncludesIsTrusted(
  node,
  capability,
  context,
  literalBindings
) {
  const value = unwrapValueExpression(node);
  if (
    value?.type !== "CallExpression" ||
    value.callee?.type !== "MemberExpression" ||
    staticMemberProperty(value.callee) !== "includes" ||
    normalizedExpression(
      memberExpressionPath(value.callee.object) ?? ""
    ) !== normalizedExpression(capability.source) ||
    value.arguments?.length !== 1 ||
    value.arguments[0]?.type === "SpreadElement"
  ) {
    return false;
  }
  return (
    argumentStringValue(
      value.arguments[0],
      literalBindings,
      context.symbols
    ) === capability.key
  );
}

function expressionHasCapability(
  node,
  capability,
  context,
  literalBindings = new Map()
) {
  if (!node || !SERVER_CAPABILITY_KINDS.has(capability.kind)) {
    return false;
  }
  const nodes = capabilityClosure(node, context.symbols);
  const sourceBindings = capabilitySourceBindings(
    nodes,
    capability.source,
    context.symbols
  );
  const provenanceContext = sourceBindings.size === 1
    ? { ...context, capabilitySourceBindings: sourceBindings }
    : context;
  if (
    !closureHasCanonicalExpression(nodes, capability.source) ||
    !capabilityHasServerProvenance(capability, provenanceContext)
  ) {
    return false;
  }
  const value = unwrapValueExpression(node);
  const isCollectionPredicate =
    value?.type === "CallExpression" &&
    value.callee?.type === "MemberExpression" &&
    staticMemberProperty(value.callee) === "some";
  if (
    capability.kind === "available_action_string" &&
    !collectionIncludesIsTrusted(
      node,
      capability,
      context,
      literalBindings
    )
  ) {
    return false;
  }
  if (
    capability.kind !== "available_action_string" &&
    isCollectionPredicate &&
    !collectionPredicateIsTrusted(
      node,
      capability,
      context,
      literalBindings
    )
  ) {
    return false;
  }
  if (
    capability.key &&
    !closureHasLiteral(
      nodes,
      capability.key,
      literalBindings,
      context.symbols
    )
  ) {
    return false;
  }
  if (capability.kind === "detail_action") {
    const enabledIsChecked = closureHasEnabledCheck(nodes);
    if (enabledIsChecked) {
      for (const binding of sourceBindings) {
        context.discoveredCapabilitySourceBindings?.add(binding);
      }
    }
    return enabledIsChecked;
  }
  if (capability.kind === "available_action_string") {
    for (const binding of sourceBindings) {
      context.discoveredCapabilitySourceBindings?.add(binding);
    }
    return true;
  }
  for (const binding of sourceBindings) {
    context.discoveredCapabilitySourceBindings?.add(binding);
  }
  return true;
}

function argumentStringValue(
  node,
  literalBindings,
  symbols
) {
  const literal = literalString(node);
  if (literal !== null) return literal;
  const value = unwrapValueExpression(node);
  if (value?.type !== "Identifier") return null;
  const binding = symbols.scopeBindings?.get(value);
  return binding
    ? literalBindings.get(binding) ?? null
    : null;
}

function capabilityRequired(
  node,
  truthy,
  capability,
  context,
  literalBindings = new Map(),
  seenBindings = new Set()
) {
  if (!node) return false;
  if (node.type === "ChainExpression") {
    return capabilityRequired(
      node.expression,
      truthy,
      capability,
      context,
      literalBindings,
      seenBindings
    );
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    return capabilityRequired(
      node.argument,
      !truthy,
      capability,
      context,
      literalBindings,
      seenBindings
    );
  }
  if (node.type === "SequenceExpression") {
    const terminal = node.expressions?.at(-1);
    return terminal
      ? capabilityRequired(
          terminal,
          truthy,
          capability,
          context,
          literalBindings,
          seenBindings
        )
      : false;
  }
  if (node.type === "LogicalExpression") {
    if (truthy && node.operator === "&&") {
      return (
        capabilityRequired(
          node.left,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        ) ||
        capabilityRequired(
          node.right,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        )
      );
    }
    if (truthy && (node.operator === "||" || node.operator === "??")) {
      return (
        capabilityRequired(
          node.left,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        ) &&
        capabilityRequired(
          node.right,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        )
      );
    }
    if (!truthy && (node.operator === "||" || node.operator === "??")) {
      return (
        capabilityRequired(
          node.left,
          false,
          capability,
          context,
          literalBindings,
          seenBindings
        ) ||
        capabilityRequired(
          node.right,
          false,
          capability,
          context,
          literalBindings,
          seenBindings
        )
      );
    }
    if (!truthy && node.operator === "&&") {
      return (
        capabilityRequired(
          node.left,
          false,
          capability,
          context,
          literalBindings,
          seenBindings
        ) &&
        capabilityRequired(
          node.right,
          false,
          capability,
          context,
          literalBindings,
          seenBindings
        )
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
        capabilityRequired(
          node.test,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        ) ||
        capabilityRequired(
          node.consequent,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        );
      const alternateProtected =
        alternateImpossible ||
        capabilityRequired(
          node.test,
          false,
          capability,
          context,
          literalBindings,
          seenBindings
        ) ||
        capabilityRequired(
          node.alternate,
          true,
          capability,
          context,
          literalBindings,
          seenBindings
        );
      return consequentProtected && alternateProtected;
    }
  }
  if (node.type === "CallExpression") {
    const callee = unwrapValueExpression(node.callee);
    if (
      [
        "ArrowFunctionExpression",
        "FunctionExpression"
      ].includes(callee?.type)
    ) {
      const returned = singleCallableReturnExpression(callee);
      return returned
        ? capabilityRequired(
            returned,
            truthy,
            capability,
            context,
            literalBindings,
            seenBindings
          )
        : false;
    }
    if (callee?.type === "Identifier") {
      const binding = resolvedReferenceBinding(
        callee,
        context.symbols
      );
      if (
        ["Boolean"].includes(callee.name) &&
        (!binding ||
          (binding.identifiers ?? []).length === 0)
      ) {
        return node.arguments?.length === 1
          ? capabilityRequired(
              node.arguments[0],
              truthy,
              capability,
              context,
              literalBindings,
              seenBindings
            )
          : false;
      }
      if (!binding || seenBindings.has(binding)) {
        return false;
      }
      const definition = uniqueIndexedNode(
        context.symbols.definitionsByBinding,
        binding
      );
      const returned = singleCallableReturnExpression(
        definition
      );
      if (!definition || !returned) return false;
      const nextLiterals = new Map(literalBindings);
      for (const [index, parameter] of (
        definition.params ?? []
      ).entries()) {
        const target =
          parameter?.type === "AssignmentPattern"
            ? parameter.left
            : parameter;
        if (target?.type !== "Identifier") continue;
        const parameterBinding =
          context.symbols.scopeBindings?.get(target);
        const value = argumentStringValue(
          node.arguments?.[index],
          literalBindings,
          context.symbols
        );
        if (parameterBinding && value !== null) {
          nextLiterals.set(parameterBinding, value);
        }
      }
      const nextSeen = new Set(seenBindings);
      nextSeen.add(binding);
      return capabilityRequired(
        returned,
        truthy,
        capability,
        context,
        nextLiterals,
        nextSeen
      );
    }
    return truthy &&
      callee?.type === "MemberExpression" &&
      ["includes", "some"].includes(
        staticMemberProperty(callee)
      )
      ? expressionHasCapability(
          node,
          capability,
          context,
          literalBindings
        )
      : false;
  }
  if (node.type === "Identifier") {
    const binding = resolvedReferenceBinding(
      node,
      context.symbols
    );
    if (!binding || seenBindings.has(binding)) return false;
    const declaration = uniqueIndexedNode(
      context.symbols.declarationsByBinding,
      binding
    );
    if (!declaration) return false;
    const nextSeen = new Set(seenBindings);
    nextSeen.add(binding);
    return capabilityRequired(
      declaration,
      truthy,
      capability,
      context,
      literalBindings,
      nextSeen
    );
  }
  if (
    node.type === "Literal" &&
    ((truthy && node.value !== true) ||
      (!truthy && node.value !== false))
  ) {
    return false;
  }
  return (
    truthy &&
    node.type === "MemberExpression" &&
    expressionHasCapability(
      node,
      capability,
      context,
      literalBindings
    )
  );
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

function literalBindingsForCall(definition, callNode, symbols) {
  const bindings = new Map();
  for (const [index, parameter] of (definition?.params ?? []).entries()) {
    if (parameter?.type !== "Identifier") continue;
    const value = literalString(callNode?.arguments?.[index]);
    const binding = symbols.scopeBindings?.get(parameter);
    if (binding && value !== null) bindings.set(binding, value);
  }
  return bindings;
}

function leadingAwaitedLocalPreflight(definition, symbols) {
  const statement = (definition?.body?.body ?? []).find(
    (candidate) => candidate.type !== "EmptyStatement"
  );
  if (statement?.type !== "ExpressionStatement") return null;
  // Preserve the AwaitExpression while unwrapping only TypeScript wrappers.
  // unwrapValueExpression intentionally erases awaits for ordinary data-flow
  // analysis, but a delegated preflight must prove that it completes first.
  const awaited = unwrapPreflightExpression(statement.expression);
  const call = awaited?.type === "AwaitExpression"
    ? unwrapValueExpression(awaited.argument)
    : null;
  if (
    call?.type !== "CallExpression" ||
    call.callee?.type !== "Identifier"
  ) {
    return null;
  }
  const binding = symbols.scopeBindings?.get(call.callee);
  const helperDefinition = binding
    ? uniqueIndexedNode(symbols.definitionsByBinding, binding)
    : null;
  return binding && helperDefinition
    ? { binding, definition: helperDefinition, call }
    : null;
}

function throwOnlyStatement(statement) {
  if (statement?.type === "ThrowStatement") return true;
  return statement?.type === "BlockStatement" &&
    (statement.body ?? []).length === 1 &&
    statement.body[0]?.type === "ThrowStatement";
}

function serverReadDeclarationIsSafe(statement, context) {
  return statement?.type === "VariableDeclaration" &&
    statement.kind === "const" &&
    (statement.declarations ?? []).every((declaration) => {
      const initialized = unwrapPreflightExpression(declaration.init);
      const value = initialized?.type === "AwaitExpression"
        ? unwrapPreflightExpression(initialized.argument)
        : initialized;
      if (
        declaration.id?.type !== "Identifier" ||
        value?.type !== "CallExpression" ||
        value.callee?.type !== "Identifier"
      ) {
        return false;
      }
      const binding = context.symbols.scopeBindings?.get(value.callee);
      return Boolean(
        binding &&
        context.serverReadImports.has(binding) &&
        (value.arguments ?? []).every(
          (argument) =>
            argument?.type !== "SpreadElement" &&
            preflightExpressionIsPure(argument, context.symbols)
        )
      );
    });
}

function delegatedPreflightCapabilityCheck(
  definition,
  capability,
  context,
  literalBindings
) {
  const statements = definition?.body?.body ?? [];
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (
      statement?.type !== "IfStatement" ||
      statement.alternate ||
      !throwOnlyStatement(statement.consequent) ||
      !preflightExpressionIsPure(statement.test, context.symbols)
    ) {
      continue;
    }
    const test = unwrapValueExpression(statement.test);
    if (
      test?.type !== "UnaryExpression" ||
      test.operator !== "!" ||
      !collectionIncludesIsTrusted(
        test.argument,
        capability,
        context,
        literalBindings
      )
    ) {
      continue;
    }
    const prefixIsSafe = statements
      .slice(0, index)
      .every((prefixStatement) =>
        serverReadDeclarationIsSafe(prefixStatement, context) ||
        (prefixStatement?.type === "IfStatement" &&
          !prefixStatement.alternate &&
          throwOnlyStatement(prefixStatement.consequent) &&
          preflightExpressionIsPure(
            prefixStatement.test,
            context.symbols
          ))
      );
    const suffixIsEmpty = statements
      .slice(index + 1)
      .every((suffixStatement) =>
        suffixStatement?.type === "EmptyStatement"
      );
    if (prefixIsSafe && suffixIsEmpty) return true;
  }
  return false;
}

function delegatedBackgroundCapabilityPreflight(
  candidate,
  capability,
  context
) {
  if (candidate?.kind !== "background_call") return null;
  const leading = leadingAwaitedLocalPreflight(
    candidate.expression,
    context.symbols
  );
  if (!leading) return null;
  const sourceBindings = capabilitySourceBindings(
    [leading.definition],
    capability.source,
    context.symbols
  );
  if (sourceBindings.size !== 1) return null;
  const preflightContext = {
    ...context,
    capabilitySourceBindings: sourceBindings,
    discoveredCapabilitySourceBindings: new Set()
  };
  const dominates = backgroundCapabilityDominates(
    { expression: leading.definition },
    capability,
    preflightContext,
    literalBindingsForCall(
      leading.definition,
      leading.call,
      context.symbols
    )
  );
  const literalBindings = literalBindingsForCall(
    leading.definition,
    leading.call,
    context.symbols
  );
  const explicitCheck = delegatedPreflightCapabilityCheck(
    leading.definition,
    capability,
    preflightContext,
    literalBindings
  );
  const sources = capabilityServerProvenanceSources(
    capability,
    preflightContext
  );
  if ((!dominates && !explicitCheck) || sources?.size !== 1) {
    return null;
  }
  return {
    helperBinding: leading.binding,
    sourceBindings: sourceBindings
  };
}

function backgroundCapabilityDominates(
  candidate,
  capability,
  context,
  literalBindings = new Map()
) {
  const definition = candidate.expression;
  const body = [
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "FunctionExpression"
  ].includes(definition?.type) && definition.generator !== true
    ? definition.body
    : null;
  if (body?.type !== "BlockStatement") return false;
  const statements = body.body ?? [];
  const definitions = indexedCompletionDefinitions(definition);
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (
      statement.type !== "IfStatement" ||
      statement.alternate ||
      !["abrupt", "return"].includes(
        statementCompletion(
          statement.consequent,
          definitions,
          new Set()
        )
      ) ||
      !capabilityRequired(
        statement.test,
        false,
        capability,
        context,
        literalBindings
      )
    ) {
      continue;
    }
    const prefixIsReadOnly = statements
      .slice(0, index + 1)
      .every((prefixStatement) => {
        if (prefixStatement.type === "VariableDeclaration") {
          return (
            prefixStatement.kind === "const" &&
            (prefixStatement.declarations ?? []).every((declaration) => {
              if (
                declaration.id?.type !== "Identifier" ||
                !declaration.init
              ) {
                return false;
              }
              if (
                preflightExpressionIsPure(
                  declaration.init,
                  context.symbols
                )
              ) {
                return true;
              }
              const initialized = unwrapPreflightExpression(declaration.init);
              const value = initialized?.type === "AwaitExpression"
                ? unwrapPreflightExpression(initialized.argument)
                : initialized;
              if (
                value?.type !== "CallExpression" ||
                value.callee?.type !== "Identifier"
              ) {
                return false;
              }
              const binding = context.symbols.scopeBindings?.get(
                value.callee
              );
              return Boolean(
                binding &&
                context.serverReadImports.has(binding) &&
                (value.arguments ?? []).every(
                  (argument) =>
                    argument?.type !== "SpreadElement" &&
                    preflightExpressionIsPure(
                      argument,
                      context.symbols
                    )
                )
              );
            })
          );
        }
        if (prefixStatement.type !== "IfStatement") return false;
        return (
          !prefixStatement.alternate &&
          preflightExpressionIsPure(
            prefixStatement.test,
            context.symbols
          ) &&
          ["abrupt", "return"].includes(
            statementCompletion(
              prefixStatement.consequent,
              definitions,
              new Set()
            )
          ) &&
          preflightThrowBranchIsSafe(
            prefixStatement.consequent,
            context.symbols,
            new Set()
          )
        );
      });
    if (prefixIsReadOnly) return true;
  }
  return false;
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
    candidate.kind === "background_call" &&
    backgroundCapabilityDominates(
      candidate,
      capability,
      context
    )
  ) {
    return true;
  }
  const delegated = delegatedBackgroundCapabilityPreflight(
    candidate,
    capability,
    context
  );
  if (delegated) {
    for (const binding of delegated.sourceBindings) {
      context.discoveredCapabilitySourceBindings?.add(binding);
    }
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

function businessDraftActionIsTrusted(source, ast) {
  if (typeof source !== "string" || !ast) return false;
  const normalized = normalizedExpression(source);
  if (
    !normalized.includes(
      "enabledActionItems=computed(()=>actionItems.filter((action)=>action.enabled))"
    )
  ) {
    return false;
  }
  if (
    !/v-for\s*=\s*["']action in enabledActionItems["']/.test(source) ||
    !/:disabled\s*=\s*["'][^"']*!action\.enabled/.test(source)
  ) {
    return false;
  }
  const scopeManager = scopeManagersByAst.get(ast) ?? null;
  const scopeBindings =
    scopeBindingsByIdentifier(scopeManager);
  const propsBindings = topLevelScopeVariables(
    scopeManager,
    "props"
  );
  if (
    !scopeBindings ||
    propsBindings.length !== 1
  ) {
    return false;
  }
  const propsBinding = propsBindings[0];
  const actionItemsBindings = topLevelScopeVariables(
    scopeManager,
    "actionItems"
  );
  const enabledActionItemsBindings =
    topLevelScopeVariables(
      scopeManager,
      "enabledActionItems"
    );
  if (
    actionItemsBindings.length !== 1 ||
    enabledActionItemsBindings.length !== 1
  ) {
    return false;
  }
  const actionItemsBinding = actionItemsBindings[0];
  const enabledActionItemsBinding =
    enabledActionItemsBindings[0];
  const selectActionDefinitions = [];
  walkEstree(ast, (node) => {
    if (
      node.type === "FunctionDeclaration" &&
      node.id?.name === "selectAction"
    ) {
      selectActionDefinitions.push(node);
    }
  });
  const selectionParameter =
    selectActionDefinitions.length === 1 &&
    selectActionDefinitions[0].params?.[0]?.type ===
      "Identifier"
      ? selectActionDefinitions[0].params[0]
      : null;
  const selectionParameterBinding = selectionParameter
    ? scopeBindings.get(selectionParameter)
    : null;
  if (!selectionParameterBinding) return false;
  const executeCalls = [];
  walkEstree(ast, (node) => {
    if (
      node.type !== "CallExpression" ||
      node.callee?.type !== "MemberExpression" ||
      staticMemberProperty(node.callee) !== "execute"
    ) {
      return;
    }
    const receiver = unwrapValueExpression(
      node.callee.object
    );
    if (
      receiver?.type === "Identifier" &&
      (scopeBindings.get(receiver) === propsBinding ||
        (receiver.name === "props" &&
          nodeIsInsideVueTemplate(receiver)))
    ) {
      executeCalls.push(node);
    }
  });
  if (executeCalls.length !== 1) return false;
  const call = executeCalls[0];
  const request = unwrapValueExpression(call.arguments?.[0]);
  const actionValue = objectProperty(request, "action");
  const actionMember = unwrapValueExpression(actionValue);
  const actionIdentifier =
    actionMember?.type === "MemberExpression" &&
    staticMemberProperty(actionMember) === "key"
      ? unwrapValueExpression(actionMember.object)
      : null;
  const actionBinding =
    actionIdentifier?.type === "Identifier"
      ? scopeBindings.get(actionIdentifier)
      : null;
  if (!actionBinding) return false;
  let callable = call.parent;
  while (
    callable &&
    ![
      "ArrowFunctionExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(callable.type)
  ) {
    callable = callable.parent;
  }
  if (
    callable?.type !== "FunctionDeclaration" ||
    callable.id?.name !== "executeAction"
  ) {
    return false;
  }
  const branchReturns = (branch) =>
    branch?.type === "ReturnStatement" ||
    (branch?.type === "BlockStatement" &&
      (branch.body ?? []).some(
        (statement) => statement.type === "ReturnStatement"
      ));
  const catchesDisabled = (test, binding) => {
    const value = unwrapValueExpression(test);
    if (
      value?.type === "UnaryExpression" &&
      value.operator === "!" &&
      bindingMemberIs(
        value.argument,
        binding,
        "enabled",
        { scopeBindings }
      )
    ) {
      return true;
    }
    if (
      value?.type === "LogicalExpression" &&
      value.operator === "||"
    ) {
      return (
        catchesDisabled(value.left, binding) ||
        catchesDisabled(value.right, binding)
      );
    }
    if (
      value?.type === "LogicalExpression" &&
      value.operator === "&&"
    ) {
      return (
        catchesDisabled(value.left, binding) &&
        catchesDisabled(value.right, binding)
      );
    }
    return false;
  };
  const guardedBefore = (
    owner,
    binding,
    beforeRange
  ) => {
    if (owner.body?.type !== "BlockStatement") return false;
    return (owner.body.body ?? []).some(
      (candidate) =>
        candidate.type === "IfStatement" &&
        Number.isInteger(candidate.range?.[0]) &&
        candidate.range[0] < beforeRange &&
        branchReturns(candidate.consequent) &&
        catchesDisabled(candidate.test, binding)
    );
  };
  const callStart = call.range?.[0] ?? -1;
  if (
    (callable.params ?? []).some(
      (parameter) =>
        parameter?.type === "Identifier" &&
        scopeBindings.get(parameter) === actionBinding
    )
  ) {
    return guardedBefore(
      callable,
      actionBinding,
      callStart
    );
  }
  const selectedActionBindings = topLevelScopeVariables(
    scopeManager,
    "selectedAction"
  );
  if (selectedActionBindings.length !== 1) return false;
  const selectedActionBinding = selectedActionBindings[0];
  let selectedAliasFound = false;
  walkEstree(callable.body, (candidate) => {
    if (
      selectedAliasFound ||
      candidate.type !== "VariableDeclarator" ||
      candidate.id?.type !== "Identifier" ||
      scopeBindings.get(candidate.id) !== actionBinding
    ) {
      return;
    }
    const initializer = unwrapValueExpression(candidate.init);
    if (
      initializer?.type === "MemberExpression" &&
      staticMemberProperty(initializer) === "value"
    ) {
      const selected = unwrapValueExpression(
        initializer.object
      );
      if (
        selected?.type === "Identifier" &&
        scopeBindings.get(selected) === selectedActionBinding
      ) {
        selectedAliasFound = true;
      }
    }
  });
  if (!selectedAliasFound) return false;
  let populated = 0;
  let unsafeStateUse = false;
  const rootBinding = (node) => {
    const root = referenceRootIdentifier(node);
    return root?.type === "Identifier"
      ? scopeBindings.get(root)
      : null;
  };
  const protectedCollection = (node) => {
    const value = unwrapValueExpression(node);
    const binding = rootBinding(value);
    const path = memberExpressionWritePath(value);
    if (binding === propsBinding && path === "props") {
      return { kind: "propsRoot", path };
    }
    if (
      binding === propsBinding &&
      (path === null ||
        path === "props.actions" ||
        path?.startsWith("props.actions."))
    ) {
      return { kind: "props", path };
    }
    if (
      binding === actionItemsBinding &&
      (path === "actionItems" ||
        path?.startsWith("actionItems."))
    ) {
      return { kind: "actionItems", path };
    }
    if (
      binding === enabledActionItemsBinding &&
      (path === "enabledActionItems" ||
        path?.startsWith("enabledActionItems."))
    ) {
      return { kind: "enabledActionItems", path };
    }
    return null;
  };
  const patternReadsPropsActions = (pattern, source) => {
    const target = unwrapValueExpression(pattern);
    return (
      rootBinding(source) === propsBinding &&
      target?.type === "ObjectPattern" &&
      (target.properties ?? []).some((property) => {
        if (property.type === "RestElement") return true;
        const key = propertyKey(property);
        return key === null || key === "actions";
      })
    );
  };
  const bindingReferenceAllowed = (
    identifier,
    binding,
    {
      allowTruthy = false,
      allowedMember = null
    } = {}
  ) => {
    if (scopeBindings.get(identifier) !== binding) return true;
    const parent = identifier.parent;
    if (
      parent?.type === "VariableDeclarator" &&
      parent.id === identifier
    ) {
      return true;
    }
    if (
      parent?.type === "MemberExpression" &&
      parent.object === identifier &&
      (allowedMember === null ||
        staticMemberProperty(parent) === allowedMember)
    ) {
      return true;
    }
    return (
      allowTruthy &&
      parent?.type === "UnaryExpression" &&
      parent.operator === "!" &&
      parent.argument === identifier
    );
  };
  walkEstree(ast, (candidate) => {
    if (
      candidate.type === "ObjectExpression" &&
      (candidate.properties ?? []).some((property) =>
        protectedCollection(
          property.type === "SpreadElement"
            ? property.argument
            : property.value
        )
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "ArrayExpression" &&
      (candidate.elements ?? []).some((element) =>
        element?.type === "SpreadElement"
          ? protectedCollection(element.argument)
          : protectedCollection(element)
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "ConditionalExpression" &&
      (protectedCollection(candidate.consequent) ||
        protectedCollection(candidate.alternate))
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "LogicalExpression" &&
      (protectedCollection(candidate.left) ||
        protectedCollection(candidate.right))
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "SequenceExpression" &&
      (candidate.expressions ?? []).some((expression) =>
        protectedCollection(expression)
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "Identifier" &&
      scopeBindings.get(candidate) ===
        selectionParameterBinding
    ) {
      const parent = candidate.parent;
      const isParameterDefinition =
        selectActionDefinitions[0].params?.includes(
          candidate
        );
      const isEnabledMemberRead =
        parent?.type === "MemberExpression" &&
        parent.object === candidate &&
        staticMemberProperty(parent) === "enabled" &&
        !(
          (parent.parent?.type ===
            "AssignmentExpression" &&
            parent.parent.left === parent) ||
          (parent.parent?.type === "UpdateExpression" &&
            parent.parent.argument === parent) ||
          (parent.parent?.type === "UnaryExpression" &&
            parent.parent.operator === "delete") ||
          (parent.parent?.type === "CallExpression" &&
            parent.parent.callee === parent)
        );
      const isSelectedPopulation =
        parent?.type === "AssignmentExpression" &&
        parent.right === candidate &&
        parent.operator === "=" &&
        parent.left?.type === "MemberExpression" &&
        staticMemberProperty(parent.left) === "value" &&
        rootBinding(parent.left) ===
          selectedActionBinding;
      if (
        !isParameterDefinition &&
        !isEnabledMemberRead &&
        !isSelectedPopulation
      ) {
        unsafeStateUse = true;
        return;
      }
    }
    if (
      candidate.type === "Identifier" &&
      !bindingReferenceAllowed(
        candidate,
        selectedActionBinding,
        { allowedMember: "value" }
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "Identifier" &&
      !bindingReferenceAllowed(
        candidate,
        actionBinding,
        { allowTruthy: true }
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "MemberExpression" &&
      rootBinding(candidate) === selectedActionBinding &&
      staticMemberProperty(candidate) === "value"
    ) {
      const parent = candidate.parent;
      const isTrustedAlias =
        parent?.type === "VariableDeclarator" &&
        parent.init === candidate &&
        parent.id?.type === "Identifier" &&
        scopeBindings.get(parent.id) === actionBinding;
      const isAssignmentTarget =
        parent?.type === "AssignmentExpression" &&
        parent.left === candidate;
      if (!isTrustedAlias && !isAssignmentTarget) {
        unsafeStateUse = true;
      }
    }
    if (
      candidate.type === "UpdateExpression" ||
      (candidate.type === "UnaryExpression" &&
        candidate.operator === "delete")
    ) {
      const target =
        candidate.type === "UpdateExpression"
          ? candidate.argument
          : candidate.argument;
      if (
        [selectedActionBinding, actionBinding].includes(
          rootBinding(target)
        ) ||
        protectedCollection(target)
      ) {
        unsafeStateUse = true;
      }
      return;
    }
    if (candidate.type === "CallExpression") {
      if (
        [selectedActionBinding, actionBinding].includes(
          rootBinding(candidate.callee)
        )
      ) {
        unsafeStateUse = true;
        return;
      }
      if (candidate.callee?.type === "MemberExpression") {
        const receiver = protectedCollection(
          candidate.callee.object
        );
        const method = staticMemberProperty(
          candidate.callee
        );
        const canonicalFilter =
          receiver?.kind === "actionItems" &&
          receiver.path === "actionItems.value" &&
          method === "filter";
        const canonicalExecute =
          receiver?.kind === "propsRoot" &&
          method === "execute";
        if (
          receiver &&
          !canonicalFilter &&
          !canonicalExecute
        ) {
          unsafeStateUse = true;
          return;
        }
      }
      if (
        (candidate.arguments ?? []).some(
          (argument) =>
            argument?.type === "SpreadElement" ||
            protectedCollection(argument)
        )
      ) {
        unsafeStateUse = true;
        return;
      }
    }
    if (
      candidate.type === "VariableDeclarator" &&
      (protectedCollection(candidate.init) ||
        patternReadsPropsActions(
          candidate.id,
          candidate.init
        ))
    ) {
      unsafeStateUse = true;
      return;
    }
    if (
      candidate.type === "ReturnStatement" &&
      protectedCollection(candidate.argument)
    ) {
      unsafeStateUse = true;
      return;
    }
    if (candidate.type !== "AssignmentExpression") return;
    if (
      protectedCollection(candidate.left) ||
      protectedCollection(candidate.right) ||
      patternReadsPropsActions(
        candidate.left,
        candidate.right
      )
    ) {
      unsafeStateUse = true;
      return;
    }
    const targetBinding = rootBinding(candidate.left);
    if (targetBinding === actionBinding) {
      unsafeStateUse = true;
      return;
    }
    if (targetBinding !== selectedActionBinding) return;
    if (
      candidate.operator !== "=" ||
      candidate.left?.type !== "MemberExpression" ||
      staticMemberProperty(candidate.left) !== "value"
    ) {
      unsafeStateUse = true;
      return;
    }
    if (expressionIsEmptyCapabilityState(candidate.right)) return;
    populated += 1;
    const assigned = unwrapValueExpression(candidate.right);
    const assignedBinding =
      assigned?.type === "Identifier"
        ? scopeBindings.get(assigned)
        : null;
    let owner = candidate.parent;
    while (
      owner &&
      ![
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(owner.type)
    ) {
      owner = owner.parent;
    }
    if (
      !assignedBinding ||
      !owner ||
      !(owner.params ?? []).some(
        (parameter) =>
          parameter?.type === "Identifier" &&
          scopeBindings.get(parameter) === assignedBinding
      ) ||
      !guardedBefore(
        owner,
        assignedBinding,
        candidate.range?.[0] ?? -1
      )
    ) {
      unsafeStateUse = true;
    }
  });
  const selectActionTemplateCalls = [];
  walkEstree(ast, (candidate) => {
    if (
      candidate.type === "CallExpression" &&
      candidate.callee?.type === "Identifier" &&
      candidate.callee.name === "selectAction" &&
      nodeIsInsideVueTemplate(candidate)
    ) {
      selectActionTemplateCalls.push(candidate);
    }
  });
  const selectedArgument = unwrapValueExpression(
    selectActionTemplateCalls[0]?.arguments?.[0]
  );
  let unsafeSelectActionReference = false;
  walkEstree(ast, (candidate) => {
    if (
      unsafeSelectActionReference ||
      candidate.type !== "Identifier" ||
      candidate.name !== "selectAction"
    ) {
      return;
    }
    const isDefinition =
      candidate.parent?.type === "FunctionDeclaration" &&
      candidate.parent.id === candidate;
    const isCanonicalTemplateCall =
      candidate === selectActionTemplateCalls[0]?.callee;
    if (!isDefinition && !isCanonicalTemplateCall) {
      unsafeSelectActionReference = true;
    }
  });
  return (
    populated === 1 &&
    !unsafeStateUse &&
    !unsafeSelectActionReference &&
    selectActionTemplateCalls.length === 1 &&
    selectActionTemplateCalls[0].arguments?.length === 1 &&
    selectedArgument?.type === "Identifier" &&
    selectedArgument.name === "action" &&
    /@confirm\s*=\s*["']executeAction["']/.test(source)
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
  definitions = indexedCompletionDefinitions(node),
  symbols = null,
  allowFailClosedEarlyReturns = false
) {
  const calls = [];
  let reliable = true;
  const causalTruthiness = staticTruthiness;
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
      const truthiness = causalTruthiness(candidate.test);
      if (truthiness.known) {
        visit(candidate.test, false);
        return visit(
          truthiness.value
            ? candidate.consequent
            : candidate.alternate,
          false
        );
      }
      if (
        !candidate.alternate &&
        allowFailClosedEarlyReturns &&
        symbols &&
        preflightExpressionIsPure(
          candidate.test,
          symbols,
          new Set(),
          false
        ) &&
        preflightExpressionHasRuntimeDependency(
          candidate.test,
          symbols,
          new Set(),
          new Map()
        ) &&
        ["abrupt", "return"].includes(
          statementCompletion(
            candidate.consequent,
            definitions,
            new Set()
          )
        )
      ) {
        visit(candidate.consequent, false);
        return false;
      }
      visit(candidate.test, false);
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
      const left = causalTruthiness(candidate.left);
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
      const test = causalTruthiness(candidate.test);
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
      const test = causalTruthiness(candidate.test);
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
        ? causalTruthiness(candidate.test)
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
          localName: candidate.callee.name,
          bindingIdentifier: candidate.callee,
          callNode: candidate
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
          memberName: candidate.callee.property.name,
          bindingIdentifier: candidate.callee.object,
          callNode: candidate
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
  const resolvedBinding =
    call.resolvedBinding ??
    (call.bindingIdentifier
      ? symbols.scopeBindings?.get(call.bindingIdentifier)
      : null);
  const binding = resolvedBinding
    ? symbols.importsByBinding?.get(resolvedBinding)
    : null;
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

const PREFLIGHT_READ_METHODS = new Set([
  "at",
  "every",
  "filter",
  "find",
  "findIndex",
  "includes",
  "map",
  "some"
]);

const PREFLIGHT_PURE_GLOBALS = new Set(["Boolean"]);

function preflightFunctionBody(definition) {
  if (
    !definition ||
    ![
      "ArrowFunctionExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(definition.type) ||
    definition.async === true ||
    definition.generator === true
  ) {
    return null;
  }
  return definition.body ?? null;
}

function unwrapPreflightExpression(node) {
  let current = node;
  while (
    current &&
    [
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

function preflightBindingIsImmutable(
  binding,
  symbols,
  expectedDefinitionTypes
) {
  if (
    !binding ||
    (symbols.writesByBinding?.get(binding) ?? []).length > 0
  ) {
    return false;
  }
  const definitions = binding.defs ?? [];
  if (definitions.length !== 1) return false;
  const definition = definitions[0];
  if (!expectedDefinitionTypes.has(definition.type)) {
    return false;
  }
  return (
    definition.type !== "Variable" ||
    definition.parent?.kind === "const"
  );
}

function preflightExpressionHasRuntimeDependency(
  node,
  symbols,
  seen = new Set(),
  parameterDependencies = new Map()
) {
  const value = unwrapPreflightExpression(node);
  if (!value) return false;
  if (value.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(value);
    if (!binding) return false;
    if (parameterDependencies.has(binding)) {
      return parameterDependencies.get(binding) === true;
    }
    if (
      symbols.importsByBinding?.has(binding) ||
      seen.has(binding)
    ) {
      return false;
    }
    const declaration = uniqueIndexedNode(
      symbols.declarationsByBinding,
      binding
    );
    if (
      declaration &&
      preflightBindingIsImmutable(
        binding,
        symbols,
        new Set(["Variable"])
      )
    ) {
      const nextSeen = new Set(seen);
      nextSeen.add(binding);
      return preflightExpressionHasRuntimeDependency(
        declaration,
        symbols,
        nextSeen,
        parameterDependencies
      );
    }
    const definitionTypes = new Set(
      (binding.defs ?? []).map(
        (definition) => definition.type
      )
    );
    if (definitionTypes.has("FunctionName")) {
      return false;
    }
    return true;
  }
  if (
    ["Literal", "ThisExpression"].includes(value.type)
  ) {
    return false;
  }
  if (value.type === "AwaitExpression") return true;
  if (value.type === "TemplateLiteral") {
    return (value.expressions ?? []).some((expression) =>
      preflightExpressionHasRuntimeDependency(
        expression,
        symbols,
        seen,
        parameterDependencies
      )
    );
  }
  if (
    [
      "BinaryExpression",
      "LogicalExpression"
    ].includes(value.type)
  ) {
    return (
      preflightExpressionHasRuntimeDependency(
        value.left,
        symbols,
        seen,
        parameterDependencies
      ) ||
      preflightExpressionHasRuntimeDependency(
        value.right,
        symbols,
        seen,
        parameterDependencies
      )
    );
  }
  if (value.type === "UnaryExpression") {
    return preflightExpressionHasRuntimeDependency(
      value.argument,
      symbols,
      seen,
      parameterDependencies
    );
  }
  if (value.type === "ConditionalExpression") {
    return [
      value.test,
      value.consequent,
      value.alternate
    ].some((candidate) =>
      preflightExpressionHasRuntimeDependency(
        candidate,
        symbols,
        seen,
        parameterDependencies
      )
    );
  }
  if (value.type === "MemberExpression") {
    return (
      preflightExpressionHasRuntimeDependency(
        value.object,
        symbols,
        seen,
        parameterDependencies
      ) ||
      (value.computed &&
        preflightExpressionHasRuntimeDependency(
          value.property,
          symbols,
          seen,
          parameterDependencies
        ))
    );
  }
  if (value.type === "ArrayExpression") {
    return (value.elements ?? []).some(
      (element) =>
        element?.type === "SpreadElement" ||
        preflightExpressionHasRuntimeDependency(
          element,
          symbols,
          seen,
          parameterDependencies
        )
    );
  }
  if (value.type === "ObjectExpression") {
    return (value.properties ?? []).some(
      (property) =>
        property?.type === "Property" &&
        property.kind === "init" &&
        property.method !== true &&
        ((property.computed &&
          preflightExpressionHasRuntimeDependency(
            property.key,
            symbols,
            seen,
            parameterDependencies
          )) ||
          preflightExpressionHasRuntimeDependency(
            property.value,
            symbols,
            seen,
            parameterDependencies
          ))
    );
  }
  if (
    [
      "ArrowFunctionExpression",
      "FunctionExpression"
    ].includes(value.type)
  ) {
    return false;
  }
  if (value.type === "BlockStatement") {
    return (value.body ?? []).some((statement) =>
      preflightExpressionHasRuntimeDependency(
        statement,
        symbols,
        seen,
        parameterDependencies
      )
    );
  }
  if (value.type === "ReturnStatement") {
    return preflightExpressionHasRuntimeDependency(
      value.argument,
      symbols,
      seen,
      parameterDependencies
    );
  }
  if (value.type === "VariableDeclaration") {
    return (value.declarations ?? []).some((declaration) =>
      preflightExpressionHasRuntimeDependency(
        declaration.init,
        symbols,
        seen,
        parameterDependencies
      )
    );
  }
  if (value.type !== "CallExpression") return false;
  const argumentDependencies = (value.arguments ?? []).map(
    (argument) =>
      argument?.type === "SpreadElement" ||
      preflightExpressionHasRuntimeDependency(
        argument,
        symbols,
        seen,
        parameterDependencies
      )
  );
  if (value.callee?.type !== "Identifier") {
    return true;
  }
  const binding = symbols.scopeBindings?.get(
    value.callee
  );
  if (
    PREFLIGHT_PURE_GLOBALS.has(value.callee.name) &&
    (!binding ||
      (binding.identifiers ?? []).length === 0)
  ) {
    return argumentDependencies.some(Boolean);
  }
  if (!binding || seen.has(binding)) return true;
  const definition = uniqueIndexedNode(
    symbols.definitionsByBinding,
    binding
  );
  if (!definition) return true;
  const nextParameters = new Map(parameterDependencies);
  for (const [index, parameter] of (
    definition.params ?? []
  ).entries()) {
    const target =
      parameter?.type === "AssignmentPattern"
        ? parameter.left
        : parameter;
    if (target?.type !== "Identifier") continue;
    const parameterBinding =
      symbols.scopeBindings?.get(target);
    if (parameterBinding) {
      nextParameters.set(
        parameterBinding,
        argumentDependencies[index] === true
      );
    }
  }
  const nextSeen = new Set(seen);
  nextSeen.add(binding);
  return preflightExpressionHasRuntimeDependency(
    preflightFunctionBody(definition),
    symbols,
    nextSeen,
    nextParameters
  );
}

function preflightExpressionIsPure(
  node,
  symbols,
  seen = new Set(),
  allowMemberReadMethods = true
) {
  const value = unwrapPreflightExpression(node);
  if (!value) return false;
  if (
    ["Identifier", "Literal"].includes(value.type)
  ) {
    return true;
  }
  if (value.type === "TemplateLiteral") {
    if (
      !allowMemberReadMethods &&
      (value.expressions ?? []).length > 0
    ) {
      return false;
    }
    return (value.expressions ?? []).every((expression) =>
      preflightExpressionIsPure(
        expression,
        symbols,
        seen,
        allowMemberReadMethods
      )
    );
  }
  if (value.type === "BinaryExpression") {
    if (
      !allowMemberReadMethods &&
      !["===", "!=="].includes(value.operator)
    ) {
      return false;
    }
    return (
      preflightExpressionIsPure(
        value.left,
        symbols,
        seen,
        allowMemberReadMethods
      ) &&
      preflightExpressionIsPure(
        value.right,
        symbols,
        seen,
        allowMemberReadMethods
      )
    );
  }
  if (value.type === "LogicalExpression") {
    return (
      preflightExpressionIsPure(
        value.left,
        symbols,
        seen,
        allowMemberReadMethods
      ) &&
      preflightExpressionIsPure(
        value.right,
        symbols,
        seen,
        allowMemberReadMethods
      )
    );
  }
  if (value.type === "UnaryExpression") {
    if (
      value.operator === "delete" ||
      (!allowMemberReadMethods &&
        !["!", "typeof", "void"].includes(
          value.operator
        ))
    ) {
      return false;
    }
    return preflightExpressionIsPure(
      value.argument,
      symbols,
      seen,
      allowMemberReadMethods
    );
  }
  if (value.type === "MemberExpression") {
    if (!allowMemberReadMethods) return false;
    return (
      preflightExpressionIsPure(
        value.object,
        symbols,
        seen,
        allowMemberReadMethods
      ) &&
      (!value.computed ||
        preflightExpressionIsPure(
          value.property,
          symbols,
          seen,
          allowMemberReadMethods
        ))
    );
  }
  if (value.type === "ArrayExpression") {
    return (value.elements ?? []).every(
      (element) =>
        element?.type !== "SpreadElement" &&
        preflightExpressionIsPure(
          element,
          symbols,
          seen,
          allowMemberReadMethods
        )
    );
  }
  if (value.type === "ObjectExpression") {
    return (value.properties ?? []).every(
      (property) =>
        property?.type === "Property" &&
        property.kind === "init" &&
        property.method !== true &&
        (!property.computed ||
          (allowMemberReadMethods &&
            preflightExpressionIsPure(
              property.key,
              symbols,
              seen,
              allowMemberReadMethods
            ))) &&
        preflightExpressionIsPure(
          property.value,
          symbols,
          seen,
          allowMemberReadMethods
        )
    );
  }
  if (
    [
      "ArrowFunctionExpression",
      "FunctionExpression"
    ].includes(value.type)
  ) {
    if (value.async === true || value.generator === true) {
      return false;
    }
    if (value.body?.type === "BlockStatement") {
      return (
        value.body.body?.length === 1 &&
        value.body.body[0]?.type === "ReturnStatement" &&
        preflightExpressionIsPure(
          value.body.body[0].argument,
          symbols,
          seen,
          allowMemberReadMethods
        )
      );
    }
    return preflightExpressionIsPure(
      value.body,
      symbols,
      seen,
      allowMemberReadMethods
    );
  }
  if (value.type !== "CallExpression") return false;
  if (value.optional === true) return false;
  const argumentsArePure = (value.arguments ?? []).every(
    (argument) =>
      argument?.type !== "SpreadElement" &&
      preflightExpressionIsPure(
        argument,
        symbols,
        seen,
        allowMemberReadMethods
      )
  );
  if (!argumentsArePure) return false;
  if (value.callee?.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(
      value.callee
    );
    if (
      PREFLIGHT_PURE_GLOBALS.has(value.callee.name) &&
      (!binding ||
        (binding.identifiers ?? []).length === 0)
    ) {
      return true;
    }
    if (!binding || seen.has(binding)) return false;
    const definition = uniqueIndexedNode(
      symbols.definitionsByBinding,
      binding
    );
    if (!definition) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(binding);
    return preflightPureHelperIsSafe(
      definition,
      symbols,
      nextSeen,
      allowMemberReadMethods
    );
  }
  if (
    value.callee?.type !== "MemberExpression" ||
    value.callee.computed
  ) {
    return false;
  }
  const method =
    value.callee.property?.type === "Identifier"
      ? value.callee.property.name
      : null;
  return (
    allowMemberReadMethods &&
    method !== null &&
    PREFLIGHT_READ_METHODS.has(method) &&
    preflightExpressionIsPure(
      value.callee.object,
      symbols,
      seen,
      allowMemberReadMethods
    )
  );
}

function preflightPureHelperIsSafe(
  definition,
  symbols,
  seen,
  allowMemberReadMethods = true
) {
  const body = preflightFunctionBody(definition);
  if (!body) return false;
  if (
    !allowMemberReadMethods &&
    (definition.params ?? []).some(
      (parameter) => parameter?.type !== "Identifier"
    )
  ) {
    return false;
  }
  if (body.type !== "BlockStatement") {
    return preflightExpressionIsPure(
      body,
      symbols,
      seen,
      allowMemberReadMethods
    );
  }
  const statements = body.body ?? [];
  if (
    statements.length === 0 ||
    statements.at(-1)?.type !== "ReturnStatement"
  ) {
    return false;
  }
  return (
    statements
      .slice(0, -1)
      .every(
        (statement) =>
          statement.type === "VariableDeclaration" &&
          statement.kind === "const" &&
          (statement.declarations ?? []).every(
            (declaration) =>
              declaration.id?.type === "Identifier" &&
              declaration.init &&
              preflightExpressionIsPure(
                declaration.init,
                symbols,
                seen,
                allowMemberReadMethods
              )
          )
      ) &&
    preflightExpressionIsPure(
      statements.at(-1).argument,
      symbols,
      seen,
      allowMemberReadMethods
    )
  );
}

function preflightThrowBranchIsSafe(
  consequent,
  symbols,
  seen
) {
  const statements =
    consequent?.type === "BlockStatement"
      ? consequent.body ?? []
      : [consequent];
  if (
    statements.length === 0 ||
    statements.at(-1)?.type !== "ThrowStatement"
  ) {
    return false;
  }
  const terminal = unwrapPreflightExpression(
    statements.at(-1).argument
  );
  if (
    terminal?.type !== "NewExpression" ||
    terminal.callee?.type !== "Identifier" ||
    !terminal.callee.name.endsWith("Error") ||
    !(terminal.arguments ?? []).every(
      (argument) =>
        argument?.type !== "SpreadElement" &&
        preflightExpressionIsPure(
          argument,
          symbols,
          seen
        )
    )
  ) {
    return false;
  }
  return statements.slice(0, -1).every((statement) => {
    const expression =
      statement?.type === "ExpressionStatement"
        ? statement.expression
        : null;
    if (
      expression?.type !== "AssignmentExpression" ||
      expression.operator !== "="
    ) {
      return false;
    }
    const path =
      expression.left?.type === "Identifier"
        ? expression.left.name
        : memberExpressionWritePath(expression.left);
    return (
      Boolean(path) &&
      (expression.left.type === "Identifier" ||
        path.endsWith(".value")) &&
      preflightExpressionIsPure(
        expression.right,
        symbols,
        seen
      )
    );
  });
}

function failClosedPreflightHelperIsSafe(
  definition,
  symbols
) {
  const body = preflightFunctionBody(definition);
  if (
    body?.type !== "BlockStatement" ||
    (definition.params ?? []).some(
      (parameter) => parameter?.type !== "Identifier"
    )
  ) {
    return false;
  }
  const statements = body.body ?? [];
  const ifIndexes = statements
    .map((statement, index) =>
      statement.type === "IfStatement" ? index : -1
    )
    .filter((index) => index >= 0);
  if (
    ifIndexes.length !== 1 ||
    ifIndexes[0] !== statements.length - 2 ||
    statements.at(-1)?.type !== "ReturnStatement"
  ) {
    return false;
  }
  const guard = statements[ifIndexes[0]];
  if (
    guard.alternate ||
    staticTruthiness(guard.test).known
  ) {
    return false;
  }
  const seen = new Set();
  return (
    statements
      .slice(0, ifIndexes[0])
      .every(
        (statement) =>
          statement.type === "VariableDeclaration" &&
          statement.kind === "const" &&
          (statement.declarations ?? []).every(
            (declaration) =>
              declaration.id?.type === "Identifier" &&
              declaration.init &&
              preflightExpressionIsPure(
                declaration.init,
                symbols,
                seen
              )
          )
      ) &&
    preflightExpressionIsPure(
      guard.test,
      symbols,
      seen
    ) &&
    preflightExpressionHasRuntimeDependency(
      guard.test,
      symbols,
      seen,
      new Map()
    ) &&
    preflightThrowBranchIsSafe(
      guard.consequent,
      symbols,
      seen
    ) &&
    preflightExpressionIsPure(
      statements.at(-1).argument,
      symbols,
      seen
    )
  );
}

function callExpressionMatchesWrapper(
  node,
  wrapper,
  symbols
) {
  if (node?.type !== "CallExpression") return false;
  if (node.callee?.type === "Identifier") {
    return importedCallMatchesWrapper(
      {
        kind: "identifier",
        localName: node.callee.name,
        bindingIdentifier: node.callee
      },
      wrapper,
      symbols
    );
  }
  if (
    node.callee?.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object?.type === "Identifier" &&
    node.callee.property?.type === "Identifier"
  ) {
    return importedCallMatchesWrapper(
      {
        kind: "member",
        localName: node.callee.object.name,
        memberName: node.callee.property.name,
        bindingIdentifier: node.callee.object
      },
      wrapper,
      symbols
    );
  }
  return false;
}

function collectLocalArgumentCalls(
  node,
  symbols,
  names
) {
  const visit = (candidate, isRoot = false) => {
    if (!candidate || typeof candidate !== "object") return;
    if (
      !isRoot &&
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(candidate.type)
    ) {
      return;
    }
    if (
      candidate.type === "CallExpression" &&
      candidate.callee?.type === "Identifier"
    ) {
      const binding = symbols.scopeBindings?.get(
        candidate.callee
      );
      if (
        binding &&
        uniqueIndexedNode(
          symbols.definitionsByBinding,
          binding
        )
      ) {
        names.add(binding);
      }
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            visit(child, false);
          }
        }
      } else if (value && typeof value.type === "string") {
        visit(value, false);
      }
    }
  };
  visit(node, true);
}

function safeWrapperArgumentPreflightHelpers(
  definition,
  wrapper,
  symbols
) {
  const names = new Set();
  const body = preflightFunctionBody(definition);
  if (!body) return names;
  const visit = (node, isRoot = false) => {
    if (!node || typeof node !== "object") return;
    if (
      !isRoot &&
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(node.type)
    ) {
      return;
    }
    if (
      callExpressionMatchesWrapper(
        node,
        wrapper,
        symbols
      )
    ) {
      for (const argument of node.arguments ?? []) {
        collectLocalArgumentCalls(
          argument?.type === "SpreadElement"
            ? argument.argument
            : argument,
          symbols,
          names
        );
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            visit(child, false);
          }
        }
      } else if (value && typeof value.type === "string") {
        visit(value, false);
      }
    }
  };
  visit(body, true);
  return new Set(
    [...names].filter((binding) =>
      failClosedPreflightHelperIsSafe(
        uniqueIndexedNode(
          symbols.definitionsByBinding,
          binding
        ),
        symbols
      )
    )
  );
}

function variantEventCall(node, handler) {
  const expression = unwrapValueExpression(node);
  if (!expression) return null;
  if (
    expression.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name === handler
  ) {
    return expression;
  }
  if (
    [
      "ArrowFunctionExpression",
      "FunctionExpression"
    ].includes(expression.type)
  ) {
    if (expression.body?.type !== "BlockStatement") {
      return variantEventCall(expression.body, handler);
    }
    const executable = (expression.body.body ?? []).filter(
      (statement) => statement.type !== "EmptyStatement"
    );
    if (executable.length !== 1) return null;
    const statement = executable[0];
    if (statement.type === "ExpressionStatement") {
      return variantEventCall(statement.expression, handler);
    }
    if (statement.type === "ReturnStatement") {
      return variantEventCall(statement.argument, handler);
    }
  }
  if (expression.type === "VOnExpression") {
    const executable = (expression.body ?? []).filter(
      (statement) => statement.type !== "EmptyStatement"
    );
    if (executable.length !== 1) return null;
    const statement = executable[0];
    if (statement.type === "ExpressionStatement") {
      return variantEventCall(statement.expression, handler);
    }
    if (statement.type === "ReturnStatement") {
      return variantEventCall(statement.argument, handler);
    }
  }
  return null;
}

function staticPropertyName(node) {
  if (!node) return null;
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  return literalString(node.property);
}

function variantSymbolicValue(
  node,
  state,
  symbols,
  seenBindings = new Set()
) {
  const value = unwrapValueExpression(node);
  if (!value) return null;
  const literal = literalString(value);
  if (literal !== null) {
    return { kind: "scalar", value: literal };
  }
  if (value.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(value);
    if (!binding) return null;
    const known = state.get(binding);
    if (known) return known;
    if (seenBindings.has(binding)) return null;
    const declaration = uniqueIndexedNode(
      symbols.declarationsByBinding,
      binding
    );
    if (!declaration) return null;
    const nextSeen = new Set(seenBindings);
    nextSeen.add(binding);
    return variantSymbolicValue(
      declaration,
      state,
      symbols,
      nextSeen
    );
  }
  if (value.type === "MemberExpression") {
    const property = staticPropertyName(value);
    if (property === null) return null;
    const receiver = variantSymbolicValue(
      value.object,
      state,
      symbols,
      seenBindings
    );
    if (
      receiver?.kind !== "object" ||
      receiver.invalidated === true
    ) {
      return null;
    }
    return receiver.fields.get(property) ?? null;
  }
  if (value.type === "SequenceExpression") {
    return variantSymbolicValue(
      value.expressions?.at(-1),
      state,
      symbols,
      seenBindings
    );
  }
  if (value.type === "ConditionalExpression") {
    const consequent = variantSymbolicValue(
      value.consequent,
      state,
      symbols,
      seenBindings
    );
    const alternate = variantSymbolicValue(
      value.alternate,
      state,
      symbols,
      seenBindings
    );
    return variantSymbolicKey(consequent) ===
      variantSymbolicKey(alternate)
      ? consequent
      : null;
  }
  if (value.type === "ArrayExpression") {
    const fields = new Map();
    for (let index = 0; index < (value.elements ?? []).length; index += 1) {
      const element = value.elements[index];
      if (!element || element.type === "SpreadElement") return null;
      const symbolic = variantSymbolicValue(
        element,
        state,
        symbols,
        seenBindings
      );
      if (symbolic) fields.set(String(index), symbolic);
    }
    return { kind: "object", fields };
  }
  if (value.type !== "ObjectExpression") return null;
  const fields = new Map();
  for (const property of value.properties ?? []) {
    if (property.type === "SpreadElement") {
      const spread = variantSymbolicValue(
        property.argument,
        state,
        symbols,
        seenBindings
      );
      if (spread?.kind !== "object") return null;
      for (const [key, symbolic] of spread.fields) {
        fields.set(key, symbolic);
      }
      continue;
    }
    if (
      property.type !== "Property" ||
      property.kind !== "init" ||
      property.method === true
    ) {
      return null;
    }
    const key = property.computed
      ? literalString(property.key)
      : property.key?.type === "Identifier"
        ? property.key.name
        : literalString(property.key);
    if (key === null) return null;
    const symbolic = variantSymbolicValue(
      property.value,
      state,
      symbols,
      seenBindings
    );
    if (symbolic) fields.set(key, symbolic);
    else fields.delete(key);
  }
  return { kind: "object", fields };
}

function variantSymbolicKey(value) {
  if (!value) return "unknown";
  if (value.kind === "scalar") {
    return `scalar:${JSON.stringify(value.value)}`;
  }
  if (value.kind !== "object") return "unknown";
  if (value.invalidated === true) return "object:invalidated";
  return `object:{${[...value.fields]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(
      ([key, child]) =>
        `${JSON.stringify(key)}:${variantSymbolicKey(child)}`
    )
    .join(",")}}`;
}

const VARIANT_SEMANTIC_FIELDS = new Set([
  "action",
  "decision",
  "kind",
  "key",
  "mode",
  "variant"
]);
const VARIANT_ENVELOPE_FIELDS = new Set([
  "body",
  "data",
  "payload",
  "request"
]);

function symbolicVariantEvidence(
  value,
  variant,
  allowDirectScalar = true
) {
  if (!value || value.kind === "unknown") {
    return "none";
  }
  if (value.kind === "scalar") {
    return allowDirectScalar && value.value === variant
      ? "match"
      : "none";
  }
  if (value.invalidated === true) return "conflict";
  const semanticValues = [...value.fields].filter(([key]) =>
    VARIANT_SEMANTIC_FIELDS.has(key)
  );
  if (semanticValues.length > 0) {
    return semanticValues.every(
      ([, child]) =>
        child?.kind === "scalar" &&
        child.value === variant
    )
      ? "match"
      : "conflict";
  }
  const envelopeEvidence = [...value.fields]
    .filter(([key]) => VARIANT_ENVELOPE_FIELDS.has(key))
    .map(([, child]) =>
      symbolicVariantEvidence(child, variant, false)
    );
  if (envelopeEvidence.includes("conflict")) {
    return "conflict";
  }
  return envelopeEvidence.includes("match")
    ? "match"
    : "none";
}

function callCarriesVariant(callNode, variant, state, symbols) {
  const evidence = (callNode?.arguments ?? [])
    .filter((argument) => argument?.type !== "SpreadElement")
    .map((argument) =>
      symbolicVariantEvidence(
        variantSymbolicValue(argument, state, symbols),
        variant
      )
  );
  return (
    !evidence.includes("conflict") &&
    evidence.includes("match")
  );
}

function cloneVariantSymbolicValue(value, memo = new Map()) {
  if (!value || value.kind !== "object") return value;
  if (memo.has(value)) return memo.get(value);
  const clone = {
    kind: "object",
    fields: new Map(),
    ...(value.invalidated === true
      ? { invalidated: true }
      : {})
  };
  memo.set(value, clone);
  for (const [key, child] of value.fields) {
    clone.fields.set(
      key,
      cloneVariantSymbolicValue(child, memo)
    );
  }
  return clone;
}

function cloneVariantState(state) {
  const memo = new Map();
  return new Map(
    [...state].map(([binding, value]) => [
      binding,
      cloneVariantSymbolicValue(value, memo)
    ])
  );
}

function variantStateNodesBeforeCall(
  definition,
  callNode
) {
  const output = [];
  let stopped = false;
  const visit = (node, isRoot = false) => {
    if (
      stopped ||
      !node ||
      typeof node !== "object"
    ) {
      return;
    }
    if (node === callNode) {
      for (const argument of node.arguments ?? []) {
        if (argument?.type !== "SpreadElement") {
          visit(argument, false);
        }
      }
      stopped = true;
      return;
    }
    if (
      !isRoot &&
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression"
      ].includes(node.type)
    ) {
      return;
    }
    if (
      node.type === "Program" ||
      node.type === "BlockStatement"
    ) {
      for (const statement of node.body ?? []) {
        visit(statement, false);
        if (stopped) break;
      }
      return;
    }
    if (node.type === "IfStatement") {
      visit(node.test, false);
      const test = staticTruthiness(node.test);
      if (test.known) {
        visit(
          test.value ? node.consequent : node.alternate,
          false
        );
      } else {
        output.push({ type: "UnknownVariantControlFlow" });
      }
      return;
    }
    if (node.type === "ConditionalExpression") {
      visit(node.test, false);
      const test = staticTruthiness(node.test);
      if (test.known) {
        visit(
          test.value ? node.consequent : node.alternate,
          false
        );
      } else {
        output.push({ type: "UnknownVariantControlFlow" });
      }
      return;
    }
    if (node.type === "LogicalExpression") {
      visit(node.left, false);
      const left = staticTruthiness(node.left);
      if (!left.known) {
        output.push({ type: "UnknownVariantControlFlow" });
        return;
      }
      if (
        (node.operator === "&&" && left.value) ||
        (node.operator === "||" && !left.value)
      ) {
        visit(node.right, false);
      }
      return;
    }
    if (node.type === "WhileStatement") {
      visit(node.test, false);
      const test = staticTruthiness(node.test);
      if (test.known && !test.value) return;
      output.push({ type: "UnknownVariantControlFlow" });
      return;
    }
    if (
      [
        "DoWhileStatement",
        "ForInStatement",
        "ForOfStatement",
        "ForStatement",
        "SwitchStatement",
        "TryStatement"
      ].includes(node.type)
    ) {
      output.push({ type: "UnknownVariantControlFlow" });
      return;
    }
    if (node.type === "VariableDeclarator") {
      visit(node.init, false);
      output.push(node);
      return;
    }
    if (node.type === "AssignmentExpression") {
      visit(node.right, false);
      output.push(node);
      return;
    }
    if (
      node.type === "UpdateExpression" ||
      (node.type === "UnaryExpression" &&
        node.operator === "delete")
    ) {
      output.push(node);
      return;
    }
    if (node.type === "CallExpression") {
      visit(node.callee, false);
      for (const argument of node.arguments ?? []) {
        if (argument?.type !== "SpreadElement") {
          visit(argument, false);
        }
      }
      output.push(node);
      return;
    }
    const children = [];
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          "comments",
          "loc",
          "parent",
          "range",
          "tokens"
        ].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            children.push(child);
          }
        }
      } else if (value && typeof value.type === "string") {
        children.push(value);
      }
    }
    children
      .sort(
        (left, right) =>
          (left.range?.[0] ?? 0) -
          (right.range?.[0] ?? 0)
      )
      .forEach((child) => visit(child, false));
  };
  visit(definition?.body ?? definition, true);
  return output;
}

function setUnknownVariantBinding(state, binding) {
  if (binding) state.set(binding, { kind: "unknown" });
}

function invalidateVariantSymbolicValue(
  value,
  seen = new Set()
) {
  if (
    !value ||
    value.kind !== "object" ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  value.invalidated = true;
  for (const child of value.fields.values()) {
    invalidateVariantSymbolicValue(child, seen);
  }
}

function invalidateVariantState(state) {
  const seen = new Set();
  for (const [binding, value] of state) {
    if (value?.kind === "object") {
      invalidateVariantSymbolicValue(value, seen);
    } else {
      state.set(binding, { kind: "unknown" });
    }
  }
}

function invalidateVariantAssignmentPattern(
  pattern,
  state,
  symbols
) {
  const target = unwrapValueExpression(pattern);
  if (!target) {
    invalidateVariantState(state);
    return;
  }
  if (target.type === "Identifier") {
    setUnknownVariantBinding(
      state,
      symbols.scopeBindings?.get(target)
    );
    return;
  }
  if (target.type === "MemberExpression") {
    invalidateVariantSymbolicValue(
      variantSymbolicValue(
        target.object,
        state,
        symbols
      )
    );
    return;
  }
  if (target.type === "AssignmentPattern") {
    invalidateVariantAssignmentPattern(
      target.left,
      state,
      symbols
    );
    return;
  }
  if (target.type === "RestElement") {
    invalidateVariantAssignmentPattern(
      target.argument,
      state,
      symbols
    );
    return;
  }
  if (target.type === "ObjectPattern") {
    for (const property of target.properties ?? []) {
      invalidateVariantAssignmentPattern(
        property.type === "RestElement"
          ? property.argument
          : property.value,
        state,
        symbols
      );
    }
    return;
  }
  if (target.type === "ArrayPattern") {
    for (const element of target.elements ?? []) {
      if (element) {
        invalidateVariantAssignmentPattern(
          element,
          state,
          symbols
        );
      }
    }
    return;
  }
  invalidateVariantState(state);
}

function applyVariantStateNode(node, state, symbols) {
  if (node.type === "UnknownVariantControlFlow") {
    invalidateVariantState(state);
    return;
  }
  if (
    node.type === "VariableDeclarator" &&
    node.id?.type === "Identifier"
  ) {
    const binding = symbols.scopeBindings?.get(node.id);
    if (!binding) return;
    const value = node.init
      ? variantSymbolicValue(node.init, state, symbols)
      : null;
    state.set(binding, value ?? { kind: "unknown" });
    return;
  }
  if (node.type === "UpdateExpression") {
    const target = unwrapValueExpression(node.argument);
    if (target?.type === "Identifier") {
      setUnknownVariantBinding(
        state,
        symbols.scopeBindings?.get(target)
      );
      return;
    }
    if (target?.type === "MemberExpression") {
      const receiver = variantSymbolicValue(
        target.object,
        state,
        symbols
      );
      if (receiver?.kind === "object") {
        receiver.invalidated = true;
      }
    }
    return;
  }
  if (
    node.type === "UnaryExpression" &&
    node.operator === "delete"
  ) {
    const target = unwrapValueExpression(node.argument);
    if (target?.type === "Identifier") {
      setUnknownVariantBinding(
        state,
        symbols.scopeBindings?.get(target)
      );
      return;
    }
    if (target?.type === "MemberExpression") {
      const receiver = variantSymbolicValue(
        target.object,
        state,
        symbols
      );
      if (receiver?.kind === "object") {
        invalidateVariantSymbolicValue(receiver);
      }
    }
    return;
  }
  if (node.type === "CallExpression") {
    for (const argument of node.arguments ?? []) {
      if (argument?.type === "SpreadElement") {
        invalidateVariantState(state);
        continue;
      }
      invalidateVariantSymbolicValue(
        variantSymbolicValue(
          argument,
          state,
          symbols
        )
      );
    }
    invalidateVariantState(state);
    return;
  }
  if (node.type !== "AssignmentExpression") return;
  const target = unwrapValueExpression(node.left);
  if (
    ["ArrayPattern", "ObjectPattern"].includes(target?.type)
  ) {
    invalidateVariantAssignmentPattern(
      target,
      state,
      symbols
    );
    return;
  }
  if (target?.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(target);
    if (!binding) return;
    const value =
      node.operator === "="
        ? variantSymbolicValue(node.right, state, symbols)
        : null;
    state.set(binding, value ?? { kind: "unknown" });
    return;
  }
  if (target?.type !== "MemberExpression") return;
  const receiver = variantSymbolicValue(
    target.object,
    state,
    symbols
  );
  if (receiver?.kind !== "object") return;
  const property = staticPropertyName(target);
  if (node.operator !== "=" || property === null) {
    receiver.invalidated = true;
    return;
  }
  const value = variantSymbolicValue(
    node.right,
    state,
    symbols
  );
  receiver.fields.set(
    property,
    value ?? { kind: "unknown" }
  );
}

function variantStateBeforeCall(
  definition,
  callNode,
  initialState,
  symbols
) {
  const state = cloneVariantState(initialState);
  for (const node of variantStateNodesBeforeCall(
    definition,
    callNode
  )) {
    applyVariantStateNode(node, state, symbols);
  }
  return state;
}

function bindVariantArguments(
  definition,
  argumentsList,
  state,
  symbols
) {
  const nextState = new Map();
  for (let index = 0; index < (definition?.params ?? []).length; index += 1) {
    const parameter = definition.params[index];
    const argument = argumentsList?.[index];
    if (
      parameter?.type !== "Identifier" ||
      !argument ||
      argument.type === "SpreadElement"
    ) {
      continue;
    }
    const binding = symbols.scopeBindings?.get(parameter);
    const symbolic = variantSymbolicValue(
      argument,
      state,
      symbols
    );
    if (binding && symbolic) nextState.set(binding, symbolic);
  }
  return nextState;
}

function businessDraftVariantState(
  definition,
  variant,
  symbols
) {
  const state = new Map();
  const parameter = definition?.params?.[0];
  if (parameter?.type !== "Identifier") return state;
  const binding = symbols.scopeBindings?.get(parameter);
  if (binding) {
    state.set(binding, {
      kind: "object",
      fields: new Map([
        ["action", { kind: "scalar", value: variant }]
      ])
    });
  }
  return state;
}

function callableVariantStateKey(definition, state, symbols) {
  return (definition?.params ?? [])
    .map((parameter) => {
      if (parameter?.type !== "Identifier") return "unsupported";
      const binding = symbols.scopeBindings?.get(parameter);
      return binding
        ? variantSymbolicKey(state.get(binding))
        : "unbound";
    })
    .join("|");
}

function wrapperCausalProof(
  handler,
  wrapper,
  symbols,
  {
    candidate = null,
    variant = null,
    businessDraftActionTrusted = false,
    capability = null,
    capabilityContext = null
  } = {}
) {
  const handlerBindings = topLevelScopeVariables(
    symbols.scopeManager,
    handler
  );
  if (handlerBindings.length !== 1) {
    return {
      verified: false,
      localCallChain: [handler]
    };
  }
  const handlerBinding = handlerBindings[0];
  const handlerDefinition = uniqueIndexedNode(
    symbols.definitionsByBinding,
    handlerBinding
  );
  const eventCall = variantEventCall(
    candidate?.expression,
    handler
  );
  let initialState = handlerDefinition && eventCall
    ? bindVariantArguments(
        handlerDefinition,
        eventCall.arguments,
        new Map(),
        symbols
      )
    : new Map();
  if (
    variant &&
    businessDraftActionTrusted &&
    candidate?.kind === "prop_callback" &&
    candidate.element === "business-draft-action" &&
    candidate.event === "execute"
  ) {
    initialState = businessDraftVariantState(
      handlerDefinition,
      variant,
      symbols
    );
  }
  const initialImport =
    symbols.importsByBinding?.get(handlerBinding);
  if (
    initialImport &&
    importedCallMatchesWrapper(
      {
        kind: "identifier",
        localName: handler,
        resolvedBinding: handlerBinding
      },
      wrapper,
      symbols
    )
  ) {
    return {
      verified:
        !variant ||
        callCarriesVariant(
          eventCall,
          variant,
          initialState,
          symbols
        ),
      localCallChain: [handler]
    };
  }
  const pending = [
    {
      binding: handlerBinding,
      name: handler,
      chain: [handler],
      state: initialState
    }
  ];
  const visited = new Map();
  let verifiedChain = null;
  let inspectedStates = 0;
  let variantMismatch = false;
  while (pending.length && inspectedStates < 128) {
    const current = pending.shift();
    const definition = uniqueIndexedNode(
      symbols.definitionsByBinding,
      current.binding
    );
    if (!definition) continue;
    const stateKey = callableVariantStateKey(
      definition,
      current.state,
      symbols
    );
    const bindingStates = visited.get(current.binding) ?? new Set();
    if (bindingStates.has(stateKey)) continue;
    bindingStates.add(stateKey);
    visited.set(current.binding, bindingStates);
    inspectedStates += 1;
    const analysis = directCallTargets(
      definition,
      symbols.declarations,
      symbols,
      current.chain.length === 1
    );
    if (!analysis.reliable) {
      return {
        verified: false,
        localCallChain: [handler]
      };
    }
    const safePreflightHelpers =
      safeWrapperArgumentPreflightHelpers(
        definition,
        wrapper,
        symbols
      );
    const delegatedPreflight =
      capability && capabilityContext &&
      current.binding === handlerBinding
        ? delegatedBackgroundCapabilityPreflight(
            { kind: "background_call", expression: definition },
            capability,
            capabilityContext
          )
        : null;
    for (const call of analysis.calls) {
      const callState = variantStateBeforeCall(
        definition,
        call.callNode,
        current.state,
        symbols
      );
      const callBinding = call.bindingIdentifier
        ? symbols.scopeBindings?.get(
            call.bindingIdentifier
          )
        : null;
      if (importedCallMatchesWrapper(call, wrapper, symbols)) {
        if (
          variant &&
          !callCarriesVariant(
            call.callNode,
            variant,
            callState,
            symbols
          )
        ) {
          variantMismatch = true;
        } else {
          verifiedChain ??= [
              ...current.chain,
              call.kind === "identifier"
                ? call.localName
                : `${call.localName}.${call.memberName}`
            ];
        }
      }
      if (
        call.kind === "identifier" &&
        !callBinding
      ) {
        return {
          verified: false,
          localCallChain: [handler]
        };
      }
      if (
        call.kind === "identifier" &&
        callBinding &&
        !safePreflightHelpers.has(callBinding) &&
        callBinding !== delegatedPreflight?.helperBinding &&
        uniqueIndexedNode(
          symbols.definitionsByBinding,
          callBinding
        )
      ) {
        const nextDefinition = uniqueIndexedNode(
          symbols.definitionsByBinding,
          callBinding
        );
        pending.push({
          binding: callBinding,
          name: call.localName,
          chain: [...current.chain, call.localName],
          state: bindVariantArguments(
            nextDefinition,
            call.callNode?.arguments,
            callState,
            symbols
          )
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
  if (verifiedChain && !variantMismatch) {
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
  const bindings = new Map();
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
      wrapper.returnProvenance !==
        "transparent_main_response" ||
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
      const importVariable =
        symbols.importVariablesByName?.get(localName);
      if (importVariable) {
        bindings.set(
          importVariable,
          wrapperIdentity(
            binding.sourceFile,
            binding.importedName
          )
        );
      }
    }
  }
  return bindings;
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
  candidate,
  businessDraftActionTrusted,
  capabilityContext
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
          symbols,
          {
            candidate,
            variant:
              declared.variant ??
              action.trigger.variant,
            businessDraftActionTrusted,
            capability: action.capability,
            capabilityContext
          }
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
          localCallChain: causalProof.localCallChain,
          ...(declared.variant
            ? { variant: declared.variant }
            : {})
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
    if (
      wrapper.returnProvenance !== undefined &&
      !WEB_RETURN_PROVENANCE.has(
        wrapper.returnProvenance
      )
    ) {
      issues.push({
        code: "UPSTREAM_WEB_WRAPPER_RETURN_PROVENANCE_INVALID",
        apiFile: posixPath(wrapper.apiFile),
        wrapper: wrapper.name,
        returnProvenance: wrapper.returnProvenance
      });
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

function upstreamWebCoverageContextIsTrusted({
  manifest,
  sourceFiles,
  reachable
}) {
  if (!isRecord(manifest.blockers)) return false;
  const blockerGroups = Object.values(manifest.blockers);
  if (!blockerGroups.every(Array.isArray)) return false;
  const hasBlockers = blockerGroups.some(
    (entries) => entries.length > 0
  );
  if (
    (manifest.status === "ready" && hasBlockers) ||
    (manifest.status === "blocked" && !hasBlockers) ||
    !["ready", "blocked"].includes(manifest.status)
  ) {
    return false;
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
    return false;
  }
  return (
    isRecord(manifest.evidence) &&
    manifest.evidence.productionModuleCount ===
      sourceFiles.length &&
    manifest.evidence.reachableProductionModuleCount ===
      reachable.size
  );
}

function upstreamBlockerReferencesAssociation(
  value,
  association
) {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      upstreamBlockerReferencesAssociation(
        entry,
        association
      )
    );
  }
  if (!isRecord(value)) return false;
  const blockerApiFile = isNonEmptyString(value.apiFile)
    ? posixPath(value.apiFile)
    : null;
  const blockerWrapper = isNonEmptyString(value.wrapper)
    ? value.wrapper
    : isNonEmptyString(value.name)
      ? value.name
      : null;
  if (
    blockerWrapper === association.wrapper &&
    (!blockerApiFile ||
      blockerApiFile === association.apiFile)
  ) {
    return true;
  }
  const blockerNormalizedKeys = uniqueStrings([
    ...(isNonEmptyString(value.normalizedKey)
      ? [value.normalizedKey]
      : []),
    ...(Array.isArray(value.normalizedKeys)
      ? value.normalizedKeys.filter(isNonEmptyString)
      : [])
  ]);
  if (
    blockerNormalizedKeys.some((normalizedKey) =>
      association.normalizedKeys.includes(normalizedKey)
    )
  ) {
    return true;
  }
  const blockerConsumer = isNonEmptyString(value.consumer)
    ? posixPath(value.consumer)
    : isNonEmptyString(value.sourceFile)
      ? posixPath(value.sourceFile)
      : null;
  if (
    blockerConsumer &&
    association.productionConsumers.includes(
      blockerConsumer
    )
  ) {
    return true;
  }
  return Object.values(value).some((entry) =>
    upstreamBlockerReferencesAssociation(
      entry,
      association
    )
  );
}

function wrapperRequestsAreSelfConsistent(wrapper) {
  if (
    !Array.isArray(wrapper.requests) ||
    wrapper.requests.length === 0
  ) {
    return false;
  }
  const mainRequestIdentities = new Set();
  for (const request of wrapper.requests) {
    if (request?.kind === "main") {
      const expected = normalizedRequestIdentity(request);
      if (
        !expected ||
        expected !== request.normalizedKey ||
        mainRequestIdentities.has(expected)
      ) {
        return false;
      }
      mainRequestIdentities.add(expected);
      continue;
    }
    if (
      request?.kind !== "ticket_followup" ||
      !isNonEmptyString(request.method) ||
      !["GET", "HEAD"].includes(
        request.method.toUpperCase()
      )
    ) {
      return false;
    }
  }
  return mainRequestIdentities.size > 0;
}

function trustedWebWrapperForAssociation({
  manifest,
  association
}) {
  const matches = manifest.wrappers.filter(
    (wrapper) =>
      isNonEmptyString(wrapper?.apiFile) &&
      isNonEmptyString(wrapper?.name) &&
      wrapperIdentity(
        posixPath(wrapper.apiFile),
        wrapper.name
      ) ===
        wrapperIdentity(
          association.apiFile,
          association.wrapper
        )
  );
  if (matches.length !== 1) return null;
  const wrapper = matches[0];
  if (
    !Array.isArray(wrapper.productionConsumers) ||
    !association.productionConsumers.every((consumer) =>
      wrapper.productionConsumers
        .map(posixPath)
        .includes(consumer)
    ) ||
    !wrapperRequestsAreSelfConsistent(wrapper) ||
    Object.entries(manifest.blockers).some(
      ([groupName, group]) =>
        groupName !== "duplicateWriteWrappers" &&
        upstreamBlockerReferencesAssociation(
          group,
          association
        )
    )
  ) {
    return null;
  }
  return wrapper;
}

function nestRouteAssociationIsTrusted(
  manifest,
  normalizedKey
) {
  if (
    manifest.authorizationScope !==
      "guard_metadata_only" ||
    !isNonEmptyString(normalizedKey)
  ) {
    return false;
  }
  const matches = manifest.routes.filter(
    (route) => route?.normalizedKey === normalizedKey
  );
  if (matches.length !== 1) return false;
  const route = matches[0];
  if (
    !isNonEmptyString(route.method) ||
    !isNonEmptyString(route.path) ||
    route.method !== route.method.toUpperCase()
  ) {
    return false;
  }
  return (
    `${route.method} ${normalizeRouteIdentityPath(
      route.path
    )}` === normalizedKey
  );
}

function bindingUpstreamAssociationIsTrusted({
  binding,
  webManifest,
  nestManifest
}) {
  if (
    !isNonEmptyString(binding.normalizedKey) ||
    binding.productionConsumers.length === 0
  ) {
    return false;
  }
  const association = {
    apiFile: posixPath(binding.apiFile),
    wrapper: binding.wrapper,
    normalizedKeys: [binding.normalizedKey],
    productionConsumers:
      binding.productionConsumers.map(posixPath)
  };
  const wrapper = trustedWebWrapperForAssociation({
    manifest: webManifest,
    association
  });
  if (!wrapper) return false;
  const matchingRequests = normalizedMainRequests(
    wrapper
  ).filter(
    (request) =>
      request.normalizedKey === binding.normalizedKey
  );
  return (
    matchingRequests.length === 1 &&
    matchingRequests[0].method.toUpperCase() ===
      binding.method &&
    matchingRequests[0].path === binding.path &&
    nestRouteAssociationIsTrusted(
      nestManifest,
      binding.normalizedKey
    )
  );
}

function capabilitySourceUpstreamAssociationIsTrusted({
  sourceIdentity,
  sourceFile,
  webManifest,
  nestManifest
}) {
  const separator = sourceIdentity.indexOf("\u0000");
  if (separator < 1) return false;
  const apiFile = sourceIdentity.slice(0, separator);
  const wrapperName = sourceIdentity.slice(separator + 1);
  const candidates = webManifest.wrappers.filter(
    (wrapper) =>
      isNonEmptyString(wrapper?.apiFile) &&
      isNonEmptyString(wrapper?.name) &&
      wrapperIdentity(
        posixPath(wrapper.apiFile),
        wrapper.name
      ) === sourceIdentity
  );
  if (candidates.length !== 1) return false;
  const mainRequests = normalizedMainRequests(
    candidates[0]
  );
  const normalizedKeys = uniqueStrings(
    mainRequests
      .map((request) => request.normalizedKey)
      .filter(isNonEmptyString)
  );
  const association = {
    apiFile,
    wrapper: wrapperName,
    normalizedKeys,
    productionConsumers: [posixPath(sourceFile)]
  };
  const wrapper = trustedWebWrapperForAssociation({
    manifest: webManifest,
    association
  });
  return (
    Boolean(wrapper) &&
    wrapper.returnProvenance ===
      "transparent_main_response" &&
    mainRequests.length > 0 &&
    mainRequests.every(
      (request) =>
        isNonEmptyString(request.method) &&
        ["GET", "HEAD"].includes(
          request.method.toUpperCase()
        ) &&
        nestRouteAssociationIsTrusted(
          nestManifest,
          request.normalizedKey
        )
    )
  );
}

function staticStringArray(
  expression,
  declarations,
  seen = new Set()
) {
  const node = unwrapValueExpression(expression);
  if (!node) return null;
  if (node.type === "Identifier") {
    if (seen.has(node.name)) return null;
    const declaration = declarations.get(node.name);
    return declaration
      ? staticStringArray(
          declaration,
          declarations,
          new Set(seen).add(node.name)
        )
      : null;
  }
  if (node.type !== "ArrayExpression") return null;
  const values = [];
  for (const element of node.elements ?? []) {
    if (!element) return null;
    if (element.type === "SpreadElement") {
      const spread = staticStringArray(
        element.argument,
        declarations,
        seen
      );
      if (!spread) return null;
      values.push(...spread);
      continue;
    }
    const value = literalString(unwrapValueExpression(element));
    if (!isNonEmptyString(value)) return null;
    values.push(value);
  }
  return uniqueStrings(values);
}

function permissionPolicyIsStatic(ast) {
  const aliases = new Set(["ACTION_REQUIRED_ROLES"]);
  let changed = true;
  while (changed) {
    changed = false;
    walkEstree(ast, (node) => {
      if (
        node.type !== "VariableDeclarator" ||
        node.id?.type !== "Identifier" ||
        !node.init
      ) {
        return;
      }
      const root = referenceRootIdentifier(node.init)?.name;
      if (
        root &&
        aliases.has(root) &&
        !aliases.has(node.id.name)
      ) {
        aliases.add(node.id.name);
        changed = true;
      }
    });
  }
  const mutationMethods = new Set([
    "clear",
    "copyWithin",
    "delete",
    "fill",
    "pop",
    "push",
    "reverse",
    "set",
    "shift",
    "sort",
    "splice",
    "unshift"
  ]);
  let safe = true;
  walkEstree(ast, (node) => {
    if (!safe) return;
    if (
      node.type === "AssignmentExpression" ||
      node.type === "UpdateExpression" ||
      (node.type === "UnaryExpression" &&
        node.operator === "delete")
    ) {
      const target =
        node.type === "AssignmentExpression"
          ? node.left
          : node.argument;
      if (aliases.has(referenceRootIdentifier(target)?.name)) {
        safe = false;
      }
      return;
    }
    if (node.type !== "CallExpression") return;
    const callee = unwrapValueExpression(node.callee);
    if (callee?.type === "MemberExpression") {
      const method = callee.computed
        ? literalString(callee.property)
        : callee.property?.type === "Identifier"
          ? callee.property.name
          : null;
      if (
        method &&
        mutationMethods.has(method) &&
        aliases.has(
          referenceRootIdentifier(callee.object)?.name
        )
      ) {
        safe = false;
        return;
      }
      if (
        memberExpressionPath(callee) === "Object.assign" &&
        aliases.has(
          referenceRootIdentifier(node.arguments?.[0])?.name
        )
      ) {
        safe = false;
        return;
      }
    }
    if (
      node.arguments?.some((argument) =>
        aliases.has(referenceRootIdentifier(argument)?.name)
      )
    ) {
      safe = false;
    }
  });
  return safe;
}

function actionRequiredRolesFromSource(source) {
  if (typeof source !== "string") return null;
  let ast;
  try {
    ast = parseSource(PERMISSIONS_SOURCE_PATH, source);
  } catch {
    return null;
  }
  if (!permissionPolicyIsStatic(ast)) return null;
  const declarations = new Map();
  for (const statement of ast.body ?? []) {
    if (
      statement.type !== "ExportNamedDeclaration" &&
      statement.type !== "VariableDeclaration"
    ) {
      continue;
    }
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations ?? []) {
      if (
        item.id?.type === "Identifier" &&
        item.init
      ) {
        declarations.set(item.id.name, item.init);
      }
    }
  }
  const policy = unwrapValueExpression(
    declarations.get("ACTION_REQUIRED_ROLES")
  );
  if (policy?.type !== "ObjectExpression") return null;
  const rolesByAction = new Map();
  for (const property of policy.properties ?? []) {
    if (
      property.type !== "Property" ||
      property.kind !== "init" ||
      property.computed
    ) {
      return null;
    }
    const action = propertyKey(property);
    const roles = staticStringArray(
      property.value,
      declarations
    );
    if (
      !isNonEmptyString(action) ||
      !roles ||
      roles.length === 0 ||
      rolesByAction.has(action)
    ) {
      return null;
    }
    rolesByAction.set(action, roles);
  }
  return rolesByAction.size > 0 ? rolesByAction : null;
}

const UNRESTRICTED_ACTOR_POSITIONS = Symbol(
  "unrestricted_actor_positions"
);

function actorPositionsForRoute(route, rolesByAction) {
  if (!isRecord(route)) return null;
  const requiredPositions = Array.isArray(route.requiredPositions)
    ? uniqueStrings(
        route.requiredPositions.filter(isNonEmptyString)
      )
    : null;
  if (
    !requiredPositions ||
    requiredPositions.length !==
      (route.requiredPositions?.length ?? 0)
  ) {
    return null;
  }
  const actionPositions =
    route.requiredProjectAction === null
      ? null
      : isNonEmptyString(route.requiredProjectAction)
        ? rolesByAction?.get(route.requiredProjectAction) ?? null
        : null;
  if (
    route.requiredProjectAction !== null &&
    !actionPositions
  ) {
    return null;
  }
  if (requiredPositions.length > 0 && actionPositions) {
    if (route.authorizationCombination === "AND") {
      const actionSet = new Set(actionPositions);
      return new Set(
        requiredPositions.filter((role) => actionSet.has(role))
      );
    }
    if (route.authorizationCombination === "OR") {
      return new Set([...requiredPositions, ...actionPositions]);
    }
    return null;
  }
  if (requiredPositions.length > 0) {
    return new Set(requiredPositions);
  }
  if (actionPositions) return new Set(actionPositions);
  return route.isPublic === true ||
    route.authentication === "authenticated"
    ? UNRESTRICTED_ACTOR_POSITIONS
    : null;
}

function intersectActorPositions(left, right) {
  if (left === UNRESTRICTED_ACTOR_POSITIONS) return right;
  if (right === UNRESTRICTED_ACTOR_POSITIONS) return left;
  return new Set(
    [...left].filter((position) => right.has(position))
  );
}

function effectiveMutationActorPositions({
  mutationBindings,
  nestManifest,
  rolesByAction
}) {
  if (
    !rolesByAction ||
    !Array.isArray(mutationBindings) ||
    mutationBindings.length === 0
  ) {
    return null;
  }
  let effective = UNRESTRICTED_ACTOR_POSITIONS;
  for (const binding of mutationBindings) {
    if (!isNonEmptyString(binding?.normalizedKey)) return null;
    const routes = nestManifest.routes.filter(
      (route) => route?.normalizedKey === binding.normalizedKey
    );
    if (routes.length !== 1) return null;
    const positions = actorPositionsForRoute(
      routes[0],
      rolesByAction
    );
    if (!positions) return null;
    effective = intersectActorPositions(effective, positions);
    if (
      effective !== UNRESTRICTED_ACTOR_POSITIONS &&
      effective.size === 0
    ) {
      return null;
    }
  }
  return effective;
}

function actorPositionsCover(required, available) {
  if (!required || !available) return false;
  if (available === UNRESTRICTED_ACTOR_POSITIONS) return true;
  if (required === UNRESTRICTED_ACTOR_POSITIONS) return false;
  return [...required].every((position) =>
    available.has(position)
  );
}

function capabilitySourceAuthorizationIsCompatible({
  sourceIdentity,
  webManifest,
  nestManifest,
  effectiveMutationActors,
  rolesByAction
}) {
  if (!effectiveMutationActors || !rolesByAction) return false;
  const candidates = webManifest.wrappers.filter(
    (wrapper) =>
      wrapperIdentity(
        posixPath(wrapper?.apiFile ?? ""),
        wrapper?.name ?? ""
      ) === sourceIdentity
  );
  if (candidates.length !== 1) return false;
  const requests = normalizedMainRequests(candidates[0]);
  if (requests.length === 0) return false;
  return requests.every((request) => {
    const routes = nestManifest.routes.filter(
      (route) => route?.normalizedKey === request.normalizedKey
    );
    if (routes.length !== 1) return false;
    const actorPositions = actorPositionsForRoute(
      routes[0],
      rolesByAction
    );
    return actorPositionsCover(
      effectiveMutationActors,
      actorPositions
    );
  });
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
  let actionRequiredRoles = null;
  try {
    // Read source directly so a stale shared-domain build cannot bless a
    // capability GET with an outdated action-to-position policy.
    actionRequiredRoles = actionRequiredRolesFromSource(
      await readFile(
        join(resolvedRoot, PERMISSIONS_SOURCE_PATH),
        "utf8"
      )
    );
  } catch {
    actionRequiredRoles = null;
  }
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
  for (const path of reachable) {
    const ast = asts.get(path);
    if (!ast) continue;
    const issue = runtimeIntrinsicIntegrityIssue(ast, {
      sourcePath: path,
      sourceFiles: sourceFileSet,
      asts
    });
    if (issue) {
      blockers.parseIssues.push({
        code: "RUNTIME_INTRINSIC_INTEGRITY_UNVERIFIED",
        sourceFile: path,
        sourceLine: issue.loc?.start?.line ?? null
      });
    }
  }
  blockers.parseIssues = blockers.parseIssues.filter(
    (issue) =>
      reachable.has(issue.sourceFile) ||
      registryActions.some(
        (action) => action.sourceFile === issue.sourceFile
      )
  );
  if (!actionRequiredRoles) {
    blockers.parseIssues.push({
      code: "ACTION_ROLE_POLICY_UNRESOLVED",
      sourceFile: PERMISSIONS_SOURCE_PATH
    });
  }
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
  const upstreamCoverageContextTrusted =
    upstreamWebCoverageContextIsTrusted({
      manifest: webManifest,
      sourceFiles,
      reachable
    }) &&
    nestManifest.authorizationScope ===
      "guard_metadata_only";

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
    ),
    asts.get(
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
          ast: null,
          definitions: new Map(),
          definitionsByBinding: new Map(),
          declarations: new Map(),
          declarationsByBinding: new Map(),
          imports: new Map(),
          importsByBinding: new Map(),
          importVariablesByName: new Map(),
          scopeManager: null,
          scopeBindings: null,
          scopeReferenceIdentifiers: new WeakSet(),
          vueRefImports: new Set(),
          vueRefImportBindings: new Set(),
          vueComputedImports: new Set(),
          vueComputedImportBindings: new Set(),
          writes: new Map(),
          writesByBinding: new Map()
        };
    const triggerHandlerBindings =
      candidate && symbols.scopeManager
        ? topLevelScopeVariables(
            symbols.scopeManager,
            action.trigger.handler
          )
        : [];
    if (
      candidate &&
      triggerHandlerBindings.length !== 1
    ) {
      blockers.unresolvedHandlers.push({
        code: "ACTION_HANDLER_UNRESOLVED",
        actionId: action.id,
        sourceFile: action.sourceFile,
        handler: action.trigger.handler
      });
    }
    const capabilityContext = {
      symbols,
      sourceFile: action.sourceFile,
      source,
      sources,
      asts,
      sourceFileSet,
      serverReadImports: serverReadImportNames(
        symbols,
        wrapperIndex,
        action.sourceFile
      ),
      discoveredCapabilitySourceBindings: new Set(),
      registryVariant: action.trigger.variant,
      businessDraftActionTrusted
    };
    const bindings = actionBindings({
      action,
      wrapperIndex,
      nestRouteIndex,
      blockers,
      graph: ownershipGraph,
      symbols,
      candidate,
      businessDraftActionTrusted,
      capabilityContext
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
    const dominatesTrigger =
      Boolean(candidate && source) &&
      capabilityDominates(
        candidate,
        action.capability,
        capabilityContext
      );
    const capabilityProvenance = capabilityServerProvenance(
      action.capability,
      capabilityContext
    );
    const capabilitySources = capabilityProvenance?.sources ?? null;
    const capabilityProvenanceTrusted =
      SERVER_CAPABILITY_KINDS.has(
        action.capability.kind
      ) &&
      capabilitySources?.size === 1 &&
      [...capabilitySources].every((sourceIdentity) =>
        capabilitySourceUpstreamAssociationIsTrusted({
          sourceIdentity,
          sourceFile:
            capabilityProvenance.sourceFiles.get(sourceIdentity) ??
            action.sourceFile,
          webManifest,
          nestManifest
        })
      );
    const mutationBindings = bindings.filter(isMutationRequest);
    const effectiveMutationActors =
      effectiveMutationActorPositions({
        mutationBindings,
        nestManifest,
        rolesByAction: actionRequiredRoles
      });
    const capabilityAuthorizationCompatible =
      !writes ||
      (Boolean(effectiveMutationActors) &&
        capabilityProvenanceTrusted &&
        [...capabilitySources].every((sourceIdentity) =>
          capabilitySourceAuthorizationIsCompatible({
            sourceIdentity,
            webManifest,
            nestManifest,
            effectiveMutationActors,
            rolesByAction: actionRequiredRoles
          })
        ));
    const capabilityServerDerived =
      capabilityProvenanceTrusted &&
      capabilityAuthorizationCompatible;
    const capabilityUpstreamAssociationTrusted =
      !writes || capabilityServerDerived;
    let capabilityAccepted =
      !writes ||
      (dominatesTrigger &&
        capabilityUpstreamAssociationTrusted);
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
      (!dominatesTrigger ||
        !capabilityUpstreamAssociationTrusted)
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
        reason: dominatesTrigger
          ? capabilityProvenanceTrusted &&
            !capabilityAuthorizationCompatible
            ? "capability_get_authorization_incompatible"
            : "capability_upstream_association_untrusted"
          : "capability_not_dominating"
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
      upstreamCoverageContextTrusted &&
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
          bindingUpstreamAssociationIsTrusted({
            binding,
            webManifest,
            nestManifest
          }) &&
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
        serverDerived: capabilityServerDerived,
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

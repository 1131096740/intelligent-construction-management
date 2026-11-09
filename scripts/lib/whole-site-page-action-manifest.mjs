import { createRequire } from "node:module";
import {
  GENERATED_ARCHIVE_ACTIONS,
  GENERATED_ARCHIVE_API,
  GENERATED_ARCHIVE_CONFIRM,
  GENERATED_ARCHIVE_CONSUMER,
  GENERATED_ARCHIVE_UPLOAD,
  GENERATED_ARCHIVE_WRITE,
  proveGeneratedArchivePageAction
} from "./contract-generated-archive-page-action-proof.mjs";
import {
  proveContractSealPageAction,
  SEAL_ACTION_IDS,
  SEAL_API,
  SEAL_COMPOSABLE,
  SEAL_WRITE,
  SEAL_WRITE_ACTION_IDS
} from "./contract-seal-page-action-proof.mjs";
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
const SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION = Object.freeze({
  facadeApiFile: `${WEB_SOURCE_ROOT}/lib/user-self-profile.ts`,
  facadeName: "updateProfile",
  transportSourceFile: `${WEB_SOURCE_ROOT}/auth/auth.store.ts`,
  method: "PATCH",
  normalizedPath: "/auth/profile",
  normalizedKey: "PATCH /auth/profile",
  transport: "auth_store_exception",
  productionConsumer: `${WEB_SOURCE_ROOT}/pages/settings/SettingsPage.vue`
});
const CONTRACT_WORKBENCH_PAGE_PATH =
  `${WEB_SOURCE_ROOT}/pages/contracts/ContractWorkbenchPage.vue`;
const CONTRACT_DRAFT_COMPOSABLE_PATH =
  `${WEB_SOURCE_ROOT}/pages/contracts/workbench/use-contract-draft.ts`;
const CONTRACT_WORKBENCH_API_PATH =
  `${WEB_SOURCE_ROOT}/api/contract-workbench.api.ts`;
const CONTRACT_DRAFT_LIFECYCLE_COMMAND_BY_WRAPPER = new Map([
  [
    "executeDeletePristineContractDraftAction",
    {
      actionId: "contract-draft.delete-pristine",
      pageHandler: "confirmDeletePristineDraft",
      command: "deletePristineDraft"
    }
  ],
  [
    "executeAbandonContractDraftAction",
    {
      actionId: "contract-draft.abandon-application",
      pageHandler: "confirmAbandonApplication",
      command: "abandonApplication"
    }
  ]
]);
const PERMISSIONS_SOURCE_PATH =
  "packages/shared-domain/src/permissions.ts";
const ACTION_USAGES = new Set(["page_action", "background"]);
const CAPABILITY_KINDS = new Set([
  "detail_action",
  "available_action_string",
  "server_definition",
  "server_boolean",
  "server_lease",
  "authenticated_self_exception",
  "client_role_or_status",
  "none"
]);
const SERVER_CAPABILITY_KINDS = new Set([
  "detail_action",
  "available_action_string",
  "server_definition",
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
    entry.capability.kind === "server_definition" &&
    (entry.capability.source !== "definition.key" ||
      entry.capability.key !== undefined)
  ) {
    return "server_definition_invalid";
  }
  if (entry.capability.freshRead !== undefined) {
    const freshRead = entry.capability.freshRead;
    const expectedFreshReadKeys = [
      "apiFile",
      "name",
      "method",
      "mode",
      "binding",
      "submissionTarget"
    ];
    const expectedBindingKeys = [
      "actor",
      "company",
      "scene",
      "action",
      "definitionRevision"
    ];
    if (
      entry.capability.kind !== "server_definition" ||
      !isRecord(freshRead) ||
      JSON.stringify(Object.keys(freshRead).sort()) !==
        JSON.stringify(expectedFreshReadKeys.sort()) ||
      !isNonEmptyString(freshRead.apiFile) ||
      !isNonEmptyString(freshRead.name) ||
      !isNonEmptyString(freshRead.method) ||
      !isNonEmptyString(freshRead.mode) ||
      freshRead.mode !== "read_only_probe" ||
      !isRecord(freshRead.binding) ||
      JSON.stringify(Object.keys(freshRead.binding).sort()) !==
        JSON.stringify(expectedBindingKeys.sort()) ||
      expectedBindingKeys.some(
        (key) => !isNonEmptyString(freshRead.binding[key])
      ) ||
      freshRead.submissionTarget !== "independent"
    ) {
      return "fresh_read_binding_invalid";
    }
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
          : {}),
        ...(entry.capability.freshRead
          ? {
              freshRead: {
                apiFile: posixPath(entry.capability.freshRead.apiFile),
                name: entry.capability.freshRead.name,
                method: entry.capability.freshRead.method.toUpperCase(),
                mode: entry.capability.freshRead.mode,
                binding: {
                  actor: entry.capability.freshRead.binding.actor,
                  company: entry.capability.freshRead.binding.company,
                  scene: entry.capability.freshRead.binding.scene,
                  action: entry.capability.freshRead.binding.action,
                  definitionRevision:
                    entry.capability.freshRead.binding.definitionRevision
                },
                submissionTarget:
                  entry.capability.freshRead.submissionTarget
              }
            }
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
  if (
    value.type === "CallExpression" &&
    value.callee?.type === "Identifier"
  ) {
    const binding = context.symbols.scopeBindings?.get(
      value.callee
    );
    const definition = binding
      ? uniqueIndexedNode(
          context.symbols.definitionsByBinding,
          binding
        )
      : null;
    if (!definition || seen.has(binding)) return null;
    const analysis = directCallTargets(
      definition,
      context.symbols.declarations,
      context.symbols,
      false
    );
    if (!analysis.reliable || analysis.calls.length !== 1) {
      return null;
    }
    const [call] = analysis.calls;
    if (!freshReadCallIsPropagated(call, definition)) {
      return null;
    }
    const source = importedReadSource(
      call.callNode,
      context.serverReadImports,
      context.symbols
    );
    return source ? new Set([source]) : null;
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
    rootBinding: explicitRootBinding = null,
    allowHandlerLocalGuardHelper = false
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
    const isAllowedHandlerLocalGuardArgument = (
      call,
      argument,
      index
    ) => {
      if (
        !allowHandlerLocalGuardHelper ||
        index !== 0 ||
        argument?.type !== "Identifier"
      ) {
        return false;
      }
      const localSource =
        context.handlerLocalCapabilitySource;
      if (
        !localSource?.valid ||
        scopeBindings.get(argument) !== localSource.binding ||
        call.callee?.type !== "Identifier"
      ) {
        return false;
      }
      const statement = parentByNode.get(call);
      if (
        statement?.type !== "ExpressionStatement" ||
        parentByNode.get(statement) !==
          localSource.definition?.body
      ) {
        return false;
      }
      const mutationStarts = handlerLocalMutationStarts(
        localSource.definition,
        context.mutationBindings,
        context.symbols
      );
      const firstMutation = Math.min(...mutationStarts);
      if (
        !Number.isFinite(firstMutation) ||
        (call.range?.[0] ?? Number.POSITIVE_INFINITY) >=
          firstMutation
      ) {
        return false;
      }
      const guardBinding = scopeBindings.get(call.callee);
      const guardDefinition = guardBinding
        ? uniqueIndexedNode(
            context.symbols.definitionsByBinding,
            guardBinding
          )
        : null;
      return Boolean(
        guardDefinition &&
        failClosedGuardHelperIsSafe(
          guardDefinition,
          context.symbols
        )
      );
    };
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
        if (
          isAllowedHandlerLocalGuardArgument(
            node,
            argument,
            index
          )
        ) {
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
  if (
    context.handlerLocalCapabilitySource &&
    !context.handlerLocalCapabilitySource.valid
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
        rootBinding,
        allowHandlerLocalGuardHelper:
          Boolean(context.handlerLocalCapabilitySource?.valid)
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

function isBoundServerReadCall(call, symbols, serverReadBinding) {
  return call?.type === "CallExpression" &&
    call.callee?.type === "Identifier" &&
    symbols.scopeBindings?.get(call.callee) === serverReadBinding &&
    (call.arguments ?? []).every(
      (argument) => argument?.type !== "SpreadElement"
    );
}

function isGuardedWorkbenchReadAwait(expression, symbols, serverReadBinding) {
  const awaited = unwrapPreflightExpression(expression);
  const branch = awaited?.type === "AwaitExpression"
    ? unwrapPreflightExpression(awaited.argument)
    : null;
  if (branch?.type !== "ConditionalExpression" ||
      branch.test?.type !== "MemberExpression" ||
      branch.test.computed || branch.test.optional ||
      branch.test.object?.type !== "Identifier" ||
      branch.test.object.name !== "options" ||
      branch.test.property?.name !== "routePath") return false;

  const guarded = unwrapPreflightExpression(branch.consequent);
  const regular = unwrapPreflightExpression(branch.alternate);
  if (!isBoundServerReadCall(guarded, symbols, serverReadBinding) ||
      !isBoundServerReadCall(regular, symbols, serverReadBinding) ||
      guarded.optional || regular.optional ||
      guarded.arguments.length !== 2 || regular.arguments.length !== 1) {
    return false;
  }
  const [guardedId, requestOptions] = guarded.arguments;
  const [regularId] = regular.arguments;
  const coordinate = symbols.scopeBindings?.get(regularId);
  const [definition] = coordinate?.defs ?? [];
  if (regularId.type !== "Identifier" || regularId.name !== "requestedVersionId" ||
      guardedId.type !== "Identifier" || guardedId.name !== regularId.name ||
      symbols.scopeBindings?.get(guardedId) !== coordinate ||
      coordinate?.defs.length !== 1 || definition?.type !== "Parameter" ||
      definition.node?.type !== "FunctionDeclaration" || definition.node.id?.name !== "load" ||
      requestOptions?.type !== "ObjectExpression" || requestOptions.properties.length !== 1) {
    return false;
  }
  const [option] = requestOptions.properties;
  return option?.type === "Property" && option.kind === "init" &&
    !option.computed && !option.method && propertyKey(option) === "responseIsCurrent" &&
    option.value?.type === "Identifier" && option.value.name === "loadingCurrent" &&
    Boolean(symbols.scopeBindings?.get(option.value));
}

function isServerReadAwait(expression, symbols, serverReadBinding) {
  const awaited = unwrapPreflightExpression(expression);
  const call = awaited?.type === "AwaitExpression"
    ? unwrapPreflightExpression(awaited.argument)
    : null;
  return isBoundServerReadCall(call, symbols, serverReadBinding) ||
    isGuardedWorkbenchReadAwait(expression, symbols, serverReadBinding);
}

function hasGuardedWorkbenchLoad(ast, symbols, serverReadBinding) {
  let matches = 0;
  walkEstree(ast, (node) => {
    if (node.type === "AssignmentExpression" && node.operator === "=" &&
        node.left?.type === "Identifier" && node.left.name === "result" &&
        isGuardedWorkbenchReadAwait(node.right, symbols, serverReadBinding)) {
      matches++;
    }
  });
  return matches === 1;
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
    (!/result\s*=\s*await\s+fetchContractDraftWorkbench\s*\(\s*requestedVersionId\s*\)\s*;/.test(
      composableSource
    ) && !hasGuardedWorkbenchLoad(
      composableAst, composableSymbols, workbenchImportBinding
    )) ||
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
  const verifiedDraftSource = context.draftOperationSource?.capability === capability;
  if (isContractDraftCreationCapability(capability, context) && !verifiedDraftSource) {
    return null;
  }
  const sources = verifiedDraftSource
    ? new Set([context.draftOperationSource.sourceIdentity])
    : capabilityServerProvenanceSources(capability, context);
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

function astAncestorChain(root, target) {
  const visit = (node, chain = []) => {
    if (!node || typeof node !== "object") return null;
    const nextChain = [...chain, node];
    if (node === target) return nextChain;
    for (const [key, value] of Object.entries(node)) {
      if (
        ["parent", "tokens", "comments", "loc", "range"].includes(key)
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") {
            const result = visit(child, nextChain);
            if (result) return result;
          }
        }
      } else if (value && typeof value.type === "string") {
        const result = visit(value, nextChain);
        if (result) return result;
      }
    }
    return null;
  };
  return visit(root);
}

function freshReadCallIsPropagated(call, definition) {
  const chain = astAncestorChain(definition, call.callNode);
  const parent = chain?.at(-2);
  return ["AwaitExpression", "ReturnStatement"].includes(parent?.type);
}

function serverDefinitionFreshReadCausalProof(
  handler,
  readWrapper,
  symbols
) {
  const handlerBindings = topLevelScopeVariables(
    symbols.scopeManager,
    handler
  );
  if (handlerBindings.length !== 1) return false;
  const visited = new Set();
  const prove = (binding, allowFailClosedEarlyReturns) => {
    if (visited.has(binding)) return false;
    visited.add(binding);
    const definition = uniqueIndexedNode(
      symbols.definitionsByBinding,
      binding
    );
    if (!definition) return false;
    const analysis = directCallTargets(
      definition,
      symbols.declarations,
      symbols,
      allowFailClosedEarlyReturns
    );
    if (!analysis.reliable) return false;
    const calls = [...analysis.calls].sort(
      (left, right) =>
        (left.callNode?.range?.[0] ?? Number.POSITIVE_INFINITY) -
        (right.callNode?.range?.[0] ?? Number.POSITIVE_INFINITY)
    );
    for (const call of calls) {
      if (importedCallMatchesWrapper(call, readWrapper, symbols)) {
        return freshReadCallIsPropagated(call, definition);
      }
      const binding = call.bindingIdentifier
        ? symbols.scopeBindings?.get(call.bindingIdentifier)
        : null;
      const imported = binding
        ? symbols.importsByBinding?.get(binding)
        : null;
      if (imported) return false;
      if (call.kind !== "identifier" || !binding) return false;
      if (
        uniqueIndexedNode(symbols.definitionsByBinding, binding)
      ) {
        if (!prove(binding, false)) return false;
        return true;
      }
    }
    return false;
  };
  return prove(handlerBindings[0], true);
}

function handlerLocalCapabilitySourceBinding({
  handler,
  capability,
  context
}) {
  const root = capabilitySourceRoot(capability.source);
  const handlerBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    handler
  );
  const definition = handlerBindings.length === 1
    ? uniqueIndexedNode(
        context.symbols.definitionsByBinding,
        handlerBindings[0]
      )
    : null;
  if (!root || !definition) return null;
  const matches = new Set();
  directCallableNodes(definition, (node) => {
    if (
      node.type === "Identifier" &&
      node.name === root
    ) {
      const binding = resolvedReferenceBinding(
        node,
        context.symbols
      );
      if (binding) matches.add(binding);
    }
    if (
      canonicalExpression(node) !==
      normalizedExpression(capability.source)
    ) {
      return;
    }
    const rootIdentifier = referenceRootIdentifier(node);
    const binding = resolvedReferenceBinding(
      rootIdentifier,
      context.symbols
    );
    if (binding) matches.add(binding);
  });
  if (matches.size === 0) return null;

  const bodyRange = definition.body?.range;
  const localMatches = [...matches].filter((binding) =>
    (binding.identifiers ?? []).some((identifier) =>
      identifier.range?.[0] >= (bodyRange?.[0] ?? Number.POSITIVE_INFINITY) &&
      identifier.range?.[1] <= (bodyRange?.[1] ?? Number.NEGATIVE_INFINITY)
    )
  );
  if (localMatches.length === 0) return null;
  if (localMatches.length !== 1) {
    return { bindings: new Set(localMatches), valid: false };
  }

  const [binding] = localMatches;
  const declaration = uniqueIndexedNode(
    context.symbols.declarationsByBinding,
    binding
  );
  const declarationIdentifiers = (binding.identifiers ?? []).filter(
    (identifier) => identifier.range?.[0] >= (bodyRange?.[0] ?? Number.POSITIVE_INFINITY) &&
      identifier.range?.[1] <= (bodyRange?.[1] ?? Number.NEGATIVE_INFINITY)
  );
  const declarationIdentifier = declarationIdentifiers.length === 1
    ? declarationIdentifiers[0]
    : null;
  const declarationNode = declarationIdentifier?.parent?.type ===
    "VariableDeclarator"
    ? declarationIdentifier.parent
    : null;
  const declarationStatement = declarationNode?.parent?.type ===
    "VariableDeclaration"
    ? declarationNode.parent
    : null;
  const hasPostInitializationWrite = (binding.references ?? []).some(
    (reference) =>
      typeof reference.isWrite === "function" &&
      reference.isWrite() &&
      reference.init !== true
  );
  const sourceBindings = declaration
    ? expressionServerReadSources(declaration, context)
    : null;
  const safe = Boolean(
    declaration &&
    declarationNode?.init === declaration &&
    declarationStatement?.kind === "const" &&
    declarationIdentifiers.length === 1 &&
    !hasPostInitializationWrite &&
    sourceBindings?.size === 1
  );
  return {
    bindings: new Set([binding]),
    valid: safe,
    binding,
    definition,
    sourceBindings
  };
}

function handlerLocalMutationStarts(
  definition,
  mutationBindings,
  symbols
) {
  if (!definition || !Array.isArray(mutationBindings)) {
    return [];
  }
  const mutationStarts = [];
  for (const mutation of mutationBindings) {
    const wrapper = {
      apiFile: mutation.apiFile,
      name: mutation.wrapper
    };
    directCallableNodes(definition, (node) => {
      if (
        node.type === "CallExpression" &&
        callExpressionMatchesWrapper(node, wrapper, symbols)
      ) {
        mutationStarts.push(
          node.range?.[0] ?? Number.POSITIVE_INFINITY
        );
      }
    });
  }
  return mutationStarts;
}

function handlerLocalCapabilityGuardProof({
  definition,
  capabilityBinding,
  mutationBindings,
  symbols
}) {
  if (
    !definition ||
    definition.body?.type !== "BlockStatement" ||
    !capabilityBinding ||
    !Array.isArray(mutationBindings) ||
    mutationBindings.length === 0
  ) {
    return false;
  }
  const mutationStarts = handlerLocalMutationStarts(
    definition,
    mutationBindings,
    symbols
  );
  const firstMutation = Math.min(...mutationStarts);
  if (!Number.isFinite(firstMutation)) return false;
  const guardedFields = new Set();
  for (const statement of definition.body.body ?? []) {
    if ((statement.range?.[0] ?? Number.POSITIVE_INFINITY) >= firstMutation) {
      break;
    }
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression?.type === "CallExpression" &&
      statement.expression.callee?.type === "Identifier"
    ) {
      const guardBinding = symbols.scopeBindings?.get(
        statement.expression.callee
      );
      const guardDefinition = guardBinding
        ? uniqueIndexedNode(
            symbols.definitionsByBinding,
            guardBinding
          )
        : null;
      const argument = statement.expression.arguments?.[0];
      const argumentBinding = argument?.type === "Identifier"
        ? symbols.scopeBindings?.get(argument)
        : null;
      if (
        guardDefinition &&
        failClosedGuardHelperIsSafe(guardDefinition, symbols) &&
        argumentBinding === capabilityBinding
      ) {
        guardedFields.add("key");
        guardedFields.add("entityId");
        guardedFields.add("revision");
        continue;
      }
    }
    if (
      statement.type !== "IfStatement" ||
      statement.alternate ||
      !preflightExpressionIsPure(statement.test, symbols) ||
      !preflightExpressionHasRuntimeDependency(
        statement.test,
        symbols,
        new Set(),
        new Map()
      ) ||
      !preflightThrowBranchIsSafe(
        statement.consequent,
        symbols,
        new Set()
      )
    ) {
      continue;
    }
    walkEstree(statement.test, (node) => {
      if (
        node.type !== "MemberExpression" ||
        node.computed ||
        node.object?.type !== "Identifier" ||
        node.property?.type !== "Identifier" ||
        symbols.scopeBindings?.get(node.object) !== capabilityBinding ||
        !["key", "entityId", "revision"].includes(node.property.name)
      ) {
        return;
      }
      guardedFields.add(node.property.name);
    });
  }
  return ["key", "entityId", "revision"].every((field) =>
    guardedFields.has(field)
  );
}

function serverDefinitionHandlerFreshRead({
  action,
  symbols,
  capabilityContext
}) {
  if (action.capability.kind !== "server_definition") {
    return true;
  }
  const provenance = capabilityServerProvenance(
    action.capability,
    capabilityContext
  );
  if (provenance?.sources?.size !== 1) return false;
  const sourceIdentity = [...provenance.sources][0];
  const separator = sourceIdentity.indexOf("\u0000");
  if (separator < 1) return false;
  const readWrapper = {
    apiFile: sourceIdentity.slice(0, separator),
    name: sourceIdentity.slice(separator + 1)
  };
  return serverDefinitionFreshReadCausalProof(
    action.trigger.handler,
    readWrapper,
    symbols
  );
}

function freshReadBindingVerified({
  action,
  wrapperIndex,
  graph,
  capabilityContext,
  handlerFreshReadVerified
}) {
  const freshRead = action.capability.freshRead;
  if (!freshRead) return true;
  const wrapper = wrapperIndex.get(
    wrapperIdentity(freshRead.apiFile, freshRead.name)
  );
  if (!wrapper || wrapper.kind !== "transport") return false;
  if (wrapper.returnProvenance !== "transparent_main_response") {
    return false;
  }
  const requests = normalizedMainRequests(wrapper);
  if (
    requests.length !== 1 ||
    requests[0].method.toUpperCase() !== "GET" ||
    freshRead.method !== "GET"
  ) {
    return false;
  }
  if (
    wrapperReferencedFromAction({
      wrapper,
      action,
      graph
    }).length === 0
  ) {
    return false;
  }
  const provenance = capabilityServerProvenance(
    action.capability,
    capabilityContext
  );
  if (provenance?.sources?.size !== 1) return false;
  return (
    [...provenance.sources][0] ===
    wrapperIdentity(freshRead.apiFile, freshRead.name) &&
    handlerFreshReadVerified
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

function leadingAwaitedLocalPreflight(definition, symbols, bindReceipt = false) {
  const statement = (definition?.body?.body ?? []).find(
    (candidate) => candidate.type !== "EmptyStatement"
  );
  const declaration = bindReceipt && statement?.type === "VariableDeclaration" &&
    statement.kind === "const" && statement.declarations.length === 1
    ? statement.declarations[0]
    : null;
  const receipt = declaration?.id?.type === "Identifier"
    ? symbols.scopeBindings.get(declaration.id)
    : null;
  if (statement?.type !== "ExpressionStatement" && !receipt) return null;
  // Preserve the AwaitExpression while unwrapping only TypeScript wrappers.
  // unwrapValueExpression intentionally erases awaits for ordinary data-flow
  // analysis, but a delegated preflight must prove that it completes first.
  const awaited = unwrapPreflightExpression(receipt ? declaration.init : statement.expression);
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
    ? { binding, definition: helperDefinition, call, receipt }
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

const CONTRACT_DRAFT_OPERATION_WRITES = new Map([
  ["acquire_contract_draft_edit_lease", ["acquireContractDraftEditLease", [0]]],
  ["heartbeat_contract_draft_edit_lease", ["heartbeatContractDraftEditLease", [0, 2]]],
  ["release_contract_draft_edit_lease", ["releaseContractDraftEditLease", [0, 2]]],
  ["take_over_contract_draft_edit_lease", ["takeOverContractDraftEditLease", [0, 2]]],
  ["save_contract_draft", ["saveContractDraftAggregate", [0, 1, 2]]],
  ["queue_contract_draft_preview", ["queueContractDraftPreview", [0, 1]]],
  ["submit_contract_draft", ["submitContractDraft", [0, 1, 2]]]
]);

function draftOperationAuthorityRead(definition, context) {
  const { symbols } = context;
  const reference = (node) => resolvedReferenceBinding(node, symbols);
  const bound = (node) => symbols.scopeBindings.get(node);
  const [versionId, revision, operation, denial, responseCurrent] =
    (definition.params ?? []).map(bound);
  if (
    definition.id?.name !== "assertCurrentContractDraftOperationCapability" ||
    !definition.async || definition.generator || definition.params.length !== 5 ||
    definition.params.some((parameter) => parameter.type !== "Identifier") ||
    !versionId || !revision || !operation || !denial || !responseCurrent
  ) return null;

  const statements = definition.body?.body ?? [];
  if (statements.length !== 5) return null;
  const [load, versionGuard, operationGuard, revisionGuard, result] = statements;
  const [declaration] = load.declarations ?? [];
  const response = bound(declaration?.id);
  const read = declaration?.init?.argument;
  if (
    load.type !== "VariableDeclaration" || load.kind !== "const" ||
    load.declarations.length !== 1 || !response ||
    declaration.init?.type !== "AwaitExpression" || read?.type !== "ConditionalExpression" ||
    reference(read.test) !== responseCurrent
  ) return null;

  const regular = read.alternate;
  const guarded = read.consequent;
  const readBinding = reference(regular?.callee);
  const imported = symbols.importsByBinding.get(readBinding);
  if (
    imported?.sourceFile !== CONTRACT_WORKBENCH_API_PATH ||
    imported.importedName !== "fetchContractDraftOperationCapabilities" ||
    !isBoundServerReadCall(regular, symbols, readBinding) ||
    !isBoundServerReadCall(guarded, symbols, readBinding) ||
    regular.optional || guarded.optional ||
    regular.arguments.length !== 1 || guarded.arguments.length !== 2 ||
    reference(regular.arguments[0]) !== versionId ||
    reference(guarded.arguments[0]) !== versionId
  ) return null;
  const options = guarded.arguments[1];
  if (options?.type !== "ObjectExpression" || options.properties.length !== 2) {
    return null;
  }
  const [retry, callback] = options.properties;
  const valueProperty = (node, name) =>
    node?.type === "Property" && node.kind === "init" &&
    !node.computed && !node.method && propertyKey(node) === name;
  if (
    !valueProperty(retry, "retryUnauthorized") ||
    retry.value?.type !== "Literal" || retry.value.value !== false ||
    !valueProperty(callback, "responseIsCurrent") ||
    reference(callback.value) !== responseCurrent
  ) return null;

  const responseField = (node, field) =>
    node?.type === "MemberExpression" && !node.optional &&
    staticMemberProperty(node) === field &&
    bindingMemberIs(node.object, response, "version", symbols);
  const mismatch = (node, field, binding) =>
    node?.type === "BinaryExpression" && node.operator === "!==" &&
    responseField(node.left, field) && reference(node.right) === binding;
  const includesOperation = (node) =>
    node?.type === "CallExpression" && !node.optional &&
    node.callee?.type === "MemberExpression" && !node.callee.optional &&
    staticMemberProperty(node.callee) === "includes" &&
    bindingMemberIs(node.callee.object, response, "draftOperationAvailableActions", symbols) &&
    node.arguments.length === 1 && reference(node.arguments[0]) === operation;
  const isGuard = (node) => node?.type === "IfStatement" && !node.alternate;
  const revisionStatements = revisionGuard.consequent?.type === "BlockStatement"
    ? revisionGuard.consequent.body
    : [];
  const [conflict, revisionThrow] = revisionStatements;
  const operationTest = operationGuard.test;
  if (
    !isGuard(versionGuard) || !mismatch(versionGuard.test, "id", versionId) ||
    !isGuard(operationGuard) || operationTest?.type !== "UnaryExpression" ||
    operationTest.operator !== "!" || !includesOperation(operationTest.argument) ||
    !isGuard(revisionGuard) || !mismatch(revisionGuard.test, "draftRevision", revision) ||
    revisionGuard.consequent?.type !== "BlockStatement" ||
    revisionGuard.consequent.body.length !== 2 ||
    result.type !== "ReturnStatement" || reference(result.argument) !== response
  ) return null;

  const versionError = authorityRefreshThrow(versionGuard.consequent, symbols);
  const deniedError = authorityRefreshThrow(operationGuard.consequent, symbols);
  const revisionError = authorityRefreshThrow(revisionThrow, symbols);
  if (
    literalString(versionError) === null || reference(deniedError) !== denial ||
    literalString(revisionError) === null ||
    !isGuard(conflict) || !throwOnlyStatement(conflict.consequent)
  ) return null;

  const terms = flattenedStrictConjunction(conflict.test) ?? [];
  const [saveTest, integerTest, newerTest, permissionTest] = terms;
  if (
    terms.length !== 4 ||
    saveTest.type !== "BinaryExpression" || saveTest.operator !== "===" ||
    reference(saveTest.left) !== operation || literalString(saveTest.right) !== "save_contract_draft" ||
    !draftOperationBuiltinCall(integerTest, "Number", "isInteger", symbols) ||
    integerTest.arguments.length !== 1 || !responseField(integerTest.arguments[0], "draftRevision") ||
    newerTest.type !== "BinaryExpression" || newerTest.operator !== ">" ||
    !responseField(newerTest.left, "draftRevision") || reference(newerTest.right) !== revision ||
    !includesOperation(permissionTest)
  ) return null;
  const conflictThrow = (conflict.consequent.body?.[0] ?? conflict.consequent).argument;
  if (!draftOperationRevisionConflict(conflictThrow, symbols)) return null;
  const sourceIdentity = importedReadSource(regular, context.serverReadImports, symbols);
  return sourceIdentity ? { sourceIdentity, response } : null;
}

function authorityRefreshThrow(node, symbols) {
  if (!throwOnlyStatement(node)) return null;
  const value = (node.body?.[0] ?? node).argument;
  if (
    value?.type !== "NewExpression" || value.callee?.type !== "Identifier" ||
    value.callee.name !== "ContractDraftAuthorityRefreshRequiredError" ||
    value.arguments.length !== 1
  ) return null;
  const definitions = resolvedReferenceBinding(value.callee, symbols)?.defs ?? [];
  const methods = definitions[0]?.node?.body?.body ?? [];
  const constructor = methods[0]?.value;
  const [forward, name] = constructor?.body?.body ?? [];
  const base = definitions[0]?.node?.superClass;
  const call = forward?.expression;
  const assignment = name?.expression;
  if (
    definitions.length !== 1 || definitions[0].node.type !== "ClassDeclaration" ||
    (definitions[0].node.decorators ?? []).length !== 0 ||
    !unshadowedRuntimeGlobal(base, new Set(["Error"]), symbols.scopeBindings) ||
    methods.length !== 1 || methods[0].kind !== "constructor" ||
    constructor.params.length !== 1 || constructor.params[0].type !== "Identifier" ||
    constructor.body.body.length !== 2 ||
    forward?.type !== "ExpressionStatement" || call?.type !== "CallExpression" ||
    call.callee?.type !== "Super" || call.arguments.length !== 1 ||
    resolvedReferenceBinding(call.arguments[0], symbols) !== symbols.scopeBindings.get(constructor.params[0]) ||
    name?.type !== "ExpressionStatement" || assignment?.type !== "AssignmentExpression" ||
    assignment.operator !== "=" || assignment.left?.type !== "MemberExpression" ||
    assignment.left.object?.type !== "ThisExpression" ||
    staticMemberProperty(assignment.left) !== "name" ||
    literalString(assignment.right) !== value.callee.name
  ) return null;
  return value.arguments[0];
}

function draftOperationBuiltinCall(node, object, method, symbols) {
  return node?.type === "CallExpression" && !node.optional &&
    node.callee?.type === "MemberExpression" && !node.callee.optional &&
    staticMemberProperty(node.callee) === method &&
    unshadowedRuntimeGlobal(node.callee.object, new Set([object]), symbols.scopeBindings);
}

function draftOperationRevisionConflict(node, symbols) {
  if (!draftOperationBuiltinCall(node, "Object", "assign", symbols) || node.arguments.length !== 2) {
    return false;
  }
  const [error, payload] = node.arguments;
  const [code] = payload?.properties ?? [];
  return error?.type === "NewExpression" &&
    unshadowedRuntimeGlobal(error.callee, new Set(["Error"]), symbols.scopeBindings) &&
    error.arguments.length === 1 && literalString(error.arguments[0]) !== null &&
    payload.type === "ObjectExpression" && payload.properties.length === 1 &&
    code?.type === "Property" && code.kind === "init" && !code.method && !code.computed &&
    propertyKey(code) === "code" && literalString(code.value) === "DRAFT_REVISION_CONFLICT";
}

function draftSubmissionReceiptGuard(node, receipt, payload, symbols) {
  const test = node?.test;
  const protocolField = test?.left;
  if (
    node?.type !== "IfStatement" || node.alternate || !receipt ||
    test?.type !== "LogicalExpression" || test.operator !== "&&" ||
    protocolField?.type !== "BinaryExpression" || protocolField.operator !== "in" ||
    literalString(protocolField.left) !== "submissionProtocolVersion" ||
    resolvedReferenceBinding(protocolField.right, symbols) !== payload ||
    literalString(authorityRefreshThrow(node.consequent, symbols)) === null
  ) return false;

  const differences = flattenedStrictDisjunction(test.right) ?? [];
  const fields = ["numericProtocolVersion", "documentContentRevision", "documentContentFingerprint"];
  return differences.length === fields.length && differences.every((difference, index) => {
    const field = fields[index];
    const left = difference.left;
    return difference.type === "BinaryExpression" && difference.operator === "!==" &&
      left?.type === "MemberExpression" && !left.optional &&
      staticMemberProperty(left) === field &&
      bindingMemberIs(left.object, receipt, "version", symbols) &&
      (index === 0
        ? difference.right?.type === "Literal" && difference.right.value === 2
        : bindingMemberIs(difference.right, payload, field, symbols));
  });
}

function draftOperationPreflight(candidate, leading, capability, context) {
  const { symbols } = context;
  const [wrapperName, writeCoordinates] = CONTRACT_DRAFT_OPERATION_WRITES.get(capability.key) ?? [];
  const caller = candidate.expression;
  const statements = caller.body?.body ?? [];
  const write = statements.at(-1)?.argument;
  const submits = capability.key === "submit_contract_draft";
  const usesPayload = submits || capability.key === "save_contract_draft";
  if (
    !wrapperName || !caller.async || caller.generator ||
    caller.params.some((parameter) => parameter.type !== "Identifier") ||
    caller.params.length !== (usesPayload ? 4 : Math.max(1, ...writeCoordinates) + 1) ||
    statements.at(-1)?.type !== "ReturnStatement" ||
    write?.type !== "CallExpression" || write.optional ||
    leading.call.optional || leading.call.arguments.length !== 4 ||
    literalString(leading.call.arguments[2]) !== capability.key ||
    literalString(leading.call.arguments[3]) === null
  ) return null;

  const version = symbols.scopeBindings.get(caller.params?.[0]);
  const reference = (node) => resolvedReferenceBinding(node, symbols);
  const importedWrite = symbols.importsByBinding.get(reference(write.callee));
  if (
    !version || reference(leading.call.arguments[0]) !== version ||
    reference(write.arguments[0]) !== version ||
    importedWrite?.sourceFile !== CONTRACT_WORKBENCH_API_PATH ||
    importedWrite.importedName !== wrapperName ||
    write.arguments.length !== writeCoordinates.length ||
    !writeCoordinates.every((parameter, index) => {
      const binding = symbols.scopeBindings.get(caller.params?.[parameter]);
      return binding && reference(write.arguments[index]) === binding;
    })
  ) return null;

  const revisionArgument = leading.call.arguments[1];
  if (usesPayload) {
    const payload = symbols.scopeBindings.get(caller.params[2]);
    const callback = symbols.scopeBindings.get(caller.params[3]);
    const dispatchStatement = statements.at(-2);
    const dispatch = dispatchStatement?.expression;
    if (
      statements.length !== (submits ? 4 : 3) ||
      dispatchStatement?.type !== "ExpressionStatement" ||
      dispatch?.type !== "CallExpression" || dispatch.optional || dispatch.arguments.length !== 0 ||
      !callback || reference(dispatch.callee) !== callback ||
      !payload || !bindingMemberIs(revisionArgument, payload, "expectedRevision", symbols) ||
      (submits && !draftSubmissionReceiptGuard(statements[1], leading.receipt, payload, symbols))
    ) return null;
  } else {
    const revision = symbols.scopeBindings.get(caller.params[1]);
    if (
      statements.length !== 2 || !revision || reference(revisionArgument) !== revision
    ) return null;
  }

  const read = draftOperationAuthorityRead(leading.definition, context);
  return read ? {
    helperBinding: leading.binding,
    sourceBindings: new Set([read.response]),
    sourceIdentity: read.sourceIdentity,
    writeIdentity: wrapperIdentity(CONTRACT_WORKBENCH_API_PATH, wrapperName),
    writeName: write.callee.name
  } : null;
}

function isContractDraftCreationCapability(capability, context) {
  return context?.sourceFile === CONTRACT_DRAFT_COMPOSABLE_PATH &&
    capability?.key === "create_contract_draft";
}

function draftCreationPreflight(definition, context) {
  const { symbols } = context;
  const binding = (node) => symbols.scopeBindings.get(node);
  const reference = (node) => resolvedReferenceBinding(node, symbols);
  const member = (node, owner, field) =>
    node?.type === "MemberExpression" && !node.optional &&
    bindingMemberIs(node, owner, field, symbols);
  const call = (node) => node?.type === "CallExpression" && !node.optional;
  const declaration = (node) =>
    node?.type === "VariableDeclaration" && node.kind === "const" &&
    node.declarations.length === 1 && node.declarations[0].id.type === "Identifier"
      ? node.declarations[0]
      : null;
  const guardedIf = (node) => node?.type === "IfStatement" && !node.alternate;
  const isNegation = (node) => node?.type === "UnaryExpression" && node.operator === "!";
  const rejects = (node) => {
    if (!throwOnlyStatement(node)) return false;
    const value = (node.body?.[0] ?? node).argument;
    return value?.type === "NewExpression" &&
      unshadowedRuntimeGlobal(value.callee, new Set(["Error"]), symbols.scopeBindings) &&
      value.arguments.length === 1 && literalString(value.arguments[0]) !== null;
  };

  const statements = definition?.body?.body ?? [];
  if (
    definition?.type !== "FunctionDeclaration" ||
    definition.id?.name !== "createWorkbenchDraftWithCapability" ||
    !definition.async || definition.generator ||
    definition.params.length !== 2 ||
    definition.params.some((parameter) => parameter.type !== "Identifier") ||
    statements.length !== 10
  ) return null;
  const [payload, direct] = definition.params.map(binding);
  if (!payload || !direct) return null;
  const [mode, load, match, projectGuard, allowed, permissionGuard, upwardGuard,
    regularReturn, dispatch, directReturn] = statements;

  const upward = declaration(mode);
  const upwardBinding = binding(upward?.id);
  const upwardTerms = flattenedStrictConjunction(upward?.init) ?? [];
  const [hasMode, isDirect, isUpward] = upwardTerms;
  const comparesPayload = (node, field, expected) =>
    node?.type === "BinaryExpression" && node.operator === "===" &&
    member(node.left, payload, field) && literalString(node.right) === expected;
  if (
    !upwardBinding || upwardTerms.length !== 3 ||
    hasMode.type !== "BinaryExpression" || hasMode.operator !== "in" ||
    literalString(hasMode.left) !== "handlingMode" || reference(hasMode.right) !== payload ||
    !comparesPayload(isDirect, "handlingMode", "direct_signed") ||
    !comparesPayload(isUpward, "relationship", "upward")
  ) return null;

  const receipt = declaration(load);
  const receiptBinding = binding(receipt?.id);
  const arms = receipt?.init?.argument;
  if (
    !receiptBinding || receipt.init?.type !== "AwaitExpression" ||
    arms?.type !== "ConditionalExpression" || reference(arms.test) !== direct
  ) return null;
  const guarded = arms.consequent;
  const regular = arms.alternate;
  const readBinding = reference(regular?.callee);
  const readImport = symbols.importsByBinding.get(readBinding);
  if (
    !call(guarded) || !call(regular) || reference(guarded.callee) !== readBinding ||
    readImport?.sourceFile !== CONTRACT_WORKBENCH_API_PATH ||
    readImport.importedName !== "fetchContractCreateCapabilities" ||
    guarded.arguments.length !== 3 || regular.arguments.length !== 1 ||
    !member(guarded.arguments[0], payload, "projectId") ||
    !member(regular.arguments[0], payload, "projectId")
  ) return null;
  const [, options, relationship] = guarded.arguments;
  const [retry, current] = options?.properties ?? [];
  const option = (node, key) =>
    node?.type === "Property" && node.kind === "init" &&
    !node.computed && !node.method && propertyKey(node) === key;
  if (
    options?.type !== "ObjectExpression" || options.properties.length !== 2 ||
    !option(retry, "retryUnauthorized") ||
    retry.value?.type !== "Literal" || retry.value.value !== false ||
    !option(current, "responseIsCurrent") || !member(current.value, direct, "current") ||
    relationship?.type !== "ConditionalExpression" ||
    reference(relationship.test) !== upwardBinding ||
    literalString(relationship.consequent) !== "upward" ||
    !unshadowedRuntimeGlobal(relationship.alternate, new Set(["undefined"]), symbols.scopeBindings)
  ) return null;

  const matchingProject = declaration(match);
  const matches = matchingProject?.init;
  const containsAction = (node, key) =>
    call(node) && node.callee?.type === "MemberExpression" && !node.callee.optional &&
    staticMemberProperty(node.callee) === "includes" &&
    member(node.callee.object, receiptBinding, "availableActions") &&
    node.arguments.length === 1 && literalString(node.arguments[0]) === key;
  const permission = declaration(allowed);
  const rejectsUnless = (node, condition) =>
    condition && guardedIf(node) && isNegation(node.test) &&
    reference(node.test.argument) === condition && rejects(node.consequent);
  const additional = upwardGuard.test;
  if (
    matches?.type !== "BinaryExpression" || matches.operator !== "===" ||
    !member(matches.left, receiptBinding, "projectId") ||
    !member(matches.right, payload, "projectId") ||
    !rejectsUnless(projectGuard, binding(matchingProject.id)) ||
    !containsAction(permission?.init, "create_contract_draft") ||
    !rejectsUnless(permissionGuard, binding(permission.id)) ||
    !guardedIf(upwardGuard) || additional?.type !== "LogicalExpression" ||
    additional.operator !== "&&" || reference(additional.left) !== upwardBinding ||
    !isNegation(additional.right) ||
    !containsAction(additional.right.argument, "create_upward_direct_draft") ||
    !rejects(upwardGuard.consequent)
  ) return null;

  const directWrite = directReturn.argument;
  const writeBinding = reference(directWrite?.callee);
  const writeImport = symbols.importsByBinding.get(writeBinding);
  const write = (node, guarded) => node?.type === "ReturnStatement" &&
    call(node.argument) && reference(node.argument.callee) === writeBinding &&
    node.argument.arguments.length === (guarded ? 2 : 1) &&
    reference(node.argument.arguments[0]) === payload &&
    (!guarded || member(node.argument.arguments[1], direct, "current"));
  const beforeDispatch = dispatch.expression;
  if (
    writeImport?.sourceFile !== CONTRACT_WORKBENCH_API_PATH ||
    writeImport.importedName !== "createWorkbenchDraft" ||
    !guardedIf(regularReturn) || !isNegation(regularReturn.test) ||
    reference(regularReturn.test.argument) !== direct || !write(regularReturn.consequent, false) ||
    dispatch.type !== "ExpressionStatement" || !call(beforeDispatch) ||
    !member(beforeDispatch.callee, direct, "beforeDispatch") || beforeDispatch.arguments.length !== 0 ||
    !write(directReturn, true)
  ) return null;

  const sourceIdentity = importedReadSource(regular, context.serverReadImports, symbols);
  return sourceIdentity ? {
    sourceBindings: new Set([receiptBinding]),
    sourceIdentity,
    writeIdentity: wrapperIdentity(CONTRACT_WORKBENCH_API_PATH, "createWorkbenchDraft"),
    writeName: directWrite.callee.name
  } : null;
}

function delegatedBackgroundCapabilityPreflight(
  candidate,
  capability,
  context
) {
  if (candidate?.kind !== "background_call") return null;
  if (isContractDraftCreationCapability(capability, context)) {
    return capability.kind === "available_action_string" &&
      capability.source === "capability.availableActions"
      ? draftCreationPreflight(candidate.expression, context)
      : null;
  }
  const draftOperation = context.sourceFile === CONTRACT_DRAFT_COMPOSABLE_PATH &&
    capability.kind === "available_action_string" &&
    capability.source === "operationCapabilities.draftOperationAvailableActions";
  const leading = leadingAwaitedLocalPreflight(
    candidate.expression,
    context.symbols,
    draftOperation && capability.key === "submit_contract_draft"
  );
  if (!leading) return null;
  if (draftOperation) {
    return draftOperationPreflight(candidate, leading, capability, context);
  }
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
  const draftCreation = isContractDraftCreationCapability(capability, context);
  if (
    capability.kind === "server_definition" &&
    context.handlerLocalCapabilitySource?.valid &&
    handlerLocalCapabilityGuardProof({
      definition: context.handlerLocalCapabilitySource.definition,
      capabilityBinding: context.handlerLocalCapabilitySource.binding,
      mutationBindings: context.mutationBindings,
      symbols: context.symbols
    })
  ) {
    return true;
  }
  if (
    !draftCreation &&
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
    !draftCreation && candidate.kind === "background_call" &&
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
    if (delegated.sourceIdentity) {
      context.draftOperationSource = {
        capability,
        sourceIdentity: delegated.sourceIdentity
      };
    }
    for (const binding of delegated.sourceBindings) {
      context.discoveredCapabilitySourceBindings?.add(binding);
    }
    return true;
  }
  if (draftCreation) return false;
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
      const roots = eventHandlerRoots(expression);
      const directRegistration = path === CONTRACT_WORKBENCH_PAGE_PATH &&
        normalizedElementName(node) === "t-button" && event.toLowerCase() === "click" &&
        directRegistrationEvent(expression);
      if (directRegistration) roots.push({ handler: "directRegistration", variants: [directRegistration.variant] });
      for (const root of roots) {
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

function isSelfProfileFacadeCandidate(declared) {
  return (
    posixPath(declared?.apiFile ?? "") ===
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile ||
    declared?.name === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName
  );
}

function registeredSelfProfileAuthTransportException(webManifest) {
  const exceptions = Array.isArray(webManifest?.authTransportExceptions)
    ? webManifest.authTransportExceptions
    : [];
  const matches = exceptions.filter(
    (exception) =>
      posixPath(exception?.sourceFile ?? "") ===
        SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.transportSourceFile &&
      exception?.transport === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.transport &&
      exception?.method === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.method &&
      exception?.normalizedPath === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath &&
      exception?.normalizedKey === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey
  );
  return matches.length === 1 ? matches[0] : null;
}

function selfProfileFacadeImplementationIsTrusted({ asts, sourceFileSet }) {
  const ast = asts.get(SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile);
  if (!ast) return false;
  const symbols = buildSymbolContext(
    ast,
    SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile,
    sourceFileSet
  );
  const bindings = topLevelScopeVariables(
    symbols.scopeManager,
    SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName
  );
  if (bindings.length !== 1) return false;
  const definition = uniqueIndexedNode(
    symbols.definitionsByBinding,
    bindings[0]
  );
  if (
    !definition ||
    !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
      definition.type
    ) ||
    ![3, 4].includes(definition.params?.length) ||
    !definition.params.every((parameter) => parameter?.type === "Identifier") ||
    definition.body?.type !== "BlockStatement" ||
    definition.body.body?.length !== 1 ||
    definition.body.body[0]?.type !== "ReturnStatement"
  ) {
    return false;
  }
  const call = unwrapValueExpression(definition.body.body[0].argument);
  const member = call?.type === "CallExpression"
    ? unwrapValueExpression(call.callee)
    : null;
  const storeCall = member?.type === "MemberExpression" && !member.computed &&
    member.property?.type === "Identifier" && member.property.name === "updateProfile"
    ? unwrapValueExpression(member.object)
    : null;
  if (
    call?.type !== "CallExpression" ||
    member?.type !== "MemberExpression" ||
    storeCall?.type !== "CallExpression" ||
    storeCall.arguments?.length !== 0 ||
    storeCall.callee?.type !== "Identifier" ||
    call.arguments?.length !== definition.params.length
  ) {
    return false;
  }
  const storeBinding = symbols.scopeBindings?.get(storeCall.callee);
  const storeImport = storeBinding
    ? symbols.importsByBinding?.get(storeBinding)
    : null;
  if (
    storeImport?.sourceFile !==
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.transportSourceFile ||
    storeImport?.importedName !== "useAuthStore"
  ) {
    return false;
  }
  return definition.params.every((parameter, index) => {
    const argument = unwrapValueExpression(call.arguments[index]);
    return argument?.type === "Identifier" &&
      symbols.scopeBindings?.get(argument) === symbols.scopeBindings?.get(parameter);
  });
}

function registeredSelfProfileAuthTransportWrapper({
  declared,
  action,
  webManifest,
  graph,
  facadeImplementationTrusted
}) {
  if (
    posixPath(declared?.apiFile ?? "") !==
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile ||
    declared?.name !== SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName
  ) {
    return null;
  }
  if (
    !facadeImplementationTrusted ||
    !registeredSelfProfileAuthTransportException(webManifest)
  ) return null;
  const dependencies = dependencyClosure(action.sourceFile, graph);
  if (!dependencies.has(SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile)) {
    return null;
  }
  return {
    apiFile: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile,
    name: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName,
    kind: "transport",
    requests: [
      {
        kind: "main",
        sourceLine: null,
        method: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.method,
        path: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath,
        normalizedPath: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath,
        normalizedKey: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey,
        bodyKind: "json"
      }
    ],
    testConsumers: [],
    productionConsumers: [action.sourceFile],
    unreachableConsumers: []
  };
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

function transparentTryCatchIsSafe(statement, symbols) {
  if (
    statement?.type !== "TryStatement" ||
    statement.finalizer ||
    statement.handler?.param?.type !== "Identifier"
  ) {
    return false;
  }
  const catchBinding = symbols?.scopeBindings?.get(
    statement.handler.param
  );
  const catchStatements = statement.handler.body?.body ?? [];
  const terminal = catchStatements.length === 1
    ? catchStatements[0]
    : null;
  const thrown = terminal?.type === "ThrowStatement"
    ? terminal.argument
    : null;
  return Boolean(
    catchBinding &&
    thrown?.type === "Identifier" &&
    symbols.scopeBindings?.get(thrown) === catchBinding
  );
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
    if (candidate.type === "TryStatement") {
      if (!transparentTryCatchIsSafe(candidate, symbols)) {
        reliable = false;
        return false;
      }
      return visit(candidate.block, false);
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

function failClosedGuardHelperIsSafe(definition, symbols) {
  const body = preflightFunctionBody(definition);
  if (
    body?.type !== "BlockStatement" ||
    (definition.params ?? []).some(
      (parameter) => parameter?.type !== "Identifier"
    )
  ) {
    return false;
  }
  const candidateBinding = symbols.scopeBindings?.get(
    definition.params?.[0]
  );
  const guardedFields = new Set();
  let guardCount = 0;
  for (const statement of body.body ?? []) {
    if (
      statement.type === "VariableDeclaration" &&
      statement.kind === "const" &&
      (statement.declarations ?? []).every(
        (declaration) =>
          declaration.id?.type === "Identifier" &&
          declaration.init &&
          preflightExpressionIsPure(
            declaration.init,
            symbols
          )
      )
    ) {
      continue;
    }
    if (
      statement.type === "IfStatement" &&
      !statement.alternate &&
      !staticTruthiness(statement.test).known &&
      preflightExpressionIsPure(
        statement.test,
        symbols
      ) &&
      preflightExpressionHasRuntimeDependency(
        statement.test,
        symbols,
        new Set(),
        new Map()
      ) &&
      preflightThrowBranchIsSafe(
        statement.consequent,
        symbols,
        new Set()
      )
    ) {
      walkEstree(statement.test, (node) => {
        if (
          node.type !== "MemberExpression" ||
          node.computed ||
          node.object?.type !== "Identifier" ||
          node.property?.type !== "Identifier" ||
          symbols.scopeBindings?.get(node.object) !== candidateBinding
        ) {
          return;
        }
        guardedFields.add(node.property.name);
      });
      guardCount += 1;
      continue;
    }
    if (
      statement.type === "ReturnStatement" &&
      preflightExpressionIsPure(
        statement.argument,
        symbols
      )
    ) {
      continue;
    }
    return false;
  }
  return (
    guardCount > 0 &&
    ["key", "entityId", "revision"].every((field) =>
      guardedFields.has(field)
    )
  );
}

function safeGuardHelperCallsBeforeWrapper(
  definition,
  calls,
  wrapper,
  symbols
) {
  const wrapperStarts = calls
    .filter((call) => importedCallMatchesWrapper(call, wrapper, symbols))
    .map((call) => call.callNode?.range?.[0] ?? Number.POSITIVE_INFINITY);
  if (wrapperStarts.length === 0) return new Set();
  const firstWrapperStart = Math.min(...wrapperStarts);
  const candidates = new Map();
  for (const call of calls) {
    if (
      call.kind !== "identifier" ||
      !call.bindingIdentifier
    ) {
      continue;
    }
    const binding = symbols.scopeBindings?.get(
      call.bindingIdentifier
    );
    const definitionForCall = binding
      ? uniqueIndexedNode(
          symbols.definitionsByBinding,
          binding
        )
      : null;
    if (!binding || !definitionForCall) continue;
    const callStart = call.callNode?.range?.[0] ?? Number.POSITIVE_INFINITY;
    const entry = candidates.get(binding) ?? {
      before: true,
      definition: definitionForCall
    };
    entry.before &&= callStart < firstWrapperStart;
    candidates.set(binding, entry);
  }
  return new Set(
    [...candidates]
      .filter(([, entry]) =>
        entry.before &&
        failClosedGuardHelperIsSafe(entry.definition, symbols)
      )
      .map(([binding]) => binding)
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

function pipelineHandlerSource(handler, wrapper, context) {
  const bindings = topLevelScopeVariables(context.symbols.scopeManager, handler);
  if (bindings.length !== 1) return null;
  const visit = (binding, visited) => {
    if (!binding || visited.has(binding) || visited.size >= 24) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(binding);
    const definition = uniqueIndexedNode(
      context.symbols.definitionsByBinding,
      binding
    );
    if (!definition?.range) return null;
    if (importedWrapperCalls([definition], wrapper, context).length > 0) {
      return [definition];
    }
    const paths = [];
    directCallableNodes(definition, (node) => {
      if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
      const called = context.symbols.scopeBindings?.get(node.callee);
      if (
        called &&
        !context.symbols.importsByBinding?.has(called) &&
        uniqueIndexedNode(context.symbols.definitionsByBinding, called)
      ) {
        const path = visit(called, nextVisited);
        if (path) paths.push(path);
      }
    });
    if (paths.length !== 1) return null;
    return [definition, ...paths[0]];
  };
  const definitions = visit(bindings[0], new Set());
  if (!definitions) return null;
  return {
    definition: definitions[0],
    definitions
  };
}

function importedWrapperCallCount(definitions, wrapper, context) {
  return importedWrapperCalls(definitions, wrapper, context).length;
}

function importedWrapperCalls(definitions, wrapper, context) {
  const calls = [];
  for (const definition of definitions ?? []) {
    walkEstree(definition, (node) => {
      if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
      const binding = context.symbols.scopeBindings?.get(node.callee);
      const imported = binding
        ? context.symbols.importsByBinding?.get(binding)
        : null;
      if (
        imported?.importedName === wrapper.name &&
        posixPath(imported.sourceFile ?? "") === posixPath(wrapper.apiFile ?? "")
      ) {
        calls.push(node);
      }
    });
  }
  return calls;
}

function awaitedCallResultBinding(call, definitions, symbols) {
  const bindings = new Set();
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        unwrapValueExpression(node.init) === call
      ) {
        const binding = symbols.scopeBindings?.get(node.id);
        if (binding) bindings.add(binding);
      }
    });
  }
  return bindings.size === 1 ? [...bindings][0] : null;
}

function expressionRootedAtBinding(expression, binding, path, symbols) {
  const value = unwrapValueExpression(expression);
  const root = referenceRootIdentifier(value);
  return Boolean(
    root &&
    symbols.scopeBindings?.get(root) === binding &&
    staticMemberPath(value) === `${root.name}.${path}`
  );
}

function sameIdentifierBinding(left, right, symbols) {
  const leftValue = unwrapValueExpression(left);
  const rightValue = unwrapValueExpression(right);
  return leftValue?.type === "Identifier" &&
    rightValue?.type === "Identifier" &&
    symbols.scopeBindings?.get(leftValue) === symbols.scopeBindings?.get(rightValue);
}

function bindingIsImmutable(binding, symbols) {
  return Boolean(binding) &&
    (symbols.writesByBinding?.get(binding) ?? []).length === 0;
}

function failClosedMemberGuardBefore({ definitions, binding, path, target, symbols }) {
  let count = 0;
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        node.type !== "IfStatement" ||
        (node.range?.[0] ?? Infinity) >= (target.range?.[0] ?? -1)
      ) return;
      const test = unwrapValueExpression(node.test);
      const guarded = test?.type === "UnaryExpression" &&
        test.operator === "!" &&
        expressionRootedAtBinding(test.argument, binding, path, symbols);
      const consequent = node.consequent?.type === "BlockStatement"
        ? node.consequent.body
        : [node.consequent];
      if (
        guarded &&
        consequent.some((statement) =>
          ["ReturnStatement", "ThrowStatement"].includes(statement?.type)
        )
      ) count += 1;
    });
  }
  return count === 1;
}

function failClosedMemberLiteralMismatchBefore({
  definitions,
  binding,
  path,
  literal,
  target,
  symbols
}) {
  let count = 0;
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        node.type !== "IfStatement" ||
        (node.range?.[0] ?? Infinity) >= (target.range?.[0] ?? -1)
      ) return;
      const test = unwrapValueExpression(node.test);
      if (!test || !["!=", "!=="].includes(test.operator)) return;
      const matches =
        (expressionRootedAtBinding(test.left, binding, path, symbols) &&
          literalString(test.right) === literal) ||
        (expressionRootedAtBinding(test.right, binding, path, symbols) &&
          literalString(test.left) === literal);
      const consequent = node.consequent?.type === "BlockStatement"
        ? node.consequent.body
        : [node.consequent];
      if (
        matches &&
        consequent.some((statement) => statement?.type === "ThrowStatement")
      ) count += 1;
    });
  }
  return count === 1;
}

function bindingDeclarationExpression(binding, symbols) {
  const direct = uniqueIndexedNode(symbols.declarationsByBinding, binding);
  if (direct) return direct;
  const definitions = binding?.defs ?? [];
  if (definitions.length !== 1) return null;
  const declarator = definitions[0]?.node;
  return declarator?.type === "VariableDeclarator" ? declarator.init : null;
}

function validationDerivedExpression(
  expression,
  validationBinding,
  symbols,
  seen = new Set(),
  localBindings = new Set()
) {
  const value = unwrapValueExpression(expression);
  if (!value) return { safe: false, origin: false };
  const root = referenceRootIdentifier(value);
  if (
    root &&
    symbols.scopeBindings?.get(root) === validationBinding &&
    staticMemberPath(value)?.startsWith(`${root.name}.values`)
  ) return { safe: true, origin: true };
  if (value.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(value);
    if (binding && localBindings.has(binding)) return { safe: true, origin: false };
    if (!binding || seen.has(binding) || !bindingIsImmutable(binding, symbols)) {
      return { safe: false, origin: false };
    }
    const declaration = bindingDeclarationExpression(binding, symbols);
    if (!declaration) return { safe: false, origin: false };
    const nextSeen = new Set(seen);
    nextSeen.add(binding);
    const proof = validationDerivedExpression(
      declaration,
      validationBinding,
      symbols,
      nextSeen,
      localBindings
    );
    return proof.origin ? proof : { safe: false, origin: false };
  }
  if (["Literal", "MetaProperty"].includes(value.type)) {
    return { safe: true, origin: false };
  }
  const combine = (parts) => ({
    safe: parts.length > 0 && parts.every((part) => part.safe),
    origin: parts.some((part) => part.origin)
  });
  if (value.type === "MemberExpression") {
    const parts = [validationDerivedExpression(value.object, validationBinding, symbols, seen, localBindings)];
    if (value.computed) {
      parts.push(validationDerivedExpression(value.property, validationBinding, symbols, seen, localBindings));
    }
    return combine(parts);
  }
  if (value.type === "CallExpression" || value.type === "NewExpression") {
    const parts = (value.arguments ?? []).map((argument) =>
      argument?.type === "SpreadElement"
        ? validationDerivedExpression(argument.argument, validationBinding, symbols, seen, localBindings)
        : validationDerivedExpression(argument, validationBinding, symbols, seen, localBindings)
    );
    return combine(parts);
  }
  if (["UnaryExpression", "AwaitExpression", "ChainExpression"].includes(value.type)) {
    return validationDerivedExpression(value.argument ?? value.expression, validationBinding, symbols, seen, localBindings);
  }
  if (["BinaryExpression", "LogicalExpression"].includes(value.type)) {
    return combine([
      validationDerivedExpression(value.left, validationBinding, symbols, seen, localBindings),
      validationDerivedExpression(value.right, validationBinding, symbols, seen, localBindings)
    ]);
  }
  if (value.type === "ConditionalExpression") {
    return combine([
      validationDerivedExpression(value.test, validationBinding, symbols, seen, localBindings),
      validationDerivedExpression(value.consequent, validationBinding, symbols, seen, localBindings),
      validationDerivedExpression(value.alternate, validationBinding, symbols, seen, localBindings)
    ]);
  }
  if (value.type === "TemplateLiteral") {
    return combine(value.expressions.map((item) =>
      validationDerivedExpression(item, validationBinding, symbols, seen, localBindings)
    ));
  }
  if (value.type === "ArrayExpression") {
    return combine(value.elements.filter(Boolean).map((item) =>
      item.type === "SpreadElement"
        ? validationDerivedExpression(item.argument, validationBinding, symbols, seen, localBindings)
        : validationDerivedExpression(item, validationBinding, symbols, seen, localBindings)
    ));
  }
  if (value.type === "ObjectExpression") {
    return combine(value.properties.map((property) => {
      if (property?.type === "SpreadElement") {
        return validationDerivedExpression(property.argument, validationBinding, symbols, seen, localBindings);
      }
      return property?.type === "Property" && property.kind === "init"
        ? validationDerivedExpression(property.value, validationBinding, symbols, seen, localBindings)
        : { safe: false, origin: false };
    }));
  }
  if (["ArrowFunctionExpression", "FunctionExpression"].includes(value.type)) {
    if (!value.params?.every((parameter) => parameter?.type === "Identifier")) {
      return { safe: false, origin: false };
    }
    const callbackLocals = new Set(localBindings);
    for (const parameter of value.params) {
      const binding = symbols.scopeBindings?.get(parameter);
      if (!binding) return { safe: false, origin: false };
      callbackLocals.add(binding);
    }
    let callbackBody = value.body;
    if (callbackBody?.type === "BlockStatement") {
      if (callbackBody.body?.length !== 1 || callbackBody.body[0]?.type !== "ReturnStatement") {
        return { safe: false, origin: false };
      }
      callbackBody = callbackBody.body[0].argument;
    }
    return validationDerivedExpression(
      callbackBody,
      validationBinding,
      symbols,
      seen,
      callbackLocals
    );
  }
  return { safe: false, origin: false };
}

function payloadFieldsHaveValidationOrigin(expression, validationBinding, symbols) {
  const value = unwrapValueExpression(expression);
  if (value?.type === "Identifier") {
    const binding = symbols.scopeBindings?.get(value);
    const declaration = binding && bindingIsImmutable(binding, symbols)
      ? bindingDeclarationExpression(binding, symbols)
      : null;
    return declaration
      ? payloadFieldsHaveValidationOrigin(declaration, validationBinding, symbols)
      : false;
  }
  if (value?.type !== "ObjectExpression" || value.properties.length === 0) {
    const proof = validationDerivedExpression(value, validationBinding, symbols);
    return proof.safe && proof.origin;
  }
  return value.properties.every((property) => {
    if (property?.type === "SpreadElement") {
      const proof = validationDerivedExpression(property.argument, validationBinding, symbols);
      return proof.safe && proof.origin;
    }
    if (property?.type !== "Property" || property.kind !== "init") return false;
    const proof = validationDerivedExpression(property.value, validationBinding, symbols);
    return proof.safe && proof.origin;
  });
}

function importedCallsByName(definitions, importedName, sourceFile, context) {
  const matches = [];
  for (const definition of definitions ?? []) {
    walkEstree(definition, (node) => {
      if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
      const binding = context.symbols.scopeBindings?.get(node.callee);
      const imported = binding
        ? context.symbols.importsByBinding?.get(binding)
        : null;
      if (
        imported?.importedName === importedName &&
        posixPath(imported.sourceFile ?? "") === posixPath(sourceFile ?? "")
      ) {
        matches.push({ call: node, imported });
      }
    });
  }
  return matches;
}

function expressionContainsBindingMember(expression, binding, path, symbols) {
  let found = false;
  walkEstree(unwrapValueExpression(expression), (node) => {
    if (!found && expressionRootedAtBinding(node, binding, path, symbols)) {
      found = true;
    }
  });
  return found;
}

function exactEnabledActionPredicate(
  expression,
  freshBinding,
  actionKey,
  capabilitySource,
  symbols
) {
  const directClauses = [];
  const flattenDirect = (node) => {
    const value = unwrapValueExpression(node);
    if (value?.type === "LogicalExpression" && value.operator === "&&") {
      flattenDirect(value.left);
      flattenDirect(value.right);
      return;
    }
    directClauses.push(value);
  };
  flattenDirect(expression);
  if (
    capabilitySource === `${freshBinding.name}.currentTask` &&
    directClauses.length === 2
  ) {
    let currentTaskKeyMatched = 0;
    let currentTaskEnabledMatched = 0;
    for (const clause of directClauses) {
      if (!clause || clause.type !== "BinaryExpression" || !["==", "==="].includes(clause.operator)) {
        currentTaskKeyMatched = 0;
        currentTaskEnabledMatched = 0;
        break;
      }
      const pairs = [
        [clause.left, clause.right],
        [clause.right, clause.left]
      ];
      if (pairs.some(([member, literal]) =>
        expressionRootedAtBinding(member, freshBinding, "currentTask.key", symbols) &&
        literalString(literal) === actionKey
      )) {
        currentTaskKeyMatched += 1;
        continue;
      }
      if (pairs.some(([member, literal]) =>
        expressionRootedAtBinding(member, freshBinding, "currentTask.enabled", symbols) &&
        unwrapValueExpression(literal)?.type === "Literal" &&
        unwrapValueExpression(literal)?.value === true
      )) {
        currentTaskEnabledMatched += 1;
        continue;
      }
      currentTaskKeyMatched = 0;
      currentTaskEnabledMatched = 0;
      break;
    }
    if (currentTaskKeyMatched === 1 && currentTaskEnabledMatched === 1) {
      return true;
    }
  }
  const call = unwrapValueExpression(expression);
  const callee = unwrapValueExpression(call?.callee);
  if (
    capabilitySource !== `${freshBinding.name}.availableActions` ||
    call?.type !== "CallExpression" ||
    callee?.type !== "MemberExpression" ||
    callee.computed ||
    callee.property?.type !== "Identifier" ||
    callee.property.name !== "some" ||
    !expressionRootedAtBinding(callee.object, freshBinding, "availableActions", symbols) ||
    call.arguments?.length !== 1
  ) return false;
  const callback = unwrapValueExpression(call.arguments[0]);
  if (
    !["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type) ||
    callback.params?.length !== 1 ||
    callback.params[0]?.type !== "Identifier"
  ) return false;
  const itemBinding = symbols.scopeBindings?.get(callback.params[0]);
  if (!itemBinding) return false;
  let body = callback.body;
  if (body?.type === "BlockStatement") {
    if (body.body?.length !== 1 || body.body[0]?.type !== "ReturnStatement") return false;
    body = body.body[0].argument;
  }
  const clauses = [];
  const flatten = (node) => {
    const value = unwrapValueExpression(node);
    if (value?.type === "LogicalExpression" && value.operator === "&&") {
      flatten(value.left);
      flatten(value.right);
      return;
    }
    clauses.push(value);
  };
  flatten(body);
  if (clauses.length !== 2) return false;
  let keyMatched = 0;
  let enabledMatched = 0;
  for (const clause of clauses) {
    if (!clause || clause.type !== "BinaryExpression" || !["==", "==="].includes(clause.operator)) {
      return false;
    }
    const pairs = [
      [clause.left, clause.right],
      [clause.right, clause.left]
    ];
    if (pairs.some(([member, literal]) =>
      expressionRootedAtBinding(member, itemBinding, "key", symbols) &&
      literalString(literal) === actionKey
    )) {
      keyMatched += 1;
      continue;
    }
    if (pairs.some(([member, literal]) =>
      expressionRootedAtBinding(member, itemBinding, "enabled", symbols) &&
      unwrapValueExpression(literal)?.type === "Literal" &&
      unwrapValueExpression(literal)?.value === true
    )) {
      enabledMatched += 1;
      continue;
    }
    return false;
  }
  return keyMatched === 1 && enabledMatched === 1;
}

function failClosedBindingGuardBefore({ definitions, binding, target, symbols }) {
  let count = 0;
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        node.type !== "IfStatement" ||
        (node.range?.[0] ?? Infinity) >= (target.range?.[0] ?? -1)
      ) return;
      const test = unwrapValueExpression(node.test);
      const argument = test?.type === "UnaryExpression" && test.operator === "!"
        ? unwrapValueExpression(test.argument)
        : null;
      const consequent = node.consequent?.type === "BlockStatement"
        ? node.consequent.body
        : [node.consequent];
      if (
        argument?.type === "Identifier" &&
        symbols.scopeBindings?.get(argument) === binding &&
        consequent.some((statement) => statement?.type === "ThrowStatement")
      ) count += 1;
    });
  }
  return count === 1;
}

function projectFreshCapabilitySources({
  action,
  handler,
  projectIdExpression,
  targetCall,
  excludedBindings,
  context
}) {
  const capabilityField = action.capability.source?.split(".").at(-1);
  if (!["canManage", "canManageMasterData"].includes(capabilityField)) return null;
  const freshCandidates = [];
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
      const call = unwrapValueExpression(node.init);
      const binding = context.symbols.scopeBindings?.get(node.id);
      if (
        call?.type !== "CallExpression" ||
        !importedReadSource(call, context.serverReadImports, context.symbols) ||
        !binding ||
        excludedBindings.has(binding) ||
        !bindingIsImmutable(binding, context.symbols) ||
        !sameIdentifierBinding(call.arguments?.[0], projectIdExpression, context.symbols)
      ) return;
      freshCandidates.push(binding);
    });
  }
  if (freshCandidates.length !== 1) return null;
  const freshBinding = freshCandidates[0];
  const operationBindings = new Set();
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        expressionContainsBindingMember(
          node.init,
          freshBinding,
          capabilityField,
          context.symbols
        )
      ) {
        const binding = context.symbols.scopeBindings?.get(node.id);
        if (binding) operationBindings.add(binding);
      }
    });
  }
  if (operationBindings.size !== 1) return null;
  const operationBinding = [...operationBindings][0];
  if (
    !bindingIsImmutable(operationBinding, context.symbols) ||
    !failClosedBindingGuardBefore({
      definitions: handler.definitions,
      binding: operationBinding,
      target: targetCall,
      symbols: context.symbols
    })
  ) return null;
  return pipelineCapabilitySourceEvidence({
    action,
    handlerDefinition: handler.definition,
    freshName: freshBinding.name,
    context
  });
}

function projectDefinitionPipelineProof({ action, wrapper, handler, context }) {
  const definitionMatches = importedCallsByName(
    handler.definitions,
    "fetchBusinessEntryDefinition",
    "apps/web-admin/src/api/business-entry.api.ts",
    context
  );
  const validationMatches = importedCallsByName(
    handler.definitions,
    "validateBusinessEntryDraft",
    "apps/web-admin/src/api/business-entry.api.ts",
    context
  );
  if (definitionMatches.length !== 1 || validationMatches.length !== 1) return null;
  const definitionCall = definitionMatches[0].call;
  const validationCall = validationMatches[0].call;
  const definitionBinding = awaitedCallResultBinding(
    definitionCall,
    handler.definitions,
    context.symbols
  );
  const validationBinding = awaitedCallResultBinding(
    validationCall,
    handler.definitions,
    context.symbols
  );
  if (
    !definitionBinding ||
    !validationBinding ||
    !bindingIsImmutable(definitionBinding, context.symbols) ||
    !bindingIsImmutable(validationBinding, context.symbols) ||
    (definitionCall.range?.[0] ?? Infinity) >= (validationCall.range?.[0] ?? -1)
  ) return null;

  const scene = literalString(definitionCall.arguments?.[0]);
  const definitionScope = unwrapValueExpression(definitionCall.arguments?.[1]);
  const definitionTarget = unwrapValueExpression(definitionCall.arguments?.[2]);
  const definitionOperation = literalString(definitionCall.arguments?.[3]);
  const projectIdExpression = objectPropertyValue(definitionScope, "projectId");
  const projectId = unwrapValueExpression(projectIdExpression);
  const projectBinding = projectId?.type === "Identifier"
    ? context.symbols.scopeBindings?.get(projectId)
    : null;
  if (
    !scene ||
    definitionOperation !== "edit" ||
    literalString(objectPropertyValue(definitionScope, "scope")) !== "project" ||
    literalString(objectPropertyValue(definitionTarget, "entityType")) !== "project" ||
    !sameIdentifierBinding(
      objectPropertyValue(definitionTarget, "entityId"),
      projectIdExpression,
      context.symbols
    ) ||
    !bindingIsImmutable(projectBinding, context.symbols)
  ) return null;

  const validationScope = unwrapValueExpression(validationCall.arguments?.[0]);
  const validationPayload = unwrapValueExpression(validationCall.arguments?.[1]);
  const validationTarget = unwrapValueExpression(
    objectPropertyValue(validationPayload, "target")
  );
  const values = objectPropertyValue(validationPayload, "values");
  const valuesIdentifier = unwrapValueExpression(values);
  const valuesBinding = valuesIdentifier?.type === "Identifier"
    ? context.symbols.scopeBindings?.get(valuesIdentifier)
    : null;
  if (
    literalString(objectPropertyValue(validationScope, "scope")) !== "project" ||
    !sameIdentifierBinding(
      objectPropertyValue(validationScope, "projectId"),
      projectIdExpression,
      context.symbols
    ) ||
    !expressionRootedAtBinding(
      objectPropertyValue(validationPayload, "sceneKey"),
      definitionBinding,
      "key",
      context.symbols
    ) ||
    !expressionRootedAtBinding(
      objectPropertyValue(validationPayload, "definitionVersion"),
      definitionBinding,
      "version",
      context.symbols
    ) ||
    literalString(objectPropertyValue(validationTarget, "entityType")) !== "project" ||
    !sameIdentifierBinding(
      objectPropertyValue(validationTarget, "entityId"),
      projectIdExpression,
      context.symbols
    ) ||
    literalString(validationCall.arguments?.[2]) !== definitionOperation ||
    !bindingIsImmutable(valuesBinding, context.symbols) ||
    !failClosedMemberLiteralMismatchBefore({
      definitions: handler.definitions,
      binding: definitionBinding,
      path: "key",
      literal: scene,
      target: validationCall,
      symbols: context.symbols
    })
  ) return null;

  const targetCalls = importedWrapperCalls(handler.definitions, wrapper, context);
  if (targetCalls.length !== 1) return null;
  const targetCall = targetCalls[0];
  const validationOnly = targetCall === validationCall;
  if (!validationOnly) {
    if (
      (targetCall.range?.[0] ?? -1) <= (validationCall.range?.[0] ?? Infinity) ||
      !sameIdentifierBinding(
        targetCall.arguments?.[0],
        projectIdExpression,
        context.symbols
      ) ||
      !failClosedMemberGuardBefore({
        definitions: handler.definitions,
        binding: validationBinding,
        path: "valid",
        target: targetCall,
        symbols: context.symbols
      }) ||
      (targetCall.arguments ?? []).slice(1).length === 0 ||
      !(targetCall.arguments ?? []).slice(1).every((argument) =>
        argument?.type !== "SpreadElement" &&
        payloadFieldsHaveValidationOrigin(
          argument,
          validationBinding,
          context.symbols
        )
      )
    ) return null;
  }

  const definitionName = definitionBinding.name;
  const definitionSources = pipelineFreshReadSources({
    handlerDefinition: handler.definition,
    freshName: definitionName,
    context
  })?.sources ?? null;
  let capabilitySources = validationOnly ? definitionSources : null;
  if (action.capability.kind !== "server_definition") {
    capabilitySources = projectFreshCapabilitySources({
      action,
      handler,
      projectIdExpression,
      targetCall,
      excludedBindings: new Set([definitionBinding, validationBinding]),
      context
    });
    if (capabilitySources?.size !== 1) return null;
  }
  return {
    kind: "project_definition",
    verified: true,
    capabilityWitness: validationOnly || capabilitySources?.size === 1,
    capabilitySources,
    definitionSources
  };
}

function projectCapabilityPipelineProof({ action, wrapper, handler, context }) {
  if (
    importedCallsByName(
      handler.definitions,
      "fetchBusinessEntryDefinition",
      "apps/web-admin/src/api/business-entry.api.ts",
      context
    ).length > 0 ||
    importedCallsByName(
      handler.definitions,
      "validateBusinessEntryDraft",
      "apps/web-admin/src/api/business-entry.api.ts",
      context
    ).length > 0
  ) return null;
  const targetCalls = importedWrapperCalls(handler.definitions, wrapper, context);
  if (targetCalls.length !== 1) return null;
  const targetCall = targetCalls[0];
  const projectId = unwrapValueExpression(targetCall.arguments?.[0]);
  const projectBinding = projectId?.type === "Identifier"
    ? context.symbols.scopeBindings?.get(projectId)
    : null;
  if (!bindingIsImmutable(projectBinding, context.symbols)) return null;
  const capabilitySources = projectFreshCapabilitySources({
    action,
    handler,
    projectIdExpression: projectId,
    targetCall,
    excludedBindings: new Set(),
    context
  });
  if (capabilitySources?.size !== 1) return null;

  const specializedValidation = importedCallsByName(
    handler.definitions,
    "validateProjectParticipatingCompanyDeactivation",
    "apps/web-admin/src/api/project-operating-profile.api.ts",
    context
  );
  const specializedWrite = importedCallsByName(
    handler.definitions,
    "deactivateProjectParticipatingCompany",
    "apps/web-admin/src/api/project-operating-profile.api.ts",
    context
  );
  if (specializedValidation.length > 0 || specializedWrite.length > 0) {
    if (specializedValidation.length !== 1 || specializedWrite.length !== 1) return null;
    const validationCall = specializedValidation[0].call;
    const writeCall = specializedWrite[0].call;
    const validationBinding = awaitedCallResultBinding(
      validationCall,
      handler.definitions,
      context.symbols
    );
    if (
      !validationBinding ||
      !bindingIsImmutable(validationBinding, context.symbols) ||
      !sameIdentifierBinding(validationCall.arguments?.[0], writeCall.arguments?.[0], context.symbols) ||
      !sameIdentifierBinding(validationCall.arguments?.[1], writeCall.arguments?.[1], context.symbols) ||
      !sameIdentifierBinding(validationCall.arguments?.[2], writeCall.arguments?.[2], context.symbols) ||
      !failClosedMemberGuardBefore({
        definitions: handler.definitions,
        binding: validationBinding,
        path: "valid",
        target: writeCall,
        symbols: context.symbols
      }) ||
      (validationCall.range?.[0] ?? Infinity) >= (writeCall.range?.[0] ?? -1)
    ) return null;
  }
  return {
    kind: "project_capability",
    verified: true,
    capabilityWitness: true,
    capabilitySources
  };
}

function pipelineFreshReadSources({ handlerDefinition, freshName, context }) {
  if (!freshName || !handlerDefinition) return null;
  const freshBindings = new Set();
  directCallableNodes(handlerDefinition, (node) => {
    if (node.type === "Identifier" && node.name === freshName) {
      const binding = context.symbols.scopeBindings?.get(node);
      if (binding) freshBindings.add(binding);
    }
  });
  if (freshBindings.size !== 1) return null;
  const freshBinding = [...freshBindings][0];
  const declaration = uniqueIndexedNode(
    context.symbols.declarationsByBinding,
    freshBinding
  );
  const sources = declaration
    ? expressionServerReadSources(declaration, context)
    : null;
  if (sources?.size !== 1) return null;
  return { binding: freshBinding, sources };
}

function pipelineCapabilitySourceEvidence({ action, handlerDefinition, freshName, context }) {
  const root = capabilitySourceRoot(action.capability.source);
  if (!root) return null;
  const freshRead = pipelineFreshReadSources({
    handlerDefinition,
    freshName,
    context
  });
  if (!freshRead) return null;
  const { binding: freshBinding, sources } = freshRead;
  if (root === freshName) return sources;
  const rootBindings = topLevelScopeVariables(context.symbols.scopeManager, root);
  if (rootBindings.length !== 1) return null;
  const rootBinding = rootBindings[0];
  let rebound = false;
  directCallableNodes(handlerDefinition, (node) => {
    if (node.type !== "AssignmentExpression" || node.operator !== "=") return;
    const left = unwrapValueExpression(node.left);
    const right = unwrapValueExpression(node.right);
    const leftRoot = referenceRootIdentifier(left);
    if (
      leftRoot?.name === root &&
      context.symbols.scopeBindings?.get(leftRoot) === rootBinding &&
      right?.type === "Identifier" &&
      context.symbols.scopeBindings?.get(right) === freshBinding
    ) {
      rebound = true;
    }
  });
  return rebound ? sources : null;
}

function nodeContainsNode(container, candidate) {
  return Array.isArray(container?.range) && Array.isArray(candidate?.range) &&
    container.range[0] <= candidate.range[0] &&
    container.range[1] >= candidate.range[1];
}

function expressionReferencesBinding(expression, binding, symbols) {
  let found = false;
  walkEstree(unwrapValueExpression(expression), (node) => {
    if (
      !found &&
      node.type === "Identifier" &&
      symbols.scopeBindings?.get(node) === binding
    ) found = true;
  });
  return found;
}

function failClosedCoordinateMismatchBefore({
  definitions,
  freshBinding,
  freshPath,
  coordinateBinding,
  target,
  symbols
}) {
  let matched = false;
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        matched ||
        node.type !== "IfStatement" ||
        (node.range?.[0] ?? Infinity) >= (target.range?.[0] ?? -1)
      ) return;
      let mismatch = false;
      walkEstree(node.test, (candidate) => {
        if (
          candidate?.type === "BinaryExpression" &&
          ["!=", "!=="].includes(candidate.operator) &&
          ((expressionRootedAtBinding(
            candidate.left,
            freshBinding,
            freshPath,
            symbols
          ) && expressionReferencesBinding(candidate.right, coordinateBinding, symbols)) ||
          (expressionRootedAtBinding(
            candidate.right,
            freshBinding,
            freshPath,
            symbols
          ) && expressionReferencesBinding(candidate.left, coordinateBinding, symbols)))
        ) mismatch = true;
      });
      const consequent = node.consequent?.type === "BlockStatement"
        ? node.consequent.body
        : [node.consequent];
      if (
        mismatch &&
        consequent.some((statement) => statement?.type === "ThrowStatement")
      ) matched = true;
    });
  }
  return matched;
}

function failClosedBindingMismatchBefore({
  definitions,
  leftBinding,
  leftPath,
  rightBinding,
  clearBinding = null,
  clearPath = null,
  target,
  symbols
}) {
  let matched = false;
  for (const definition of definitions ?? []) {
    directCallableNodes(definition, (node) => {
      if (
        matched ||
        node.type !== "IfStatement" ||
        (node.range?.[0] ?? Infinity) >= (target.range?.[0] ?? -1)
      ) return;
      let mismatch = false;
      walkEstree(node.test, (candidate) => {
        if (
          candidate?.type === "BinaryExpression" &&
          ["!=", "!=="].includes(candidate.operator) &&
          ((expressionRootedAtBinding(candidate.left, leftBinding, leftPath, symbols) &&
            expressionReferencesBinding(candidate.right, rightBinding, symbols)) ||
          (expressionRootedAtBinding(candidate.right, leftBinding, leftPath, symbols) &&
            expressionReferencesBinding(candidate.left, rightBinding, symbols)))
        ) mismatch = true;
      });
      const consequent = node.consequent?.type === "BlockStatement"
        ? node.consequent.body
        : [node.consequent];
      let clearsRetainedSource = !clearBinding;
      for (const statement of consequent) {
        walkEstree(statement, (candidate) => {
          if (
            candidate?.type === "AssignmentExpression" &&
            candidate.operator === "=" &&
            expressionRootedAtBinding(candidate.left, clearBinding, clearPath, symbols) &&
            unwrapValueExpression(candidate.right)?.type === "Literal" &&
            unwrapValueExpression(candidate.right)?.value === null
          ) clearsRetainedSource = true;
        });
      }
      if (
        mismatch &&
        clearsRetainedSource &&
        consequent.some((statement) => statement?.type === "ThrowStatement")
      ) matched = true;
    });
  }
  return matched;
}

function importedCallMetadata(call, symbols) {
  if (call?.callee?.type !== "Identifier") return null;
  const binding = symbols.scopeBindings?.get(call.callee);
  return binding ? symbols.importsByBinding?.get(binding) ?? null : null;
}

function guardedUploadPipelineProof({ action, wrapper, handler, context }) {
  const helperCandidates = [];
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
      const callbackIndex = (node.arguments ?? []).findIndex((argument) =>
        ["ArrowFunctionExpression", "FunctionExpression"].includes(
          unwrapValueExpression(argument)?.type
        )
      );
      if (callbackIndex < 1) return;
      const imported = importedCallMetadata(node, context.symbols);
      if (!imported?.sourceFile || !imported?.importedName) return;
      const helperAst = context.asts.get(imported.sourceFile);
      if (!helperAst) return;
      const helperSymbols = buildSymbolContext(
        helperAst,
        imported.sourceFile,
        context.sourceFileSet
      );
      const bindings = topLevelScopeVariables(
        helperSymbols.scopeManager,
        imported.importedName
      );
      const helperDefinition = bindings.length === 1
        ? uniqueIndexedNode(helperSymbols.definitionsByBinding, bindings[0])
        : null;
      if (!helperDefinition || helperDefinition.params?.length <= callbackIndex) return;
      helperCandidates.push({
        call: node,
        callback: unwrapValueExpression(node.arguments[callbackIndex]),
        callbackIndex,
        imported,
        helperDefinition,
        helperSymbols
      });
    });
  }
  if (helperCandidates.length !== 1) return null;
  const witness = helperCandidates[0];
  const helperFileParameter = witness.helperDefinition.params[witness.callbackIndex - 1];
  const helperUploadParameter = witness.helperDefinition.params[witness.callbackIndex];
  if (
    helperFileParameter?.type !== "Identifier" ||
    helperUploadParameter?.type !== "Identifier" ||
    witness.callback?.params?.length !== 2 ||
    !witness.callback.params.every((parameter) => parameter?.type === "Identifier")
  ) return null;
  const helperFileBinding = witness.helperSymbols.scopeBindings?.get(helperFileParameter);
  const helperUploadBinding = witness.helperSymbols.scopeBindings?.get(helperUploadParameter);
  const helperUploadCalls = [];
  directCallableNodes(witness.helperDefinition, (node) => {
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      witness.helperSymbols.scopeBindings?.get(node.callee) === helperUploadBinding
    ) helperUploadCalls.push(node);
  });
  if (helperUploadCalls.length !== 1 || (helperUploadBinding?.references ?? []).length !== 1) {
    return null;
  }
  const helperUploadCall = helperUploadCalls[0];
  if (
    !sameIdentifierBinding(
      helperUploadCall.arguments?.[0],
      helperFileParameter,
      witness.helperSymbols
    ) ||
    !expressionRootedAtBinding(
      helperUploadCall.arguments?.[1],
      helperFileBinding,
      "name",
      witness.helperSymbols
    )
  ) return null;
  const voucherBinding = awaitedCallResultBinding(
    helperUploadCall,
    [witness.helperDefinition],
    witness.helperSymbols
  );
  if (!bindingIsImmutable(voucherBinding, witness.helperSymbols)) return null;
  const helperReturns = [];
  directCallableNodes(witness.helperDefinition, (node) => {
    if (node.type === "ReturnStatement") helperReturns.push(node);
  });
  if (helperReturns.length !== 1) return null;
  const returnObject = unwrapValueExpression(helperReturns[0].argument);
  if (
    returnObject?.type !== "ObjectExpression" ||
    !expressionRootedAtBinding(
      objectPropertyValue(returnObject, "voucherFileId"),
      voucherBinding,
      "id",
      witness.helperSymbols
    )
  ) return null;

  const callbackBindings = witness.callback.params.map((parameter) =>
    context.symbols.scopeBindings?.get(parameter)
  );
  if (callbackBindings.some((binding) => !binding)) return null;
  const callbackUploadCalls = [];
  walkEstree(witness.callback, (node) => {
    if (node.type !== "CallExpression" || !importedCallMetadata(node, context.symbols)) return;
    const firstCallbackArgument = (node.arguments ?? []).findIndex((argument) => {
      const value = unwrapValueExpression(argument);
      return value?.type === "Identifier" &&
        context.symbols.scopeBindings?.get(value) === callbackBindings[0];
    });
    if (
      firstCallbackArgument >= 1 &&
      sameIdentifierBinding(
        node.arguments[firstCallbackArgument + 1],
        witness.callback.params[1],
        context.symbols
      )
    ) callbackUploadCalls.push({ call: node, firstCallbackArgument });
  });
  if (callbackUploadCalls.length !== 1) return null;
  const uploadCall = callbackUploadCalls[0].call;
  const coordinateExpressions = uploadCall.arguments.slice(
    0,
    callbackUploadCalls[0].firstCallbackArgument
  );
  const coordinateBindings = coordinateExpressions.map((expression) => {
    const value = unwrapValueExpression(expression);
    return value?.type === "Identifier"
      ? context.symbols.scopeBindings?.get(value) ?? null
      : null;
  });
  if (
    coordinateBindings.length < 1 ||
    coordinateBindings.length > 2 ||
    coordinateBindings.some((binding) => !bindingIsImmutable(binding, context.symbols))
  ) return null;

  const payloadBindings = new Set();
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
      let containsHelper = false;
      walkEstree(node.init, (candidate) => {
        if (candidate === witness.call) containsHelper = true;
      });
      if (containsHelper) {
        const binding = context.symbols.scopeBindings?.get(node.id);
        if (binding) payloadBindings.add(binding);
      }
    });
  }
  if (payloadBindings.size !== 1) return null;
  const payloadBinding = [...payloadBindings][0];
  if (!bindingIsImmutable(payloadBinding, context.symbols)) return null;
  const payloadDeclaration = bindingDeclarationExpression(payloadBinding, context.symbols);
  const payloadExpression = unwrapValueExpression(payloadDeclaration);
  let retainedBinding = null;
  let retainedSourceBinding = null;
  let retainedSourcePath = null;
  if (payloadExpression?.type === "LogicalExpression" && payloadExpression.operator === "??") {
    const retainedRoot = referenceRootIdentifier(payloadExpression.left);
    retainedBinding = retainedRoot?.type === "Identifier"
      ? context.symbols.scopeBindings?.get(retainedRoot) ?? null
      : null;
    if (
      !retainedBinding ||
      !bindingIsImmutable(retainedBinding, context.symbols) ||
      !expressionRootedAtBinding(
        payloadExpression.left,
        retainedBinding,
        "payload",
        context.symbols
      ) ||
      !nodeContainsNode(payloadExpression.right, witness.call)
    ) return null;
    const retainedDeclaration = bindingDeclarationExpression(retainedBinding, context.symbols);
    const retainedSourceRoot = referenceRootIdentifier(retainedDeclaration);
    retainedSourceBinding = retainedSourceRoot?.type === "Identifier"
      ? context.symbols.scopeBindings?.get(retainedSourceRoot) ?? null
      : null;
    const retainedDeclarationPath = staticMemberPath(unwrapValueExpression(retainedDeclaration));
    retainedSourcePath = retainedDeclarationPath?.split(".").slice(1).join(".") ?? null;
    if (!retainedSourceBinding || !retainedSourcePath) return null;
  } else if (!nodeContainsNode(payloadExpression, witness.call)) {
    return null;
  }

  const finalCalls = [];
  for (const definition of handler.definitions) {
    walkEstree(definition, (node) => {
      if (
        node.type !== "CallExpression" ||
        nodeContainsNode(witness.callback, node) ||
        node === witness.call ||
        !importedCallMetadata(node, context.symbols)
      ) return;
      const payloadIndex = (node.arguments ?? []).findIndex((argument) => {
        const value = unwrapValueExpression(argument);
        return value?.type === "Identifier" &&
          context.symbols.scopeBindings?.get(value) === payloadBinding;
      });
      if (payloadIndex !== coordinateBindings.length) return;
      if (!coordinateExpressions.every((coordinate, index) =>
        sameIdentifierBinding(node.arguments[index], coordinate, context.symbols)
      )) return;
      finalCalls.push(node);
    });
  }
  if (finalCalls.length !== 1) return null;
  const finalCall = finalCalls[0];
  if (
    (witness.call.range?.[0] ?? Infinity) >= (finalCall.range?.[0] ?? -1) ||
    (uploadCall.range?.[0] ?? Infinity) >= (finalCall.range?.[0] ?? -1)
  ) return null;

  const capabilityRoot = capabilitySourceRoot(action.capability.source);
  const freshBindings = new Set();
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        node.id.name === capabilityRoot
      ) {
        const call = unwrapValueExpression(node.init);
        const binding = context.symbols.scopeBindings?.get(node.id);
        if (
          call?.type === "CallExpression" &&
          importedReadSource(call, context.serverReadImports, context.symbols) &&
          binding &&
          sameIdentifierBinding(call.arguments?.[0], coordinateExpressions[0], context.symbols)
        ) freshBindings.add(binding);
      }
    });
  }
  if (freshBindings.size !== 1) return null;
  const freshBinding = [...freshBindings][0];
  const coordinatePaths = coordinateBindings.length === 2
    ? ["payment.id", "payment.procurement.id"]
    : ["id"];
  if (!coordinateBindings.every((coordinateBinding, index) =>
    failClosedCoordinateMismatchBefore({
      definitions: handler.definitions,
      freshBinding,
      freshPath: coordinatePaths[index],
      coordinateBinding,
      target: witness.call,
      symbols: context.symbols
    })
  )) return null;
  if (retainedBinding) {
    if (
      coordinateBindings.length !== 2 ||
      !coordinateBindings.every((coordinateBinding, index) =>
        failClosedBindingMismatchBefore({
          definitions: handler.definitions,
          leftBinding: retainedBinding,
          leftPath: index === 0 ? "paymentId" : "procurementId",
          rightBinding: coordinateBinding,
          clearBinding: retainedSourceBinding,
          clearPath: retainedSourcePath,
          target: witness.call,
          symbols: context.symbols
        })
      )
    ) return null;
    const expectedBindings = new Set();
    for (const definition of handler.definitions) {
      directCallableNodes(definition, (node) => {
        if (
          node.type === "VariableDeclarator" &&
          node.id?.type === "Identifier" &&
          expressionRootedAtBinding(
            node.init,
            freshBinding,
            "discrepancy.refundExpectedAmountCents",
            context.symbols
          )
        ) {
          const binding = context.symbols.scopeBindings?.get(node.id);
          if (binding && bindingIsImmutable(binding, context.symbols)) expectedBindings.add(binding);
        }
      });
    }
    if (expectedBindings.size !== 1) return null;
    if (!failClosedBindingMismatchBefore({
      definitions: handler.definitions,
      leftBinding: retainedBinding,
      leftPath: "payload.amountCents",
      rightBinding: [...expectedBindings][0],
      clearBinding: retainedSourceBinding,
      clearPath: retainedSourcePath,
      target: witness.call,
      symbols: context.symbols
    })) return null;
  }
  const operationBindings = new Set();
  for (const definition of handler.definitions) {
    directCallableNodes(definition, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        exactEnabledActionPredicate(
          node.init,
          freshBinding,
          action.capability.key,
          action.capability.source,
          context.symbols
        )
      ) {
        const binding = context.symbols.scopeBindings?.get(node.id);
        if (binding) operationBindings.add(binding);
      }
    });
  }
  if (operationBindings.size !== 1) return null;
  const operationBinding = [...operationBindings][0];
  if (
    !failClosedBindingGuardBefore({
      definitions: handler.definitions,
      binding: operationBinding,
      target: uploadCall,
      symbols: context.symbols
    }) ||
    !failClosedBindingGuardBefore({
      definitions: handler.definitions,
      binding: operationBinding,
      target: finalCall,
      symbols: context.symbols
    })
  ) return null;
  const currentWrapperCalls = importedWrapperCalls(
    handler.definitions,
    wrapper,
    context
  );
  if (
    currentWrapperCalls.length !== 1 ||
    (currentWrapperCalls[0] !== uploadCall && currentWrapperCalls[0] !== finalCall)
  ) return null;
  const capabilitySources = pipelineCapabilitySourceEvidence({
    action,
    handlerDefinition: handler.definition,
    freshName: freshBinding.name,
    context
  });
  return capabilitySources?.size === 1
    ? {
        kind: "guarded_upload",
        verified: true,
        capabilityWitness: true,
        capabilitySources
      }
    : null;
}

// A deliberately narrow AST-backed bridge for the two governed pipelines that
// are wider than the ordinary single-wrapper causal proof.  It never relies on
// a file name or action id: the witness is the fresh read, fail-closed guards,
// value flow and the concrete transport wrapper call in the trigger handler.
/* A bounded proof for an immutable, owner-bound server action projection.
 * It supplements one pipeline proof; the general causal/try rules stay strict.
 */
function frozenServerGrantPipelineProof({ action, wrapper, handler, context }) {
  if (action.capability.kind !== "available_action_string" ||
      !/^[A-Za-z_$][\w$]*\.value\.(?:actions|serverAvailableActions)$/u.test(action.capability.source) ||
      handler.definitions.length !== 1) return null;
  const { symbols } = context;
  const definition = handler.definition;
  const fileGrant = action.capability.source.endsWith(".serverAvailableActions");
  const actionField = fileGrant ? "serverAvailableActions" : "actions";
  const approvedFileLoops = new Set();
  const roots = topLevelScopeVariables(symbols.scopeManager, capabilitySourceRoot(action.capability.source));
  if (roots.length !== 1) return null;
  const rootBinding = roots[0];
  const rootDeclaration = uniqueIndexedNode(symbols.declarationsByBinding, rootBinding);
  if (!expressionIsEmptyVueRef(rootDeclaration, symbols)) return null;
  const ids = new Map();
  const identity = (binding) => {
    if (!ids.has(binding)) ids.set(binding, `b${ids.size}`);
    return ids.get(binding);
  };
  const bindingOf = (node) => symbols.scopeBindings?.get(unwrapValueExpression(node));
  const member = (node) => {
    const value = unwrapValueExpression(node);
    return value?.type === "MemberExpression" && !value.optional
      ? staticMemberProperty(value) : null;
  };
  const path = (node, environment = new Map(), seen = []) => {
    const value = unwrapValueExpression(node);
    if (value?.type === "MemberExpression" && !value.optional) {
      const name = member(value), base = path(value.object, environment, seen);
      return name && base ? `${base}.${name}` : null;
    }
    if (value?.type !== "Identifier") return null;
    const binding = bindingOf(value);
    if (!binding || seen.length > 48 || seen.some(frame => frame.binding === binding && frame.environment === environment)) return null;
    const next = [...seen, { binding, environment }];
    if (environment.has(binding)) {
      const bound = environment.get(binding);
      return path(bound.node, bound.environment, next);
    }
    const declaration = uniqueIndexedNode(symbols.declarationsByBinding, binding);
    const initializer = unwrapValueExpression(declaration);
    const vueRef = initializer?.type === "CallExpression" &&
      symbols.vueRefImportBindings.has(bindingOf(initializer.callee));
    if (!vueRef && (symbols.writesByBinding.get(binding) ?? []).length > 0) return null;
    if (declaration && !expressionIsEmptyVueRef(declaration, symbols)) {
      const candidate = path(declaration, environment, next);
      if (candidate) return candidate;
    }
    return identity(binding);
  };
  const cap = `${identity(rootBinding)}.value`;
  const globalCall = (node, globalName, methodName = null) => {
    const value = unwrapValueExpression(node);
    const callee = unwrapValueExpression(value?.callee);
    const root = methodName ? unwrapValueExpression(callee?.object) : callee;
    return value?.type === "CallExpression" && (!methodName || member(callee) === methodName) &&
      root?.type === "Identifier" && root.name === globalName &&
      unshadowedRuntimeGlobal(root, new Set([globalName]), symbols.scopeBindings);
  };
  const frozen = (node) => globalCall(node, "Object", "freeze") && node.arguments?.length === 1
    ? unwrapValueExpression(node.arguments[0]) : null;
  const assignments = symbols.writesByBinding.get(rootBinding) ?? [];
  const populated = assignments.filter(write => !expressionIsEmptyCapabilityState(write.value));
  if (populated.length !== 1 || assignments.some(write => write.operator !== "=" || write.path !== `${capabilitySourceRoot(action.capability.source)}.value`)) return null;
  const record = frozen(populated[0].value);
  const requiredFields = fileGrant ? ["ownerKey", "readGeneration", "fileId", "documentId", "serverAction", "serverAvailableActions"] : ["ownerKey", "readGeneration", "sourceRevision", "fingerprint", "actions"];
  if (record?.type !== "ObjectExpression" || record.properties.length !== requiredFields.length ||
      record.properties.some(property => property.type !== "Property" || property.kind !== "init" || property.method || property.computed)) return null;
  const properties = new Map(record.properties.map(property => [property.key.name ?? property.key.value, property.value]));
  if (!requiredFields.every(key => properties.has(key))) return null;
  const functions = [...symbols.definitionsByBinding.entries()].flatMap(([binding]) => {
    const value = uniqueIndexedNode(symbols.definitionsByBinding, binding);
    return value?.range && value.range[0] < record.range[0] && value.range[1] > record.range[1]
      ? [{ binding, definition: value }] : [];
  });
  if (functions.length !== 1) return null;
  const writer = functions[0];
  if (![1, 2].includes(writer.definition.params?.length) || writer.definition.params.some(parameter => parameter.type !== "Identifier")) return null;
  const targetCalls = importedWrapperCalls([definition], wrapper, context);
  if (targetCalls.length !== 1) return null;
  const target = targetCalls[0];
  const attempts = [];
  directCallableNodes(definition, node => { if (node.type === "TryStatement" && node.block.range[0] < target.range[0] && node.block.range[1] > target.range[1]) attempts.push(node); });
  if (attempts.length !== 1) return null;
  const attempt = attempts[0];
  const writerCalls = [];
  directCallableNodes(attempt.block, node => {
    if (node.type === "CallExpression" && bindingOf(node.callee) === writer.binding && node.range[0] < target.range[0]) writerCalls.push(node);
  });
  if (writerCalls.length !== 1 || writerCalls[0].arguments.length !== writer.definition.params.length) return null;
  const callSites = binding => {
    const sites = [];
    walkEstree(symbols.ast, node => { if (node.type === "CallExpression" && bindingOf(node.callee) === binding) sites.push(node); });
    return sites;
  };
  const callableEscapes = binding => {
    let escaped = false;
    walkEstree(symbols.ast, node => {
      if (node.type !== "Identifier" || bindingOf(node) !== binding || !symbols.scopeReferenceIdentifiers.has(node)) return;
      const parent = astAncestorChain(symbols.ast, node)?.at(-2);
      if (parent?.type !== "CallExpression" || parent.callee !== node) escaped = true;
    });
    return escaped;
  };
  const enclosingCallable = node => [...symbols.definitionsByBinding.keys()].map(binding => ({ binding,
    definition: uniqueIndexedNode(symbols.definitionsByBinding, binding) })).filter(value => value.definition?.range &&
      value.definition.range[0] < node.range[0] && value.definition.range[1] > node.range[1])
    .sort((left, right) => (left.definition.range[1] - left.definition.range[0]) - (right.definition.range[1] - right.definition.range[0]))[0] ?? null;
  const awaitedBefore = (call, before, requireRejectedResult = false) => {
    const ancestors = astAncestorChain(symbols.ast, call) ?? [];
    const awaited = ancestors.at(-2);
    if (awaited?.type !== "AwaitExpression" || awaited.argument !== call) return false;
    const block = ancestors.filter(node => node.type === "BlockStatement").at(-1);
    if (!block || before <= block.range[0] || before >= block.range[1]) return false;
    const statement = block.body.find(node => node.range[0] <= call.range[0] && node.range[1] >= call.range[1]);
    if (!statement || statement.range[1] >= before) return false;
    if (!requireRejectedResult && statement.type === "ExpressionStatement" && statement.expression === awaited) return true;
    if (!requireRejectedResult && statement.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1 && statement.declarations[0].init === awaited) return true;
    const test = unwrapValueExpression(statement.test), stop = statement.consequent?.type === "BlockStatement" ? statement.consequent.body.at(-1) : statement.consequent;
    return statement.type === "IfStatement" && !statement.alternate && test?.type === "UnaryExpression" && test.operator === "!" &&
      test.argument === awaited && ["ReturnStatement", "ThrowStatement"].includes(stop?.type);
  };
  const bindCall = (callable, call, outer = new Map()) => {
    if (callable.params.length !== call.arguments.length || callable.params.some(parameter => parameter.type !== "Identifier") || call.arguments.some(argument => argument.type === "SpreadElement")) return null;
    const environment = new Map(outer);
    callable.params.forEach((parameter, index) => environment.set(bindingOf(parameter), { node: call.arguments[index], environment: outer }));
    return environment;
  };
  if (callableEscapes(writer.binding) || !awaitedBefore(writerCalls[0], target.range[0])) return null;
  const writerBody = writer.definition.body?.body ?? [];
  const replacement = writerBody.findIndex(statement => statement.type === "ExpressionStatement" &&
    statement.expression.type === "AssignmentExpression" && statement.expression.right === populated[0].value);
  if (replacement < 0) return null;
  const rejectsFailure = awaitedBefore(writerCalls[0], target.range[0], true);
  for (const statement of writerBody.slice(0, replacement)) {
    if (["ExpressionStatement", "VariableDeclaration"].includes(statement.type)) continue;
    const stop = statement.consequent?.type === "BlockStatement" ?
      (statement.consequent.body.length === 1 ? statement.consequent.body[0] : null) : statement.consequent;
    if (statement.type !== "IfStatement" || statement.alternate || !(stop?.type === "ThrowStatement" ||
        rejectsFailure && stop?.type === "ReturnStatement" && unwrapValueExpression(stop.argument)?.type === "Literal" && stop.argument.value === false)) return null;
  }
  const suffix = writerBody.slice(replacement + 1);
  if (suffix.length > 1 || suffix.length === 1 && suffix[0].type !== "ReturnStatement") return null;
  const writerEnvironment = bindCall(writer.definition, writerCalls[0]);
  if (!writerEnvironment) return null;
  const actualOwner = path(writerCalls[0].arguments[0]);
  const owner = path(writer.definition.params[0], writerEnvironment);
  if (path(properties.get("ownerKey"), writerEnvironment) !== `${owner}.ownerKey` ||
      path(properties.get("readGeneration"), writerEnvironment) !== `${owner}.generation`) return null;
  const projectedReads = new Map();
  const projectedIdentityRead = binding => {
    if (projectedReads.has(binding)) return projectedReads.get(binding);
    projectedReads.set(binding, null);
    const imported = symbols.importsByBinding.get(binding);
    if (imported?.kind !== "named") return null;
    const metadata = context.wrapperIndex?.get(wrapperIdentity(imported.sourceFile, imported.importedName));
    const requests = metadata ? normalizedMainRequests(metadata) : [];
    if (metadata?.kind !== "transport" || metadata.returnProvenance !== "unverified" || !metadata.productionConsumers?.includes(context.sourceFile) || requests.length !== 1 || requests[0].method?.toUpperCase() !== "GET") return null;
    const ast = context.asts.get(imported.sourceFile);
    if (!ast) return null;
    const local = buildSymbolContext(ast, imported.sourceFile, context.sourceFileSet), localBinding = node => local.scopeBindings.get(unwrapValueExpression(node));
    const bindings = topLevelScopeVariables(local.scopeManager, imported.importedName), facadeBinding = bindings.length === 1 ? bindings[0] : null;
    const facade = facadeBinding ? uniqueIndexedNode(local.definitionsByBinding, facadeBinding) : null;
    if (!facade || (local.writesByBinding.get(facadeBinding) ?? []).length || facade.params.length !== 1 || facade.params[0].type !== "Identifier" || facade.body?.type !== "BlockStatement" || facade.body.body.length !== 2) return null;
    const [declaration, returned] = facade.body.body;
    const raw = declaration.type === "VariableDeclaration" && declaration.kind === "const" && declaration.declarations.length === 1 ? declaration.declarations[0] : null;
    const read = raw?.init?.type === "AwaitExpression" ? unwrapValueExpression(raw.init.argument) : null;
    const output = returned.type === "ReturnStatement" ? unwrapValueExpression(returned.argument) : null;
    const body = raw?.id.type === "Identifier" ? localBinding(raw.id) : null, transport = read?.callee?.type === "Identifier" ? localBinding(read.callee) : null;
    if (!body || !transport || (local.writesByBinding.get(body) ?? []).length || (local.writesByBinding.get(transport) ?? []).length || output?.type !== "ObjectExpression" || output.properties.length !== 2 ||
        output.properties[0].type !== "SpreadElement" || localBinding(output.properties[0].argument) !== body || output.properties[1].type !== "Property" || output.properties[1].computed || output.properties[1].method || output.properties[1].kind !== "init") return null;
    const coordinates = new Set(["contractVersionId", "draftRevision", "documentContentRevision", "layoutTemplateVersionId", "sourceSha256"]);
    const override = output.properties[1], field = override.key.name ?? override.key.value, normalize = unwrapValueExpression(override.value);
    if (coordinates.has(field) || normalize?.type !== "CallExpression" || normalize.callee.type !== "Identifier" || normalize.arguments.length !== 1 ||
        normalize.arguments[0].type !== "MemberExpression" || normalize.arguments[0].computed || member(normalize.arguments[0]) !== field || localBinding(normalize.arguments[0].object) !== body) return null;
    // Reuse the existing producer's transparent GET transport witness, not a
    // helper name. This wrapper remains unverified as a whole response.
    const trustedTransport = [...(context.wrapperIndex?.values() ?? [])].some(wrapper => {
      if (wrapper.apiFile !== imported.sourceFile || wrapper.returnProvenance !== "transparent_main_response" || normalizedMainRequests(wrapper).length !== 1 || normalizedMainRequests(wrapper)[0].method?.toUpperCase() !== "GET") return false;
      const siblings = topLevelScopeVariables(local.scopeManager, wrapper.name), sibling = siblings.length === 1 ? uniqueIndexedNode(local.definitionsByBinding, siblings[0]) : null;
      const expression = sibling?.body?.type === "BlockStatement" && sibling.body.body.length === 1 && sibling.body.body[0].type === "ReturnStatement" ? unwrapValueExpression(sibling.body.body[0].argument) : null;
      return expression?.type === "CallExpression" && localBinding(expression.callee) === transport;
    });
    if (!trustedTransport) return null;
    let confined = true;
    walkEstree(ast, reference => {
      if (reference.type !== "Identifier" || localBinding(reference) !== body || !local.scopeReferenceIdentifiers.has(reference)) return;
      const parent = astAncestorChain(ast, reference)?.at(-2);
      if (parent?.type === "VariableDeclarator" && parent.id === reference && parent.init === raw.init || parent === output.properties[0] || parent === normalize.arguments[0]) return;
      confined = false;
    });
    if (!confined) return null;
    const normalizerBinding = localBinding(normalize.callee), normalizer = normalizerBinding ? uniqueIndexedNode(local.definitionsByBinding, normalizerBinding) : null;
    if (!normalizer || (local.writesByBinding.get(normalizerBinding) ?? []).length || normalizer.async || normalizer.params.length !== 1 || normalizer.params[0].type !== "Identifier" || normalizer.body?.type !== "BlockStatement" || normalizer.body.body.length !== 3 ||
        normalizer.body.body[0].type !== "IfStatement" || normalizer.body.body[1].type !== "IfStatement" || normalizer.body.body[2].type !== "ReturnStatement") return null;
    const global = (node, name) => node?.type === "Identifier" && node.name === name && unshadowedRuntimeGlobal(node, new Set([name]), local.scopeBindings);
    const literalConstant = variable => {
      const value = variable ? unwrapValueExpression(uniqueIndexedNode(local.declarationsByBinding, variable)) : null;
      return value?.type === "Literal" && ["string", "number", "boolean"].includes(typeof value.value) && !(local.writesByBinding.get(variable) ?? []).length;
    };
    const constantSets = new Map();
    const constantSet = variable => {
      if (constantSets.has(variable)) return constantSets.get(variable);
      constantSets.set(variable, false);
      const value = variable ? unwrapValueExpression(uniqueIndexedNode(local.declarationsByBinding, variable)) : null;
      if (value?.type !== "NewExpression" || !global(value.callee, "Set") || value.arguments.length !== 1 || value.arguments[0].type !== "ArrayExpression" || value.arguments[0].elements.some(item => item?.type !== "Literal" || typeof item.value !== "string") || (local.writesByBinding.get(variable) ?? []).length) return false;
      let valid = true;
      walkEstree(ast, reference => {
        if (reference.type !== "Identifier" || localBinding(reference) !== variable || !local.scopeReferenceIdentifiers.has(reference)) return;
        const ancestors = astAncestorChain(ast, reference), parent = ancestors?.at(-2), call = ancestors?.at(-3);
        if (parent?.type === "VariableDeclarator" && parent.id === reference && parent.init === value) return;
        if (parent?.type !== "MemberExpression" || parent.computed || parent.object !== reference || member(parent) !== "has" || call?.type !== "CallExpression" || call.callee !== parent) valid = false;
      });
      constantSets.set(variable, valid); return valid;
    };
    const normalSyntax = new Set(["FunctionDeclaration", "ArrowFunctionExpression", "Identifier", "BlockStatement", "IfStatement", "ReturnStatement", "CallExpression", "MemberExpression", "LogicalExpression", "BinaryExpression", "UnaryExpression", "Literal", "ArrayExpression", "SpreadElement", "NewExpression", "TSAsExpression", "TSTypeAnnotation", "TSUnknownKeyword", "TSTypeReference", "TSUnionType", "TSArrayType", "TSStringKeyword", "TSTypeParameterInstantiation"]);
    const pureJsonArray = (node, parameters, arrayReturns = true) => {
      let valid = true;
      directCallableNodes(node, current => {
        if (!valid) return;
        if (!normalSyntax.has(current.type) || current.type === "UnaryExpression" && !["!", "typeof"].includes(current.operator)) { valid = false; return; }
        if (current.type === "Identifier" && local.scopeReferenceIdentifiers.has(current)) {
          const variable = localBinding(current), parent = astAncestorChain(ast, current)?.at(-2);
          if (parameters.has(variable) || literalConstant(variable) || global(current, "undefined")) return;
          if (parent?.type === "MemberExpression" && parent.object === current && member(parent) === "has" && constantSet(variable)) return;
          if (parent?.type === "MemberExpression" && parent.object === current && global(current, "Array") && member(parent) === "isArray" || parent?.type === "NewExpression" && parent.callee === current && global(current, "Set")) return;
          valid = false; return;
        }
        if (current.type === "ReturnStatement" && arrayReturns && unwrapValueExpression(current.argument)?.type !== "ArrayExpression") { valid = false; return; }
        if (current.type === "NewExpression" && !(global(current.callee, "Set") && current.arguments.length === 1 && parameters.has(localBinding(unwrapValueExpression(current.arguments[0]))))) { valid = false; return; }
        if (current.type !== "CallExpression") return;
        if (member(current.callee) === "isArray" && global(current.callee.object, "Array") && current.arguments.length === 1 && parameters.has(localBinding(current.arguments[0]))) return;
        if (member(current.callee) === "has" && constantSet(localBinding(current.callee.object)) && current.arguments.length === 1 && parameters.has(localBinding(current.arguments[0]))) return;
        const callback = current.arguments[0];
        if (member(current.callee) === "some" && parameters.has(localBinding(current.callee.object)) && current.arguments.length === 1 && callback?.type === "ArrowFunctionExpression" && !callback.async && callback.params.length === 1 && callback.params[0].type === "Identifier" && pureJsonArray(callback, new Set([...parameters, localBinding(callback.params[0])]), false)) return;
        valid = false;
      });
      return valid;
    };
    if (!pureJsonArray(normalizer, new Set([localBinding(normalizer.params[0])]))) return null;
    const proof = { sourceIdentity: wrapperIdentity(imported.sourceFile, imported.importedName), fields: coordinates };
    projectedReads.set(binding, proof); return proof;
  };
  // Trace one immutable field through const aliases, bound parameters and a
  // single frozen record return. Unselected fields never become authority.
  const fieldOrigin = (node, environment, frame, trail = [], seen = new Set(), missing = new Set()) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.size > 32) return null;
    const freeze = frozen(value);
    if (freeze?.type === "ConditionalExpression") {
      const check = unwrapValueExpression(freeze.test), yes = unwrapValueExpression(freeze.consequent), no = unwrapValueExpression(freeze.alternate);
      const arrayCheck = unwrapValueExpression(check?.left), every = unwrapValueExpression(check?.right);
      const callback = unwrapValueExpression(every?.arguments?.[0]);
      const predicate = unwrapValueExpression(callback?.body), typed = unwrapValueExpression(predicate?.left);
      const cloned = yes?.type === "ArrayExpression" && yes.elements.length === 1 && yes.elements[0]?.type === "SpreadElement" ? yes.elements[0].argument : null;
      const sourcePath = cloned ? path(cloned, environment) : null;
      if (check?.type !== "LogicalExpression" || check.operator !== "&&" || !globalCall(arrayCheck, "Array", "isArray") || arrayCheck.arguments.length !== 1 ||
          every?.type !== "CallExpression" || member(every.callee) !== "every" || every.arguments.length !== 1 ||
          callback?.type !== "ArrowFunctionExpression" || callback.async || callback.params.length !== 1 || callback.params[0].type !== "Identifier" ||
          predicate?.type !== "BinaryExpression" || predicate.operator !== "===" || literalString(predicate.right) !== "string" ||
          typed?.type !== "UnaryExpression" || typed.operator !== "typeof" || typed.argument.type !== "Identifier" || bindingOf(typed.argument) !== bindingOf(callback.params[0]) ||
          !sourcePath || path(arrayCheck.arguments[0], environment) !== sourcePath || path(every.callee.object, environment) !== sourcePath ||
          no?.type !== "ArrayExpression" || no.elements.length !== 0) return null;
      const source = fieldOrigin(cloned, environment, frame, trail, seen, missing);
      if (source?.kind !== "read") return null;
      return { ...source, immutableArray: true };
    }
    if (freeze?.type === "ArrayExpression") {
      if (freeze.elements.length !== 1 || freeze.elements[0]?.type !== "SpreadElement") return null;
      const source = fieldOrigin(freeze.elements[0].argument, environment, frame, trail, seen, missing);
      return source?.kind === "read" ? { ...source, immutableArray: true } : null;
    }
    if (freeze?.type === "ObjectExpression" && freeze.properties.length === 1 && freeze.properties[0].type === "SpreadElement") {
      const source = fieldOrigin(freeze.properties[0].argument, environment, frame, trail, seen, missing);
      return source?.kind === "read" ? { ...source, immutableRecord: true } : null;
    }
    if (freeze?.type === "ObjectExpression") {
      if (freeze.properties.length > 8 || freeze.properties.some(property => property.type !== "Property" || property.kind !== "init" || property.method || property.computed)) return null;
      const fields = new Map(freeze.properties.map(property => [property.key.name ?? property.key.value, property.value]));
      return fields.size === freeze.properties.length ? { kind: "record", fields, environment, frame, trail } : null;
    }
    if (value.type === "MemberExpression" && !value.optional) {
      const field = member(value), object = fieldOrigin(value.object, environment, frame, trail, seen, missing);
      if (!field || !object) return null;
      if (object.kind === "record") {
        const selected = object.fields.get(field);
        return selected ? fieldOrigin(selected, object.environment, object.frame, object.trail, seen, missing) : null;
      }
      if (object.allowedFields && object.fields.length === 0 && !object.allowedFields.has(field)) return null;
      return { ...object, fields: [...object.fields, field] };
    }
    if (value.type === "Identifier") {
      const binding = bindingOf(value);
      if (!binding || seen.has(binding) || (symbols.writesByBinding.get(binding) ?? []).length > 0) return null;
      const next = new Set(seen).add(binding);
      const bound = environment.get(binding);
      const initializer = bound?.node ?? uniqueIndexedNode(symbols.declarationsByBinding, binding);
      if (!initializer) { missing.add(binding); return null; }
      const source = fieldOrigin(initializer, bound?.environment ?? environment, frame, trail, next, missing);
      return source?.kind === "read" && !source.holder && source.fields.length === 0 ? { ...source, holder: binding } : source;
    }
    if (value.type !== "CallExpression" || value.callee.type !== "Identifier" || value.arguments.some(argument => argument.type === "SpreadElement")) return null;
    const binding = bindingOf(value.callee), sourceIdentity = context.serverReadImports.get(binding);
    if ((symbols.writesByBinding.get(binding) ?? []).length > 0) return null;
    if (sourceIdentity) {
      return value.arguments.length === 1 ? { kind: "read", sourceIdentity, read: value, coordinate: path(value.arguments[0], environment),
        environment, frame, trail, fields: [], holder: null } : null;
    }
    const projected = projectedIdentityRead(binding);
    if (projected && value.arguments.length === 1) {
      return { kind: "read", sourceIdentity: projected.sourceIdentity, allowedFields: projected.fields, read: value, coordinate: path(value.arguments[0], environment), environment, frame, trail, fields: [], holder: null };
    }
    const callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
    if (!callable || (symbols.writesByBinding.get(binding) ?? []).length > 0 || seen.has(binding) || callable.params.length !== value.arguments.length || callable.params.some(parameter => parameter.type !== "Identifier")) return null;
    const returns = [];
    directCallableNodes(callable, current => {
      if (current.type === "ReturnStatement" && !expressionIsEmptyCapabilityState(current.argument)) returns.push(current);
    });
    if (returns.length !== 1 || !frozen(returns[0].argument)) return null;
    const local = new Map(environment);
    callable.params.forEach((parameter, index) => local.set(bindingOf(parameter), { node: value.arguments[index], environment }));
    return fieldOrigin(returns[0].argument, local, { definition: callable, limit: returns[0].range[0] }, [...trail, value], new Set(seen).add(binding), missing);
  };
  const readHasIdentity = (origin, idField, revisionField, actualOwner, extraFields = []) => {
    const equal = (left, right) => [left, right].sort().join("=");
    if (!origin.holder) return false;
    const equalities = new Set();
    const collect = node => {
      const value = unwrapValueExpression(node);
      if (value?.type === "LogicalExpression" && value.operator === "||") { collect(value.left); collect(value.right); }
      else if (value?.type === "BinaryExpression" && value.operator === "!==") {
        const left = path(value.left, origin.environment), right = path(value.right, origin.environment);
        if (left && right) equalities.add(equal(left, right));
      }
    };
    for (const statement of origin.frame.definition.body.body ?? []) {
      if (statement.range[0] >= origin.frame.limit) break;
      if (statement.range[0] <= origin.read.range[1]) continue;
      const stopped = statement.consequent?.type === "BlockStatement" && statement.consequent.body.length === 1 ? statement.consequent.body[0] : statement.consequent;
      if (statement.type === "IfStatement" && !statement.alternate && stopped?.type === "ThrowStatement") collect(statement.test);
    }
    return equalities.has(equal(`${identity(origin.holder)}.${idField}`, `${actualOwner}.context.contractVersionId`)) &&
      equalities.has(equal(`${identity(origin.holder)}.${revisionField}`, `${actualOwner}.context.draftRevision`)) &&
      extraFields.every(([field, ownerField]) => equalities.has(equal(`${identity(origin.holder)}.${field}`, `${actualOwner}.${ownerField}`)));
  };
  const evaluateProjection = (environment, caller, before) => {
    const missing = new Set();
    const actualOwner = path(writer.definition.params[0], environment);
    if (!actualOwner || path(properties.get("ownerKey"), environment) !== `${actualOwner}.ownerKey` ||
        path(properties.get("readGeneration"), environment) !== `${actualOwner}.generation`) return { missing };
    const sourceFrame = { definition: writer.definition, limit: record.range[0] };
  const actionOrigin = fieldOrigin(properties.get(actionField), environment, sourceFrame, [], new Set(), missing);
  const fingerprintOrigin = fieldOrigin(properties.get("fingerprint"), environment, sourceFrame, [], new Set(), missing);
  const revisionOrigin = fieldOrigin(properties.get("sourceRevision"), environment, sourceFrame, [], new Set(), missing);
  const sameRead = (left, right) => left?.kind === "read" && right?.kind === "read" && left.read === right.read &&
    left.coordinate === right.coordinate && left.trail.length === right.trail.length && left.trail.every((call, index) => call === right.trail[index]);
  if (fileGrant) {
    const pdf = writer.definition.params.length === 2 ? path(writer.definition.params[1], environment) : null;
    const serverAction = fieldOrigin(properties.get("serverAction"), environment, sourceFrame, [], new Set(), missing);
    if (!pdf || path(properties.get("fileId"), environment) !== `${pdf}.fileId` || path(properties.get("documentId"), environment) !== `${pdf}.documentId` ||
        actionOrigin?.kind !== "read" || !actionOrigin.immutableArray || actionOrigin.fields.join(".") !== "availableActions" ||
        !sameRead(actionOrigin, serverAction) || !serverAction.immutableRecord || serverAction.fields.join(".") !== "action" ||
        actionOrigin.coordinate !== `${pdf}.fileId` || actionOrigin.frame.definition !== writer.definition || actionOrigin.trail.length !== 0 ||
        !awaitedBefore(actionOrigin.read, record.range[0])) return { missing };
    return { missing, sourceIdentity: actionOrigin.sourceIdentity };
  }
  if (actionOrigin?.kind !== "read" || !actionOrigin.immutableArray || actionOrigin.fields.join(".") !== "draftOperationAvailableActions" ||
      !sameRead(actionOrigin, fingerprintOrigin) || fingerprintOrigin.fields.join(".") !== "version.documentContentFingerprint" ||
      revisionOrigin?.kind !== "read" || actionOrigin.coordinate !== `${actualOwner}.context.contractVersionId` || revisionOrigin.coordinate !== actionOrigin.coordinate) return { missing };
  const sourceIdentity = actionOrigin.sourceIdentity;
  const currentRead = origin => {
    const range = origin.frame.definition.range;
    if (!range || origin.read.range[0] <= range[0] || origin.read.range[1] >= range[1] || origin.trail.length > 1 ||
        !awaitedBefore(origin.read, origin.frame.limit)) return false;
    if (origin.frame.definition === writer.definition) return true;
    const invocation = origin.trail[0];
    return Boolean(invocation && invocation.range[0] > caller.range[0] && invocation.range[1] < caller.range[1] &&
      invocation.range[1] < before && awaitedBefore(invocation, before));
  };
  if (!currentRead(actionOrigin) || !currentRead(revisionOrigin)) return { missing };

  if (!readHasIdentity(actionOrigin, "version.id", "version.draftRevision", actualOwner)) return { missing };
  if (sameRead(actionOrigin, revisionOrigin)) {
    if (revisionOrigin.fields.join(".") !== "version.draftRevision") return { missing };
  } else if (revisionOrigin.fields.join(".") !== "draftRevision" || !readHasIdentity(revisionOrigin, "contractVersionId", "draftRevision", actualOwner)) return { missing };
    return { missing, sourceIdentity };
  };
  const mainProjection = evaluateProjection(writerEnvironment, definition, writerCalls[0].range[0]);
  if (!mainProjection.sourceIdentity) return null;
  const sourceIdentity = mainProjection.sourceIdentity;
  // Every other writer call must have the same trusted read. One lexical
  // parameter-forwarding frame covers the current read-only recovery chain;
  // an unknown caller or deeper/dynamic argument flow stays unproven.
  for (const call of callSites(writer.binding)) {
    if (call === writerCalls[0]) continue;
    const caller = enclosingCallable(call), initial = bindCall(writer.definition, call);
    const callBlock = (astAncestorChain(symbols.ast, call) ?? []).filter(node => node.type === "BlockStatement").at(-1);
    if (!caller || !initial || !callBlock || !awaitedBefore(call, callBlock.range[1] - 1)) return null;
    const projected = evaluateProjection(initial, caller.definition, call.range[0]);
    if (projected.sourceIdentity === sourceIdentity) continue;
    if (projected.missing.size !== 1) return null;
    const [parameter] = projected.missing;
    const parents = [...symbols.definitionsByBinding.keys()].map(binding => ({ binding,
      definition: uniqueIndexedNode(symbols.definitionsByBinding, binding) })).filter(value =>
        value.definition?.params?.some(node => bindingOf(node) === parameter));
    if (parents.length !== 1 || parents[0].definition !== caller.definition || callableEscapes(parents[0].binding)) return null;
    const parent = parents[0], callers = callSites(parent.binding);
    if (callers.length === 0 || callers.length > 16) return null;
    for (const incoming of callers) {
      const outerCaller = enclosingCallable(incoming), outer = bindCall(parent.definition, incoming);
      const environment = outer ? bindCall(writer.definition, call, outer) : null;
      if (!outerCaller || !environment || evaluateProjection(environment, outerCaller.definition, incoming.range[0]).sourceIdentity !== sourceIdentity) return null;
    }
  }
  const equal = (left, right) => [left, right].sort().join("=");
  const terminates = statement => statement?.type === "ReturnStatement" || statement?.type === "ThrowStatement" ||
    (statement?.type === "BlockStatement" && statement.body.length === 1 && terminates(statement.body[0]));
  const capturedAfterRead = node => {
    let fresh = true;
    walkEstree(node, candidate => {
      if (candidate.type !== "Identifier") return;
      const value = path(candidate), binding = bindingOf(candidate);
      if (!value || !(value === cap || value.startsWith(`${cap}.`)) || binding === rootBinding) return;
      const capture = uniqueIndexedNode(symbols.declarationsByBinding, binding);
      if (!capture?.range || capture.range[0] <= writerCalls[0].range[1]) fresh = false;
    });
    return fresh;
  };
  if (!target.arguments.every(capturedAfterRead)) return null;
  const actualPdf = fileGrant && writerCalls[0].arguments.length === 2 ? path(writerCalls[0].arguments[1]) : null;
  if (!actualOwner) return null;
  if (fileGrant) {
    const options = unwrapValueExpression(target.arguments[1]);
    const fields = options?.type === "ObjectExpression" && options.properties.every(property => property.type === "Property" && !property.computed && !property.method && property.kind === "init") ?
      new Map(options.properties.map(property => [property.key.name ?? property.key.value, property.value])) : null;
    if (!actualPdf || target.arguments.length !== 3 || path(target.arguments[0]) !== `${cap}.fileId` || literalString(target.arguments[2]) !== "pdf-blob" ||
        !fields || fields.size !== 3 || options.properties.length !== 3 || !["confirmationPassword", "downloadReason", "accessMode"].every(key => fields.has(key)) || literalString(fields.get("accessMode")) !== "preview") return null;
  } else if (target.arguments.length !== 2 || path(target.arguments[0]) !== `${actualOwner}.context.contractVersionId` || path(target.arguments[1]) !== `${cap}.sourceRevision`) return null;
  const purePredicates = new Set();
  const trustedIncludes = new Set();
  const frameworkImport = (binding, moduleName, importedName, localSymbols = symbols) => (localSymbols.ast?.body ?? []).some(statement =>
    statement.type === "ImportDeclaration" && literalString(statement.source) === moduleName && statement.specifiers.some(specifier =>
      specifier.type === "ImportSpecifier" && (specifier.imported.name ?? specifier.imported.value) === importedName && topLevelScopeVariables(localSymbols.scopeManager, specifier.local.name).includes(binding)));
  const plainData = node => {
    const value = unwrapValueExpression(node);
    return value?.type === "Literal" && (value.value === null || ["string", "number", "boolean"].includes(typeof value.value)) ||
      value?.type === "ObjectExpression" && value.properties.every(property => property.type === "Property" && !property.computed && !property.method && property.kind === "init" && unwrapValueExpression(property.value)?.type === "Literal" && plainData(property.value));
  };
  const confinedDataBindings = new Map();
  const confinedDataBinding = (binding, seen = new Set()) => {
    if (!seen.size && confinedDataBindings.has(binding)) return confinedDataBindings.get(binding);
    if (!binding || seen.has(binding) || (symbols.writesByBinding.get(binding) ?? []).length) return false;
    let valid = true;
    walkEstree(symbols.ast, reference => {
      if (!valid || reference.type !== "Identifier" || bindingOf(reference) !== binding || !symbols.scopeReferenceIdentifiers.has(reference)) return;
      const parent = astAncestorChain(symbols.ast, reference)?.at(-2);
      if (parent?.type === "VariableDeclarator" && parent.id === reference) return;
      if (parent?.type === "VariableDeclarator" && parent.init === reference && parent.id.type === "Identifier" && confinedDataBinding(bindingOf(parent.id), new Set(seen).add(binding))) return;
      if (parent?.type === "MemberExpression" && parent.object === reference && !parent.computed) return;
      valid = false;
    });
    if (!seen.size) confinedDataBindings.set(binding, valid);
    return valid;
  };
  let scalarRefProducer = () => false;
  const scalarRefValue = (node, environment = new Map(), seen = new Set()) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.size > 16) return false;
    if (value.type === "Literal") return value.value === null || ["string", "number", "boolean"].includes(typeof value.value);
    if (value.type === "Identifier") {
      if (value.name === "undefined" && unshadowedRuntimeGlobal(value, new Set(["undefined"]), symbols.scopeBindings)) return true;
      const variable = bindingOf(value), bound = environment.get(variable);
      if (!variable || seen.has(variable) || (symbols.writesByBinding.get(variable) ?? []).length) return false;
      const initial = bound?.node ?? uniqueIndexedNode(symbols.declarationsByBinding, variable);
      return Boolean(initial) && scalarRefValue(initial, bound?.environment ?? environment, new Set(seen).add(variable));
    }
    if (value.type === "ConditionalExpression") return scalarRefValue(value.consequent, environment, seen) && scalarRefValue(value.alternate, environment, seen);
    return scalarRefProducer(value, environment);
  };
  const basicRefValue = (node, environment = new Map()) => scalarRefValue(node, environment) ||
    fieldOrigin(node, environment, { definition, limit: target.range[0] })?.kind === "record";
  let qualifiedRefValue = basicRefValue;
  const rawDataRefs = new Map();
  const rawDataRefConfined = binding => {
    if (rawDataRefs.has(binding)) return rawDataRefs.get(binding);
    const initial = unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding));
    if (initial?.type === "CallExpression" && symbols.vueRefImportBindings.has(bindingOf(initial.callee)) &&
        (!qualifiedRefValue(initial.arguments[0]) || (symbols.writesByBinding.get(binding) ?? []).some(write => !qualifiedRefValue(write.value)))) {
      rawDataRefs.set(binding, false); return false;
    }
    let valid = true;
    walkEstree(symbols.ast, reference => {
      if (reference.type !== "Identifier" || bindingOf(reference) !== binding || !symbols.scopeReferenceIdentifiers.has(reference)) return;
      const parent = astAncestorChain(symbols.ast, reference)?.at(-2);
      if (parent?.type === "VariableDeclarator" && parent.id === reference) return;
      if (parent?.type !== "MemberExpression" || parent.object !== reference || parent.computed || parent.optional || member(parent) !== "value") valid = false;
    });
    rawDataRefs.set(binding, valid);
    return valid;
  };
  let derivedCollectionsReady = false;
  const jsonIterationParameter = (binding, environment) => {
    let valid = false;
    walkEstree(symbols.ast, node => {
      if (approvedFileLoops.has(node) && node.left.declarations.some(declaration => bindingOf(declaration.id) === binding)) valid = true;
      if (node.type !== "ArrowFunctionExpression" || bindingOf(node.params[0]) !== binding) return;
      const parent = astAncestorChain(symbols.ast, node)?.at(-2);
      if (parent?.type === "CallExpression" && parent.arguments[0] === node && ["filter", "find", "some", "every"].includes(member(parent.callee)) &&
          (fieldOrigin(parent.callee.object, environment, { definition, limit: target.range[0] })?.kind === "read" || derivedCollectionsReady && readDerivedCollection(parent.callee.object, environment))) valid = true;
    });
    return valid;
  };
  const computeImportedDataFactory = binding => {
    const imported = symbols.importsByBinding.get(binding), ast = imported && context.asts.get(imported.sourceFile);
    if (!ast) return false;
    const local = buildSymbolContext(ast, imported.sourceFile, context.sourceFileSet), roots = topLevelScopeVariables(local.scopeManager, imported.importedName);
    if (roots.length !== 1 || (local.writesByBinding.get(roots[0]) ?? []).length) return false;
    const localBinding = node => local.scopeBindings.get(unwrapValueExpression(node));
    const trustedResponseRequest = requestBinding => requestBinding && local.importsByBinding.has(requestBinding) && [...(context.wrapperIndex?.values() ?? [])].some(sibling => {
          if (sibling.apiFile !== imported.sourceFile || sibling.returnProvenance !== "transparent_main_response" || normalizedMainRequests(sibling).length !== 1 || normalizedMainRequests(sibling)[0].method?.toUpperCase() !== "GET") return false;
          const variables = topLevelScopeVariables(local.scopeManager, sibling.name), definition = variables.length === 1 ? uniqueIndexedNode(local.definitionsByBinding, variables[0]) : null;
          const call = definition?.body?.body?.length === 1 && definition.body.body[0].type === "ReturnStatement" ? unwrapValueExpression(definition.body.body[0].argument) : null;
          const reader = call?.type === "CallExpression" ? uniqueIndexedNode(local.definitionsByBinding, localBinding(call.callee)) : null;
          const readDeclaration = reader?.body?.body?.[0]?.declarations?.[0]?.init;
          return readDeclaration?.type === "AwaitExpression" && localBinding(readDeclaration.argument.callee) === requestBinding;
        });
    const callable = uniqueIndexedNode(local.definitionsByBinding, roots[0]);
    if (callable && !callable.generator && callable.body?.type === "BlockStatement" && callable.body.body.length === 1 && callable.body.body[0].type === "ReturnStatement" && plainData(callable.body.body[0].argument)) return true;
    if (fileGrant && binding === bindingOf(target.callee) && callable?.async && !callable.generator && callable.params.length === 3 && callable.params.every(parameter => parameter.type === "Identifier") && callable.body?.type === "BlockStatement") {
      const statements = callable.body.body, declaration = statement => statement?.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1 ? statement.declarations[0] : null;
      const ticket = declaration(statements[3]), response = declaration(statements[5]), blob = declaration(statements[8]), returned = statements[9];
      const ticketBinding = localBinding(ticket?.id), responseBinding = localBinding(response?.id), blobBinding = localBinding(blob?.id), delivery = localBinding(callable.params[2]);
      const localMember = (node, binding, fields) => {
        let current = unwrapValueExpression(node); const names = [];
        while (current?.type === "MemberExpression" && !current.computed && !current.optional) { names.unshift(member(current)); current = unwrapValueExpression(current.object); }
        return localBinding(current) === binding && names.join(".") === fields;
      };
      const delivered = node => node?.type === "BinaryExpression" && node.operator === "===" && localBinding(node.left) === delivery && literalString(node.right) === "pdf-blob";
      const throws = node => node?.type === "BlockStatement" && node.body.length === 1 && node.body[0].type === "ThrowStatement";
      const regexTest = (node, pattern, flags, argument) => node?.type === "CallExpression" && member(node.callee) === "test" && node.callee.object?.regex?.pattern === pattern && node.callee.object.regex.flags === flags && node.arguments.length === 1 && argument(node.arguments[0]);
      const request = response?.init?.type === "AwaitExpression" ? unwrapValueExpression(response.init.argument) : null;
      const blobCall = blob?.init?.type === "AwaitExpression" ? unwrapValueExpression(blob.init.argument) : null;
      const result = returned?.consequent?.type === "ReturnStatement" ? unwrapValueExpression(returned.consequent.argument) : null;
      const urlGuard = statements[4], urlTest = urlGuard?.test?.right, slash = urlTest?.right;
      const mimeGuard = statements[7], mimeTest = mimeGuard?.test?.right;
      const contentType = node => node?.type === "LogicalExpression" && node.operator === "??" && literalString(node.right) === "" && node.left.type === "CallExpression" &&
        member(node.left.callee) === "get" && localMember(node.left.callee.object, responseBinding, "headers") && node.left.arguments.length === 1 && literalString(node.left.arguments[0]) === "content-type";
      const validation = statements[6]?.expression?.type === "AwaitExpression" ? unwrapValueExpression(statements[6].expression.argument) : null;
      const validatorBinding = validation?.type === "CallExpression" ? localBinding(validation.callee) : null, validator = validatorBinding ? uniqueIndexedNode(local.definitionsByBinding, validatorBinding) : null;
      const first = validator?.body?.body?.[0], last = validator?.body?.body?.at(-1), parameter = validator?.params?.[0], success = first?.consequent?.type === "BlockStatement" && first.consequent.body.length === 1 ? first.consequent.body[0] : null;
      const returns = [];
      if (validator) directCallableNodes(validator, node => { if (node.type === "ReturnStatement") returns.push(node); });
      let confined = Boolean(responseBinding);
      walkEstree(ast, reference => {
        if (reference.type !== "Identifier" || localBinding(reference) !== responseBinding || !local.scopeReferenceIdentifiers.has(reference)) return;
        const parent = astAncestorChain(ast, reference)?.at(-2);
        if (parent === response || parent?.type === "MemberExpression" && parent.object === reference && !parent.computed || parent === validation && validation.arguments[0] === reference) return;
        confined = false;
      });
      if (ticketBinding && responseBinding && blobBinding && [ticketBinding, responseBinding, blobBinding].every(variable => !(local.writesByBinding.get(variable) ?? []).length) && confined &&
          ticket.init?.type === "AwaitExpression" && request?.type === "CallExpression" && request.arguments.length === 1 && trustedResponseRequest(localBinding(request.callee)) && localMember(request.arguments[0], ticketBinding, "downloadUrl") &&
          urlGuard?.type === "IfStatement" && !urlGuard.alternate && urlGuard.test?.type === "LogicalExpression" && urlGuard.test.operator === "&&" && delivered(urlGuard.test.left) && throws(urlGuard.consequent) &&
          urlTest?.type === "LogicalExpression" && urlTest.operator === "||" && urlTest.left?.type === "UnaryExpression" && urlTest.left.operator === "!" && regexTest(urlTest.left.argument, "^\\/files\\/[^/?#]+\\/download\\?", "", node => localMember(node, ticketBinding, "downloadUrl")) &&
          slash?.type === "CallExpression" && member(slash.callee) === "includes" && localMember(slash.callee.object, ticketBinding, "downloadUrl") && slash.arguments.length === 1 && literalString(slash.arguments[0]) === "\\" &&
          mimeGuard?.type === "IfStatement" && !mimeGuard.alternate && mimeGuard.test?.type === "LogicalExpression" && mimeGuard.test.operator === "&&" && delivered(mimeGuard.test.left) && throws(mimeGuard.consequent) &&
          mimeTest?.type === "UnaryExpression" && mimeTest.operator === "!" && regexTest(mimeTest.argument, "^application\\/pdf(?:;|$)", "i", contentType) &&
          blobCall?.type === "CallExpression" && !blobCall.arguments.length && member(blobCall.callee) === "blob" && localBinding(blobCall.callee.object) === responseBinding &&
          returned?.type === "IfStatement" && !returned.alternate && delivered(returned.test) && result?.type === "ObjectExpression" && result.properties.length === 2 && result.properties.every(property => property.type === "Property" && !property.computed && !property.method && property.kind === "init") &&
          (result.properties[0].key.name ?? result.properties[0].key.value) === "blob" && localBinding(result.properties[0].value) === blobBinding && (result.properties[1].key.name ?? result.properties[1].key.value) === "fileName" && localMember(result.properties[1].value, ticketBinding, "fileName") &&
          validation?.arguments.length >= 1 && localBinding(validation.arguments[0]) === responseBinding && validator?.async && !validator.generator && !(local.writesByBinding.get(validatorBinding) ?? []).length && parameter?.type === "Identifier" && !(local.writesByBinding.get(localBinding(parameter)) ?? []).length &&
          first?.type === "IfStatement" && !first.alternate && localMember(first.test, localBinding(parameter), "ok") && success?.type === "ReturnStatement" && !success.argument && returns.length === 1 && returns[0] === success && last?.type === "ThrowStatement") return { nativeBlob: true };
    }
    // Data-only qualification for the selected HTTP write's awaited result.
    // This never contributes a server-read or capability witness.
    if (binding === bindingOf(target.callee) && callable?.body?.type === "BlockStatement" && callable.body.body.length === 1 && callable.body.body[0].type === "ReturnStatement") {
      const forwarded = unwrapValueExpression(callable.body.body[0].argument), localBinding = node => local.scopeBindings.get(unwrapValueExpression(node));
      const transportBinding = forwarded?.type === "CallExpression" ? localBinding(forwarded.callee) : null;
      const transport = transportBinding ? uniqueIndexedNode(local.definitionsByBinding, transportBinding) : null;
      if (transport?.async && !transport.generator && !(local.writesByBinding.get(transportBinding) ?? []).length && transport.body?.type === "BlockStatement" && transport.body.body.length === 3) {
        const [declaration, validation, returned] = transport.body.body;
        const response = declaration.type === "VariableDeclaration" && declaration.kind === "const" && declaration.declarations.length === 1 ? declaration.declarations[0] : null;
        const request = response?.init?.type === "AwaitExpression" ? unwrapValueExpression(response.init.argument) : null;
        const parsed = returned.type === "ReturnStatement" ? unwrapValueExpression(returned.argument) : null;
        const responseBinding = response?.id.type === "Identifier" ? localBinding(response.id) : null;
        const requestBinding = request?.type === "CallExpression" ? localBinding(request.callee) : null;
        const validated = validation.type === "ExpressionStatement" && validation.expression.type === "AwaitExpression" ? unwrapValueExpression(validation.expression.argument) : null;
        const validatorBinding = validated?.type === "CallExpression" ? localBinding(validated.callee) : null;
        const validator = validatorBinding ? uniqueIndexedNode(local.definitionsByBinding, validatorBinding) : null;
        const first = validator?.body?.body?.[0], last = validator?.body?.body?.at(-1), parameter = validator?.params?.[0];
        const stops = [];
        if (validator) directCallableNodes(validator, node => { if (node.type === "ReturnStatement") stops.push(node); });
        const success = first?.consequent?.type === "BlockStatement" && first.consequent.body.length === 1 ? first.consequent.body[0] : first?.consequent;
        const trustedRequest = trustedResponseRequest(requestBinding);
        if (responseBinding && !(local.writesByBinding.get(responseBinding) ?? []).length && trustedRequest &&
            parsed?.type === "CallExpression" && !parsed.arguments.length && member(parsed.callee) === "json" && localBinding(parsed.callee.object) === responseBinding &&
            validated?.arguments.length >= 1 && localBinding(validated.arguments[0]) === responseBinding && validator?.async && !validator.generator &&
            !(local.writesByBinding.get(validatorBinding) ?? []).length && parameter?.type === "Identifier" && !(local.writesByBinding.get(localBinding(parameter)) ?? []).length &&
            first?.type === "IfStatement" && !first.alternate && member(first.test) === "ok" && localBinding(first.test.object) === localBinding(parameter) &&
            success?.type === "ReturnStatement" && !success.argument && stops.length === 1 && stops[0] === success && last?.type === "ThrowStatement") return true;
      }
    }
    const store = unwrapValueExpression(uniqueIndexedNode(local.declarationsByBinding, roots[0]));
    if (store?.type !== "CallExpression" || !frameworkImport(local.scopeBindings.get(store.callee), "pinia", "defineStore", local) || store.arguments.length !== 2) return false;
    const options = unwrapValueExpression(store.arguments[1]);
    if (options?.type !== "ObjectExpression" || options.properties.some(property => property.type !== "Property" || property.computed || property.method || property.kind !== "init")) return false;
    const state = options.properties.find(property => (property.key.name ?? property.key.value) === "state")?.value;
    const getters = options.properties.find(property => (property.key.name ?? property.key.value) === "getters")?.value;
    const output = state?.type === "ArrowFunctionExpression" && !state.async && !state.params.length ? unwrapValueExpression(state.body) : null;
    // A store may expose only its plain state fields as data, never its getters.
    if (!plainData(output) || output?.type !== "ObjectExpression" || getters?.type !== "ObjectExpression") return false;
    return { stateFields: new Set(output.properties.map(property => property.key.name ?? property.key.value)), getterFields: new Set(getters.properties.map(property => property.key.name ?? property.key.value)) };
  };
  // This cache contains completed module-source summaries only. Every caller's
  // storage confinement and awaited target-result binding is checked afresh.
  const importedDataFactories = new Map();
  const importedDataFactory = binding => {
    if (!importedDataFactories.has(binding)) importedDataFactories.set(binding, computeImportedDataFactory(binding));
    return importedDataFactories.get(binding);
  };
  // Resolve own data properties through immutable records and Vue ref storage.
  // Accessors, unknown factories, computed keys and reassigned aliases fail closed.
  const ownDataMember = (node, fields = [], environment = new Map(), seen = []) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.length > 24) return false;
    if (value.type === "MemberExpression") {
      if (value.optional && value.computed) return false;
      const field = staticMemberProperty(value);
      return field ? ownDataMember(value.object, [field, ...fields], environment, seen) : false;
    }
    const record = frozen(value) ?? value;
    if (record.type === "ObjectExpression") {
      // An ordinary nested object can escape through a projected alias. A
      // frozen outer record does not make that child immutable.
      if (record === value && !plainData(record)) return false;
      if (!fields.length || record.properties.some(property => property.type !== "Property" || property.computed || property.method || property.kind !== "init" ||
          ["ObjectExpression", "ArrayExpression"].includes(unwrapValueExpression(property.value)?.type))) return false;
      const matches = record.properties.filter(property => (property.key.name ?? property.key.value) === fields[0]);
      return matches.length === 1 && (fields.length === 1 || ownDataMember(matches[0].value, fields.slice(1), environment, seen));
    }
    if (value.type === "Identifier") {
      const binding = bindingOf(value);
      if (!binding || seen.some(frame => frame.binding === binding && frame.environment === environment)) return false;
      const next = [...seen, { binding, environment }], bound = environment.get(binding);
      if (bound) return ownDataMember(bound.node, fields, bound.environment, next);
      const initial = unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding));
      const writes = symbols.writesByBinding.get(binding) ?? [];
      if (initial?.type === "CallExpression" && symbols.vueRefImportBindings.has(bindingOf(initial.callee)) && fields[0] === "value") {
        if (!rawDataRefConfined(binding)) return false;
        if (fields.length === 1) return true;
        if (!writes.every(write => write.kind === "assignment" && write.operator === "=" && write.path === `${binding.name}.value`)) return false;
        const values = [initial.arguments[0], ...writes.map(write => write.value)].filter(item => item && !expressionIsEmptyCapabilityState(item));
        return values.length > 0 && values.every(item => ownDataMember(item, fields.slice(1), environment, next));
      }
      return !writes.length && Boolean(initial) && (initial.type !== "ObjectExpression" || confinedDataBinding(binding)) && ownDataMember(initial, fields, environment, next);
    }
    if (value.type !== "CallExpression" || value.callee.type !== "Identifier") return false;
    const binding = bindingOf(value.callee), callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
    if (!callable || callable.async || callable.generator || seen.some(frame => frame.binding === binding && frame.environment === environment) || (symbols.writesByBinding.get(binding) ?? []).length) return false;
    const local = bindCall(callable, value, environment);
    if (!local) return false;
    const returns = [];
    directCallableNodes(callable, current => { if (current.type === "ReturnStatement" && !expressionIsEmptyCapabilityState(current.argument)) returns.push(current.argument); });
    return returns.length === 1 && Boolean(frozen(returns[0])) && ownDataMember(returns[0], fields, local, [...seen, { binding, environment }]);
  };
  const projectMember = (base, fields) => fields.reduce((object, name) => ({ type: "MemberExpression", object, property: { type: "Identifier", name }, computed: false, optional: false }), base);
  const primitiveGetterValue = (node, seen = new Set(), environment = new Map()) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.size > 16) return false;
    if (value.type === "MemberExpression" && value.optional && !value.computed && staticMemberProperty(value)) return primitiveGetterValue({ ...value, optional: false }, seen, environment);
    if (globalCall(value, "Boolean") && value.arguments.length === 1) return true;
    if (value.type === "Literal") return value.value === null || ["string", "number", "boolean"].includes(typeof value.value);
    if (value.type === "Identifier") {
      const binding = bindingOf(value);
      if (!binding || seen.has(binding) || (symbols.writesByBinding.get(binding) ?? []).length > 0) return false;
      const bound = environment.get(binding), initializer = bound?.node ?? uniqueIndexedNode(symbols.declarationsByBinding, binding);
      return initializer ? primitiveGetterValue(initializer, new Set(seen).add(binding), bound?.environment ?? environment) : jsonIterationParameter(binding, environment);
    }
    if (value.type === "MemberExpression" && !value.computed && value.property.type === "Identifier") {
      if (fieldOrigin(value, environment, { definition, limit: target.range[0] })?.kind === "read") return true;
      const record = fieldOrigin(value.object, environment, { definition, limit: target.range[0] });
      if (record?.kind === "record" && record.fields.has(member(value))) {
        const selected = record.fields.get(member(value));
        return !seen.has(selected) && primitiveGetterValue(selected, new Set(seen).add(selected), record.environment);
      }
      const spread = frozen(value.object);
      if (spread?.type === "ObjectExpression" && spread.properties.length === 1 && spread.properties[0].type === "SpreadElement") {
        return primitiveGetterValue(projectMember(spread.properties[0].argument, [member(value)]), seen, environment);
      }
      const fields = [];
      let root = value;
      while (root?.type === "MemberExpression" && !root.computed) { fields.unshift(member(root)); root = unwrapValueExpression(root.object); }
      if (root?.type !== "Identifier") return false;
      const binding = bindingOf(root), bound = environment.get(binding);
      if (!binding || seen.has(binding)) return false;
      if (bound) return primitiveGetterValue(projectMember(bound.node, fields), new Set(seen).add(binding), bound.environment);
      const initializer = unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding));
      if (!initializer) return jsonIterationParameter(binding, environment);
      if (initializer.type === "ObjectExpression") {
        if (!plainData(initializer) || !confinedDataBinding(binding)) return false;
        const matches = initializer.properties.filter(property => (property.key.name ?? property.key.value) === fields[0]);
        return matches.length === 1 && primitiveGetterValue(projectMember(matches[0].value, fields.slice(1)), new Set(seen).add(binding), environment);
      }
      const sourceRecord = fieldOrigin(initializer, environment, { definition, limit: target.range[0] });
      if (sourceRecord?.kind === "record" && sourceRecord.fields.has(fields[0])) return primitiveGetterValue(projectMember(sourceRecord.fields.get(fields[0]), fields.slice(1)), new Set(seen).add(binding), sourceRecord.environment);
      if (initializer.type === "CallExpression") {
        const called = bindingOf(initializer.callee);
        if (symbols.vueRefImportBindings.has(called)) {
          if (!rawDataRefConfined(binding) || fields[0] !== "value") return false;
          const values = [initializer.arguments[0], ...(symbols.writesByBinding.get(binding) ?? []).map(write => write.value)].filter(value => value && (fields.length === 1 || !expressionIsEmptyCapabilityState(value)));
          if (fields.length === 1) return values.length > 0 && values.every(value => scalarRefValue(value, environment));
          return values.length > 0 && values.every(value => {
            const local = value === populated[0].value && !writer.definition.params.every(parameter => environment.has(bindingOf(parameter))) ? bindCall(writer.definition, writerCalls[0], environment) : environment;
            return Boolean(local) && primitiveGetterValue(projectMember(value, fields.slice(1)), new Set(seen).add(binding), local);
          });
        }
        const dataFactory = importedDataFactory(called);
        return Boolean(dataFactory?.nativeBlob && binding === awaitedCallResultBinding(target, [definition], symbols) && ["blob", "blob.size", "fileName"].includes(fields.join(".")) ||
          dataFactory === true && (binding === awaitedCallResultBinding(target, [definition], symbols) || confinedDataBinding(binding)) ||
          dataFactory?.stateFields && confinedDataBinding(binding) && dataFactory.stateFields.has(fields[0]) && !dataFactory.getterFields.has(fields[0]) ||
          frameworkImport(called, "vue-router", "useRoute") && confinedDataBinding(binding) ||
          symbols.vueComputedImportBindings.has(called) && rawDataRefConfined(binding) && initializer.arguments.length === 1 && initializer.arguments[0]?.type === "ArrowFunctionExpression" && !initializer.arguments[0].async &&
          primitiveGetterValue(initializer.arguments[0].body, new Set(seen).add(binding), environment) && purePredicate(initializer.arguments[0], environment) ||
          initializer.callee.type === "Identifier" && initializer.callee.name === "defineProps" && confinedDataBinding(binding) && unshadowedRuntimeGlobal(initializer.callee, new Set(["defineProps"]), symbols.scopeBindings));
      }
      return ["Identifier", "MemberExpression"].includes(initializer.type) && primitiveGetterValue(projectMember(initializer, fields), new Set(seen).add(binding), environment);
    }
    if (value.type === "LogicalExpression" || value.type === "BinaryExpression") return primitiveGetterValue(value.left, seen, environment) && primitiveGetterValue(value.right, seen, environment);
    if (value.type === "UnaryExpression") return ["!", "typeof"].includes(value.operator) || ["+", "-"].includes(value.operator) && primitiveGetterValue(value.argument, seen, environment);
    return false;
  };
  const readonlyGetterBody = callable => {
    if (callable.async || callable.generator) return false;
    if (callable.body?.type !== "BlockStatement") return Boolean(callable.body && !["FunctionExpression", "ArrowFunctionExpression"].includes(callable.body.type));
    const statements = callable.body.body;
    if (!statements.length || statements.at(-1).type !== "ReturnStatement") return false;
    return statements.every(statement => {
      if (statement.type === "ReturnStatement") return true;
      if (statement.type === "VariableDeclaration") return statement.kind === "const" && statement.declarations.every(declaration =>
        declaration.id.type === "Identifier" && primitiveGetterValue(declaration.init) && (symbols.writesByBinding.get(bindingOf(declaration.id)) ?? []).length === 0);
      if (statement.type !== "IfStatement" || statement.alternate) return false;
      const stop = statement.consequent?.type === "BlockStatement" && statement.consequent.body.length === 1 ? statement.consequent.body[0] : statement.consequent;
      return stop?.type === "ReturnStatement" && unwrapValueExpression(stop.argument)?.type === "Literal";
    });
  };
  const readonlyRegexpCall = (current, environment = new Map()) => {
    if (member(current.callee) !== "test" || current.arguments.length !== 1 || current.callee.object.type !== "Identifier" || !primitiveGetterValue(current.arguments[0], new Set(), environment)) return false;
    const binding = bindingOf(current.callee.object), declaration = binding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding)) : null;
    if (!declaration?.regex || /[gy]/u.test(declaration.regex.flags) || (symbols.writesByBinding.get(binding) ?? []).length > 0) return false;
    const declarationAncestors = astAncestorChain(symbols.ast, declaration);
    if (declarationAncestors?.at(-2)?.type !== "VariableDeclarator" || declarationAncestors?.at(-3)?.kind !== "const") return false;
    let safe = true;
    walkEstree(symbols.ast, node => {
      if (node.type !== "Identifier" || bindingOf(node) !== binding || !symbols.scopeReferenceIdentifiers.has(node)) return;
      const ancestors = astAncestorChain(symbols.ast, node), parent = ancestors?.at(-2), call = ancestors?.at(-3);
      if (parent?.type === "VariableDeclarator" && parent.id === node && parent.init === declaration) return;
      if (parent?.type !== "MemberExpression" || parent.object !== node || member(parent) !== "test" || call?.type !== "CallExpression" || call.callee !== parent) safe = false;
    });
    return safe;
  };
  const readonlyIntrinsicCall = (current, environment) => {
    const pureRecord = frozen(current);
    if (pureRecord?.type === "ObjectExpression" && pureRecord.properties.every(property => property.type === "Property" && property.kind === "init" && !property.method && !property.computed && primitiveGetterValue(property.value, new Set(), environment))) return true;
    return readonlyRegexpCall(current, environment) || globalCall(current, "JSON", "stringify") && current.arguments.length === 1 &&
      unwrapValueExpression(current.arguments[0])?.type === "ArrayExpression" && current.arguments[0].elements.every(element =>
        element && element.type !== "SpreadElement" && primitiveGetterValue(element, new Set(), environment));
  };
  // This proof supports the present read/display call graph, not arbitrary JS.
  // Any new executable syntax must first obtain its own bounded proof.
  const limitedNodes = new Set([
    "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "Identifier", "Literal", "BlockStatement",
    "VariableDeclaration", "VariableDeclarator", "ExpressionStatement", "IfStatement", "ReturnStatement", "ThrowStatement",
    "TryStatement", "CatchClause", "AwaitExpression", "CallExpression", "MemberExpression", "ChainExpression",
    "LogicalExpression", "BinaryExpression", "UnaryExpression", "AssignmentExpression", "UpdateExpression", "ConditionalExpression",
    "ObjectExpression", "Property", "ArrayExpression", "SpreadElement", "NewExpression", "TemplateLiteral", "TemplateElement",
    "TSTypeAnnotation", "TSTypeReference", "TSStringKeyword", "TSNumberKeyword", "TSBooleanKeyword", "TSUnknownKeyword", "TSVoidKeyword",
    "TSNullKeyword", "TSUnionType", "TSLiteralType", "TSTypeQuery", "TSIndexedAccessType", "TSTypeOperator", "TSArrayType",
    "TSQualifiedName", "TSTypeParameterInstantiation", "TSAsExpression", "TSNonNullExpression", "TSTypePredicate"
  ]);
  const limitedSyntax = node => (limitedNodes.has(node.type) || approvedFileLoops.has(node)) &&
    (node.type !== "UnaryExpression" || ["!", "typeof", "void"].includes(node.operator)) &&
    (node.type !== "BinaryExpression" || ["===", "!==", ">", ">=", "<", "<=", "instanceof"].includes(node.operator) ||
      ["==", "!="].includes(node.operator) && [node.left, node.right].some(value => value.type === "Literal" && value.value === null)) &&
    (node.type !== "LogicalExpression" || ["&&", "||", "??"].includes(node.operator)) &&
    (node.type !== "Property" || node.kind === "init" && !node.method && !node.computed && !["FunctionExpression", "ArrowFunctionExpression"].includes(node.value?.type));
  const primitiveOperation = (node, environment, additionalPrimitive = () => false) => {
    const primitive = value => primitiveGetterValue(value, new Set(), environment) || additionalPrimitive(value);
    if (node.type === "TemplateLiteral") return node.expressions.every(primitive);
    if (node.type !== "BinaryExpression") return true;
    if (["<", "<=", ">", ">="].includes(node.operator)) return primitive(node.left) && primitive(node.right);
    if (node.operator === "instanceof") return node.right.type === "Identifier" && node.right.name === "Error" &&
      unshadowedRuntimeGlobal(node.right, new Set(["Error"]), symbols.scopeBindings);
    return true;
  };
  const purePredicate = (node, environment = new Map(), seen = new Set()) => {
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type) && (node.async || node.generator)) return false;
    let pure = true;
    directCallableNodes(node, current => {
      if (!pure) return;
      if (!limitedSyntax(current) || !primitiveOperation(current, environment)) { pure = false; return; }
      if (current.type === "SpreadElement" && fieldOrigin(current.argument, environment, { definition, limit: target.range[0] })?.kind !== "read") { pure = false; return; }
      if (["AwaitExpression", "AssignmentExpression", "UpdateExpression", "YieldExpression", "NewExpression", "TaggedTemplateExpression"].includes(current.type)) { pure = false; return; }
      if (current.type !== "CallExpression") return;
      if (globalCall(current, "Boolean") || (globalCall(current, "Array", "isArray") && current.arguments.length === 1)) return;
      if (readonlyIntrinsicCall(current, environment)) return;
      if (member(current.callee) === "includes" && path(current.callee.object, environment) === `${cap}.${actionField}`) {
        trustedIncludes.add(path(current.callee.object, environment));
        return;
      }
      const binding = bindingOf(current.callee);
      const callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
      if (!callable || (symbols.writesByBinding.get(binding) ?? []).length > 0 || seen.has(binding) || callable.params.length !== current.arguments.length || callable.params.some(parameter => parameter.type !== "Identifier") ||
          !readonlyGetterBody(callable)) { pure = false; return; }
      const local = new Map(environment);
      callable.params.forEach((parameter, index) => local.set(bindingOf(parameter), { node: current.arguments[index], environment }));
      if (!purePredicate(callable.body, local, new Set(seen).add(binding))) pure = false;
    });
    return pure;
  };
  const predicateAtoms = (node, environment, seen = new Set()) => {
    const value = unwrapValueExpression(node);
    if (value?.type === "LogicalExpression" && value.operator === "&&") {
      return [...predicateAtoms(value.left, environment, seen), ...predicateAtoms(value.right, environment, seen)];
    }
    if (globalCall(value, "Boolean") && value.arguments.length === 1) return predicateAtoms(value.arguments[0], environment, seen);
    if (value?.type === "CallExpression" && value.callee.type === "Identifier") {
      const binding = bindingOf(value.callee), callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
      if (!callable || callable.async || callable.generator || (symbols.writesByBinding.get(binding) ?? []).length > 0 || seen.has(binding) || callable.params.length !== value.arguments.length || callable.params.some(parameter => parameter.type !== "Identifier") ||
          callable.body?.type !== "BlockStatement" || callable.body.body.length !== 1 || callable.body.body[0].type !== "ReturnStatement") return [];
      purePredicates.add(binding);
      const local = new Map(environment);
      callable.params.forEach((parameter, index) => local.set(bindingOf(parameter), { node: value.arguments[index], environment }));
      return predicateAtoms(callable.body.body[0].argument, local, new Set(seen).add(binding));
    }
    if (value?.type === "BinaryExpression" && value.operator === "===") {
      const left = path(value.left, environment), right = path(value.right, environment);
      if (left && right) return [equal(left, right)];
      if (value.left.type === "UnaryExpression" && value.left.operator === "typeof" && literalString(value.right) === "string") {
        const field = path(value.left.argument, environment);
        return field ? [`typeof:${field}:string`] : [];
      }
      const literal = unwrapValueExpression(value.right);
      return left && literal?.type === "Literal" && ["string", "boolean"].includes(typeof literal.value) ? [`literal:${left}:${JSON.stringify(literal.value)}`] : [];
    }
    if (value?.type === "CallExpression" && member(value.callee) === "includes" && value.arguments.length === 1 && literalString(value.arguments[0]) === action.capability.key) {
      return [`includes:${path(value.callee.object, environment)}:${action.capability.key}`];
    }
    const truthy = ["Identifier", "MemberExpression"].includes(value?.type) ? path(value, environment) : null;
    return truthy ? [`truthy:${truthy}`] : [];
  };
  const currentFileSearch = () => {
    const nullReturn = statement => statement?.type === "ReturnStatement" && unwrapValueExpression(statement.argument)?.type === "Literal" && unwrapValueExpression(statement.argument).value === null;
    const single = statement => statement?.type === "BlockStatement" && statement.body.length === 1 ? statement.body[0] : statement;
    const memberOf = (object, name) => ({ type: "MemberExpression", object, property: { type: "Identifier", name }, computed: false, optional: false });
    const candidates = [];
    for (const statement of attempt.block.body ?? []) {
      if (statement.range[0] >= writerCalls[0].range[0]) break;
      const test = unwrapValueExpression(statement.test), waited = test?.argument, call = waited?.argument;
      const stop = statement.consequent?.type === "BlockStatement" ? statement.consequent.body.at(-1) : statement.consequent;
      if (statement.type !== "IfStatement" || statement.alternate || test?.type !== "UnaryExpression" || test.operator !== "!" ||
          waited?.type !== "AwaitExpression" || call?.type !== "CallExpression" || call.callee.type !== "Identifier" ||
          !["ReturnStatement", "ThrowStatement"].includes(stop?.type) || bindingOf(call.callee) === writer.binding ||
          call.arguments.length !== 2 || path(call.arguments[0]) !== actualOwner || path(call.arguments[1]) !== actualPdf || !awaitedBefore(call, writerCalls[0].range[0])) continue;
      candidates.push(call);
    }
    if (candidates.length !== 1) return false;
    const call = candidates[0], searchBinding = bindingOf(call.callee), search = uniqueIndexedNode(symbols.definitionsByBinding, searchBinding);
    if (!search || (symbols.writesByBinding.get(searchBinding) ?? []).length || search.params.length !== 2 || search.body?.type !== "BlockStatement" || search.body.body.length !== 4) return false;
    const environment = bindCall(search, call);
    if (!environment) return false;
    const [readStatement, absent, loop, final] = search.body.body;
    const state = readStatement?.type === "VariableDeclaration" && readStatement.kind === "const" && readStatement.declarations.length === 1 ? readStatement.declarations[0] : null;
    const read = state?.init?.type === "AwaitExpression" ? state.init.argument : null;
    if (state?.id.type !== "Identifier" || read?.type !== "CallExpression" || read.callee.type !== "Identifier" || read.arguments.length !== 1 ||
        path(read.arguments[0], environment) !== actualOwner || !nullReturn(final) || loop?.type !== "ForOfStatement" || loop.await) return false;
    const statePath = path(state.id, environment), absentTest = unwrapValueExpression(absent.test);
    if (absent.type !== "IfStatement" || absent.alternate || absentTest?.type !== "UnaryExpression" || absentTest.operator !== "!" ||
        path(absentTest.argument, environment) !== statePath || !nullReturn(single(absent.consequent))) return false;
    const sourceFrame = { definition: search, limit: loop.range[0] };
    const fingerprint = fieldOrigin(memberOf(state.id, "fingerprint"), environment, sourceFrame);
    const documents = fieldOrigin(memberOf(state.id, "documents"), environment, sourceFrame);
    const fresh = origin => origin?.kind === "read" && origin.coordinate === `${actualOwner}.context.contractVersionId` && origin.trail.length === 1 && origin.trail[0] === read &&
      origin.read.range[0] > origin.frame.definition.range[0] && origin.read.range[1] < origin.frame.definition.range[1] && awaitedBefore(origin.read, origin.frame.limit);
    if (!fresh(fingerprint) || fingerprint.fields.join(".") !== "version.documentContentFingerprint" || !fresh(documents) || documents.fields.length ||
        !readHasIdentity(fingerprint, "version.id", "version.draftRevision", actualOwner, [["contract.id", "routeContractId"], ["version.layoutTemplateVersionId", "context.layoutTemplateVersionId"], ["version.documentContentRevision", "context.documentContentRevision"]])) return false;
    const iteration = loop.left?.type === "VariableDeclaration" && loop.left.kind === "const" && loop.left.declarations.length === 1 ? loop.left.declarations[0] : null;
    const matchingCall = unwrapValueExpression(loop.right), matchingBinding = matchingCall?.type === "CallExpression" ? bindingOf(matchingCall.callee) : null;
    const matching = matchingBinding ? uniqueIndexedNode(symbols.definitionsByBinding, matchingBinding) : null;
    if (iteration?.id.type !== "Identifier" || iteration.init || !matching || (symbols.writesByBinding.get(matchingBinding) ?? []).length || matching.params.length !== 2 ||
        matching.body?.type !== "BlockStatement" || matching.body.body.length !== 1 || matching.body.body[0].type !== "ReturnStatement" || matchingCall.arguments.length !== 2 ||
        path(matchingCall.arguments[0], environment) !== actualOwner || path(matchingCall.arguments[1], environment) !== statePath) return false;
    const matchingEnvironment = bindCall(matching, matchingCall, environment), filter = unwrapValueExpression(matching.body.body[0].argument);
    const predicate = filter?.arguments?.[0];
    if (!matchingEnvironment || filter?.type !== "CallExpression" || member(filter.callee) !== "filter" || filter.arguments.length !== 1 ||
        path(filter.callee.object, matchingEnvironment) !== `${statePath}.documents` || predicate?.type !== "ArrowFunctionExpression" || predicate.async || predicate.params.length !== 1 || predicate.params[0].type !== "Identifier" || !purePredicate(predicate, matchingEnvironment)) return false;
    const item = path(predicate.params[0], matchingEnvironment), filterFacts = new Set(predicateAtoms(predicate.body, matchingEnvironment));
    const filterRequired = [`typeof:${item}.id:string`, `truthy:${item}.id`, `literal:${item}.purpose:"draft"`,
      equal(`${item}.layoutTemplateVersionId`, `${actualOwner}.context.layoutTemplateVersionId`),
      equal(`${item}.documentContentRevision`, `${actualOwner}.context.documentContentRevision`),
      equal(`${item}.documentContentFingerprint`, `${statePath}.fingerprint`),
      equal(`${item}.inputSnapshot.bodyDocument.sourceSha256`, `${actualOwner}.context.sourceSha256`)];
    if (!filterRequired.every(fact => filterFacts.has(fact)) || loop.body?.type !== "BlockStatement" || loop.body.body.length !== 2) return false;
    const [projectStatement, matchStatement] = loop.body.body;
    const projection = projectStatement.type === "VariableDeclaration" && projectStatement.kind === "const" && projectStatement.declarations.length === 1 ? projectStatement.declarations[0] : null;
    const projectCall = unwrapValueExpression(projection?.init), projectBinding = projectCall?.type === "CallExpression" ? bindingOf(projectCall.callee) : null;
    const project = projectBinding ? uniqueIndexedNode(symbols.definitionsByBinding, projectBinding) : null;
    const iterationPath = path(iteration.id, environment);
    if (projection?.id.type !== "Identifier" || !project || (symbols.writesByBinding.get(projectBinding) ?? []).length || project.params.length !== 3 || project.body?.type !== "BlockStatement" || project.body.body.length !== 2 || projectCall.arguments.length !== 3 ||
        path(projectCall.arguments[0], environment) !== actualOwner || path(projectCall.arguments[1], environment) !== statePath || path(projectCall.arguments[2], environment) !== iterationPath) return false;
    const projectEnvironment = bindCall(project, projectCall, environment), [reject, returned] = project.body.body;
    const output = returned.type === "ReturnStatement" ? frozen(returned.argument) : null;
    if (!projectEnvironment || reject.type !== "IfStatement" || reject.alternate || !nullReturn(single(reject.consequent)) || output?.type !== "ObjectExpression" || output.properties.length !== 6 ||
        output.properties.some(property => property.type !== "Property" || property.computed || property.method || property.kind !== "init")) return false;
    const outputFields = new Map(output.properties.map(property => [property.key.name ?? property.key.value, property.value]));
    const expectedFields = { documentId: `${iterationPath}.id`, fileId: `${iterationPath}.pdfFileId`, contentRevision: `${actualOwner}.context.documentContentRevision`,
      fingerprint: `${statePath}.fingerprint`, layoutId: `${actualOwner}.context.layoutTemplateVersionId`, sourceSha256: `${actualOwner}.context.sourceSha256` };
    if (!Object.entries(expectedFields).every(([field, expected]) => path(outputFields.get(field), projectEnvironment) === expected)) return false;
    const failures = node => {
      const value = unwrapValueExpression(node);
      if (value?.type === "LogicalExpression" && value.operator === "||") return [...failures(value.left), ...failures(value.right)];
      if (value?.type === "UnaryExpression" && value.operator === "!") return [`truthy:${path(value.argument, projectEnvironment)}`];
      if (value?.type !== "BinaryExpression" || value.operator !== "!==") return [];
      if (value.left.type === "UnaryExpression" && value.left.operator === "typeof" && literalString(value.right) === "string") return [`typeof:${path(value.left.argument, projectEnvironment)}:string`];
      return value.right.type === "Literal" ? [`literal:${path(value.left, projectEnvironment)}:${JSON.stringify(value.right.value)}`] : [];
    };
    const rejected = new Set(failures(reject.test));
    if (![ `literal:${iterationPath}.status:"success"`, `typeof:${iterationPath}.id:string`, `typeof:${iterationPath}.pdfFileId:string`, `truthy:${iterationPath}.pdfFileId` ].every(fact => rejected.has(fact))) return false;
    const projected = path(projection.id, environment), expected = path(search.params[1], environment), match = unwrapValueExpression(matchStatement.test);
    const either = unwrapValueExpression(match?.right), noExpected = unwrapValueExpression(either?.left);
    if (matchStatement.type !== "IfStatement" || matchStatement.alternate || matchStatement.consequent.type !== "ReturnStatement" || path(matchStatement.consequent.argument, environment) !== projected ||
        match?.type !== "LogicalExpression" || match.operator !== "&&" || path(match.left, environment) !== projected || either?.type !== "LogicalExpression" || either.operator !== "||" ||
        noExpected?.type !== "UnaryExpression" || noExpected.operator !== "!" || path(noExpected.argument, environment) !== expected) return false;
    const matched = new Set(predicateAtoms(either.right, environment));
    if (!["documentId", "fileId", "fingerprint"].every(field => matched.has(equal(`${projected}.${field}`, `${expected}.${field}`)))) return false;
    const rejectsMissingPdf = node => {
      const value = unwrapValueExpression(node);
      return value?.type === "LogicalExpression" && value.operator === "||" ? rejectsMissingPdf(value.left) || rejectsMissingPdf(value.right) :
        value?.type === "UnaryExpression" && value.operator === "!" && path(value.argument) === actualPdf;
    };
    if (!(definition.body.body ?? []).some(statement => statement.range[0] < attempt.range[0] && statement.type === "IfStatement" && !statement.alternate &&
      ["ReturnStatement", "ThrowStatement"].includes(single(statement.consequent)?.type) && rejectsMissingPdf(statement.test))) return false;
    approvedFileLoops.add(loop);
    return true;
  };
  let dominating = false;
  for (const statement of attempt.block.body ?? []) {
    if (statement.range[0] >= target.range[0]) break;
    if (statement.range[0] <= writerCalls[0].range[1] || !capturedAfterRead(statement.test)) continue;
    const test = unwrapValueExpression(statement.test);
    if (statement.type !== "IfStatement" || statement.alternate || !terminates(statement.consequent)) continue;
    // Reaching the transport after an OR-of-failures requires each failure
    // to be false. A negated predicate therefore contributes its positive
    // facts; AND-of-failures and positive predicates contribute no authority.
    const successAtoms = node => {
      const value = unwrapValueExpression(node);
      if (value?.type === "LogicalExpression" && value.operator === "||") return [...successAtoms(value.left), ...successAtoms(value.right)];
      return value?.type === "UnaryExpression" && value.operator === "!" ? predicateAtoms(value.argument, new Map()) : [];
    };
    if (!purePredicate(test)) continue;
    const atoms = new Set(successAtoms(test));
    const required = [equal(`${cap}.ownerKey`, `${actualOwner}.ownerKey`), equal(`${cap}.readGeneration`, `${actualOwner}.generation`), `includes:${cap}.${actionField}:${action.capability.key}`,
      ...(fileGrant ? [equal(`${cap}.fileId`, `${actualPdf}.fileId`), equal(`${cap}.documentId`, `${actualPdf}.documentId`), `literal:${cap}.serverAction.key:${JSON.stringify(action.capability.key)}`, `literal:${cap}.serverAction.enabled:true`] : [equal(`${cap}.sourceRevision`, `${actualOwner}.context.draftRevision`)])];
    if (required.every(atom => atoms.has(atom))) dominating = true;
  }
  if (!dominating) return null;
  if (fileGrant && !currentFileSearch()) return null;
  const readDerivedCollection = (node, environment, seen = new Set()) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.size > 16) return false;
    if (value.type === "ArrayExpression" && value.elements.every(element => element?.type === "Literal" && typeof element.value === "string")) return true;
    const refArray = (node, local, fields = [], visited = new Set()) => {
      const selected = unwrapValueExpression(node);
      if (!selected || visited.size > 16) return false;
      if (selected.type === "MemberExpression" && member(selected)) return refArray(selected.object, local, [member(selected), ...fields], visited);
      if (selected.type !== "Identifier") return false;
      const binding = bindingOf(selected);
      if (!binding || visited.has(binding)) return false;
      const next = new Set(visited).add(binding), bound = local.get(binding);
      if (bound) return refArray(bound.node, bound.environment, fields, next);
      const initial = uniqueIndexedNode(symbols.declarationsByBinding, binding);
      if (!expressionIsEmptyVueRef(initial, symbols)) return initial && !(symbols.writesByBinding.get(binding) ?? []).length ? refArray(initial, local, fields, next) : false;
      const writes = symbols.writesByBinding.get(binding) ?? [], populated = writes.filter(write => !expressionIsEmptyCapabilityState(write.value));
      if (fields.length !== 2 || fields[0] !== "value" || populated.length !== 1 || !writes.every(write => write.kind === "assignment" && write.operator === "=" && write.path === `${binding.name}.value`)) return false;
      const record = frozen(populated[0].value);
      const properties = record?.type === "ObjectExpression" ? record.properties.filter(property => property.type === "Property" && !property.computed && !property.method && property.kind === "init" && (property.key.name ?? property.key.value) === fields[1]) : [];
      const origin = properties.length === 1 ? fieldOrigin(properties[0].value, local, { definition, limit: target.range[0] }) : null;
      return origin?.kind === "read" && origin.immutableArray;
    };
    if (refArray(value, environment)) return true;
    if (fieldOrigin(value, environment, { definition, limit: target.range[0] })?.kind === "read") return true;
    if (value.type === "Identifier") {
      const binding = bindingOf(value);
      if (!binding || seen.has(binding) || (symbols.writesByBinding.get(binding) ?? []).length) return false;
      const bound = environment.get(binding), initializer = bound?.node ?? uniqueIndexedNode(symbols.declarationsByBinding, binding);
      return initializer ? readDerivedCollection(initializer, bound?.environment ?? environment, new Set(seen).add(binding)) : false;
    }
    if (value.type !== "CallExpression") return false;
    if (member(value.callee) === "filter" && value.arguments.length === 1 && value.arguments[0].type === "ArrowFunctionExpression" && purePredicate(value.arguments[0], environment)) return readDerivedCollection(value.callee.object, environment, seen);
    const binding = bindingOf(value.callee), callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
    if (!callable || (symbols.writesByBinding.get(binding) ?? []).length > 0 || seen.has(binding) || callable.body?.type !== "BlockStatement" || callable.body.body.length !== 1 || callable.body.body[0].type !== "ReturnStatement") return false;
    const local = bindCall(callable, value, environment);
    return local ? readDerivedCollection(callable.body.body[0].argument, local, new Set(seen).add(binding)) : false;
  };
  const readDerivedValue = (node, environment, seen = new Set()) => {
    const value = unwrapValueExpression(node);
    if (!value || seen.size > 16) return false;
    if (fieldOrigin(value, environment, { definition, limit: target.range[0] })?.kind === "read") return true;
    if (value.type === "MemberExpression" && member(value)) return readDerivedValue(value.object, environment, seen);
    if (value.type === "ConditionalExpression") return readDerivedValue(value.consequent, environment, seen) && readDerivedValue(value.alternate, environment, seen);
    if (value.type === "LogicalExpression" && value.operator === "??") return readDerivedValue(value.left, environment, seen) && readDerivedValue(value.right, environment, seen);
    if (value.type === "Identifier") {
      const binding = bindingOf(value), bound = environment.get(binding);
      if (!binding || seen.has(binding) || (symbols.writesByBinding.get(binding) ?? []).length) return false;
      const initializer = bound?.node ?? uniqueIndexedNode(symbols.declarationsByBinding, binding);
      return initializer ? readDerivedValue(initializer, bound?.environment ?? environment, new Set(seen).add(binding)) : false;
    }
    return value.type === "CallExpression" && member(value.callee) === "find" && value.arguments.length === 1 &&
      value.arguments[0].type === "ArrowFunctionExpression" && purePredicate(value.arguments[0], environment) && readDerivedCollection(value.callee.object, environment);
  };
  derivedCollectionsReady = true;
  const pureImportedStrings = new Map();
  const importedStringCall = (call, environment = new Map()) => {
    const imported = importedCallMetadata(call, symbols);
    if (!imported?.importedName || imported.kind !== "named") return false;
    const ast = context.asts.get(imported.sourceFile);
    if (!ast || !ast.body.every(statement => statement.type === "FunctionDeclaration" ||
        statement.type === "ExportNamedDeclaration" && statement.declaration?.type === "FunctionDeclaration") ||
        !ast.body.some(statement => statement.type === "ExportNamedDeclaration" && statement.declaration?.id?.name === imported.importedName)) return false;
    const local = buildSymbolContext(ast, imported.sourceFile, context.sourceFileSet);
    const roots = topLevelScopeVariables(local.scopeManager, imported.importedName);
    if (roots.length !== 1) return false;
    const root = roots[0], rootDefinition = uniqueIndexedNode(local.definitionsByBinding, root);
    if (!rootDefinition || rootDefinition.async || rootDefinition.generator || rootDefinition.params.length !== call.arguments.length || call.arguments.some(argument => argument.type === "SpreadElement") || rootDefinition.params.some((parameter, index) =>
      ["TSStringKeyword", "TSNumberKeyword", "TSBooleanKeyword"].includes(parameter.typeAnnotation?.typeAnnotation?.type) && !primitiveGetterValue(call.arguments[index], new Set(), environment))) return false;
    const binding = node => local.scopeBindings.get(unwrapValueExpression(node));
    const cache = new Map(), active = new Set();
    const annotated = (variable, type) => variable?.identifiers?.some(identifier => identifier.typeAnnotation?.typeAnnotation?.type === type);
    const numberValue = (node, seen = new Set()) => {
      const value = unwrapValueExpression(node);
      if (!value || seen.size > 16) return false;
      if (value.type === "Literal") return typeof value.value === "number";
      if (value.type !== "Identifier") return false;
      const variable = binding(value);
      if (!variable || seen.has(variable) || (local.writesByBinding.get(variable) ?? []).length) return false;
      const initializer = uniqueIndexedNode(local.declarationsByBinding, variable);
      return initializer ? numberValue(initializer, new Set(seen).add(variable)) : annotated(variable, "TSNumberKeyword");
    };
    const stringValue = (node, seen = new Set()) => {
      const value = unwrapValueExpression(node);
      if (!value || seen.size > 16) return false;
      if (value.type === "Literal") return typeof value.value === "string";
      if (value.type === "Identifier") {
        const variable = binding(value);
        if (!variable || seen.has(variable) || (local.writesByBinding.get(variable) ?? []).length) return false;
        const initializer = uniqueIndexedNode(local.declarationsByBinding, variable);
        // Local annotations cannot replace initializer provenance. Parameter
        // annotations are usable only after every incoming call checks its actuals.
        return initializer ? stringValue(initializer, new Set(seen).add(variable)) : annotated(variable, "TSStringKeyword");
      }
      if (value.type === "TemplateLiteral") return value.expressions.every(expression => stringValue(expression, seen) || numberValue(expression, seen));
      if (value.type !== "CallExpression") return false;
      if (member(value.callee) === "trim" && value.arguments.length === 0) return stringValue(value.callee.object, seen);
      const definition = value.callee.type === "Identifier" ? uniqueIndexedNode(local.definitionsByBinding, binding(value.callee)) : null;
      return definition && qualifiedLocalArguments(definition, value.arguments) && summary(binding(value.callee));
    };
    const qualifiedLocalArguments = (definition, args) => definition.params.length === args.length && args.every(argument => argument.type !== "SpreadElement") &&
      definition.params.every((parameter, index) => {
        const type = parameter.typeAnnotation?.typeAnnotation?.type;
        if (type === "TSStringKeyword") return stringValue(args[index]);
        if (type === "TSNumberKeyword") return numberValue(args[index]);
        if (type === "TSBooleanKeyword") { const value = unwrapValueExpression(args[index]); return value?.type === "Literal" && typeof value.value === "boolean"; }
        return true;
      });
    const summary = variable => {
      if (!variable || active.has(variable)) return false;
      if (cache.has(variable)) return cache.get(variable);
      const callable = uniqueIndexedNode(local.definitionsByBinding, variable);
      if (!callable || callable.async || callable.generator || callable.params.some(parameter => parameter.type !== "Identifier")) return false;
      active.add(variable);
      let valid = true, returns = 0;
      directCallableNodes(callable, (current, parent) => {
        if (!valid) return;
        if (!limitedSyntax(current)) { valid = false; return; }
        // This imported string-only subset has no opaque property reads or
        // implicit numeric/string coercion of unknown objects, even if unused.
        if (current.type === "UnaryExpression" && !["!", "typeof", "void"].includes(current.operator) ||
            current.type === "BinaryExpression" && !["===", "!==", "<", "<=", ">", ">="].includes(current.operator)) { valid = false; return; }
        if (current.type === "MemberExpression") {
          const receiver = unwrapValueExpression(current.object);
          const nativeCall = !current.computed && !current.optional && parent?.type === "CallExpression" && parent.callee === current &&
            (member(current) === "trim" && parent.arguments.length === 0 && stringValue(receiver) ||
              member(current) === "test" && receiver?.regex && !/[gy]/u.test(receiver.regex.flags) && parent.arguments.length === 1 && stringValue(parent.arguments[0]));
          if (!nativeCall) { valid = false; return; }
        }
        if (["AssignmentExpression", "UpdateExpression", "AwaitExpression", "YieldExpression", "NewExpression", "TaggedTemplateExpression", "TryStatement", "ObjectExpression", "ArrayExpression", "SpreadElement", "ThrowStatement"].includes(current.type)) { valid = false; return; }
        if (current.type === "TemplateLiteral" && !stringValue(current)) { valid = false; return; }
        if (current.type === "BinaryExpression" && ["<", "<=", ">", ">="].includes(current.operator) && ![current.left, current.right].every(value =>
            value.type === "Literal" && ["number", "string", "boolean"].includes(typeof value.value) ||
            numberValue(value) || stringValue(value))) { valid = false; return; }
        if (current.type === "VariableDeclaration" && current.kind !== "const") { valid = false; return; }
        if (current.type === "ReturnStatement") { returns += 1; if (!stringValue(current.argument)) valid = false; }
        if (current.type !== "CallExpression") return;
        const regex = unwrapValueExpression(current.callee?.object);
        if (member(current.callee) === "test" && regex?.regex && !/[gy]/u.test(regex.regex.flags) && current.arguments.length === 1 && stringValue(current.arguments[0])) return;
        if (member(current.callee) === "trim" && current.arguments.length === 0 && stringValue(current.callee.object)) return;
        if (current.callee.type === "Identifier") {
          const target = binding(current.callee), definition = target ? uniqueIndexedNode(local.definitionsByBinding, target) : null;
          if (definition && qualifiedLocalArguments(definition, current.arguments) && summary(target)) return;
        }
        valid = false;
      });
      active.delete(variable); cache.set(variable, valid && returns > 0);
      return valid && returns > 0;
    };
    const key = `${imported.sourceFile}:${imported.importedName}`;
    if (!pureImportedStrings.has(key)) pureImportedStrings.set(key, summary(root));
    return pureImportedStrings.get(key);
  };
  const privateStringRef = node => {
    const value = unwrapValueExpression(node);
    if (value?.type !== "MemberExpression" || value.computed || value.optional || member(value) !== "value" || value.object.type !== "Identifier") return false;
    const binding = bindingOf(value.object), initial = binding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding)) : null;
    if (initial?.type !== "CallExpression" || !symbols.vueRefImportBindings.has(bindingOf(initial.callee)) || initial.arguments.length !== 1 ||
        unwrapValueExpression(initial.arguments[0])?.type !== "Literal" || typeof unwrapValueExpression(initial.arguments[0]).value !== "string") return false;
    if ((symbols.writesByBinding.get(binding) ?? []).some(write => write.kind !== "assignment" || write.operator !== "=" || write.path !== `${binding.name}.value` ||
        unwrapValueExpression(write.value)?.type !== "Literal" || typeof unwrapValueExpression(write.value).value !== "string")) return false;
    let confined = true;
    walkEstree(symbols.ast, candidate => {
      if (candidate.type !== "Identifier" || bindingOf(candidate) !== binding || !symbols.scopeReferenceIdentifiers.has(candidate)) return;
      const parent = astAncestorChain(symbols.ast, candidate)?.at(-2);
      if (parent?.type === "VariableDeclarator" && parent.id === candidate && parent.init === initial) return;
      if (parent?.type !== "MemberExpression" || parent.object !== candidate || parent.computed || parent.optional || member(parent) !== "value") confined = false;
    });
    return confined;
  };
  const previewObjectUrls = new Set();
  if (fileGrant) {
    const result = awaitedCallResultBinding(target, [definition], symbols);
    const awaited = astAncestorChain(symbols.ast, target)?.at(-2);
    const creations = [];
    if (result && !(symbols.writesByBinding.get(result) ?? []).length && awaited?.type === "AwaitExpression") walkEstree(definition, node => {
      if (node.type !== "AssignmentExpression" || node.operator !== "=" || node.left.type !== "MemberExpression" || member(node.left) !== "value" || node.left.object.type !== "Identifier") return;
      const create = unwrapValueExpression(node.right), binding = bindingOf(node.left.object), initial = binding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding)) : null;
      if (!globalCall(create, "URL", "createObjectURL") || create.arguments.length !== 1 || path(create.arguments[0]) !== `${identity(result)}.blob` ||
          create.range[0] <= target.range[1] || initial?.type !== "CallExpression" || !symbols.vueRefImportBindings.has(bindingOf(initial.callee)) ||
          unwrapValueExpression(initial.arguments[0])?.type !== "Literal" || typeof unwrapValueExpression(initial.arguments[0]).value !== "string") return;
      if ((symbols.writesByBinding.get(binding) ?? []).some(write => write.kind !== "assignment" || write.operator !== "=" || write.path !== `${binding.name}.value` ||
          write.value !== create && !(unwrapValueExpression(write.value)?.type === "Literal" && typeof unwrapValueExpression(write.value).value === "string"))) return;
      let confined = true;
      walkEstree(symbols.ast, reference => {
        if (reference.type !== "Identifier" || bindingOf(reference) !== binding || !symbols.scopeReferenceIdentifiers.has(reference)) return;
        const parent = astAncestorChain(symbols.ast, reference)?.at(-2);
        if (parent?.type === "VariableDeclarator" && parent.id === reference && parent.init === initial) return;
        if (parent?.type !== "MemberExpression" || parent.object !== reference || parent.computed || parent.optional || member(parent) !== "value") confined = false;
      });
      if (confined) creations.push({ create, binding });
    });
    if (creations.length === 1) {
      const { create, binding } = creations[0]; previewObjectUrls.add(create);
      walkEstree(symbols.ast, node => {
        if (globalCall(node, "URL", "revokeObjectURL") && node.arguments.length === 1 && path(node.arguments[0]) === `${identity(binding)}.value`) previewObjectUrls.add(node);
      });
    }
  }
  const guardedStringTrim = (call, environment) => {
    if (member(call.callee) !== "trim" || call.arguments.length !== 0) return false;
    if (privateStringRef(call.callee.object)) return true;
    const receiver = path(call.callee.object, environment);
    if (!receiver) return false;
    const rejectsNonString = node => {
      const value = unwrapValueExpression(node);
      if (value?.type === "LogicalExpression" && value.operator === "||") return rejectsNonString(value.left) || rejectsNonString(value.right);
      return value?.type === "BinaryExpression" && value.operator === "!==" && literalString(value.right) === "string" &&
        value.left.type === "UnaryExpression" && value.left.operator === "typeof" && path(value.left.argument, environment) === receiver;
    };
    const ancestors = astAncestorChain(symbols.ast, call) ?? [];
    return ancestors.some((ancestor, index) => ancestor.type === "LogicalExpression" && ancestor.operator === "||" &&
      ancestor.right === ancestors[index + 1] && rejectsNonString(ancestor.left));
  };
  const privateScalar = binding => {
    const initial = binding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding)) : null;
    if (initial?.type !== "Literal" || !["number", "boolean", "string"].includes(typeof initial.value)) return false;
    return (symbols.writesByBinding.get(binding) ?? []).every(write => {
      if (write.path !== binding.name) return false;
      if (write.kind === "update") return typeof initial.value === "number" && ["++", "--"].includes(write.operator);
      const value = unwrapValueExpression(write.value);
      return write.kind === "assignment" && ["=", "+=", "-="].includes(write.operator) &&
        (write.operator === "=" || typeof initial.value === "number") && value?.type === "Literal" && typeof value.value === typeof initial.value;
    });
  };
  const privateTimers = new Map();
  const privateTimer = binding => {
    if (privateTimers.has(binding)) return privateTimers.get(binding);
    privateTimers.set(binding, false);
    const initial = binding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, binding)) : null;
    if (initial?.type !== "Literal" || initial.value !== null) return false;
    const writes = symbols.writesByBinding.get(binding) ?? [], callbacks = [];
    if (!writes.length || writes.some(write => {
      const value = unwrapValueExpression(write.value);
      if (write.kind !== "assignment" || write.operator !== "=" || write.path !== binding.name) return true;
      if (value?.type === "Literal" && value.value === null) return false;
      const callback = unwrapValueExpression(value?.arguments?.[0]), delay = unwrapValueExpression(value?.arguments?.[1]);
      if (!globalCall(value, "setTimeout") || value.arguments.length !== 2 || callback?.type !== "ArrowFunctionExpression" ||
          callback.async || callback.params.length || delay?.type !== "Literal" || typeof delay.value !== "number" || delay.value <= 0 || delay.value > 60_000) return true;
      callbacks.push(callback); return false;
    })) return false;
    let privateHandle = true;
    walkEstree(symbols.ast, node => {
      if (node.type !== "Identifier" || bindingOf(node) !== binding || !symbols.scopeReferenceIdentifiers.has(node)) return;
      const parent = astAncestorChain(symbols.ast, node)?.at(-2);
      if (parent?.type === "VariableDeclarator" && parent.id === node && parent.init === initial) return;
      if (parent?.type === "AssignmentExpression" && parent.left === node && parent.operator === "=") return;
      if (parent?.type === "CallExpression" && globalCall(parent, "clearTimeout") && parent.arguments.length === 1 && parent.arguments[0] === node) return;
      if (parent?.type === "BinaryExpression" && ["===", "!=="].includes(parent.operator)) {
        const other = unwrapValueExpression(parent.left === node ? parent.right : parent.left);
        if (other?.type === "Literal" && other.value === null) return;
      }
      privateHandle = false;
    });
    if (!privateHandle) return false;
    privateTimers.set(binding, true);
    // The cache qualifies only the private timer handle's source structure.
    // Callback effects are checked at each setTimeout with its bound frame.
    return true;
  };
  const readonlyFrameCoordinate = (node, environment, depth = 0) => {
    if (depth > 8) return null;
    const origin = fieldOrigin(node, environment, { definition, limit: target.range[0] });
    if (origin?.kind === "read" && origin.coordinate) return JSON.stringify(["json", origin.sourceIdentity, origin.coordinate, origin.fields, Boolean(origin.immutableArray), Boolean(origin.immutableRecord)]);
    if (origin?.kind !== "record") return null;
    const fields = [...origin.fields].map(([key, value]) => [key, readonlyFrameCoordinate(value, origin.environment, depth + 1)]);
    return fields.length && fields.every(([, value]) => value) ? JSON.stringify(["record", fields]) : null;
  };
  // These additional data producers are available only after their original
  // source/target proofs finish. Unknown writes still have no witness.
  scalarRefProducer = (node, environment) => importedStringCall(unwrapValueExpression(node), environment) || previewObjectUrls.has(unwrapValueExpression(node));
  qualifiedRefValue = node => basicRefValue(node);
  rawDataRefs.clear();
  const safeCalls = (node, allowTarget = false, finalizer = false, checked = new Map(), environment = new Map()) => {
    let valid = true;
    directCallableNodes(node, current => {
      if (!valid) return;
      if (!limitedSyntax(current) || !primitiveOperation(current, environment, value => value?.type === "Identifier" && privateScalar(bindingOf(value)))) { valid = false; return; }
      if (current.type === "Identifier" && symbols.scopeReferenceIdentifiers.has(current) && symbols.definitionsByBinding.has(bindingOf(current))) {
        const parent = astAncestorChain(symbols.ast, current)?.at(-2);
        if (!(parent?.type === "CallExpression" && parent.callee === current) && !(parent?.type === "VariableDeclarator" && parent.id === current)) { valid = false; return; }
      }
      if (current.type === "MemberExpression") {
        const parent = astAncestorChain(symbols.ast, current)?.at(-2);
        // Method execution is qualified by the call checker below. A bare
        // property read must itself have a data origin: it may invoke a getter.
        const callee = parent?.type === "CallExpression" && parent.callee === current;
        const receiver = fieldOrigin(current.object, environment, { definition, limit: target.range[0] });
        const recordField = receiver?.kind === "record" && member(current) && receiver.fields.has(member(current));
        if (!callee && !recordField && !ownDataMember(current, [], environment) && !primitiveGetterValue(current, new Set(), environment) && !readDerivedValue(current, environment)) { valid = false; return; }
      }
      if (current.type === "SpreadElement" && !readDerivedCollection(current.argument, environment) &&
          fieldOrigin(current.argument, environment, { definition, limit: target.range[0] })?.kind !== "read") { valid = false; return; }
      if (current.type === "CallExpression") {
        if (current === target && allowTarget) return;
        if (readonlyIntrinsicCall(current, environment) || (current.callee.type === "Identifier" && projectedIdentityRead(bindingOf(current.callee)) && current.arguments.length === 1 && primitiveGetterValue(current.arguments[0], new Set(), environment)) || importedStringCall(current, environment) || guardedStringTrim(current, environment) || !finalizer && previewObjectUrls.has(current)) return;
        if (globalCall(current, "Array", "isArray") && current.arguments.length === 1) return;
        if (globalCall(current, "String") && current.arguments.length === 1 && readDerivedValue(current.arguments[0], environment)) return;
        if (member(current.callee) === "includes" && current.arguments.length === 1 && readDerivedCollection(current.callee.object, environment)) return;
        if (["filter", "some", "find", "every"].includes(member(current.callee)) && current.arguments.length === 1 &&
            current.arguments[0].type === "ArrowFunctionExpression" && !current.arguments[0].async &&
            purePredicate(current.arguments[0], environment) && readDerivedCollection(current.callee.object, environment)) return;
        if (globalCall(current, "clearTimeout") && !finalizer && current.arguments.length === 1 && current.arguments[0].type === "Identifier" && privateTimer(bindingOf(current.arguments[0]))) return;
        if (globalCall(current, "setTimeout") && !finalizer) {
          const parent = astAncestorChain(symbols.ast, current)?.at(-2);
          if (parent?.type === "AssignmentExpression" && parent.right === current && parent.left.type === "Identifier" && privateTimer(bindingOf(parent.left)) &&
              safeCalls(current.arguments[0], false, false, checked, environment)) return;
        }
        if (globalCall(current, "Object", "freeze") || globalCall(current, "Boolean")) return;
        const binding = bindingOf(current.callee);
        if (binding && context.serverReadImports.has(binding)) return;
        const callable = binding ? uniqueIndexedNode(symbols.definitionsByBinding, binding) : null;
        if (callable) {
          if ((symbols.writesByBinding.get(binding) ?? []).length > 0) { valid = false; return; }
          if (callable === definition) { valid = false; return; }
          const local = bindCall(callable, current, environment);
          if (!local) { valid = false; return; }
          const frame = callable.params.map(parameter => readonlyFrameCoordinate(parameter, local) ?? path(parameter, local));
          if (checked.has(binding)) {
            const prior = checked.get(binding);
            // Only an identical lexical argument frame may close a recursive
            // read-only cycle. An unfinished frame proves no sibling call.
            if (frame.some((value, index) => !value || value !== prior[index])) valid = false;
          } else {
            const stack = new Map(checked); stack.set(binding, frame);
            if (!safeCalls(callable, false, finalizer, stack, local)) valid = false;
          }
          return;
        }
        if (member(current.callee) === "includes" && current.arguments.length === 1 && trustedIncludes.has(path(current.callee.object, environment))) return;
        valid = false;
      }
      if (current.type === "AssignmentExpression") {
        if (!finalizer && current.left.type === "Identifier" && (privateTimer(bindingOf(current.left)) || privateScalar(bindingOf(current.left)))) return;
        const destination = path(current.left);
        if (finalizer) {
          const left = unwrapValueExpression(current.left);
          const scalarBinding = left?.type === "MemberExpression" && member(left) === "value" && left.object.type === "Identifier" ? bindingOf(left.object) : null;
          const scalar = scalarBinding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, scalarBinding)) : null;
          const initial = unwrapValueExpression(scalar?.arguments?.[0]), assigned = unwrapValueExpression(current.right);
          if (!scalar || scalar.type !== "CallExpression" || !symbols.vueRefImportBindings.has(bindingOf(scalar.callee)) ||
              initial?.type !== "Literal" || !["boolean", "string"].includes(typeof initial.value) ||
              assigned?.type !== "Literal" || typeof assigned.value !== typeof initial.value) { valid = false; return; }
        }
        if (!destination || current.operator !== "=" || !destination.endsWith(".value")) { valid = false; return; }
        if (destination === cap) {
          if (!expressionIsEmptyCapabilityState(current.right) && current.right !== populated[0].value) valid = false;
        } else if (unwrapValueExpression(current.right)?.type !== "Literal") {
          const left = unwrapValueExpression(current.left), uiBinding = left?.type === "MemberExpression" && member(left) === "value" && left.object.type === "Identifier" ? bindingOf(left.object) : null;
          const ui = uiBinding ? unwrapValueExpression(uniqueIndexedNode(symbols.declarationsByBinding, uiBinding)) : null;
          const initial = unwrapValueExpression(ui?.arguments?.[0]);
          // A component-owned nullable Vue ref only receives display/read data;
          // every nested call is still checked independently for writes.
          const literalNotice = (node, depth = 0) => {
            const value = unwrapValueExpression(node);
            return depth < 8 && (value?.type === "Literal" && typeof value.value === "string" || value?.type === "ConditionalExpression" && literalNotice(value.consequent, depth + 1) && literalNotice(value.alternate, depth + 1));
          };
          if (finalizer || ui?.type !== "CallExpression" || !symbols.vueRefImportBindings.has(bindingOf(ui.callee)) || initial?.type !== "Literal" ||
              !(initial.value === null || typeof initial.value === "string" && (literalNotice(current.right) || importedStringCall(unwrapValueExpression(current.right), environment) || previewObjectUrls.has(unwrapValueExpression(current.right))))) valid = false;
        }
      }
      if (["UpdateExpression", "YieldExpression", "TaggedTemplateExpression", "NewExpression"].includes(current.type)) {
        if (!finalizer && current.type === "UpdateExpression" && current.argument.type === "Identifier" && privateScalar(bindingOf(current.argument))) return;
        if (current.type !== "NewExpression" || current.callee.type !== "Identifier" || current.callee.name !== "Error" || !unshadowedRuntimeGlobal(current.callee, new Set(["Error"]), symbols.scopeBindings) ||
            current.arguments.length > 1 || current.arguments.some(argument => unwrapValueExpression(argument)?.type !== "Literal" || typeof unwrapValueExpression(argument).value !== "string")) valid = false;
      }
    });
    return valid;
  };
  if (!safeCalls(definition, true)) return null;
  if (attempt.handler && !safeCalls(attempt.handler.body)) return null;
  if (attempt.finalizer && !safeCalls(attempt.finalizer, false, true)) return null;
  // Cap state/aliases cannot be passed to an unknown callable or mutated deeply.
  let escaped = false;
  walkEstree(symbols.ast, node => {
    if (node.type === "Identifier" && bindingOf(node) === rootBinding && symbols.scopeReferenceIdentifiers.has(node)) {
      const parent = astAncestorChain(symbols.ast, node)?.at(-2);
      const declaration = parent?.type === "VariableDeclarator" && parent.id === node && parent.init === rootDeclaration;
      const valueAccess = parent?.type === "MemberExpression" && !parent.optional && !parent.computed && parent.object === node && member(parent) === "value";
      // The mutable ref itself never enters a container, argument or return.
      // Only its frozen value may participate in the proven capability chain.
      if (!declaration && !valueAccess) escaped = true;
    }
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") {
      const destination = path(node.left ?? node.argument);
      if (destination?.startsWith(`${cap}.`)) escaped = true;
    }
    if (node.type !== "CallExpression" || node === target) return;
    for (const argument of node.arguments ?? []) {
      const value = path(argument);
      if (value === identity(rootBinding) || (value && (value === cap || value.startsWith(`${cap}.`)) && !purePredicates.has(bindingOf(node.callee)) && !readonlyIntrinsicCall(node, new Map()))) escaped = true;
    }
  });
  if (escaped) return null;
  return { verified: true, kind: "frozen_server_grant", capabilityWitness: true, capabilitySources: new Set([sourceIdentity]) };
}

function proveBusinessActionPipeline({ action, wrapper, context }) {
  const specializedProof = SEAL_ACTION_IDS.has(action.id) ? proveContractSealPageAction :
    GENERATED_ARCHIVE_ACTIONS.has(action.id) ? proveGeneratedArchivePageAction : null;
  if (specializedProof) {
    return specializedProof({ action, wrapper, context, syntax: {
      astAncestorChain,
      buildSymbolContext,
      callExpressionMatchesWrapper,
      elementDirective,
      localCallable: directRegistrationCallable,
      matches: directRegistrationMatches,
      normalizedMainRequests,
      referenceRootIdentifier,
      sameExpression: directRegistrationExpression,
      topLevelScopeVariables,
      uniqueIndexedNode,
      unshadowedRuntimeGlobal,
      walkEstree,
      wrapperIdentity
    } });
  }
  if (isContractDraftCreationCapability(action.capability, context)) return null;
  const handler = pipelineHandlerSource(action.trigger.handler, wrapper, context);
  if (!handler) return null;
  const targetCalls = importedWrapperCallCount(
    handler.definitions,
    wrapper,
    context
  );
  if (targetCalls !== 1) return null;

  const frozenGrantProof = frozenServerGrantPipelineProof({ action, wrapper, handler, context });
  if (frozenGrantProof) return frozenGrantProof;

  const projectDefinitionProof = projectDefinitionPipelineProof({
    action,
    wrapper,
    handler,
    context
  });
  if (projectDefinitionProof) return projectDefinitionProof;
  const projectCapabilityProof = projectCapabilityPipelineProof({
    action,
    wrapper,
    handler,
    context
  });
  if (projectCapabilityProof) return projectCapabilityProof;

  return guardedUploadPipelineProof({
    action,
    wrapper,
    handler,
    context
  });
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
  if (SEAL_ACTION_IDS.has(capabilityContext?.actionId) || GENERATED_ARCHIVE_ACTIONS.has(capabilityContext?.actionId)) {
    return { verified: false, localCallChain: [handler] };
  }
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
  // The draft proof binds both the awaited receipt and the sole write.
  // Reuse it for the exact wrapper without bypassing variant analysis.
  const draftOperation = !variant && candidate?.kind === "background_call" &&
    capability && capabilityContext?.sourceFile === CONTRACT_DRAFT_COMPOSABLE_PATH && handlerDefinition
    ? delegatedBackgroundCapabilityPreflight(
        { kind: "background_call", expression: handlerDefinition },
        capability,
        capabilityContext
      )
    : null;
  if (draftOperation?.writeIdentity === wrapperIdentity(wrapper.apiFile, wrapper.name)) {
    return {
      verified: true,
      localCallChain: [handler, draftOperation.writeName]
    };
  }
  if (isContractDraftCreationCapability(capability, capabilityContext)) {
    return { verified: false, localCallChain: [handler] };
  }
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
    const safeGuardHelpers =
      safeGuardHelperCallsBeforeWrapper(
        definition,
        analysis.calls,
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
        !safeGuardHelpers.has(callBinding) &&
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

function directCallableNodes(definition, visitor) {
  const seen = new Set();
  const visit = (node, parent = null, isRoot = false) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (
      !isRoot &&
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression"
      ].includes(node.type)
    ) {
      return;
    }
    visitor(node, parent);
    for (const [key, value] of Object.entries(node)) {
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
            visit(child, node, false);
          }
        }
      } else if (value && typeof value.type === "string") {
        visit(value, node, false);
      }
    }
  };
  visit(definition, null, true);
}

function staticMemberPath(node) {
  const value = unwrapValueExpression(node);
  if (value?.type === "Identifier") return value.name;
  if (
    value?.type !== "MemberExpression" ||
    value.computed ||
    value.property?.type !== "Identifier"
  ) {
    return null;
  }
  const objectPath = staticMemberPath(value.object);
  return objectPath
    ? `${objectPath}.${value.property.name}`
    : null;
}

function directAwaitedBoundMemberCallCount(
  definition,
  memberPath,
  rootBinding,
  symbols
) {
  let count = 0;
  directCallableNodes(definition, (node, parent) => {
    const rootIdentifier = referenceRootIdentifier(node.callee);
    if (
      node.type === "CallExpression" &&
      staticMemberPath(node.callee) === memberPath &&
      parent?.type === "AwaitExpression" &&
      rootIdentifier &&
      symbols.scopeBindings?.get(rootIdentifier) === rootBinding
    ) {
      count += 1;
    }
  });
  return count;
}

function directAwaitedWrapperCallCount(definition, wrapper, symbols) {
  let count = 0;
  directCallableNodes(definition, (node, parent) => {
    if (
      node.type !== "CallExpression" ||
      node.callee?.type !== "Identifier" ||
      parent?.type !== "AwaitExpression"
    ) {
      return;
    }
    const call = {
      kind: "identifier",
      localName: node.callee.name,
      bindingIdentifier: node.callee,
      callNode: node
    };
    if (importedCallMatchesWrapper(call, wrapper, symbols)) count += 1;
  });
  return count;
}

function directWrapperCallCount(definition, wrapper, symbols) {
  let count = 0;
  directCallableNodes(definition, (node) => {
    if (callExpressionMatchesWrapper(node, wrapper, symbols)) count += 1;
  });
  return count;
}

function objectPropertyValue(object, name) {
  if (object?.type !== "ObjectExpression") return null;
  const matches = (object.properties ?? []).filter(
    (property) =>
      property?.type === "Property" &&
      property.kind === "init" &&
      propertyKey(property) === name
  );
  return matches.length === 1 ? matches[0].value : null;
}

function returnedContractDraftLifecycleCommand({
  command,
  composableSymbols
}) {
  const lifecycleBinding = uniqueScopeVariable(
    composableSymbols.scopeManager,
    "lifecycle"
  );
  if (!lifecycleBinding) return null;
  const lifecycleObject = uniqueIndexedNode(
    composableSymbols.declarationsByBinding,
    lifecycleBinding
  );
  const commandsObject = objectPropertyValue(
    lifecycleObject,
    "commands"
  );
  const commandReference = objectPropertyValue(
    commandsObject,
    command
  );
  if (commandReference?.type !== "Identifier") return null;
  const commandBinding = composableSymbols.scopeBindings?.get(
    commandReference
  );
  const commandDefinition = commandBinding
    ? uniqueIndexedNode(
        composableSymbols.definitionsByBinding,
        commandBinding
      )
    : null;
  if (!commandBinding || !commandDefinition) return null;

  const useDraftBindings = topLevelScopeVariables(
    composableSymbols.scopeManager,
    "useContractDraft"
  );
  if (useDraftBindings.length !== 1) return null;
  const useDraftDefinition = uniqueIndexedNode(
    composableSymbols.definitionsByBinding,
    useDraftBindings[0]
  );
  if (!useDraftDefinition) return null;
  let returned = false;
  directCallableNodes(useDraftDefinition, (node) => {
    if (node.type !== "ReturnStatement") return;
    const lifecycleReference = objectPropertyValue(
      unwrapValueExpression(node.argument),
      "lifecycle"
    );
    if (
      lifecycleReference?.type === "Identifier" &&
      composableSymbols.scopeBindings?.get(lifecycleReference) ===
        lifecycleBinding
    ) {
      returned = true;
    }
  });
  return returned ? commandDefinition : null;
}

function bindingOwnsIdentifierRange(
  binding,
  identifier,
  { references = false } = {}
) {
  if (
    identifier?.type !== "Identifier" ||
    !Array.isArray(identifier.range)
  ) {
    return false;
  }
  const candidates = references
    ? (binding?.references ?? []).map((reference) => reference.identifier)
    : binding?.identifiers ?? [];
  return candidates.some(
    (candidate) =>
      candidate?.type === "Identifier" &&
      candidate.name === identifier.name &&
      candidate.range?.[0] === identifier.range[0] &&
      candidate.range?.[1] === identifier.range[1]
  );
}

function contractDraftPageLifecycleBinding(context) {
  const lifecycleBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    "lifecycle"
  );
  const draftBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    "draft"
  );
  const useDraftBinding =
    context.symbols.importVariablesByName.get("useContractDraft");
  const useDraftImport = useDraftBinding
    ? context.symbols.importsByBinding.get(useDraftBinding)
    : null;
  if (
    lifecycleBindings.length !== 1 ||
    draftBindings.length !== 1 ||
    !useDraftBinding ||
    useDraftImport?.sourceFile !== CONTRACT_DRAFT_COMPOSABLE_PATH ||
    useDraftImport.importedName !== "useContractDraft"
  ) {
    return null;
  }

  const lifecycleBinding = lifecycleBindings[0];
  const draftBinding = draftBindings[0];
  const pageAst = context.asts.get(context.sourceFile);
  const draftDeclaration = uniqueIndexedNode(
    context.symbols.declarationsByBinding,
    draftBinding
  );
  const draftCall = unwrapValueExpression(draftDeclaration);
  if (
    draftCall?.type !== "CallExpression" ||
    draftCall.callee?.type !== "Identifier" ||
    context.symbols.scopeBindings?.get(draftCall.callee) !==
      useDraftBinding ||
    (context.symbols.writesByBinding.get(draftBinding) ?? []).length > 0 ||
    (context.symbols.writesByBinding.get(lifecycleBinding) ?? []).length > 0 ||
    !pageAst
  ) {
    return null;
  }

  let destructuringCount = 0;
  walkEstree(pageAst, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      node.id?.type !== "ObjectPattern" ||
      node.init?.type !== "Identifier" ||
      !bindingOwnsIdentifierRange(
        draftBinding,
        node.init,
        { references: true }
      )
    ) {
      return;
    }
    const lifecycleProperties = (node.id.properties ?? []).filter(
      (property) =>
        property?.type === "Property" &&
        property.shorthand === true &&
        propertyKey(property) === "lifecycle" &&
        property.value?.type === "Identifier" &&
        bindingOwnsIdentifierRange(
          lifecycleBinding,
          property.value
        )
    );
    destructuringCount += lifecycleProperties.length;
  });
  return destructuringCount === 1 ? lifecycleBinding : null;
}

function contractDraftLifecycleSessionCausalProof({
  action,
  wrapper,
  context
}) {
  const expected = CONTRACT_DRAFT_LIFECYCLE_COMMAND_BY_WRAPPER.get(
    wrapper.name
  );
  const authorityTrusted = expected
    ? Boolean(
        contractDraftAuthoritySnapshotProvenance(
          action.capability,
          context
        )
      )
    : false;
  if (
    !expected ||
    action.id !== expected.actionId ||
    action.sourceFile !== CONTRACT_WORKBENCH_PAGE_PATH ||
    action.trigger.handler !== expected.pageHandler ||
    wrapper.apiFile !== CONTRACT_WORKBENCH_API_PATH ||
    !authorityTrusted
  ) {
    return null;
  }
  const lifecycleBinding = contractDraftPageLifecycleBinding(context);
  const pageHandlerBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    expected.pageHandler
  );
  const pageHandlerDefinition = pageHandlerBindings.length === 1
    ? uniqueIndexedNode(
        context.symbols.definitionsByBinding,
        pageHandlerBindings[0]
      )
    : null;
  const pageCallCount = pageHandlerDefinition && lifecycleBinding
    ? directAwaitedBoundMemberCallCount(
        pageHandlerDefinition,
        `lifecycle.commands.${expected.command}`,
        lifecycleBinding,
        context.symbols
      )
    : 0;
  if (!pageHandlerDefinition || pageCallCount !== 1) {
    return null;
  }

  const composableAst = context.asts.get(
    CONTRACT_DRAFT_COMPOSABLE_PATH
  );
  if (!composableAst) return null;
  const composableSymbols = buildSymbolContext(
    composableAst,
    CONTRACT_DRAFT_COMPOSABLE_PATH,
    context.sourceFileSet
  );
  const commandDefinition = returnedContractDraftLifecycleCommand({
    command: expected.command,
    composableSymbols
  });
  const wrapperCallCount = commandDefinition
    ? directAwaitedWrapperCallCount(
        commandDefinition,
        wrapper,
        composableSymbols
      )
    : 0;
  if (
    !commandDefinition ||
    wrapperCallCount !== 1
  ) {
    return null;
  }
  return {
    verified: true,
    localCallChain: [
      expected.pageHandler,
      `lifecycle.commands.${expected.command}`,
      expected.command,
      wrapper.name
    ]
  };
}

function normalizedSource(source) {
  return source.replace(/\s+/gu, " ").trim();
}

function containsOrderedSourceFragments(source, fragments) {
  const normalized = normalizedSource(source);
  let cursor = 0;
  for (const fragment of fragments.map(normalizedSource)) {
    const index = normalized.indexOf(fragment, cursor);
    if (index < 0) return false;
    cursor = index + fragment.length;
  }
  return true;
}

function finalContractSourceRevisionReachesPayload(
  terminalCall,
  symbols
) {
  const payload = unwrapValueExpression(terminalCall?.arguments?.[1]);
  if (payload?.type !== "ObjectExpression") return false;
  const sourceRevisionProperties = (payload.properties ?? []).filter(
    (property) =>
      property?.type === "Property" &&
      property.kind === "init" &&
      !property.computed &&
      propertyKey(property) === "sourceRevision" &&
      property.value?.type === "Identifier"
  );
  if (sourceRevisionProperties.length !== 1) return false;
  const sourceRevision = sourceRevisionProperties[0].value;
  const sourceRevisionBinding = symbols.scopeBindings?.get(sourceRevision);
  const declaration = sourceRevisionBinding
    ? uniqueIndexedNode(
        symbols.declarationsByBinding,
        sourceRevisionBinding
      )
    : null;
  const source = unwrapValueExpression(declaration);
  const capabilityRevision = source?.arguments?.length === 1
    ? staticMemberPath(source.arguments[0])
    : null;
  const lastProperty = payload.properties?.at(-1);
  return Boolean(
    source?.type === "CallExpression" &&
    source.callee?.type === "Identifier" &&
    source.callee.name === "Number" &&
    !symbols.scopeBindings?.get(source.callee) &&
    capabilityRevision === "capability.draftRevision" &&
    lastProperty === sourceRevisionProperties[0]
  );
}

function directConstBinding(definition, name, symbols) {
  const matches = [];
  for (const [index, statement] of (
    definition?.body?.type === "BlockStatement"
      ? definition.body.body ?? []
      : []
  ).entries()) {
    if (
      statement.type !== "VariableDeclaration" ||
      statement.kind !== "const"
    ) {
      continue;
    }
    for (const declaration of statement.declarations ?? []) {
      if (
        declaration.id?.type !== "Identifier" ||
        declaration.id.name !== name ||
        !declaration.init
      ) {
        continue;
      }
      const binding = symbols.scopeBindings?.get(declaration.id);
      if (binding) {
        matches.push({ binding, declaration, index });
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function directFailClosedBindingGuard(
  definition,
  binding,
  symbols
) {
  const matches = [];
  const statements = definition?.body?.type === "BlockStatement"
    ? definition.body.body ?? []
    : [];
  for (const [index, statement] of statements.entries()) {
    const test = unwrapValueExpression(statement?.test);
    const guarded = test?.type === "UnaryExpression" &&
      test.operator === "!"
      ? unwrapValueExpression(test.argument)
      : null;
    if (
      statement.type === "IfStatement" &&
      !statement.alternate &&
      guarded?.type === "Identifier" &&
      symbols.scopeBindings?.get(guarded) === binding &&
      preflightThrowBranchIsSafe(
        statement.consequent,
        symbols,
        new Set()
      )
    ) {
      matches.push(index);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function flattenedStrictConjunction(node) {
  const value = unwrapValueExpression(node);
  if (
    value?.type === "LogicalExpression" &&
    value.operator === "&&"
  ) {
    const left = flattenedStrictConjunction(value.left);
    const right = flattenedStrictConjunction(value.right);
    return left && right ? [...left, ...right] : null;
  }
  return value ? [value] : null;
}

function flattenedStrictDisjunction(node) {
  const value = unwrapValueExpression(node);
  if (
    value?.type === "LogicalExpression" &&
    value.operator === "||"
  ) {
    const left = flattenedStrictDisjunction(value.left);
    const right = flattenedStrictDisjunction(value.right);
    return left && right ? [...left, ...right] : null;
  }
  return value ? [value] : null;
}

function sameDocumentContentDefinitionIsExact(
  definition,
  symbols
) {
  if (
    definition?.type !== "FunctionDeclaration" ||
    definition.params?.length !== 2 ||
    definition.params.some(
      (parameter) => parameter?.type !== "Identifier"
    ) ||
    definition.body?.type !== "BlockStatement" ||
    definition.body.body?.length !== 1 ||
    definition.body.body[0]?.type !== "ReturnStatement"
  ) {
    return false;
  }
  const [leftParameter, rightParameter] = definition.params;
  const leftBinding = symbols.scopeBindings?.get(leftParameter);
  const rightBinding = symbols.scopeBindings?.get(rightParameter);
  const returned = unwrapValueExpression(
    definition.body.body[0].argument
  );
  if (
    !leftBinding ||
    !rightBinding ||
    returned?.type !== "CallExpression" ||
    !unshadowedRuntimeGlobal(
      returned.callee,
      new Set(["Boolean"]),
      symbols.scopeBindings
    ) ||
    returned.arguments?.length !== 1
  ) {
    return false;
  }
  const terms = flattenedStrictConjunction(
    returned.arguments[0]
  );
  if (!terms || terms.length !== 4) return false;

  const [leftPresent, rightPresent, revision, fingerprint] = terms;
  const revisionLeftRoot = referenceRootIdentifier(revision?.left);
  const revisionRightRoot = referenceRootIdentifier(revision?.right);
  const fingerprintLeftRoot = referenceRootIdentifier(fingerprint?.left);
  const fingerprintRightRoot = referenceRootIdentifier(fingerprint?.right);
  return Boolean(
    leftPresent?.type === "Identifier" &&
    symbols.scopeBindings?.get(leftPresent) === leftBinding &&
    rightPresent?.type === "Identifier" &&
    symbols.scopeBindings?.get(rightPresent) === rightBinding &&
    revision?.type === "BinaryExpression" &&
    revision.operator === "===" &&
    staticMemberPath(revision.left) ===
      `${leftParameter.name}.documentContentRevision` &&
    staticMemberPath(revision.right) ===
      `${rightParameter.name}.documentContentRevision` &&
    revisionLeftRoot &&
    revisionRightRoot &&
    symbols.scopeBindings?.get(revisionLeftRoot) === leftBinding &&
    symbols.scopeBindings?.get(revisionRightRoot) === rightBinding &&
    fingerprint?.type === "BinaryExpression" &&
    fingerprint.operator === "===" &&
    staticMemberPath(fingerprint.left) ===
      `${leftParameter.name}.documentContentFingerprint` &&
    staticMemberPath(fingerprint.right) ===
      `${rightParameter.name}.documentContentFingerprint` &&
    fingerprintLeftRoot &&
    fingerprintRightRoot &&
    symbols.scopeBindings?.get(fingerprintLeftRoot) === leftBinding &&
    symbols.scopeBindings?.get(fingerprintRightRoot) === rightBinding
  );
}

export function verifySameDocumentContentFunctionSource(functionSource) {
  try {
    const path = "same-document-content.ts";
    const ast = parseSource(path, functionSource);
    const symbols = buildSymbolContext(
      ast,
      path,
      new Set([path])
    );
    const bindings = topLevelScopeVariables(
      symbols.scopeManager,
      "sameDocumentContent"
    );
    const definition = bindings.length === 1
      ? uniqueIndexedNode(
          symbols.definitionsByBinding,
          bindings[0]
        )
      : null;
    return sameDocumentContentDefinitionIsExact(
      definition,
      symbols
    );
  } catch {
    return false;
  }
}

function documentContentCoordinatesDefinitionIsExact(
  definition,
  symbols
) {
  if (
    definition?.type !== "FunctionDeclaration" ||
    definition.params?.length !== 2 ||
    definition.params.some(
      (parameter) => parameter?.type !== "Identifier"
    ) ||
    definition.body?.type !== "BlockStatement" ||
    definition.body.body?.length !== 2
  ) {
    return false;
  }
  const [revisionParameter, fingerprintParameter] =
    definition.params;
  const revisionBinding = symbols.scopeBindings?.get(
    revisionParameter
  );
  const fingerprintBinding = symbols.scopeBindings?.get(
    fingerprintParameter
  );
  const [guard, terminal] = definition.body.body;
  if (
    !revisionBinding ||
    !fingerprintBinding ||
    guard?.type !== "IfStatement" ||
    guard.alternate ||
    !preflightThrowBranchIsSafe(
      guard.consequent,
      symbols,
      new Set()
    ) ||
    terminal?.type !== "ReturnStatement"
  ) {
    return false;
  }
  const guardTerms = flattenedStrictDisjunction(guard.test);
  if (!guardTerms || guardTerms.length !== 4) return false;
  const [invalidInteger, invalidPositive, invalidType, invalidHash] =
    guardTerms;
  const integerCall = invalidInteger?.type === "UnaryExpression" &&
    invalidInteger.operator === "!"
    ? unwrapValueExpression(invalidInteger.argument)
    : null;
  const integerNumberRoot = referenceRootIdentifier(
    integerCall?.callee
  );
  const integerArgument = integerCall?.arguments?.[0];
  const positiveCall = invalidPositive?.type === "BinaryExpression"
    ? unwrapValueExpression(invalidPositive.left)
    : null;
  const positiveArgument = positiveCall?.arguments?.[0];
  const typeArgument = invalidType?.type === "BinaryExpression" &&
    invalidType.left?.type === "UnaryExpression" &&
    invalidType.left.operator === "typeof"
    ? unwrapValueExpression(invalidType.left.argument)
    : null;
  const hashCall = invalidHash?.type === "UnaryExpression" &&
    invalidHash.operator === "!"
    ? unwrapValueExpression(invalidHash.argument)
    : null;
  const hashPattern = hashCall?.callee?.type === "MemberExpression"
    ? unwrapValueExpression(hashCall.callee.object)
    : null;
  const hashArgument = hashCall?.arguments?.[0];
  if (
    integerCall?.type !== "CallExpression" ||
    staticMemberPath(integerCall.callee) !== "Number.isInteger" ||
    !unshadowedRuntimeGlobal(
      integerNumberRoot,
      new Set(["Number"]),
      symbols.scopeBindings
    ) ||
    integerCall.arguments?.length !== 1 ||
    integerArgument?.type !== "Identifier" ||
    symbols.scopeBindings?.get(integerArgument) !== revisionBinding ||
    invalidPositive?.type !== "BinaryExpression" ||
    invalidPositive.operator !== "<" ||
    positiveCall?.type !== "CallExpression" ||
    !unshadowedRuntimeGlobal(
      positiveCall.callee,
      new Set(["Number"]),
      symbols.scopeBindings
    ) ||
    positiveCall.arguments?.length !== 1 ||
    positiveArgument?.type !== "Identifier" ||
    symbols.scopeBindings?.get(positiveArgument) !== revisionBinding ||
    invalidPositive.right?.type !== "Literal" ||
    invalidPositive.right.value !== 1 ||
    invalidType?.type !== "BinaryExpression" ||
    invalidType.operator !== "!==" ||
    typeArgument?.type !== "Identifier" ||
    symbols.scopeBindings?.get(typeArgument) !== fingerprintBinding ||
    invalidType.right?.type !== "Literal" ||
    invalidType.right.value !== "string" ||
    hashCall?.type !== "CallExpression" ||
    staticMemberProperty(hashCall.callee) !== "test" ||
    hashPattern?.type !== "Literal" ||
    hashPattern.regex?.pattern !== "^[a-f0-9]{64}$" ||
    hashPattern.regex?.flags !== "u" ||
    hashCall.arguments?.length !== 1 ||
    hashArgument?.type !== "Identifier" ||
    symbols.scopeBindings?.get(hashArgument) !== fingerprintBinding
  ) {
    return false;
  }

  const returned = unwrapValueExpression(terminal.argument);
  if (
    returned?.type !== "ObjectExpression" ||
    returned.properties?.length !== 2
  ) {
    return false;
  }
  const revisionValue = objectPropertyValue(
    returned,
    "documentContentRevision"
  );
  const fingerprintValue = objectPropertyValue(
    returned,
    "documentContentFingerprint"
  );
  const revisionArgument = revisionValue?.type === "CallExpression" &&
    unshadowedRuntimeGlobal(
      revisionValue.callee,
      new Set(["Number"]),
      symbols.scopeBindings
    ) &&
    revisionValue.arguments?.length === 1
    ? revisionValue.arguments[0]
    : null;
  return Boolean(
    revisionArgument?.type === "Identifier" &&
    symbols.scopeBindings?.get(revisionArgument) === revisionBinding &&
    fingerprintValue?.type === "Identifier" &&
    symbols.scopeBindings?.get(fingerprintValue) ===
      fingerprintBinding
  );
}

export function verifyDocumentContentCoordinatesFunctionSource(
  functionSource
) {
  try {
    const path = "document-content-coordinates.ts";
    const ast = parseSource(path, functionSource);
    const symbols = buildSymbolContext(
      ast,
      path,
      new Set([path])
    );
    const bindings = topLevelScopeVariables(
      symbols.scopeManager,
      "documentContentCoordinatesFromValues"
    );
    const definition = bindings.length === 1
      ? uniqueIndexedNode(
          symbols.definitionsByBinding,
          bindings[0]
        )
      : null;
    return documentContentCoordinatesDefinitionIsExact(
      definition,
      symbols
    );
  } catch {
    return false;
  }
}

function exactDraftRevisionGuardIndex(
  definition,
  capabilityBinding,
  symbols
) {
  const matches = [];
  const statements = definition?.body?.type === "BlockStatement"
    ? definition.body.body ?? []
    : [];
  for (const [index, statement] of statements.entries()) {
    const test = unwrapValueExpression(statement?.test);
    const integerGuard = unwrapValueExpression(test?.left);
    const positiveGuard = unwrapValueExpression(test?.right);
    const integerCall = integerGuard?.type === "UnaryExpression" &&
      integerGuard.operator === "!"
      ? unwrapValueExpression(integerGuard.argument)
      : null;
    const integerNumberRoot = referenceRootIdentifier(
      integerCall?.callee
    );
    const integerRevision = integerCall?.arguments?.[0];
    const integerRevisionRoot = referenceRootIdentifier(
      integerRevision
    );
    const positiveNumberCall = unwrapValueExpression(
      positiveGuard?.left
    );
    const positiveRevision = positiveNumberCall?.arguments?.[0];
    const positiveRevisionRoot = referenceRootIdentifier(
      positiveRevision
    );
    if (
      statement.type === "IfStatement" &&
      !statement.alternate &&
      test?.type === "LogicalExpression" &&
      test.operator === "||" &&
      integerCall?.type === "CallExpression" &&
      staticMemberPath(integerCall.callee) === "Number.isInteger" &&
      unshadowedRuntimeGlobal(
        integerNumberRoot,
        new Set(["Number"]),
        symbols.scopeBindings
      ) &&
      integerCall.arguments?.length === 1 &&
      staticMemberPath(integerRevision) ===
        "capability.draftRevision" &&
      integerRevisionRoot &&
      symbols.scopeBindings?.get(integerRevisionRoot) ===
        capabilityBinding &&
      positiveGuard?.type === "BinaryExpression" &&
      positiveGuard.operator === "<" &&
      positiveNumberCall?.type === "CallExpression" &&
      unshadowedRuntimeGlobal(
        positiveNumberCall.callee,
        new Set(["Number"]),
        symbols.scopeBindings
      ) &&
      positiveNumberCall.arguments?.length === 1 &&
      staticMemberPath(positiveRevision) ===
        "capability.draftRevision" &&
      positiveRevisionRoot &&
      symbols.scopeBindings?.get(positiveRevisionRoot) ===
        capabilityBinding &&
      positiveGuard.right?.type === "Literal" &&
      positiveGuard.right.value === 1 &&
      preflightThrowBranchIsSafe(
        statement.consequent,
        symbols,
        new Set()
      )
    ) {
      matches.push(index);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function finalContractDraftRevisionGuardIsExact(
  definition,
  symbols
) {
  const capability = directConstBinding(
    definition,
    "capability",
    symbols
  );
  const sourceRevision = directConstBinding(
    definition,
    "sourceRevision",
    symbols
  );
  if (!capability || !sourceRevision) return false;
  const guardIndex = exactDraftRevisionGuardIndex(
    definition,
    capability.binding,
    symbols
  );
  return guardIndex !== null && guardIndex < sourceRevision.index;
}

export function verifyFinalContractDraftRevisionGuardSource(
  functionSource
) {
  try {
    const path = "final-contract-association.ts";
    const ast = parseSource(path, functionSource);
    const symbols = buildSymbolContext(
      ast,
      path,
      new Set([path])
    );
    const bindings = topLevelScopeVariables(
      symbols.scopeManager,
      "associateContractFinalFileWithCapability"
    );
    const definition = bindings.length === 1
      ? uniqueIndexedNode(
          symbols.definitionsByBinding,
          bindings[0]
        )
      : null;
    return finalContractDraftRevisionGuardIsExact(
      definition,
      symbols
    );
  } catch {
    return false;
  }
}

function finalContractDocumentGuardBindingProof({
  actionId,
  definition,
  symbols
}) {
  const sameContentBindings = topLevelScopeVariables(
    symbols.scopeManager,
    "sameDocumentContent"
  );
  const coordinateBindings = topLevelScopeVariables(
    symbols.scopeManager,
    "documentContentCoordinatesFromValues"
  );
  if (
    sameContentBindings.length !== 1 ||
    coordinateBindings.length !== 1
  ) {
    return false;
  }
  const sameContentBinding = sameContentBindings[0];
  const coordinateBinding = coordinateBindings[0];
  const sameContentDefinition = uniqueIndexedNode(
    symbols.definitionsByBinding,
    sameContentBinding
  );
  const coordinateDefinition = uniqueIndexedNode(
    symbols.definitionsByBinding,
    coordinateBinding
  );
  if (
    !sameContentDefinition ||
    !coordinateDefinition ||
    !sameDocumentContentDefinitionIsExact(
      sameContentDefinition,
      symbols
    ) ||
    !documentContentCoordinatesDefinitionIsExact(
      coordinateDefinition,
      symbols
    )
  ) {
    return false;
  }

  const capability = directConstBinding(
    definition,
    "capability",
    symbols
  );
  const currentContent = directConstBinding(
    definition,
    "currentContent",
    symbols
  );
  const contentMatches = directConstBinding(
    definition,
    "documentContentMatches",
    symbols
  );
  const expectedName = actionId === "contract-final.upload-file"
    ? "expectedContent"
    : actionId === "contract-final.associate"
      ? "staged"
      : null;
  const expectedParameter = (definition.params ?? []).find(
    (parameter) =>
      parameter?.type === "Identifier" &&
      parameter.name === expectedName
  );
  const expectedBinding = expectedParameter
    ? symbols.scopeBindings?.get(expectedParameter)
    : null;
  if (
    !capability ||
    !currentContent ||
    !contentMatches ||
    !expectedBinding
  ) {
    return false;
  }

  const coordinateCall = unwrapValueExpression(
    currentContent.declaration.init
  );
  const coordinateArguments = coordinateCall?.arguments ?? [];
  const revisionRoot = referenceRootIdentifier(
    coordinateArguments[0]
  );
  const fingerprintRoot = referenceRootIdentifier(
    coordinateArguments[1]
  );
  const matchesCall = unwrapValueExpression(
    contentMatches.declaration.init
  );
  const matchesArguments = matchesCall?.arguments ?? [];
  const currentReference = matchesArguments[0];
  const expectedReference = matchesArguments[1];
  const guardIndex = directFailClosedBindingGuard(
    definition,
    contentMatches.binding,
    symbols
  );
  const terminalIndex = definition.body.body.length - 1;
  return Boolean(
    coordinateCall?.type === "CallExpression" &&
    coordinateCall.callee?.type === "Identifier" &&
    symbols.scopeBindings?.get(coordinateCall.callee) ===
      coordinateBinding &&
    coordinateArguments.length === 2 &&
    staticMemberPath(coordinateArguments[0]) ===
      "capability.documentContentRevision" &&
    staticMemberPath(coordinateArguments[1]) ===
      "capability.documentContentFingerprint" &&
    revisionRoot &&
    fingerprintRoot &&
    symbols.scopeBindings?.get(revisionRoot) === capability.binding &&
    symbols.scopeBindings?.get(fingerprintRoot) === capability.binding &&
    matchesCall?.type === "CallExpression" &&
    matchesCall.callee?.type === "Identifier" &&
    symbols.scopeBindings?.get(matchesCall.callee) ===
      sameContentBinding &&
    matchesArguments.length === 2 &&
    currentReference?.type === "Identifier" &&
    symbols.scopeBindings?.get(currentReference) ===
      currentContent.binding &&
    expectedReference?.type === "Identifier" &&
    symbols.scopeBindings?.get(expectedReference) ===
      expectedBinding &&
    capability.index < currentContent.index &&
    currentContent.index < contentMatches.index &&
    contentMatches.index < guardIndex &&
    guardIndex < terminalIndex
  );
}

export function verifyFinalContractWriteGuardSequence({
  actionId,
  handlerSource,
  fileSource
}) {
  const helperVerified = containsOrderedSourceFragments(
    fileSource,
    [
      "function sameDocumentContent(",
      "left.documentContentRevision === right.documentContentRevision &&",
      "left.documentContentFingerprint === right.documentContentFingerprint"
    ]
  );
  const action = actionId === "contract-final.upload-file"
    ? {
        content: "expectedContent",
        terminal: "return uploadPrivateFile(file, fileName);"
      }
    : actionId === "contract-final.associate"
      ? {
          content: "staged",
          terminal:
            "return uploadMutuallySignedContract(contractVersionId, { ...staged.declaration, fileId: staged.fileId, sourceRevision });"
        }
      : null;
  if (!action || !helperVerified) return false;

  const commonFragments = [
    "const capability = await fetchContractDetail(contractId);",
    "const matchesRequestedContract = capability.id === contractId;",
    "if (!matchesRequestedContract) throw new Error(",
    "const matchesRequestedVersion = capability.contractVersionId === contractVersionId;",
    "if (!matchesRequestedVersion) throw new Error(",
    "const operationAllowed = capability.availableActionKeys.includes(\"upload_final_contract\");",
    "if (!operationAllowed) throw new Error(",
    "const currentContent = documentContentCoordinatesFromValues( capability.documentContentRevision, capability.documentContentFingerprint );",
    "const documentContentMatches = sameDocumentContent( currentContent,",
    `${action.content} );`,
    "if (!documentContentMatches) { throw new Error("
  ];
  const associationFragments = actionId === "contract-final.associate"
    ? [
        "if (!Number.isInteger(capability.draftRevision) || Number(capability.draftRevision) < 1) { throw new Error(",
        "const sourceRevision = Number(capability.draftRevision);"
      ]
    : [];
  return containsOrderedSourceFragments(
    handlerSource,
    [...commonFragments, ...associationFragments, action.terminal]
  );
}

function finalContractWriteCausalProof({
  action,
  wrapper,
  context
}) {
  const expected = action.id === "contract-final.upload-file"
    ? {
        handler: "uploadContractFinalPrivateFileWithCapability",
        wrapperApi: `${WEB_SOURCE_ROOT}/api/core-flow-read.api.ts`,
        wrapperName: "uploadPrivateFile"
      }
    : action.id === "contract-final.associate"
      ? {
          handler: "associateContractFinalFileWithCapability",
          wrapperApi: `${WEB_SOURCE_ROOT}/api/core-flow-read.api.ts`,
          wrapperName: "uploadMutuallySignedContract"
        }
      : null;
  if (
    !expected ||
    action.sourceFile !==
      `${WEB_SOURCE_ROOT}/pages/contracts/ContractDetailPage.vue` ||
    action.trigger.handler !== expected.handler ||
    wrapper.apiFile !== expected.wrapperApi ||
    wrapper.name !== expected.wrapperName
  ) {
    return null;
  }
  const handlerBindings = topLevelScopeVariables(
    context.symbols.scopeManager,
    action.trigger.handler
  );
  const definition = handlerBindings.length === 1
    ? uniqueIndexedNode(
        context.symbols.definitionsByBinding,
        handlerBindings[0]
      )
    : null;
  const terminal = definition?.body?.type === "BlockStatement"
    ? definition.body.body?.at(-1)
    : null;
  const terminalCall = terminal?.type === "ReturnStatement"
    ? unwrapValueExpression(terminal.argument)
    : null;
  const handlerSource = definition?.range && isNonEmptyString(context.source)
    ? context.source.slice(definition.range[0], definition.range[1])
    : "";
  if (
    !definition ||
    !verifyFinalContractWriteGuardSequence({
      actionId: action.id,
      handlerSource,
      fileSource: context.source
    }) ||
    !finalContractDocumentGuardBindingProof({
      actionId: action.id,
      definition,
      symbols: context.symbols
    }) ||
    !callExpressionMatchesWrapper(
      terminalCall,
      wrapper,
      context.symbols
    ) ||
    (action.id === "contract-final.associate" &&
      !finalContractDraftRevisionGuardIsExact(
        definition,
        context.symbols
      )) ||
    (action.id === "contract-final.associate" &&
      !finalContractSourceRevisionReachesPayload(
        terminalCall,
        context.symbols
      )) ||
    directWrapperCallCount(
      definition,
      wrapper,
      context.symbols
    ) !== 1
  ) {
    return null;
  }
  return {
    verified: true,
    localCallChain: [
      action.trigger.handler,
      wrapper.name
    ]
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

const DIRECT_REGISTRATION_MODULE = `${WEB_SOURCE_ROOT}/pages/contracts/workbench/use-direct-contract-registration.ts`;
const DIRECT_REGISTRATION_API = `${WEB_SOURCE_ROOT}/api/core-flow-read.api.ts`;
const DIRECT_REGISTRATION_ACTIONS = new Set([
  "contract-direct-registration.lookup-original", "contract-direct-registration.resume-original", "contract-direct-registration.confirm"
]);

function directRegistrationEvent(expression) {
  const statement = expression?.type === "VOnExpression" && expression.body.length === 1
    ? expression.body[0]
    : null;
  const call = statement?.type === "ExpressionStatement" ? statement.expression : expression;
  if (call?.type !== "CallExpression" || call.optional ||
      staticMemberPath(call.callee) !== "directRegistration.query" || call.callee.optional) return null;
  if (call.arguments.length === 0) return { call, variant: "lookup-original" };
  if (call.arguments.length === 1 && call.arguments[0]?.type === "Literal" && call.arguments[0].value === true) {
    return { call, variant: "resume-original" };
  }
  return null;
}

function directRegistrationAstShape(node) {
  return JSON.stringify(node, (key, value) =>
    ["parent", "loc", "range", "raw", "comments", "tokens"].includes(key) ? undefined : value);
}

function directRegistrationMatches(node, statement) {
  return Boolean(node && directRegistrationAstShape(node) ===
    directRegistrationAstShape(parseSource("direct-registration-proof.ts", statement).body[0]));
}

function directRegistrationFactory(symbols) {
  const bindings = topLevelScopeVariables(symbols.scopeManager, "useDirectContractRegistration");
  if (bindings.length !== 1 || bindings[0].references.some(reference => reference.isWrite() && !reference.init)) return null;
  const definition = uniqueIndexedNode(symbols.definitionsByBinding, bindings[0]);
  return definition?.type === "FunctionDeclaration" && definition.body?.type === "BlockStatement" &&
    symbols.ast.body.some(node => node.type === "ExportNamedDeclaration" && node.declaration === definition) &&
    definition.params.length === 1 && definition.params[0]?.type === "Identifier"
    ? definition
    : null;
}

function directRegistrationCallable(factory, name, symbols, returned = false) {
  const matches = factory.body.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  if (matches.length !== 1) return null;
  const [definition] = matches;
  const binding = symbols.scopeBindings.get(definition.id);
  if (!binding || binding.references.some(reference => reference.isWrite())) return null;
  if (!returned) return { definition, binding };
  const result = factory.body.body.at(-1);
  const reference = result?.type === "ReturnStatement" && objectPropertyValue(result.argument, name);
  return reference?.type === "Identifier" && symbols.scopeBindings.get(reference) === binding &&
    result.argument.properties.every(property => property.type === "Property" && !property.computed)
    ? { definition, binding } : null;
}

function directRegistrationPageFactory(context) {
  const { symbols } = context;
  const bindings = topLevelScopeVariables(symbols.scopeManager, "directRegistration");
  if (bindings.length !== 1) return null;
  const [binding] = bindings;
  const invocation = uniqueIndexedNode(symbols.declarationsByBinding, binding);
  if (!callExpressionMatchesWrapper(invocation, {
    apiFile: DIRECT_REGISTRATION_MODULE, name: "useDirectContractRegistration"
  }, symbols) || invocation.arguments.length !== 1 ||
    binding.references.some(reference => reference.isWrite() && !reference.init)) return null;
  return { binding, options: invocation.arguments[0] };
}

function directRegistrationReadEffects(factory, read, keyBinding, getCall, page, symbols, pageSymbols) {
  const completed = objectPropertyValue(page.options, "completed");
  const completedStatement = completed?.body?.body?.[0];
  if (completed?.type !== "ArrowFunctionExpression" || completed.body?.body?.length !== 1 ||
      !directRegistrationMatches(completedStatement,
        'void router.replace({ path: `/contracts/${encodeURIComponent(id)}`, query: { versionId } });')) return false;
  const router = completedStatement.expression.argument.callee.object;
  const routerBinding = pageSymbols.scopeBindings.get(router);
  const routerSource = routerBinding && uniqueIndexedNode(pageSymbols.declarationsByBinding, routerBinding);
  const routerFactory = routerSource?.type === "CallExpression" && pageSymbols.scopeBindings.get(routerSource.callee);
  if (!routerFactory || !(routerFactory.defs ?? []).some(definition =>
    definition.type === "ImportBinding" && definition.parent?.source?.value === "vue-router" &&
    definition.node?.imported?.name === "useRouter")) return false;

  const allowedLocals = new Set(["cancelledKey", "reconcileCancelledUnderLock", "removeStored", "sameBody",
    "sameFiles", "sameStoredIntent", "validBody", "wasCancelled"]);
  const allowedMembers = new Set(["Array.isArray", "JSON.parse", "Number.isSafeInteger", "localStorage.getItem",
    "localStorage.setItem", "localStorage.removeItem"]);
  const body = factory.body;
  const seen = new Set();
  let valid = true;
  const bindingOf = node => symbols.scopeBindings.get(node);
  const check = definition => {
    if (!definition || seen.has(definition)) return;
    seen.add(definition);
    walkEstree(definition.body, node => {
      if (!valid || node === getCall) return;
      if (node.type === "TaggedTemplateExpression" || node.type === "ImportExpression") { valid = false; return; }
      if (node.type === "NewExpression") {
        if (!unshadowedRuntimeGlobal(node.callee, new Set(["Set"]), symbols.scopeBindings)) valid = false;
        return;
      }
      if (node.type !== "CallExpression") return;
      const { callee } = node;
      const path = staticMemberPath(callee);
      const root = referenceRootIdentifier(callee);
      if (allowedMembers.has(path) && unshadowedRuntimeGlobal(root, new Set([path.split(".")[0]]), symbols.scopeBindings)) return;
      if (callee.type === "Identifier") {
        if (unshadowedRuntimeGlobal(callee, new Set(["encodeURIComponent"]), symbols.scopeBindings)) return;
        const local = bindingOf(callee);
        if (!local || !allowedLocals.has(local.name) || local.references.some(ref => ref.isWrite() && !ref.init)) { valid = false; return; }
        check(uniqueIndexedNode(symbols.definitionsByBinding, local));
        if (!seen.has(uniqueIndexedNode(symbols.definitionsByBinding, local))) valid = false;
        return;
      }
      if (path === "input.completed" && bindingOf(root) === bindingOf(factory.params[0])) return;
      if (path === "locks.request") {
        const locked = bindingOf(root);
        const value = locked && uniqueIndexedNode(symbols.declarationsByBinding, locked);
        const expected = parseSource("direct-registration-proof.ts", "const locks = globalThis.navigator?.locks;").body[0].declarations[0].init;
        if (value && directRegistrationAstShape(value) === directRegistrationAstShape(expected) &&
            unshadowedRuntimeGlobal(referenceRootIdentifier(value), new Set(["globalThis"]), symbols.scopeBindings) &&
            !locked.references.some(ref => ref.isWrite() && !ref.init)) return;
      }
      if (path === "uuid.test" || path === "sha.test") {
        const value = uniqueIndexedNode(symbols.declarationsByBinding, bindingOf(root));
        if (value?.type === "Literal" && value.regex && !bindingOf(root).references.some(ref => ref.isWrite() && !ref.init)) return;
      }
      if (["left.every", "body.fileIds.every"].includes(path) &&
          ["sameFiles", "validBody"].includes(definition.id?.name) &&
          bindingOf(root) === bindingOf(definition.params[0]?.left ?? definition.params[0])) return;
      valid = false;
    });
  };
  const keyDefinition = keyBinding && uniqueIndexedNode(symbols.definitionsByBinding, keyBinding);
  if (!keyDefinition || !body.body.some(statement => statement.type === "VariableDeclaration" &&
      statement.declarations.some(declaration => declaration.init === keyDefinition))) return false;
  check(keyDefinition);
  check(read.definition);
  return valid;
}

const DIRECT_REGISTRATION_COORDINATES = `${WEB_SOURCE_ROOT}/pages/contracts/workbench/direct-pending-draft.ts`;
const DIRECT_REGISTRATION_WORKBENCH_READ = { apiFile: CONTRACT_WORKBENCH_API_PATH, name: "fetchContractDraftWorkbench" };
const DIRECT_REGISTRATION_POST = { apiFile: DIRECT_REGISTRATION_API, name: "archiveSignedContractV2" };
const DIRECT_REGISTRATION_GET = { apiFile: DIRECT_REGISTRATION_API, name: "fetchDirectSignedContractResult" };

function directRegistrationBlock(node, statements) {
  return directRegistrationMatches(node, `{${statements}}`);
}

function directRegistrationCalls(node, predicate) {
  const matches = [];
  walkEstree(node, candidate => {
    if (candidate.type === "CallExpression" && predicate(candidate)) matches.push(candidate);
  });
  return matches;
}

function directRegistrationLocalCall(node, target, symbols) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" &&
    symbols.scopeBindings.get(node.callee) === target?.binding;
}

function directRegistrationCoordinateProof(call, symbols, context) {
  if (!callExpressionMatchesWrapper(call, {
    apiFile: DIRECT_REGISTRATION_COORDINATES, name: "directRegistrationCoordinates"
  }, symbols)) return false;
  const ast = context.asts.get(DIRECT_REGISTRATION_COORDINATES);
  if (!ast) return false;
  const target = buildSymbolContext(ast, DIRECT_REGISTRATION_COORDINATES, context.sourceFileSet);
  const definition = name => {
    const [binding] = topLevelScopeVariables(target.scopeManager, name);
    return binding && uniqueIndexedNode(target.definitionsByBinding, binding);
  };
  const coordinates = definition("directRegistrationCoordinates");
  const state = definition("directWorkbenchState");
  const input = definition("directInputState");
  const signing = definition("directSigningMarker");
  if (!coordinates || !state || !input || !signing) return false;
  const guard = coordinates.body.body[0];
  const parse = coordinates.body.body[1];
  if (!directRegistrationMatches(guard,
    'if (!workbench || !actor || workbench.contract.ownerUserId !== actor || record(workbench.directPendingCapabilities)?.registrationEnabled !== true || !directSigningMarker(workbench.draft?.directSigningInput)) return null;') ||
    coordinates.body.body.length !== 2 || parse?.type !== "TryStatement" ||
    !directRegistrationBlock(parse.block, `
      if (directWorkbenchState(workbench) !== "complete") return null;
      const source = record(workbench.directPendingInput);
      const files = record(source?.Q)?.signedFiles;
      if (typeof source?.inputSha256 !== "string" || !Array.isArray(files) || files.length < 1 || files.length > 20 ||
        files.length !== workbench.attachments.length) return null;
      const fileIds: string[] = [];
      for (const [index, raw] of files.entries()) {
        const file = record(raw), attachment = workbench.attachments[index];
        if (typeof file?.fileId !== "string" || !archiveFileUuid.test(file.fileId) || fileIds.includes(file.fileId)
          || file.mimeType !== "application/pdf" || file.displayOrder !== index || attachment?.slotKey !== directOriginalSlot ||
          attachment.fileId !== file.fileId || attachment.displayOrder !== index) return null;
        fileIds.push(file.fileId);
      }
      return { contractId: workbench.contract.id, versionId: workbench.version.id, draftRevision: workbench.version.draftRevision,
        inputSha256: source.inputSha256, fileIds };
    `) || !directRegistrationBlock(parse.handler?.body, "return null;") || parse.finalizer) return false;
  const [stateCall] = directRegistrationCalls(parse.block, node => node.callee.name === "directWorkbenchState");
  const [inputCall] = directRegistrationCalls(state, node => node.callee.name === "directInputState");
  const [signingCall] = directRegistrationCalls(guard, node => node.callee.name === "directSigningMarker");
  const callsDefinition = (callNode, declared) =>
    target.scopeBindings.get(callNode?.callee) === target.scopeBindings.get(declared.id);
  return callsDefinition(stateCall, state) && callsDefinition(inputCall, input) && callsDefinition(signingCall, signing) &&
    state.body.body.some(statement => directRegistrationMatches(statement,
      "const state = directInputState(workbench.directPendingInput, contract.id, version.id, version.draftRevision, contract.projectId);")) &&
    input.body.body.some(statement => directRegistrationMatches(statement, `
      if (source.state !== "complete" || typeof source.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.inputSha256) ||
        q?.inputProtocolVersion !== 1 || kind?.kind !== "direct_signed" || kind.relationship !== "outside" ||
        locator?.contractId !== contractId || locator.contractVersionId !== versionId || locator.projectId !== projectId ||
        locator.draftRevision !== revision || locator.changeType !== "original" ||
        !Array.isArray(q.signedFiles) || q.signedFiles.length === 0) return null;
    `));
}

function directRegistrationExpression(node, source) {
  const expected = parseSource("direct-registration-proof.ts", `const witness = ${source};`).body[0].declarations[0].init;
  return Boolean(node && directRegistrationAstShape(node) === directRegistrationAstShape(expected));
}

function directRegistrationDeclared(symbols, name, moduleScope = false) {
  const binding = moduleScope ? topLevelScopeVariables(symbols.scopeManager, name)[0] : uniqueScopeVariable(symbols.scopeManager, name);
  return binding && !binding.references.some(reference => reference.isWrite() && !reference.init)
    ? uniqueIndexedNode(symbols.declarationsByBinding, binding)
    : null;
}

function directRegistrationInputBindings(page, symbols) {
  const expressions = {
    actor: "computed(() => authStore.user?.id)",
    routeContract: 'computed(() => contractId.value ?? "")',
    routeVersion: "computed(() => queryText(route.query.versionId).trim())",
    workbench: "computed(() => (authoritySnapshot.value?.workbench as ContractDraftWorkbenchReadModel | undefined) ?? null)",
    blocked: 'computed(() => Boolean(isDirty.value || pendingSaveResult.value || pendingLocalRecovery.value || saveState.value === "saving" || authoritySnapshot.value?.refreshRequired))'
  };
  if (page.options.type !== "ObjectExpression" || page.options.properties.length !== 7 ||
      page.options.properties.some(property => property.type !== "Property" || property.computed || property.method) ||
      !directRegistrationExpression(objectPropertyValue(page.options, "online"), "online")) return false;
  for (const [name, expression] of Object.entries(expressions)) {
    const value = objectPropertyValue(page.options, name);
    if (!directRegistrationExpression(value, expression) || !symbols.vueComputedImportBindings.has(symbols.scopeBindings.get(value.callee))) return false;
  }
  const auth = directRegistrationDeclared(symbols, "authStore", true);
  const route = directRegistrationDeclared(symbols, "route", true);
  const routeBinding = route?.type === "CallExpression" && symbols.scopeBindings.get(route.callee);
  const id = directRegistrationDeclared(symbols, "contractId", true);
  return Boolean(callExpressionMatchesWrapper(auth, {
    apiFile: `${WEB_SOURCE_ROOT}/auth/auth.store.ts`, name: "useAuthStore"
  }, symbols) && auth.arguments.length === 0 &&
    routeBinding?.defs.some(definition => definition.type === "ImportBinding" &&
      definition.parent?.source?.value === "vue-router" && definition.node?.imported?.name === "useRoute") &&
    route.arguments.length === 0 &&
    directRegistrationExpression(id, `computed(() => {
      const value = route.params.contractId;
      return typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
    })`) && symbols.vueComputedImportBindings.has(symbols.scopeBindings.get(id.callee)));
}

function directRegistrationContextBindings(factory, symbols) {
  const expressions = {
    context: "computed(() => directRegistrationCoordinates(input.workbench.value, input.actor.value))",
    version: 'computed(() => input.routeVersion.value || input.workbench.value?.version.id || "")',
    scope: "computed(() => JSON.stringify([input.actor.value, input.routeContract.value, version.value]))",
    available: "computed(() => context.value?.contractId === input.routeContract.value && context.value.versionId === version.value)"
  };
  for (const [name, expression] of Object.entries(expressions)) {
    const declaration = directRegistrationDeclared(symbols, name);
    if (!directRegistrationExpression(declaration, expression) ||
        !symbols.vueComputedImportBindings.has(symbols.scopeBindings.get(declaration.callee))) return false;
  }
  const ctx = directRegistrationDeclared(symbols, "context");
  if (!callExpressionMatchesWrapper(ctx.arguments[0].body, {
    apiFile: DIRECT_REGISTRATION_COORDINATES, name: "directRegistrationCoordinates"
  }, symbols)) return false;
  const watches = directRegistrationCalls(factory.body, node => node.callee.name === "watch");
  const watch = watches[0];
  const watchBinding = symbols.scopeBindings.get(watch?.callee);
  return watches.length === 1 && watch.arguments.length === 3 &&
    watchBinding?.defs.some(definition => definition.type === "ImportBinding" &&
      definition.parent?.source?.value === "vue" && definition.node?.imported?.name === "watch") &&
    directRegistrationExpression(watch.arguments[0], "scope") &&
    directRegistrationExpression(watch.arguments[2], "{ immediate: true, flush: \"sync\" }") &&
    directRegistrationMatches(watch.arguments[1]?.body?.body?.[0], "const started = ++epoch;");
}

function directRegistrationTransportProof(context) {
  const ast = context.asts.get(DIRECT_REGISTRATION_API);
  if (!ast) return false;
  const symbols = buildSymbolContext(ast, DIRECT_REGISTRATION_API, context.sourceFileSet);
  const definitions = ast.body.filter(node =>
    node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration" &&
    node.declaration.id?.name === DIRECT_REGISTRATION_POST.name);
  const command = definitions.length === 1 ? definitions[0].declaration : null;
  const post = topLevelScopeVariables(symbols.scopeManager, "postJson");
  const helper = post.length === 1 && uniqueIndexedNode(symbols.definitionsByBinding, post[0]);
  if (!directRegistrationBlock(command?.body, `
    const options = { retryUnauthorized: false, responseIsCurrent };
    return postJson<ContractSignedArchiveV2Result>(\`/contracts/\${encodeURIComponent(versionId)}/signed-archive\`, body, options);
  `) ||
    !directRegistrationBlock(helper?.body, `
      const response = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        ...options
      });
      await ensureOk(response, "提交失败");
      return response.json() as Promise<TResponse>;
    `)) return false;
  return symbols.scopeBindings.get(command.body.body[1].argument.callee) === post[0] &&
    callExpressionMatchesWrapper(helper.body.body[0].declarations[0].init.argument, {
      apiFile: `${WEB_SOURCE_ROOT}/api/api-fetch.ts`, name: "apiFetch"
    }, symbols);
}

function directRegistrationLockProof(factory, symbols) {
  const same = directRegistrationCallable(factory, "sameStoredIntent", symbols);
  const reconcile = directRegistrationCallable(factory, "reconcileCancelledUnderLock", symbols);
  const cancelled = directRegistrationDeclared(symbols, "wasCancelled");
  return Boolean(same && reconcile && cancelled &&
    directRegistrationBlock(same.definition.body, `
      const saved = raw ? JSON.parse(raw) as StoredIntent : null;
      return saved && saved.actor === intent.actor && saved.contractId === intent.contractId && saved.versionId === intent.versionId &&
        saved.requestSha256 === intent.requestSha256 && sameBody(saved.body, intent.body) ? saved : null;
    `) &&
    directRegistrationBlock(reconcile.definition.body, `
      const saved = sameStoredIntent(raw, intent);
      if ((saved && saved.phase !== "preparing") || !wasCancelled(intent, storageKey)) return false;
      if (saved) localStorage.removeItem(storageKey);
      return true;
    `) &&
    directRegistrationExpression(cancelled, `(intent: Intent, storageKey: string) =>
      localStorage.getItem(cancelledKey(intent, storageKey)) === intent.body.idempotencyKey`));
}

function directRegistrationWriteProof({ action, wrapper, candidate, context, page, factory, symbols, query, read, attempt }) {
  const confirmMode = action.id === "contract-direct-registration.confirm";
  const readbackMode = action.id === "contract-direct-registration.resume-original";
  if ((!confirmMode && !readbackMode) || action.capability.kind !== "server_boolean" ||
      action.capability.source !== "directPendingCapabilities.registrationEnabled" ||
      wrapper.name !== DIRECT_REGISTRATION_POST.name || wrapper.apiFile !== DIRECT_REGISTRATION_POST.apiFile ||
      normalizedMainRequests(wrapper).length !== 1 ||
      normalizedMainRequests(wrapper)[0].normalizedKey !== "POST /contracts/:param/signed-archive") return null;

  const send = directRegistrationCallable(factory, "send", symbols);
  const refresh = directRegistrationCallable(factory, "refreshCoordinates", symbols);
  const confirm = directRegistrationCallable(factory, "confirm", symbols, true);
  if (!directRegistrationInputBindings(page, context.symbols) ||
      !directRegistrationContextBindings(factory, symbols) ||
      !directRegistrationLockProof(factory, symbols) || !directRegistrationTransportProof(context)) return null;
  const sameCoordinates = topLevelScopeVariables(symbols.scopeManager, "sameCoordinates")[0];
  const sameFiles = topLevelScopeVariables(symbols.scopeManager, "sameFiles")[0];
  const order = sameFiles && uniqueIndexedNode(symbols.definitionsByBinding, sameFiles);
  const compare = sameCoordinates && uniqueIndexedNode(symbols.definitionsByBinding, sameCoordinates);
  const current = uniqueScopeVariable(symbols.scopeManager, "sendCurrent");
  const currentDefinition = current && uniqueIndexedNode(symbols.definitionsByBinding, current);
  if (!send || !refresh || !confirm || !compare || !currentDefinition || !order ||
      !directRegistrationBlock(order.body, "return left.length === right.length && left.every((id, index) => id === right[index]);") ||
      !directRegistrationCalls(compare, node => directRegistrationLocalCall(node, { binding: sameFiles }, symbols)).length ||
      !directRegistrationBlock(compare.body, `
        return !!left && left.contractId === right.contractId && left.versionId === right.versionId &&
          left.draftRevision === right.draftRevision && left.inputSha256 === right.inputSha256 && sameFiles(left.fileIds, right.fileIds);
      `) ||
      !directRegistrationMatches({ type: "ExpressionStatement", expression: currentDefinition.body },
        "started === epoch && available.value && input.online.value && !input.blocked.value && sameCoordinates(context.value, captured);")) return null;

  if (!directRegistrationBlock(refresh.definition.body, `
    const fresh = await fetchContractDraftWorkbench(captured.versionId, { retryUnauthorized: false, responseIsCurrent: () => started === epoch });
    return sendCurrent(captured, started) && sameCoordinates(directRegistrationCoordinates(fresh, input.actor.value), captured);
  `) || !directRegistrationBlock(send.definition.body, `
    const locks = globalThis.navigator?.locks;
    if (!locks) return;
    const admission = await locks.request(storageKey, () => {
      const saved = sameStoredIntent(localStorage.getItem(storageKey), intent);
      if (!saved || (!resume && saved.phase !== "preparing") || wasCancelled(intent, storageKey) || !sendCurrent(captured, started)) return;
      localStorage.setItem(storageKey, JSON.stringify({ ...intent, phase: "sent" }));
      const response = archiveSignedContractV2(intent.versionId, intent.body, () => started === epoch).catch(() => {});
      return { response };
    });
    if (!admission) return;
    await admission.response;
    if (started === epoch) await read(intent, started, storageKey);
  `)) return null;

  const [fresh] = directRegistrationCalls(refresh.definition, node => callExpressionMatchesWrapper(node, DIRECT_REGISTRATION_WORKBENCH_READ, symbols));
  const [coordinateCall] = directRegistrationCalls(refresh.definition, node => node.callee.name === "directRegistrationCoordinates");
  const postCalls = directRegistrationCalls(factory, node => callExpressionMatchesWrapper(node, DIRECT_REGISTRATION_POST, symbols));
  if (!fresh || !directRegistrationCoordinateProof(coordinateCall, symbols, context) || postCalls.length !== 1 ||
      !directRegistrationCalls(send.definition, node => node === postCalls[0]).length ||
      !directRegistrationCalls(send.definition, node => directRegistrationLocalCall(node, read, symbols)).length ||
      !directRegistrationCalls(send.definition, node => directRegistrationLocalCall(node, { binding: current }, symbols)).length ||
      !directRegistrationCalls(refresh.definition, node => directRegistrationLocalCall(node, { binding: sameCoordinates }, symbols)).length ||
      !directRegistrationCalls(refresh.definition, node => directRegistrationLocalCall(node, { binding: current }, symbols)).length ||
      !directRegistrationCalls(currentDefinition, node => directRegistrationLocalCall(node, { binding: sameCoordinates }, symbols)).length) return null;

  let caller;
  if (confirmMode) {
    const bindings = topLevelScopeVariables(context.symbols.scopeManager, "confirmDirectRegistration");
    const handler = bindings.length === 1 && uniqueIndexedNode(context.symbols.definitionsByBinding, bindings[0]);
    const pageCall = handler?.body?.body?.[1]?.expression?.argument;
    if (candidate.element !== "t-dialog" || candidate.event !== "confirm" || candidate.handler !== "confirmDirectRegistration" ||
        !directRegistrationBlock(handler?.body, "directRegistrationConfirmVisible.value = false; void directRegistration.confirm();") ||
        context.symbols.scopeBindings.get(referenceRootIdentifier(pageCall?.callee)) !== page.binding) return null;
    const body = confirm.definition.body.body;
    const first = body.at(-1);
    if (body.length !== 6 ||
        !directRegistrationMatches(body[0], "const captured = context.value, actor = input.actor.value, locks = globalThis.navigator?.locks;") ||
        !directRegistrationMatches(body[1], "if (!canConfirm.value || !captured || !actor || !locks) return;") ||
        !directRegistrationMatches(body[2], "const started = epoch, storageKey = key();") ||
        !directRegistrationMatches(body[3], "let claimed: Intent | undefined;") ||
        !directRegistrationMatches(body[4], "busy.value = true;") ||
        !directRegistrationBlock(first?.handler?.body, `
          if (started === epoch) message.value = pending.value ? "正式登记结果待核对，请查询原请求。" : "暂时无法核对正式登记资料。";
        `) ||
        !directRegistrationBlock(first?.finalizer, `
          if (claimed && await removeStored(claimed, storageKey, true).catch(() => false) && started === epoch) pending.value = null;
          if (started === epoch) busy.value = false;
        `) ||
        !directRegistrationBlock(first?.block, `
          const body: ContractDirectRegistrationPayload = { archiveProtocolVersion: 2, archiveSource: "direct_signed",
            idempotencyKey: crypto.randomUUID(), expectedDraftRevision: captured.draftRevision, expectedInputSha256: captured.inputSha256,
            fileIds: captured.fileIds, confirmedMatchingSignedDocument: true };
          const coordinates = { actor, contractId: captured.contractId, versionId: captured.versionId, body };
          const intent = { ...coordinates, requestSha256: await requestSha(coordinates) };
          const observedRaw = localStorage.getItem(storageKey);
          const observed = await validatedIntent(observedRaw);
          const claim = await locks.request(storageKey, () => {
            if (!sendCurrent(captured, started)) return;
            const raw = localStorage.getItem(storageKey);
            if (raw !== null && (raw !== observedRaw || observed?.phase !== "preparing" ||
              !reconcileCancelledUnderLock(observed, storageKey, raw))) return { raw };
            localStorage.setItem(storageKey, JSON.stringify({ ...intent, phase: "preparing" }));
            claimed = intent;
            return { raw: null };
          });
          if (!claim || started !== epoch) return;
          if (claim.raw !== null) {
            const saved = await validatedIntent(claim.raw);
            if (saved && started === epoch) keepPending(saved);
            return;
          }
          keepPending(intent);
          if (!await refreshCoordinates(captured, started)) {
            if (started === epoch) message.value = "合同资料或权限已变化，请刷新并核对保存的原件。";
            return;
          }
          await send(intent, captured, started, storageKey, false);
        `)) return null;
    caller = confirm.definition;
  } else {
    if (candidate.element !== "t-button" || candidate.event !== "click" ||
        directRegistrationEvent(candidate.expression)?.variant !== "resume-original") return null;
    const remaining = { ...attempt.block, body: attempt.block.body.slice(1) };
    if (!directRegistrationBlock(remaining, `
      const captured = { contractId: intent.contractId, versionId: intent.versionId,
        draftRevision: intent.body.expectedDraftRevision, inputSha256: intent.body.expectedInputSha256, fileIds: intent.body.fileIds };
      if (!sendCurrent(captured, started) || !await refreshCoordinates(captured, started)) {
        if (started === epoch) message.value = "当前资料或权限已变化，请继续查询原登记结果。";
        return;
      }
      await send(intent, captured, started, storageKey, true);
    `)) return null;
    caller = query.definition;
  }
  if (directRegistrationCalls(caller, node => directRegistrationLocalCall(node, send, symbols)).length !== 1 ||
      directRegistrationCalls(caller, node => directRegistrationLocalCall(node, refresh, symbols)).length !== 1) return null;
  return { verified: true, localCallChain: [action.trigger.handler, confirmMode ? "confirm" : "query(true)",
    "refreshCoordinates", "send", wrapper.name], capabilityWitness: true,
    capabilitySources: new Set([wrapperIdentity(DIRECT_REGISTRATION_WORKBENCH_READ.apiFile, DIRECT_REGISTRATION_WORKBENCH_READ.name)]) };
}

function directRegistrationCausalProof({ action, wrapper, candidate, context }) {
  if (!candidate || action.sourceFile !== CONTRACT_WORKBENCH_PAGE_PATH ||
      !DIRECT_REGISTRATION_ACTIONS.has(action.id)) return null;
  const lookup = action.id === "contract-direct-registration.lookup-original";
  const confirmed = action.id === "contract-direct-registration.confirm";
  const variant = lookup ? "lookup-original" : "resume-original";
  const event = directRegistrationEvent(candidate.expression);
  const page = directRegistrationPageFactory(context);
  const composableAst = context.asts.get(DIRECT_REGISTRATION_MODULE);
  if (!page || !composableAst || candidate.elementNode.variables?.length ||
      astAncestorChain(context.symbols.ast.templateBody, candidate.elementNode)?.some(node => node.variables?.length)) return null;
  if (confirmed) {
    if (candidate.expression?.type !== "Identifier" || candidate.expression.name !== "confirmDirectRegistration") return null;
  } else if (candidate.element !== "t-button" || candidate.event !== "click" || candidate.handler !== "directRegistration" ||
      action.trigger.variant !== variant || event?.variant !== variant) return null;
  if (lookup && (wrapper.apiFile !== DIRECT_REGISTRATION_GET.apiFile || wrapper.name !== DIRECT_REGISTRATION_GET.name ||
    normalizedMainRequests(wrapper).length !== 1 ||
    normalizedMainRequests(wrapper)[0].normalizedKey !== "GET /contracts/:param/archive-requests/:param")) return null;
  const symbols = buildSymbolContext(composableAst, DIRECT_REGISTRATION_MODULE, context.sourceFileSet);
  const factory = directRegistrationFactory(symbols);
  const query = factory && directRegistrationCallable(factory, "query", symbols, true);
  const read = factory && directRegistrationCallable(factory, "read", symbols);
  if (!query || !read) return null;

  const { definition } = query;
  const [mode] = definition.params;
  if (definition.params.length !== 1 || mode?.type !== "AssignmentPattern" ||
      mode.left.type !== "Identifier" || mode.left.name !== "continueOriginal" ||
      mode.right.type !== "Literal" || mode.right.value !== false) return null;
  const modeBinding = symbols.scopeBindings.get(mode.left);
  if (!modeBinding || modeBinding.references.some(reference => reference.isWrite() && !reference.init)) return null;

  const statements = definition.body.body;
  const [intent, permission, captured, busy, attempt] = statements;
  if (statements.length !== 5 ||
      !directRegistrationMatches(intent, "const intent = pending.value;") ||
      !directRegistrationMatches(permission, "if (!intent || !(continueOriginal ? canContinue.value : canQuery.value)) return;") ||
      !directRegistrationMatches(captured, "const started = epoch, storageKey = key();") ||
      !directRegistrationMatches(busy, "busy.value = true;") || attempt?.type !== "TryStatement") return null;
  const readGate = attempt.block.body[0];
  if (!directRegistrationMatches(readGate,
    'if (await read(intent, started, storageKey) !== "unknown" || !continueOriginal || started !== epoch) return;')) return null;
  const readCall = readGate.test.left.left.left.argument;
  if (symbols.scopeBindings.get(readCall?.callee) !== read.binding) return null;
  const readStatement = read.definition.body.body[0];
  if (!directRegistrationMatches(readStatement,
    "const result = await fetchDirectSignedContractResult(intent.versionId, intent.body.idempotencyKey, () => started === epoch);") ||
    !callExpressionMatchesWrapper(readStatement.declarations[0].init.argument, DIRECT_REGISTRATION_GET, symbols)) return null;
  if (!directRegistrationBlock(read.definition.body, `
    const result = await fetchDirectSignedContractResult(intent.versionId, intent.body.idempotencyKey, () => started === epoch);
    if (started !== epoch) return "stale";
    if (result?.status === "unknown") {
      const locks = globalThis.navigator?.locks;
      const cancelled = locks && await locks.request(storageKey, () =>
        reconcileCancelledUnderLock(intent, storageKey, localStorage.getItem(storageKey)));
      if (started !== epoch) return "stale";
      if (cancelled) {
        if (pending.value?.requestSha256 === intent.requestSha256) pending.value = null;
        message.value = "上次登记未发出。请核对已保存原件后重新确认。";
        return "cancelled";
      }
      message.value = "尚未查到正式登记结果。请继续查询，或核对资料后按原请求继续。";
      return "unknown";
    }
    if (result?.status !== "archived" || result.requestSha256 !== intent.requestSha256 || !sameBody(result.intent, intent.body) ||
      !uuid.test(result.result?.archiveId) || result.result?.contractVersionId !== intent.versionId ||
      result.result.status !== "effective" || !Array.isArray(result.result.fileIds) || !sameFiles(result.result.fileIds, intent.body.fileIds)) {
      message.value = "返回结果与原登记请求不一致，请保留原请求并查询。";
      return "mismatch";
    }
    await removeStored(intent, storageKey, false);
    if (started !== epoch) return "stale";
    pending.value = null;
    done.value = true;
    message.value = "正式登记完成，合同已生效。";
    input.completed(intent.contractId, intent.versionId);
    return "archived";
  `)) return null;
  const keyBinding = symbols.scopeBindings.get(captured.declarations[1].init.callee);
  const saved = directRegistrationCallable(factory, "validatedIntent", symbols);
  const kept = directRegistrationCallable(factory, "keepPending", symbols);
  const pending = symbols.scopeBindings.get(intent.declarations[0].init.object);
  if (!saved || !kept || !pending ||
      !directRegistrationExpression(uniqueIndexedNode(symbols.declarationsByBinding, keyBinding),
        '() => `jg:direct-contract-registration:v1:${encodeURIComponent(input.actor.value ?? "")}:${encodeURIComponent(version.value)}`') ||
      !directRegistrationBlock(saved.definition.body, `
        if (raw === null) return null;
        if (raw.length > 8192) throw new Error();
        const saved = JSON.parse(raw) as StoredIntent;
        if (saved.actor !== input.actor.value || saved.versionId !== version.value || saved.contractId !== input.routeContract.value ||
          (saved.phase !== undefined && saved.phase !== "preparing" && saved.phase !== "sent") ||
          !validBody(saved.body) || !sha.test(saved.requestSha256) || await requestSha(saved) !== saved.requestSha256) throw new Error();
        return saved;
      `) ||
      !directRegistrationBlock(kept.definition.body, `
        pending.value = intent;
        message.value = "正式登记结果待核对，请保留原请求并查询。";
      `)) return null;
  const setPending = kept.definition.body.body[0].expression;
  let substitutedIntent = false;
  walkEstree(factory.body, node => {
    if (node.type === "AssignmentExpression" && staticMemberPath(node.left) === "pending.value" &&
        symbols.scopeBindings.get(referenceRootIdentifier(node.left)) === pending &&
        node !== setPending && (node.operator !== "=" || node.right.type !== "Literal" || node.right.value !== null)) substitutedIntent = true;
  });
  if (substitutedIntent || !directRegistrationReadEffects(factory, read, keyBinding,
    readStatement.declarations[0].init.argument, page, symbols, context.symbols)) return null;
  // The non-continuation returns from the try before the write branch. Its
  // failure and cleanup code must stay display-only.
  for (const block of [attempt.handler?.body, attempt.finalizer]) {
    let callable = false;
    walkEstree(block, node => { if (["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node.type)) callable = true; });
    if (!block || callable) return null;
  }
  if (!lookup) return directRegistrationWriteProof({ action, wrapper, candidate, context, page, factory, symbols, query, read, attempt });
  return { verified: true, localCallChain: ["directRegistration.query()", "query", "read", wrapper.name] };
}

const CONTRACT_APPROVAL_PAGE = `${WEB_SOURCE_ROOT}/pages/contracts/ContractDetailPage.vue`;
const CONTRACT_APPROVAL_API = `${WEB_SOURCE_ROOT}/api/core-flow-read.api.ts`;
const CONTRACT_APPROVAL_READ = "fetchContractDetail";
const CONTRACT_APPROVAL_COORDINATES = [
  "expectedContractUpdatedAt", "expectedApprovalInstanceId", "expectedNodeIndex", "expectedApprovalUpdatedAt"
];
const CONTRACT_APPROVAL_ACTIONS = new Map([
  ["contract-approval.review-approve", { decision: "approve", handler: "confirmContractReviewApprove", dialog: "approvalApprove" }],
  ["contract-approval.review-reject", { decision: "reject", handler: "confirmContractReviewReject", dialog: "approvalReject" }],
  ["contract-approval.withdraw", { decision: null, handler: "confirmContractWithdrawal", dialog: "withdrawal" }]
]);

function approvalAstShape(node) {
  return JSON.stringify(node, (key, value) =>
    ["parent", "loc", "range", "raw", "comments", "tokens"].includes(key) ? undefined : value);
}

function approvalStatements(node, source) {
  const expected = parseSource("contract-approval-proof.ts", `{${source}}`).body[0];
  return Boolean(node && approvalAstShape(node) === approvalAstShape(expected));
}

function approvalStatement(node, source) {
  return approvalStatements({ type: "BlockStatement", body: [node] }, source);
}

function approvalExpression(node, source) {
  return approvalStatement({ type: "ExpressionStatement", expression: node }, `${source};`);
}

function approvalFunction(symbols, name) {
  const bindings = topLevelScopeVariables(symbols.scopeManager, name);
  if (bindings.length !== 1 || bindings[0].references.some(reference => reference.isWrite() && !reference.init)) return null;
  const definition = uniqueIndexedNode(symbols.definitionsByBinding, bindings[0]);
  return definition?.type === "FunctionDeclaration" ? { definition, binding: bindings[0] } : null;
}

function approvalCalls(node, predicate) {
  const matches = [];
  walkEstree(node, candidate => {
    if (candidate.type === "CallExpression" && predicate(candidate)) matches.push(candidate);
  });
  return matches;
}

function approvalBoundCall(node, name, symbols) {
  const target = approvalFunction(symbols, name);
  return Boolean(target && approvalCalls(node, candidate => candidate.callee.type === "Identifier" &&
    symbols.scopeBindings.get(candidate.callee) === target.binding).length === 1);
}

function approvalParamNames(definition, ...names) {
  return definition.params.length === names.length && definition.params.every((param, index) =>
    param.type === "Identifier" && param.name === names[index]);
}

function approvalFreezeObject(statement, symbols) {
  const call = statement?.type === "ReturnStatement" && statement.argument;
  return call?.type === "CallExpression" && staticMemberPath(call.callee) === "Object.freeze" &&
    unshadowedRuntimeGlobal(referenceRootIdentifier(call.callee), new Set(["Object"]), symbols.scopeBindings) &&
    call.arguments.length === 1 && call.arguments[0]?.type === "ObjectExpression" ? call.arguments[0] : null;
}

function approvalFields(object, mapping) {
  return Object.entries(mapping).every(([key, value]) => approvalExpression(objectPropertyValue(object, key), value));
}

function approvalNoUnexpectedReturns(definition) {
  const last = definition.body.body.at(-1);
  let safe = true;
  directCallableNodes(definition, node => {
    if (node.type === "ReturnStatement" && node !== last &&
        (node.argument?.type !== "Literal" || node.argument.value !== null)) safe = false;
  });
  return safe;
}

function approvalKnownCoordinateMap(fields, source) {
  return Object.fromEntries(fields.map(field => [field, `${source}.${field}`]));
}

function contractApprovalCaptureSource(spec, captured, current, owner, returnObject, context) {
  const { symbols } = context;
  const review = Boolean(spec.decision);
  const mode = review ? "Review" : "Withdrawal";
  const dialogName = review ? "currentContractReviewDialogContext" : "currentContractWithdrawalCoordinates";
  const dialog = approvalFunction(symbols, dialogName);
  const route = approvalFunction(symbols, "routeContractId");
  const ownerScope = approvalFunction(symbols, `contract${mode}OwnerScope`);
  if (!dialog || !route || !ownerScope ||
      !approvalStatements(route.definition.body, `
        const value = route.params.contractId;
        return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
      `) ||
      !approvalStatements(ownerScope.definition.body, `
        return [context.routeContractId, context.contractVersionId, context.expectedApprovalInstanceId].join("\\u0000");
      `) ||
      !approvalBoundCall(owner.definition, "routeContractId", symbols) ||
      !approvalBoundCall(owner.definition, `contract${mode}OwnerScope`, symbols) ||
      !approvalBoundCall(captured.definition, `contract${mode}OwnerScope`, symbols) ||
      !approvalBoundCall(dialog.definition, "routeContractId", symbols) ||
      (!review && !approvalBoundCall(current.definition, dialogName, symbols))) return false;
  const [routeBinding] = topLevelScopeVariables(symbols.scopeManager, "route");
  const routeSource = uniqueIndexedNode(symbols.declarationsByBinding, routeBinding);
  const routeImport = routeSource?.type === "CallExpression" && symbols.scopeBindings.get(routeSource.callee);
  if (!routeImport || routeSource.arguments.length !== 0 || !routeImport.defs.some(definition =>
    definition.type === "ImportBinding" && definition.parent?.source?.value === "vue-router" &&
    definition.node?.imported?.name === "useRoute")) return false;

  const constructed = approvalFreezeObject(dialog.definition.body.body.at(-1), symbols);
  const [capability, coordinates] = dialog.definition.body.body;
  const coordinateName = review ? "reviewApprovalContext" : "withdrawApprovalContext";
  if (!constructed || !approvalNoUnexpectedReturns(dialog.definition) ||
      !approvalStatement(capability, "const capability = contractReviewCapability.value;") ||
      !approvalStatement(coordinates, `const coordinates = capability?.${coordinateName};`) ||
      constructed.properties.some(property => property.type !== "Property" || property.computed) ||
      !approvalFields(constructed, {
        routeContractId: review ? "routeId" : "currentRouteContractId",
        contractId: "capability.id", contractVersionId: "capability.contractVersionId",
        ...approvalKnownCoordinateMap(CONTRACT_APPROVAL_COORDINATES, "coordinates")
      })) return false;
  const dialogBody = dialog.definition.body.body;
  const routeVariable = review ? "routeId" : "currentRouteContractId";
  const routeDeclaration = dialogBody[review ? 2 : 3];
  const gate = dialogBody[review ? 3 : 4];
  if (dialogBody.length !== (review ? 5 : 6) ||
      !approvalStatement(routeDeclaration, `const ${routeVariable} = routeContractId();`) ||
      gate?.type !== "IfStatement" || gate.alternate ||
      !approvalStatements(gate.consequent, "return null;")) return false;
  if (review) {
    if (!approvalExpression(gate.test, `!capability || !coordinates || !routeId || !contractReviewActionEnabled() ||
      capability.id !== routeId || capability.lifecycleUpdatedAt !== coordinates.expectedContractUpdatedAt`) ||
      !approvalBoundCall(dialog.definition, "contractReviewActionEnabled", symbols)) return false;
  } else if (!approvalStatement(dialogBody[2],
      'const enabledActions = capability?.availableActions.filter((action) => action.key === "withdraw_approval" && action.enabled) ?? [];') ||
      !approvalExpression(gate.test, `!capability || !coordinates || enabledActions.length !== 1 ||
        !contractWithdrawalActionEnabled() || !currentRouteContractId || capability.id !== currentRouteContractId ||
        !capability.contractVersionId || capability.lifecycleUpdatedAt !== coordinates.expectedContractUpdatedAt ||
        !coordinates.expectedContractUpdatedAt || !coordinates.expectedApprovalInstanceId ||
        !Number.isInteger(coordinates.expectedNodeIndex) || coordinates.expectedNodeIndex < 0 ||
        !coordinates.expectedApprovalUpdatedAt`) ||
      !approvalBoundCall(dialog.definition, "contractWithdrawalActionEnabled", symbols)) return false;
  const shared = {
    ownerScope: `contract${mode}OwnerScope(dialog)`, operationId: "operationId",
    routeGeneration: review ? "detailRequestId" : "dialog.routeGeneration",
    detailEpoch: review ? "detailRequestId" : "dialog.detailEpoch",
    dialogGeneration: review ? "contractReviewDialogGeneration" : "dialog.dialogGeneration"
  };
  if (!approvalFields(returnObject, {
    ...shared, ...(review ? { decision: "decision", requiresSelfReviewConfirmation: "requiresContractSelfReviewConfirmation.value" } : { action: '"withdraw"' })
  }) || returnObject.properties.some(property => property.type === "Property" && property.computed)) return false;
  const spreads = returnObject.properties.filter(property => property.type === "SpreadElement");
  if (!review) return spreads.length === 0;
  if (spreads.length !== 2 ||
      !approvalExpression(spreads[0].argument, "comment ? { comment } : {}") ||
      !approvalExpression(spreads[1].argument, "selfReviewPayload")) return false;
  // The self-review helper may contribute only comment/password fields, never coordinates.
  const helperPath = `${WEB_SOURCE_ROOT}/components/approval-self-review.config.ts`;
  const calls = approvalCalls(captured.definition, node => callExpressionMatchesWrapper(node, {
    apiFile: helperPath, name: "buildApprovalSelfReviewPayload"
  }, symbols));
  const ast = context.asts.get(helperPath);
  if (calls.length !== 1 || !ast || !approvalExpression(calls[0],
    "buildApprovalSelfReviewPayload(requiresContractSelfReviewConfirmation.value, { selfReviewReason: contractArchiveForm.selfReviewReason, confirmationPassword: password })")) return false;
  const helperSymbols = buildSymbolContext(ast, helperPath, context.sourceFileSet);
  const helper = approvalFunction(helperSymbols, "buildApprovalSelfReviewPayload");
  if (!helper) return false;
  const returns = [];
  directCallableNodes(helper.definition, node => { if (node.type === "ReturnStatement") returns.push(node); });
  return returns.length === 2 && approvalExpression(returns[0].argument, "({})") &&
    approvalExpression(returns[1].argument, "({ selfReviewReason, confirmationPassword: form.confirmationPassword })");
}

function contractApprovalPageEvidence(spec, candidate, context) {
  const { symbols } = context;
  const mode = spec.decision ? "Review" : "Withdrawal";
  const captured = approvalFunction(symbols, `captureContract${mode}Context`);
  const current = approvalFunction(symbols, `contract${mode}SubmissionIsCurrent`);
  const owner = approvalFunction(symbols, `ownsContract${mode}Submission`);
  const handler = approvalFunction(symbols, spec.handler);
  if (!captured || !current || !owner || !handler ||
      candidate.element !== "sensitive-action-dialog" || candidate.event !== "confirm" ||
      candidate.expression?.type !== "Identifier" || candidate.expression.name !== spec.handler ||
      candidate.elementNode.variables?.length ||
      astAncestorChain(symbols.ast.templateBody, candidate.elementNode)?.some(node => node.variables?.length)) return false;
  const dialogImports = topLevelScopeVariables(symbols.scopeManager, "SensitiveActionDialog");
  const dialogImport = dialogImports.length === 1 && symbols.importsByBinding.get(dialogImports[0]);
  if (dialogImport?.kind !== "default" ||
      dialogImport.sourceFile !== `${WEB_SOURCE_ROOT}/components/SensitiveActionDialog.vue`) return false;
  const capture = spec.decision
    ? `() => captureContractReviewContext("${spec.decision}", values.password)`
    : "captureContractWithdrawalContext";
  const modeProperty = spec.decision ? `decision: "${spec.decision}"` : 'action: "withdraw"';
  const command = `executeContractApproval${mode}Action`;
  const prepare = `prepareContractApproval${mode}Action`;
  if (!approvalParamNames(handler.definition, ...(spec.decision ? ["values"] : [])) ||
      !approvalStatements(handler.definition.body, `
        if (contract${mode}InFlight) return contract${mode}InFlight;
        const execution = ${command}({
          ${modeProperty},
          capture: ${capture},
          preflight: (context) => ${prepare}({
            ...context,
            isCurrent: contract${mode}SubmissionIsCurrent
          }),
          current: contract${mode}SubmissionIsCurrent,
          stale: staleContract${mode},
          complete: completeContract${mode},
          fail: failContract${mode},
          finish: finishContract${mode}
        }).then((result) => result.status === "completed");
        contract${mode}InFlight = execution;
        void execution.finally(() => {
          if (contract${mode}InFlight === execution) { contract${mode}InFlight = null; }
        });
        return execution;
      `)) return false;
  const [execute] = approvalCalls(handler.definition, node => callExpressionMatchesWrapper(node, {
    apiFile: CONTRACT_APPROVAL_API, name: command
  }, symbols));
  const options = execute?.arguments[0];
  const preflight = objectPropertyValue(options, "preflight");
  const captureNode = objectPropertyValue(options, "capture");
  if (!options || !callExpressionMatchesWrapper(preflight?.body, { apiFile: CONTRACT_APPROVAL_API, name: prepare }, symbols) ||
      symbols.scopeBindings.get(objectPropertyValue(options, "current")) !== current.binding ||
      symbols.scopeBindings.get(objectPropertyValue(preflight.body.arguments[0], "isCurrent")) !== current.binding ||
      (spec.decision ? !approvalBoundCall(captureNode, "captureContractReviewContext", symbols)
        : symbols.scopeBindings.get(captureNode) !== captured.binding)) return false;

  if (!approvalParamNames(current.definition, "context") || !approvalParamNames(owner.definition, "context") ||
      !approvalStatements(owner.definition.body, `
        return context.operationId === contract${mode}SubmissionToken &&
          context.ownerScope === contract${mode}OwnerScope(context) &&
          routeContractId() === context.routeContractId;
      `) || !approvalBoundCall(current.definition, `ownsContract${mode}Submission`, symbols)) return false;
  const currentChecks = `
    ownsContract${mode}Submission(context) &&
      context.routeGeneration === detailRequestId &&
      context.detailEpoch === detailRequestId &&
      context.dialogGeneration === contract${mode}DialogGeneration &&
      sensitiveAction.visible &&
  `;
  if (spec.decision) {
    if (!approvalStatements(current.definition.body, `
      const expectedKind = context.decision === "approve" ? "approvalApprove" : "approvalReject";
      return (${currentChecks} sensitiveAction.kind === expectedKind);
    `)) return false;
  } else if (!approvalStatements(current.definition.body, `
      const current = currentContractWithdrawalCoordinates();
      return (${currentChecks} sensitiveAction.kind === "withdrawal" &&
        Boolean(current) &&
        current?.contractId === context.contractId &&
        current.contractVersionId === context.contractVersionId &&
        ${CONTRACT_APPROVAL_COORDINATES.map(field => `current.${field} === context.${field}`).join(" && ")});
    `)) return false;

  const fields = ["routeContractId", "contractId", "contractVersionId", ...CONTRACT_APPROVAL_COORDINATES];
  const result = captured.definition.body.body.at(-1);
  const returnObject = spec.decision
    ? result?.type === "ReturnStatement" && result.argument
    : approvalFreezeObject(result, symbols);
  if (!approvalNoUnexpectedReturns(captured.definition) || !returnObject ||
      !approvalFields(returnObject, Object.fromEntries(fields.map(field => [field, `dialog.${field}`])))) return false;
  const [dialog, fresh, guard] = captured.definition.body.body;
  if (!approvalStatement(dialog, `const dialog = contract${mode}DialogContext;`) || guard?.type !== "IfStatement" ||
      !approvalStatements(guard.consequent, "return null;")) return false;
  if (spec.decision) {
    if (!approvalStatement(fresh, "const freshDialog = currentContractReviewDialogContext(decision);") ||
        !approvalExpression(guard.test, `!dialog || !freshDialog || dialog.decision !== decision ||
          ${fields.slice(1).map(field => `dialog.${field} !== freshDialog.${field}`).join(" || ")} ||
          !sameContractReviewOwnerRisk(dialog.ownerContractRisk, freshDialog.ownerContractRisk) ||
          archiveActionBusy.value || contractReviewResultUnknown`) ||
        !approvalBoundCall(captured.definition, "currentContractReviewDialogContext", symbols)) return false;
  } else {
    const compare = approvalFunction(symbols, "sameContractWithdrawalCoordinates");
    if (!compare || !approvalParamNames(compare.definition, "expected", "actual") ||
        !approvalStatements(compare.definition.body, `return ${[
          "routeGeneration", "detailEpoch", "dialogGeneration", ...fields
        ].map(field => `expected.${field} === actual.${field}`).join(" && ")};`) ||
        !approvalStatement(fresh, "const fresh = currentContractWithdrawalCoordinates();") ||
        !approvalExpression(guard.test, `!dialog || !fresh || !sameContractWithdrawalCoordinates(dialog, fresh) ||
          archiveActionBusy.value || contractWithdrawalResultUnknown || !sensitiveAction.visible ||
          sensitiveAction.kind !== "withdrawal"`) ||
        !approvalBoundCall(captured.definition, "sameContractWithdrawalCoordinates", symbols) ||
        !approvalBoundCall(captured.definition, "currentContractWithdrawalCoordinates", symbols)) return false;
  }
  return contractApprovalCaptureSource(spec, captured, current, owner, returnObject, context);
}

function contractApprovalFrozenCoordinates(normalizer, comparator, review, symbols) {
  const plainFields = ["ownerScope", "routeContractId", "contractId", "contractVersionId",
    "expectedContractUpdatedAt", "expectedApprovalInstanceId", "expectedApprovalUpdatedAt"];
  const numericFields = ["routeGeneration", "detailEpoch", "dialogGeneration", "operationId", "expectedNodeIndex"];
  const comparisonFields = [...numericFields.slice(0, 4), ...plainFields.slice(1, 6),
    "expectedNodeIndex", "expectedApprovalUpdatedAt"];
  const freeze = approvalFreezeObject(normalizer.definition.body.body.at(-1), symbols);
  if (!approvalParamNames(normalizer.definition, "input") || !freeze || !approvalNoUnexpectedReturns(normalizer.definition) ||
      !approvalParamNames(comparator.definition, "expected", "actual")) return false;
  for (const field of plainFields) {
    if (!normalizer.definition.body.body.some(statement => approvalStatement(statement, `const ${field} = input.${field}.trim();`))) return false;
  }
  if (!approvalFields(freeze, {
    ...Object.fromEntries(plainFields.map(field => [field, field])),
    ...Object.fromEntries(numericFields.map(field => [field, `input.${field}`])),
    ...(review ? { decision: "input.decision" } : { action: '"withdraw"' })
  }) || freeze.properties.some(property => property.type === "Property" && property.computed)) return false;
  const directProperties = freeze.properties.filter(property => property.type === "Property");
  if (new Set(directProperties.map(propertyKey)).size !== directProperties.length) return false;
  const expectedSpreads = review ? [
    "...(comment ? { comment } : {})",
    "...(selfReviewReason ? { selfReviewReason } : {})",
    "...(confirmationPassword ? { confirmationPassword } : {})"
  ] : [];
  const spreads = freeze.properties.filter(property => property.type === "SpreadElement");
  if (spreads.length !== expectedSpreads.length ||
      spreads.some((property, index) => !approvalExpression({ type: "ObjectExpression", properties: [property] }, `({ ${expectedSpreads[index]} })`))) return false;
  let hasWrite = false;
  directCallableNodes(normalizer.definition, node => {
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") hasWrite = true;
  });
  if (hasWrite) return false;
  const fields = [...(review ? [] : ["action"]), "ownerScope", ...comparisonFields,
    ...(review ? ["decision", "comment", "requiresSelfReviewConfirmation", "selfReviewReason", "confirmationPassword", "ownerContractRiskConfirmed"] : [])];
  return approvalStatements(comparator.definition.body, `
    return ${fields.map(field => `expected.${field} === actual.${field}`).join(" && ")}
      ${review ? "&& sameContractApprovalOwnerRisk(expected.ownerContractRisk, actual.ownerContractRisk)" : ""};
  `) && (!review || approvalBoundCall(comparator.definition, "sameContractApprovalOwnerRisk", symbols));
}

function contractApprovalFreshEvidence(prepare, assertion, review, mode, symbols) {
  const name = `assertContractApproval${mode}Preflight`;
  const available = `enabled${mode}Actions`;
  const capability = review ? "review_approval" : "withdraw_approval";
  const coordinateMember = review ? "reviewApprovalContext" : "withdrawApprovalContext";
  return approvalParamNames(prepare.definition, "input") &&
    approvalStatements(prepare.definition.body, `
      const context = normalizeContractApproval${mode}Action(input);
      if (!input.isCurrent(context)) { return { status: "stale", context }; }
      const preflight = await fetchContractDetail(context.routeContractId) as ContractApproval${mode}PreflightReadModel;
      if (!input.isCurrent(context)) { return { status: "stale", context }; }
      ${name}(context, preflight);
      if (!input.isCurrent(context)) { return { status: "stale", context }; }
      return { status: "ready", context, preflight };
    `) &&
    approvalBoundCall(prepare.definition, "fetchContractDetail", symbols) &&
    approvalBoundCall(prepare.definition, name, symbols) &&
    approvalBoundCall(prepare.definition, `normalizeContractApproval${mode}Action`, symbols) &&
    approvalParamNames(assertion.definition, "context", "preflight") &&
    approvalStatements(assertion.definition.body, `
      const ${available} = preflight.availableActions.filter((action) => action.key === "${capability}" && action.enabled);
      const coordinates = preflight.${coordinateMember};
      if (preflight.id !== context.contractId || preflight.contractVersionId !== context.contractVersionId ||
          preflight.lifecycleUpdatedAt !== context.expectedContractUpdatedAt || ${available}.length !== 1 ||
          ${review ? '(enabledReviewActions[0]?.requiresSelfReviewConfirmation === true) !== context.requiresSelfReviewConfirmation ||' : ""}
          ${CONTRACT_APPROVAL_COORDINATES.map((field, index) =>
            `coordinates${index === 0 ? "?" : ""}.${field} !== context.${field}`).join(" || ")}
          ${review ? "|| !sameContractApprovalOwnerRisk(context.ownerContractRisk, preflight.ownerContractRisk ?? null)" : ""}) {
        throw new Error("${review ? "合同审批资格、风险或审批坐标已变化，请重新读取当前合同" : "合同审批撤回资格或审批坐标已变化，请重新读取当前合同"}");
      }
    `) && (!review || approvalBoundCall(assertion.definition, "sameContractApprovalOwnerRisk", symbols));
}

function contractApprovalCommandEvidence(command, review, mode, symbols) {
  const payloadName = review ? "contractApprovalReviewActionPayload" : "contractApprovalWithdrawalPayload";
  const payload = approvalFunction(symbols, payloadName);
  if (!payload || !approvalParamNames(command.definition, "input") ||
      !approvalParamNames(payload.definition, "context", ...(review ? ["decision"] : [])) ||
      !approvalNoUnexpectedReturns(payload.definition)) return false;
  const suffix = review ? "approval" : "approval-withdrawal";
  const currentAfter = review ? `
      await input.stale(activeContext);
      return { status: "stale", context: activeContext };
    ` : `
      throw new ContractApprovalWithdrawalResultUnknownError(new Error("合同审批撤回请求已发出，但提交后的页面归属已变化"));
    `;
  const post = review ? "payload" : "contractApprovalWithdrawalPayload(activeContext)";
  if (!approvalStatements(command.definition.body, `
    const capturedContext = input.capture(input.${review ? "decision" : "action"});
    if (!capturedContext) return { status: "not_started" };
    let activeContext = capturedContext;
    try {
      const frozenCapturedContext = normalizeContractApproval${mode}Action(capturedContext);
      activeContext = frozenCapturedContext;
      const prepared = await input.preflight(frozenCapturedContext);
      activeContext = prepared.context;
      if (prepared.status !== "ready" ||
          !sameContractApproval${mode}Context(frozenCapturedContext, prepared.context) ||
          !input.current(frozenCapturedContext, prepared)) {
        await input.stale(frozenCapturedContext);
        return { status: "stale", context: frozenCapturedContext };
      }
      ${review ? "const payload = contractApprovalReviewActionPayload(activeContext, input.decision);" : ""}
      let response: unknown;
      try {
        response = await postJson<unknown>(\`/contracts/\${encodeURIComponent(activeContext.contractVersionId)}/${suffix}\`, ${post});
      } catch (error) {
        if (error instanceof CoreFlowApiError && error.status < 500) { throw error; }
        throw new ContractApproval${mode}ResultUnknownError(error);
      }
      if (!input.current(frozenCapturedContext, prepared)) { ${currentAfter} }
      await input.complete(activeContext, response);
      return { status: "completed", context: activeContext, response };
    } catch (error) {
      await input.fail(activeContext, error);
      return { status: "failed", context: activeContext, error };
    } finally {
      input.finish(activeContext);
    }
  `)) return false;
  const coords = CONTRACT_APPROVAL_COORDINATES.map(field => `${field}: context.${field}`).join(", ");
  const reviewFields = `
    decision,
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresSelfReviewConfirmation ? {
      selfReviewReason: context.selfReviewReason, confirmationPassword: context.confirmationPassword
    } : {}),
    ...(decision === "approve" && context.ownerContractRisk?.requiresExplicitConfirmation ? {
      ownerContractRiskConfirmed: true, expectedOwnerContractRisk: context.ownerContractRisk
    } : {}),
  `;
  return approvalStatement(payload.definition.body.body.at(-1), `return { ${review ? reviewFields : ""} ${coords} };`) &&
    [`normalizeContractApproval${mode}Action`, `sameContractApproval${mode}Context`, payloadName, "postJson"]
      .every(name => approvalBoundCall(command.definition, name, symbols));
}

function contractApprovalPageCausalProof({ action, wrapper, candidate, context, nestRouteIndex }) {
  const spec = CONTRACT_APPROVAL_ACTIONS.get(action.id);
  if (!spec || !candidate || action.sourceFile !== CONTRACT_APPROVAL_PAGE ||
      action.trigger.handler !== spec.handler || action.capability.kind !== "available_action_string" ||
      action.capability.source !== "contractLifecycleAvailableActionKeys" ||
      action.capability.key !== (spec.decision ? "review_approval" : "withdraw_approval") ||
      action.wrappers.length !== 1 || action.wrappers[0].variant !== (spec.decision ?? undefined) ||
      action.routePaths.length !== 1 || action.routePaths[0] !== "/合同管理/:contractId") return null;
  const mode = spec.decision ? "Review" : "Withdrawal";
  const commandName = `executeContractApproval${mode}Action`;
  const prepareName = `prepareContractApproval${mode}Action`;
  const request = spec.decision ? "POST /contracts/:param/approval" : "POST /contracts/:param/approval-withdrawal";
  const writeRequests = normalizedMainRequests(wrapper);
  const sourceIdentity = wrapperIdentity(CONTRACT_APPROVAL_API, CONTRACT_APPROVAL_READ);
  const read = context.wrapperIndex.get(sourceIdentity);
  const readRequests = normalizedMainRequests(read);
  const readRoute = nestRouteIndex.get("GET /contracts/:param");
  const writeRoute = nestRouteIndex.get(request);
  if (readRoute?.authentication !== "authenticated" || readRoute.isPublic !== false ||
      writeRoute?.authentication !== "authenticated" || writeRoute.isPublic !== false ||
      wrapper.apiFile !== CONTRACT_APPROVAL_API || wrapper.name !== commandName ||
      writeRequests.length !== 1 || writeRequests[0].normalizedKey !== request ||
      read?.returnProvenance !== "transparent_main_response" || readRequests.length !== 1 ||
      readRequests[0].normalizedKey !== "GET /contracts/:param" ||
      !contractApprovalPageEvidence(spec, candidate, context)) return null;
  const ast = context.asts.get(CONTRACT_APPROVAL_API);
  if (!ast) return null;
  const symbols = buildSymbolContext(ast, CONTRACT_APPROVAL_API, context.sourceFileSet);
  const command = approvalFunction(symbols, commandName);
  const prepare = approvalFunction(symbols, prepareName);
  const assertion = approvalFunction(symbols, `assertContractApproval${mode}Preflight`);
  const normalizer = approvalFunction(symbols, `normalizeContractApproval${mode}Action`);
  const comparator = approvalFunction(symbols, `sameContractApproval${mode}Context`);
  const reader = approvalFunction(symbols, CONTRACT_APPROVAL_READ);
  const review = Boolean(spec.decision);
  if (!command || !prepare || !assertion || !normalizer || !comparator || !reader ||
      !approvalStatements(reader.definition.body, `
        const query = options?.versionId ? \`?versionId=\${encodeURIComponent(options.versionId)}\` : "";
        return readJson<ContractDetailReadModel>(\`/contracts/\${encodeURIComponent(contractId)}\${query}\`,
          { "x-contract-numeric-protocol": "2" });
      `) || !approvalBoundCall(reader.definition, "readJson", symbols) ||
      !contractApprovalFrozenCoordinates(normalizer, comparator, review, symbols) ||
      !contractApprovalFreshEvidence(prepare, assertion, review, mode, symbols) ||
      !contractApprovalCommandEvidence(command, review, mode, symbols)) return null;
  return {
    verified: true,
    localCallChain: [spec.handler, prepareName, CONTRACT_APPROVAL_READ, commandName],
    capabilityWitness: true,
    capabilitySources: new Set([sourceIdentity])
  };
}

const SIGNING_MATERIAL_CHANGE_ACTION = "contract.signing-material-change";
const SIGNING_MATERIAL_CHANGE_COMMAND = "executeContractSigningMaterialChange";
const SIGNING_MATERIAL_CHANGE_HANDLER = "confirmSigningMaterialChange";
const SIGNING_MATERIAL_CHANGE_KEY = "report_signing_material_change";

function requiresContractDetailCausalProof(action) {
  return CONTRACT_APPROVAL_ACTIONS.has(action.id) || action.id === SIGNING_MATERIAL_CHANGE_ACTION;
}

function signingMaterialChangePageEvidence(candidate, { symbols }) {
  const handler = approvalFunction(symbols, SIGNING_MATERIAL_CHANGE_HANDLER);
  const capture = approvalFunction(symbols, "captureSigningMaterialChangeSubmission");
  const captureDialog = approvalFunction(symbols, "captureSigningMaterialChangeContext");
  const open = approvalFunction(symbols, "requestSigningMaterialChange");
  const current = approvalFunction(symbols, "signingMaterialChangeSubmissionIsCurrent");
  const owner = approvalFunction(symbols, "ownsSigningMaterialChangeSubmission");
  const route = approvalFunction(symbols, "routeContractId");
  const enabled = approvalFunction(symbols, "signingMaterialChangeActionEnabled");
  if (!handler || !capture || !captureDialog || !open || !current || !owner || !route || !enabled ||
      candidate.expression?.type !== "Identifier" || candidate.expression.name !== SIGNING_MATERIAL_CHANGE_HANDLER ||
      candidate.elementNode.variables?.length ||
      astAncestorChain(symbols.ast.templateBody, candidate.elementNode)?.some(node => node.variables?.length)) return false;
  const dialogImports = topLevelScopeVariables(symbols.scopeManager, "SensitiveActionDialog");
  const dialogImport = dialogImports.length === 1 && symbols.importsByBinding.get(dialogImports[0]);
  const guard = directiveExpression(elementDirective(candidate.elementNode, "if"));
  const model = directiveExpression(elementDirective(candidate.elementNode, "model"));
  if (dialogImport?.kind !== "default" ||
      dialogImport.sourceFile !== `${WEB_SOURCE_ROOT}/components/SensitiveActionDialog.vue` ||
      !approvalExpression(guard, "signingMaterialChangeActionEnabled()") ||
      !approvalExpression(model, "signingMaterialChangeDialogVisible")) return false;
  const openButtons = [];
  walkEstree(symbols.ast.templateBody, node => {
    if (node.type !== "VElement") return;
    const click = directiveExpression(elementDirective(node, "on", "click"));
    if (click?.type === "Identifier" && click.name === "requestSigningMaterialChange") openButtons.push(node);
  });
  if (openButtons.length !== 1 || openButtons[0].name !== "t-button" ||
      !approvalExpression(directiveExpression(elementDirective(openButtons[0], "if")), "signingMaterialChangeActionEnabled()") ||
      astAncestorChain(symbols.ast.templateBody, openButtons[0])?.some(node => node.variables?.length)) return false;

  if (!approvalParamNames(handler.definition, "values") ||
      !approvalStatements(handler.definition.body, `
        return executeContractSigningMaterialChange({
          capture: () => captureSigningMaterialChangeSubmission(values),
          current: signingMaterialChangeSubmissionIsCurrent,
          stale: () => undefined,
          reason: (context) => context.reason,
          complete: completeSigningMaterialChange,
          fail: failSigningMaterialChange,
          finish: finishSigningMaterialChange
        });
      `)) return false;
  const call = handler.definition.body.body[0].argument;
  if (!callExpressionMatchesWrapper(call, { apiFile: CONTRACT_APPROVAL_API, name: SIGNING_MATERIAL_CHANGE_COMMAND }, symbols) ||
      symbols.scopeBindings.get(objectPropertyValue(call.arguments[0], "current")) !== current.binding ||
      !approvalBoundCall(objectPropertyValue(call.arguments[0], "capture"), "captureSigningMaterialChangeSubmission", symbols) ||
      !approvalBoundCall(current.definition, "ownsSigningMaterialChangeSubmission", symbols) ||
      !approvalBoundCall(owner.definition, "routeContractId", symbols) ||
      !approvalBoundCall(captureDialog.definition, "routeContractId", symbols) ||
      !approvalBoundCall(captureDialog.definition, "signingMaterialChangeActionEnabled", symbols) ||
      !approvalBoundCall(open.definition, "captureSigningMaterialChangeContext", symbols)) return false;
  const [routeBinding] = topLevelScopeVariables(symbols.scopeManager, "route");
  const routeSource = uniqueIndexedNode(symbols.declarationsByBinding, routeBinding);
  const routeImport = routeSource?.type === "CallExpression" && symbols.scopeBindings.get(routeSource.callee);
  return Boolean(routeImport && routeSource.arguments.length === 0 && routeImport.defs.some(definition =>
    definition.type === "ImportBinding" && definition.parent?.source?.value === "vue-router" &&
    definition.node?.imported?.name === "useRoute") &&
    approvalStatements(route.definition.body, `
      const value = route.params.contractId;
      return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
    `) &&
    approvalStatements(enabled.definition.body, `
      if (contractDetail.value?.v2Lifecycle || v2LifecycleLocked.value) return false;
      return Boolean(contractLifecycleAvailableActionKeys.value?.includes("report_signing_material_change")) &&
        Boolean(contractReviewCapability.value?.availableActions.some(
          (action) => action.key === "report_signing_material_change" && action.enabled
        ));
    `) &&
    approvalStatements(captureDialog.definition.body, `
      const detail = contractReviewCapability.value;
      const coordinates = detail?.signingMaterialChangeContext;
      const sealTask = detail?.sealTask;
      const routeId = routeContractId();
      if (!detail || !coordinates || !sealTask || !routeId || !signingMaterialChangeActionEnabled() ||
          detail.draftRevision !== coordinates.expectedRevision || sealTask.id !== coordinates.expectedSealTaskId) {
        return null;
      }
      return {
        routeContractId: routeId, contractId: detail.id, contractVersionId: detail.contractVersionId, ...coordinates
      } satisfies ContractSigningMaterialChangeActionContext;
    `) &&
    approvalStatements(open.definition.body, `
      const context = captureSigningMaterialChangeContext();
      if (!context) {
        setActionError(new Error("合同签署状态已变化"), "无法申报签署内容实质变化，请刷新后重试。");
        return;
      }
      signingMaterialChangeSubmissionToken += 1;
      signingMaterialChangeDialogContext.value = context;
      signingMaterialChangeDialogError.value = "";
      signingMaterialChangeDialogVisible.value = true;
    `) &&
    approvalParamNames(capture.definition, "values") &&
    approvalStatements(capture.definition.body, `
      const owner = signingMaterialChangeDialogContext.value;
      const capability = contractReviewCapability.value;
      const coordinates = capability?.signingMaterialChangeContext;
      const actionCount = capability?.availableActions.filter(
        (action) => action.key === "report_signing_material_change" && action.enabled
      ).length ?? 0;
      if (!owner || !capability || !coordinates || actionCount !== 1 ||
          capability.id !== owner.contractId || capability.contractVersionId !== owner.contractVersionId ||
          coordinates.expectedRevision !== owner.expectedRevision || coordinates.expectedSealTaskId !== owner.expectedSealTaskId ||
          coordinates.expectedStatus !== owner.expectedStatus) {
        signingMaterialChangeDialogError.value = "合同签署状态已变化，请关闭并刷新详情后重试。";
        return null;
      }
      if (archiveActionBusy.value) {
        signingMaterialChangeDialogError.value = "当前操作正在提交，请等待本次操作完成。";
        return null;
      }
      const reason = values.reason.trim();
      if (!reason) {
        signingMaterialChangeDialogError.value = "实质变化原因不能为空。";
        return null;
      }
      archiveActionBusy.value = "signingMaterialChange";
      archiveActionMessage.value = "";
      return { ...owner, submissionToken: signingMaterialChangeSubmissionToken, reason };
    `) &&
    approvalParamNames(owner.definition, "context") &&
    approvalStatements(owner.definition.body, `
      return context.submissionToken === signingMaterialChangeSubmissionToken &&
        routeContractId() === context.routeContractId;
    `) &&
    approvalParamNames(current.definition, "context") &&
    approvalStatements(current.definition.body, `
      return ownsSigningMaterialChangeSubmission(context) &&
        signingMaterialChangeDialogContext.value?.contractVersionId === context.contractVersionId;
    `));
}

function signingMaterialChangeApiEvidence(symbols) {
  const command = approvalFunction(symbols, SIGNING_MATERIAL_CHANGE_COMMAND);
  const reader = approvalFunction(symbols, CONTRACT_APPROVAL_READ);
  const assertion = approvalFunction(symbols, "assertContractSigningMaterialChangePreflight");
  const path = approvalFunction(symbols, "governedContractPath");
  const readJson = approvalFunction(symbols, "readJson");
  const postJson = approvalFunction(symbols, "postJson");
  const fetchWrapper = { apiFile: `${WEB_SOURCE_ROOT}/api/api-fetch.ts`, name: "apiFetch" };
  if (!command || !reader || !assertion || !path || !readJson || !postJson ||
      !approvalStatements(readJson.definition.body, `
        const response = await apiFetch(path, headers || options ? { headers, ...options } : undefined);
        await ensureOk(response, "读取失败");
        return response.json() as Promise<T>;
      `) ||
      !approvalStatements(postJson.definition.body, `
        const response = await apiFetch(path, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), ...options
        });
        await ensureOk(response, "提交失败");
        return response.json() as Promise<TResponse>;
      `) ||
      [readJson, postJson].some(helper =>
        approvalCalls(helper.definition, call => callExpressionMatchesWrapper(call, fetchWrapper, symbols)).length !== 1) ||
      !approvalParamNames(command.definition, "input") ||
      !approvalParamNames(assertion.definition, "context", "fresh") ||
      !approvalParamNames(path.definition, "contractVersionId", "suffix") ||
      !approvalStatements(path.definition.body, 'return `/contracts/${encodeURIComponent(contractVersionId)}/${suffix}`;') ||
      !approvalStatements(reader.definition.body, `
        const query = options?.versionId ? \`?versionId=\${encodeURIComponent(options.versionId)}\` : "";
        return readJson<ContractDetailReadModel>(\`/contracts/\${encodeURIComponent(contractId)}\${query}\`,
          { "x-contract-numeric-protocol": "2" });
      `) ||
      !approvalBoundCall(reader.definition, "readJson", symbols) ||
      !approvalBoundCall(command.definition, CONTRACT_APPROVAL_READ, symbols) ||
      !approvalBoundCall(command.definition, "assertContractSigningMaterialChangePreflight", symbols) ||
      !approvalBoundCall(command.definition, "governedContractPath", symbols) ||
      !approvalBoundCall(command.definition, "postJson", symbols)) return false;
  const [map] = topLevelScopeVariables(symbols.scopeManager, "MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS");
  const statusMap = uniqueIndexedNode(symbols.declarationsByBinding, map);
  if (!approvalExpression(statusMap, `({
    approved_pending_seal: "pending_approval",
    in_seal: "in_seal",
    seal_approved_pending_archive: "completed",
    pending_archive_confirm: "completed"
  })`) || map.references.filter(reference => !reference.init).length !== 1 ||
      !approvalStatements(assertion.definition.body, `
        const enabledActions = fresh.availableActions.filter(
          (action) => action.key === "report_signing_material_change" && action.enabled
        );
        const coordinates = fresh.signingMaterialChangeContext;
        if (fresh.id !== context.contractId || fresh.contractVersionId !== context.contractVersionId ||
            fresh.draftRevision !== context.expectedRevision || fresh.sealTask?.id !== context.expectedSealTaskId ||
            fresh.sealTask.status !== MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS[context.expectedStatus] ||
            enabledActions.length !== 1 || coordinates?.expectedRevision !== context.expectedRevision ||
            coordinates.expectedSealTaskId !== context.expectedSealTaskId || coordinates.expectedStatus !== context.expectedStatus) {
          throw new Error("合同签署状态已变化，未执行实质变化申报，请刷新详情后重试");
        }
      `)) return false;
  const statements = command.definition.body.body;
  const execution = statements[2];
  const ordered = execution?.type === "TryStatement" && execution.block.body;
  const send = ordered?.[7];
  return statements.length === 3 &&
    approvalStatements({ type: "BlockStatement", body: statements.slice(0, 2) }, `
      const context = input.capture();
      if (!context) return { status: "not_started" };
    `) &&
    Boolean(ordered && approvalStatements({ type: "BlockStatement", body: ordered.slice(0, 7) }, `
      if (!input.current(context)) {
        await input.stale(context);
        return { status: "stale", context };
      }
      const fresh = await fetchContractDetail(context.routeContractId);
      if (!input.current(context, fresh)) {
        await input.stale(context);
        return { status: "stale", context };
      }
      assertContractSigningMaterialChangePreflight(context, fresh);
      const reason = typeof input.reason === "function" ? input.reason(context) : input.reason;
      const payload: ContractSigningMaterialChangePayload = {
        expectedRevision: context.expectedRevision,
        expectedSealTaskId: context.expectedSealTaskId,
        expectedStatus: context.expectedStatus,
        reason
      };
      let response: ContractSigningMaterialChangeResponse;
    `) && send?.type === "TryStatement" &&
    approvalStatement(send.block.body[0], `
      const rawResponse = await postJson<unknown>(
        governedContractPath(context.contractVersionId, "signing/material-change"), payload
      );
    `));
}

function signingMaterialChangeCausalProof({ action, wrapper, candidate, context, nestRouteIndex }) {
  if (!candidate || action.sourceFile !== CONTRACT_APPROVAL_PAGE ||
      action.trigger.handler !== SIGNING_MATERIAL_CHANGE_HANDLER ||
      candidate.element !== "sensitive-action-dialog" || candidate.event !== "confirm" ||
      action.routePaths.length !== 1 || action.routePaths[0] !== "/合同管理/:contractId" ||
      action.capability.kind !== "available_action_string" ||
      action.capability.source !== "contractLifecycleAvailableActionKeys" ||
      action.capability.key !== SIGNING_MATERIAL_CHANGE_KEY || action.wrappers.length !== 1 ||
      action.wrappers[0].variant !== undefined || wrapper.apiFile !== CONTRACT_APPROVAL_API ||
      wrapper.name !== SIGNING_MATERIAL_CHANGE_COMMAND) return null;
  const get = "GET /contracts/:param";
  const post = "POST /contracts/:param/signing/material-change";
  const readIdentity = wrapperIdentity(CONTRACT_APPROVAL_API, CONTRACT_APPROVAL_READ);
  const read = context.wrapperIndex.get(readIdentity);
  const readRequests = normalizedMainRequests(read);
  const requests = normalizedMainRequests(wrapper);
  if ([get, post].some(key => {
    const route = nestRouteIndex.get(key);
    return route?.authentication !== "authenticated" || route.isPublic !== false;
  }) ||
      read?.returnProvenance !== "transparent_main_response" ||
      readRequests.length !== 1 || readRequests[0].normalizedKey !== get ||
      requests.length !== 2 || !requests.some(request => request.normalizedKey === get && request.bodyKind === "none") ||
      !requests.some(request => request.normalizedKey === post && request.bodyKind === "json") ||
      !signingMaterialChangePageEvidence(candidate, context)) return null;
  const ast = context.asts.get(CONTRACT_APPROVAL_API);
  if (!ast || !signingMaterialChangeApiEvidence(buildSymbolContext(ast, CONTRACT_APPROVAL_API, context.sourceFileSet))) {
    return null;
  }
  return {
    verified: true,
    localCallChain: [SIGNING_MATERIAL_CHANGE_HANDLER, SIGNING_MATERIAL_CHANGE_COMMAND, CONTRACT_APPROVAL_READ, "assertContractSigningMaterialChangePreflight"],
    capabilityWitness: true,
    capabilitySources: new Set([readIdentity])
  };
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

function layoutRiskStopProof({ action, wrapper, candidate, context }) {
  const page = `${WEB_SOURCE_ROOT}/pages/contract-templates/LayoutTemplateEditorPage.vue`;
  const read = {
    apiFile: `${WEB_SOURCE_ROOT}/api/contract-template-mapping.api.ts`,
    name: "getLayoutVersionMaintenanceCapability"
  };
  if (action.sourceFile !== page || candidate?.kind !== "background_call" ||
      action.trigger.handler !== "stopCurrentVersionWithCapability" ||
      action.capability.kind !== "detail_action" || action.capability.source !== "capability.availableActions" ||
      action.capability.key !== "risk_stop" || wrapper.apiFile !== CONTRACT_WORKBENCH_API_PATH ||
      wrapper.name !== "stopLayoutTemplateVersion") return null;

  const { symbols } = context;
  const handler = candidate.expression;
  if (handler?.type !== "FunctionDeclaration" || !handler.async || handler.generator ||
      handler.params.length !== 1 || handler.params[0]?.type !== "Identifier" || handler.params[0].name !== "context" ||
      !directRegistrationBlock(handler.body, `
        const capability = await getLayoutVersionMaintenanceCapability(context.versionId);
        if (!riskStopResultCanWrite(context)) return;
        const matchesRequestedVersion = capability.versionId === context.versionId;
        if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
        const operationAllowed = capability.availableActions.some(action => action.key === "risk_stop" && action.enabled);
        if (!operationAllowed) throw new Error("当前版式不允许风险停用");
        return stopLayoutTemplateVersion(context.versionId);
      `)) return null;
  const [load, stale, , versionGuard, , operationGuard, submit] = handler.body.body;
  if ([versionGuard, operationGuard].some(guard => {
    const ctor = resolvedReferenceBinding(guard.consequent.argument.callee, symbols);
    return (ctor?.identifiers?.length ?? 0) !== 0;
  })) return null;
  const readCall = load.declarations[0].init.argument;
  const readSource = importedReadSource(readCall, context.serverReadImports, symbols);
  if (readSource !== wrapperIdentity(read.apiFile, read.name) ||
      !callExpressionMatchesWrapper(submit.argument, wrapper, symbols)) return null;
  const reads = normalizedMainRequests(context.wrapperIndex.get(readSource));
  const writes = normalizedMainRequests(wrapper);
  if (reads.length !== 1 || reads[0].normalizedKey !== "GET /contract-layout-template-versions/:param/maintenance-capability" ||
      writes.length !== 1 || writes[0].normalizedKey !== "POST /contract-layout-template-versions/:param/stop") return null;

  const guard = call => {
    const binding = resolvedReferenceBinding(call.callee, symbols);
    if (!binding || binding.references.some(ref => ref.isWrite() && !ref.init)) return null;
    const definition = uniqueIndexedNode(symbols.definitionsByBinding, binding);
    return definition?.type === "FunctionDeclaration" && !definition.async && !definition.generator &&
      definition.params.length === 1 && definition.params[0]?.type === "Identifier" &&
      definition.params[0].name === "context" ? definition : null;
  };
  const canWrite = guard(stale.test.argument);
  if (!directRegistrationBlock(canWrite?.body, `
      return riskStopContextIsCurrent(context) && riskStopOperationIsCurrent(context);
    `)) return null;
  const { left, right } = canWrite.body.body[0].argument;
  if (!directRegistrationBlock(guard(left)?.body, `
      return Boolean(context.templateId && context.versionId) &&
        context.templateId === layoutTemplateRouteId.value &&
        context.versionId === riskStopVersionId.value &&
        context.versionId === selectedVersionId.value &&
        context.routeGeneration === layoutRouteGeneration;
    `) || !directRegistrationBlock(guard(right)?.body, `
      return context.templateId === layoutTemplateRouteId.value &&
        context.routeGeneration === layoutRouteGeneration &&
        context.operationId === riskStopOperationId;
    `) || !preflightExpressionIsPure(stale.test.argument, symbols)) return null;
  return { verified: true, capabilityWitness: true, capabilitySources: new Set([readSource]) };
}

function actionBindings({
  action,
  wrapperIndex,
  webManifest,
  nestRouteIndex,
  blockers,
  graph,
  symbols,
  candidate,
  businessDraftActionTrusted,
  capabilityContext,
  selfProfileFacadeImplementationTrusted
}) {
  const bindings = [];
  for (const declared of action.wrappers) {
    const identity = wrapperIdentity(
      declared.apiFile,
      declared.name
    );
    const wrapper = isSelfProfileFacadeCandidate(declared)
      ? registeredSelfProfileAuthTransportWrapper({
          declared,
          action,
          webManifest,
          graph,
          facadeImplementationTrusted:
            selfProfileFacadeImplementationTrusted
        })
      : wrapperIndex.get(identity);
    if (!wrapper) {
      blockers.unresolvedWrappers.push({
        code: "WRAPPER_NOT_IN_MANIFEST",
        actionId: action.id,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
      continue;
    }
    const relatedConsumers = wrapperReferencedFromAction({ wrapper, action, graph })
      .filter(consumer => !DIRECT_REGISTRATION_ACTIONS.has(action.id) || consumer === DIRECT_REGISTRATION_MODULE)
      .filter(consumer =>
        !["contract-final.upload-file", "contract-archive.upload-file"].includes(action.id) || consumer === action.sourceFile
      );
    if (relatedConsumers.length === 0) {
      blockers.unresolvedWrappers.push({
        code: "WRAPPER_NOT_REFERENCED_BY_ACTION_SOURCE",
        actionId: action.id,
        apiFile: declared.apiFile,
        wrapper: declared.name
      });
    }
    let causalProof = candidate
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
    const layoutStop = action.id === "layout-template.stop";
    const pipelineProof = layoutStop
      ? layoutRiskStopProof({ action, wrapper, candidate, context: capabilityContext })
      : proveBusinessActionPipeline({ action, wrapper, context: capabilityContext });
    if (layoutStop && !pipelineProof) {
      causalProof = { verified: false, localCallChain: [action.trigger.handler] };
    }
    if (pipelineProof?.verified) {
      causalProof = {
        verified: true,
        localCallChain: [action.trigger.handler, wrapper.name]
      };
      capabilityContext.pipelineProofs ??= new Map();
      capabilityContext.pipelineProofs.set(
        wrapperIdentity(declared.apiFile, declared.name),
        pipelineProof
      );
    }
    const directRegistrationProof = directRegistrationCausalProof({ action, wrapper, candidate, context: capabilityContext });
    if (DIRECT_REGISTRATION_ACTIONS.has(action.id)) {
      causalProof = directRegistrationProof ?? { verified: false, localCallChain: [action.trigger.handler] };
      if (directRegistrationProof?.capabilityWitness) {
        capabilityContext.pipelineProofs ??= new Map();
        capabilityContext.pipelineProofs.set(identity, directRegistrationProof);
      } else if (directRegistrationProof) {
        capabilityContext.directRegistrationLookupVerified = true;
      }
    }
    if (requiresContractDetailCausalProof(action)) {
      const prove = action.id === SIGNING_MATERIAL_CHANGE_ACTION
        ? signingMaterialChangeCausalProof
        : contractApprovalPageCausalProof;
      const contractDetailProof = prove({ action, wrapper, candidate, context: capabilityContext, nestRouteIndex });
      causalProof = contractDetailProof ?? { verified: false, localCallChain: [action.trigger.handler] };
      if (contractDetailProof) {
        capabilityContext.pipelineProofs ??= new Map();
        capabilityContext.pipelineProofs.set(identity, contractDetailProof);
      } else {
        capabilityContext.pipelineProofs?.delete(identity);
      }
    }
    const finalContractProof = finalContractWriteCausalProof({
      action,
      wrapper: {
        ...wrapper,
        apiFile: posixPath(wrapper.apiFile)
      },
      context: capabilityContext
    });
    if (finalContractProof !== null) {
      causalProof = finalContractProof;
    } else if (!causalProof.verified) {
      causalProof =
        contractDraftLifecycleSessionCausalProof({
          action,
          wrapper: {
            ...wrapper,
            apiFile: posixPath(wrapper.apiFile)
          },
          context: capabilityContext
        }) ??
        causalProof;
    }
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

function nestRouteIdentity(route) {
  if (
    !isNonEmptyString(route?.method) ||
    !isNonEmptyString(route?.path) ||
    !isNonEmptyString(route?.normalizedKey)
  ) {
    return null;
  }
  const expectedKey = `${route.method.toUpperCase()} ${normalizeRouteIdentityPath(
    route.path
  )}`;
  return {
    declaredKey: route.normalizedKey,
    expectedKey,
    valid:
      route.method === route.method.toUpperCase() &&
      route.normalizedKey === expectedKey
  };
}

function buildNestRouteIndex(routes) {
  const records = (Array.isArray(routes) ? routes : [])
    .map((route) => {
      const identity = nestRouteIdentity(route);
      return identity ? { route, ...identity } : null;
    })
    .filter(Boolean);
  const blockedKeys = new Set();
  const groups = new Map();

  for (const record of records) {
    if (!record.valid) {
      blockedKeys.add(record.declaredKey);
      blockedKeys.add(record.expectedKey);
    }
    for (const key of new Set([
      record.declaredKey,
      record.expectedKey
    ])) {
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    if (group.length > 1) {
      blockedKeys.add(key);
      for (const record of group) {
        blockedKeys.add(record.declaredKey);
        blockedKeys.add(record.expectedKey);
      }
    }
  }

  const index = new Map();
  for (const record of records) {
    if (
      record.valid &&
      !blockedKeys.has(record.declaredKey) &&
      !blockedKeys.has(record.expectedKey)
    ) {
      index.set(record.declaredKey, record.route);
    }
  }
  return index;
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
  const route = buildNestRouteIndex(manifest.routes).get(
    normalizedKey
  );
  if (!route) return false;
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
  const authFacadeException =
    posixPath(binding.apiFile) ===
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile &&
    binding.wrapper === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName &&
    binding.method === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.method &&
    binding.path === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath &&
    binding.normalizedKey === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey &&
    binding.bodyKind === "json" &&
    binding.productionConsumers.length === 1 &&
    binding.productionConsumers[0] ===
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.productionConsumer &&
    (webManifest.authTransportExceptions ?? []).filter(
      (entry) =>
        posixPath(entry?.sourceFile ?? "") ===
          SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.transportSourceFile &&
        entry?.transport === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.transport &&
        entry?.method === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.method &&
        entry?.normalizedPath === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath &&
        entry?.normalizedKey === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey
    ).length === 1;
  if (authFacadeException) {
    return nestRouteAssociationIsTrusted(
      nestManifest,
      binding.normalizedKey
    );
  }
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
  const nestRouteIndex = buildNestRouteIndex(
    nestManifest.routes
  );
  for (const binding of mutationBindings) {
    if (!isNonEmptyString(binding?.normalizedKey)) return null;
    const route = nestRouteIndex.get(binding.normalizedKey);
    if (!route) return null;
    const positions = actorPositionsForRoute(
      route,
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
  const nestRouteIndex = buildNestRouteIndex(
    nestManifest.routes
  );
  return requests.every((request) => {
    const route = nestRouteIndex.get(request.normalizedKey);
    if (!route) return false;
    const actorPositions = actorPositionsForRoute(
      route,
      rolesByAction
    );
    return actorPositionsCover(
      effectiveMutationActors,
      actorPositions
    );
  });
}

// A consumer with multiple intentional write paths is covered only when every
// required action has independently passed causal, capability and route checks.
const PAIRED_WRITE_COVERAGE = new Map([
  [`${wrapperIdentity(SEAL_API, SEAL_WRITE)}\u0000${SEAL_COMPOSABLE}`, SEAL_WRITE_ACTION_IDS],
  [`${wrapperIdentity(GENERATED_ARCHIVE_API, GENERATED_ARCHIVE_WRITE)}\u0000${GENERATED_ARCHIVE_CONSUMER}`, GENERATED_ARCHIVE_ACTIONS],
  [`${wrapperIdentity(GENERATED_ARCHIVE_API, GENERATED_ARCHIVE_UPLOAD)}\u0000${GENERATED_ARCHIVE_CONSUMER}`, new Set([GENERATED_ARCHIVE_CONFIRM])]
]);

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
  const nestRouteIndex = buildNestRouteIndex(nestManifest.routes);

  const manifestActions = [];
  const candidateConsumerPairs = new Set();
  const coveredConsumerPairs = new Set();
  const pairedConsumerCoverage = new Map();
  const productionMutationConsumerPairs = new Set();
  const authFacadeMutationPairs = new Map();
  const selfProfileFacadeImplementationTrusted =
    selfProfileFacadeImplementationIsTrusted({
      asts,
      sourceFileSet
    });
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
  const selfProfileConsumer =
    SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.productionConsumer;
  if (
    selfProfileFacadeImplementationTrusted &&
    registeredSelfProfileAuthTransportException(webManifest) &&
    reachable.has(selfProfileConsumer) &&
    reachable.has(SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile) &&
    graph.get(selfProfileConsumer)?.includes(
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile
    ) &&
    nestRouteAssociationIsTrusted(
      nestManifest,
      SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey
    )
  ) {
    const binding = {
      apiFile: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile,
      wrapper: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName,
      method: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.method,
      path: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedPath,
      normalizedKey: SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.normalizedKey,
      bodyKind: "json",
      productionConsumers: [selfProfileConsumer]
    };
    const pair = `${wrapperIdentity(binding.apiFile, binding.wrapper)}\u0000${selfProfileConsumer}`;
    productionMutationConsumerPairs.add(pair);
    authFacadeMutationPairs.set(pair, {
      binding,
      consumer: selfProfileConsumer
    });
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
      actionId: action.id,
      candidate,
      nestRouteIndex,
      symbols,
      sourceFile: action.sourceFile,
      source,
      sources,
      asts,
      sourceFileSet,
      wrapperIndex,
      serverReadImports: serverReadImportNames(
        symbols,
        wrapperIndex,
        action.sourceFile
      ),
      discoveredCapabilitySourceBindings: new Set(),
      registryVariant: action.trigger.variant,
      businessDraftActionTrusted
    };
    const localCapabilitySource =
      action.capability.kind === "server_definition"
        ? handlerLocalCapabilitySourceBinding({
            handler: action.trigger.handler,
            capability: action.capability,
            context: capabilityContext
          })
        : null;
    if (localCapabilitySource) {
      capabilityContext.handlerLocalCapabilitySource =
        localCapabilitySource;
      capabilityContext.capabilitySourceBindings =
        localCapabilitySource.bindings;
    }
    const bindings = actionBindings({
      action,
      wrapperIndex,
      webManifest,
      nestRouteIndex,
      blockers,
      graph: ownershipGraph,
      symbols,
      candidate,
      businessDraftActionTrusted,
      capabilityContext,
      selfProfileFacadeImplementationTrusted
    });
    for (const binding of bindings) {
      const boundWrapper = wrapperIndex.get(
        wrapperIdentity(
          binding.apiFile,
          binding.wrapper
        )
      );
      const authFacadeMutation =
        !boundWrapper &&
        isMutationRequest(binding) &&
        bindingUpstreamAssociationIsTrusted({
          binding,
          webManifest,
          nestManifest
        }) &&
        posixPath(binding.apiFile) ===
          SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile &&
        binding.wrapper === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName;
      if (
        (!boundWrapper || !wrapperIsProductionMutation(boundWrapper)) &&
        !authFacadeMutation
      ) {
        continue;
      }
      for (const consumer of binding.productionConsumers) {
        const pair = `${wrapperIdentity(
          binding.apiFile,
          binding.wrapper
        )}\u0000${consumer}`;
        candidateConsumerPairs.add(pair);
        if (authFacadeMutation) {
          productionMutationConsumerPairs.add(pair);
          authFacadeMutationPairs.set(pair, { binding, consumer });
        }
      }
    }
    const mutationBindings = bindings.filter(isMutationRequest);
    capabilityContext.mutationBindings = mutationBindings;
    const governedPipelineRequired = [...(capabilityContext.pipelineProofs?.values() ?? [])]
      .some((proof) => [
        "project_definition",
        "project_capability",
        "guarded_upload"
      ].includes(proof.kind));
    if (governedPipelineRequired) {
      for (const binding of mutationBindings) {
        if (capabilityContext.pipelineProofs?.has(
          wrapperIdentity(binding.apiFile, binding.wrapper)
        )) continue;
        binding.causalVerified = false;
        if (!blockers.unresolvedWrappers.some((entry) =>
          entry.actionId === action.id &&
          entry.apiFile === binding.apiFile &&
          entry.wrapper === binding.wrapper &&
          entry.code === "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
        )) {
          blockers.unresolvedWrappers.push({
            code: "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED",
            actionId: action.id,
            sourceFile: action.sourceFile,
            apiFile: binding.apiFile,
            wrapper: binding.wrapper
          });
        }
      }
    }
    const writes = bindings.some((binding) =>
      isMutationRequest(binding)
    );
    const pipelineDominates =
      mutationBindings.length > 0 &&
      mutationBindings.every((binding) =>
        capabilityContext.pipelineProofs?.get(
          wrapperIdentity(binding.apiFile, binding.wrapper)
        )?.capabilityWitness === true
      );
    const pipelineCapabilitySources = new Set(
      mutationBindings.flatMap((binding) => [
        ...(capabilityContext.pipelineProofs?.get(
          wrapperIdentity(binding.apiFile, binding.wrapper)
        )?.capabilitySources ?? [])
      ])
    );
    const pipelineDefinitionSources = new Set(
      mutationBindings.flatMap((binding) => [
        ...(capabilityContext.pipelineProofs?.get(
          wrapperIdentity(binding.apiFile, binding.wrapper)
        )?.definitionSources ?? [])
      ])
    );
    const expectedFreshReadIdentity = action.capability.freshRead
      ? wrapperIdentity(
          action.capability.freshRead.apiFile,
          action.capability.freshRead.name
        )
      : null;
    const projectDefinitionFreshReadAccepted =
      Boolean(expectedFreshReadIdentity) &&
      mutationBindings.length > 0 &&
      mutationBindings.every((binding) => {
        const proof = capabilityContext.pipelineProofs?.get(
          wrapperIdentity(binding.apiFile, binding.wrapper)
        );
        return proof?.kind === "project_definition" &&
          proof.definitionSources?.size === 1 &&
          proof.definitionSources.has(expectedFreshReadIdentity);
      });
    const dominatesTrigger =
      Boolean(candidate && source) &&
      (pipelineDominates || (!requiresContractDetailCausalProof(action) && capabilityDominates(
        candidate,
        action.capability,
        capabilityContext
      )));
    const pipelineProvenanceSources =
      action.capability.kind === "server_definition"
        ? pipelineDefinitionSources
        : pipelineCapabilitySources;
    const capabilityProvenance =
      (requiresContractDetailCausalProof(action) ? null : capabilityServerProvenance(
        action.capability,
        capabilityContext
      )) ??
      (pipelineDominates && pipelineProvenanceSources.size === 1
        ? {
            sources: pipelineProvenanceSources,
            sourceFiles: new Map(
              [...pipelineProvenanceSources].map((sourceIdentity) => [
                sourceIdentity,
                [...(capabilityContext.pipelineProofs?.values() ?? [])]
                  .find(proof => proof.capabilitySources?.has(sourceIdentity))?.capabilitySourceFile ??
                (DIRECT_REGISTRATION_ACTIONS.has(action.id) ? DIRECT_REGISTRATION_MODULE : action.sourceFile)
              ])
            )
          }
        : null);
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
    const serverDefinitionFreshReadVerified =
      serverDefinitionHandlerFreshRead({
        action,
        symbols,
        capabilityContext
      });
    const effectiveServerDefinitionFreshReadVerified =
      serverDefinitionFreshReadVerified ||
      projectDefinitionFreshReadAccepted;
    const freshReadBindingIsVerified =
      freshReadBindingVerified({
        action,
        wrapperIndex,
        graph: ownershipGraph,
        capabilityContext,
        handlerFreshReadVerified: serverDefinitionFreshReadVerified
      });
    const effectiveFreshReadBindingIsVerified =
      freshReadBindingIsVerified ||
      projectDefinitionFreshReadAccepted;
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
        capabilityUpstreamAssociationTrusted &&
        effectiveServerDefinitionFreshReadVerified &&
        effectiveFreshReadBindingIsVerified);
    if (
      action.capability.kind === "server_definition" &&
      !effectiveServerDefinitionFreshReadVerified
    ) {
      capabilityAccepted = false;
      blockers.writeWithoutServerCapability.push({
        code: "SERVER_DEFINITION_HANDLER_FRESH_READ_UNVERIFIED",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    }
    if (
      action.capability.freshRead &&
      !effectiveFreshReadBindingIsVerified
    ) {
      capabilityAccepted = false;
      blockers.writeWithoutServerCapability.push({
        code:
          action.capability.freshRead.method !== "GET"
            ? "FRESH_READ_BINDING_NOT_GET"
            : "FRESH_READ_BINDING_UNVERIFIED",
        actionId: action.id,
        sourceFile: action.sourceFile
      });
    }
    if (action.capability.kind === "client_role_or_status") {
      capabilityAccepted = false;
      blockers.clientRoleOrStatusGates.push({
        code: "CLIENT_ROLE_OR_STATUS_GATE",
        actionId: action.id,
        sourceFile: action.sourceFile,
        capabilitySource: action.capability.source
      });
    } else if (action.capability.kind === "none" && !(
      (capabilityContext.directRegistrationLookupVerified ||
        [...(capabilityContext.pipelineProofs?.values() ?? [])].some(proof => proof.readOnlyWitness === true)) &&
      action.semantic === "read_only" && !writes && bindings.length === 1 &&
      bindingUpstreamAssociationIsTrusted({ binding: bindings[0], webManifest, nestManifest })
    )) {
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
        const authFacadeMutation =
          !wrapper &&
          isMutationRequest(binding) &&
          bindingUpstreamAssociationIsTrusted({
            binding,
            webManifest,
            nestManifest
          }) &&
          posixPath(binding.apiFile) ===
            SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeApiFile &&
          binding.wrapper === SELF_PROFILE_AUTH_TRANSPORT_EXCEPTION.facadeName;
        if (
          (wrapper && wrapperIsProductionMutation(wrapper)) ||
          authFacadeMutation
        ) {
          for (const consumer of binding.productionConsumers) {
            const pair = `${wrapperIdentity(binding.apiFile, binding.wrapper)}\u0000${consumer}`;
            const required = PAIRED_WRITE_COVERAGE.get(pair);
            if (!required) {
              coveredConsumerPairs.add(pair);
            } else if (required.has(action.id)) {
              const proven = pairedConsumerCoverage.get(pair) ?? new Set();
              proven.add(action.id);
              pairedConsumerCoverage.set(pair, proven);
            }
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

  for (const [pair, required] of PAIRED_WRITE_COVERAGE) {
    const proven = pairedConsumerCoverage.get(pair);
    if (proven && [...required].every(id => proven.has(id))) coveredConsumerPairs.add(pair);
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
  for (const [pair, { binding, consumer }] of authFacadeMutationPairs) {
    if (coveredConsumerPairs.has(pair)) continue;
    blockers.uncoveredMutationWrappers.push({
      code: "PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION",
      apiFile: posixPath(binding.apiFile),
      wrapper: binding.wrapper,
      sourceFile: consumer,
      normalizedKeys: [binding.normalizedKey]
    });
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

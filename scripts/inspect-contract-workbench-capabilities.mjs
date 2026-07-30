#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../services/api/package.json", import.meta.url)
);
const ts = require("typescript");

const HTTP_DECORATORS = new Map([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Patch", "PATCH"],
  ["Delete", "DELETE"]
]);

const HTTP_HELPERS = new Map([
  ["readJson", "GET"],
  ["postJson", "POST"],
  ["postJsonWithHeaders", "POST"],
  ["postForm", "POST"],
  ["putJson", "PUT"],
  ["putJsonWithHeaders", "PUT"],
  ["patchJson", "PATCH"],
  ["deleteJson", "DELETE"],
  ["deleteJsonWithHeaders", "DELETE"]
]);

const API_FILES = [
  "apps/web-admin/src/api/contract-workbench.api.ts",
  "apps/web-admin/src/api/core-flow-read.api.ts"
];

export const DEFAULT_LEGACY_ROUTES = [
  "GET /contract-workbench",
  "GET /contract-workbench/:param",
  "PATCH /contract-workbench/:param",
  "POST /contract-workbench/:param/checkpoints",
  "POST /contract-workbench/:param/checkpoints/:param/restore",
  "POST /contract-workbench/:param/void",
  "POST /contract-workbench/:param/restore",
  "DELETE /contract-drafts/:param",
  "POST /contract-bills/:param/rows",
  "PATCH /contract-bills/:param/rows/:param",
  "DELETE /contract-bills/:param/rows/:param",
  "POST /contract-bills/:param/rows/reorder"
];

const DEFAULT_INTERNAL_ROUTES = [];
const EXPLICIT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function posixPath(path) {
  return path.split(sep).join("/");
}

function isTestFile(path) {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:spec|test)\.[^.]+$/.test(path);
}

function normalizeRoute(path) {
  const withoutQuery = String(path || "").split("?")[0];
  const normalized = `/${withoutQuery}`
    .replace(/\/+/g, "/")
    .replace(/(?<!\/):param/g, "")
    .replace(/\/:([A-Za-z0-9_]+)/g, "/:param")
    .replace(/\/$/, "");
  return normalized || "/";
}

function normalizeRouteKey(value) {
  const match = String(value).trim().match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) return null;
  return `${match[1].toUpperCase()} ${normalizeRoute(match[2])}`;
}

function capabilityInputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function failLegacyRoutes() {
  throw capabilityInputError(
    "CAPABILITY_LEGACY_ROUTES_INVALID",
    "Configured legacy routes failed validation"
  );
}

function failLegacyHits() {
  throw capabilityInputError(
    "CAPABILITY_LEGACY_HITS_INVALID",
    "Legacy route hit evidence failed validation"
  );
}

function normalizeEvidenceRouteKey(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
  if (!match) return null;
  const path = match[2];
  if (
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    path.includes("//")
  ) {
    return null;
  }
  const segments = path.split("/").slice(1);
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        (segment.includes(":") && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment))
    )
  ) {
    return null;
  }
  return normalizeRouteKey(value);
}

function normalizeUniqueLegacyRoutes(routes) {
  if (!Array.isArray(routes)) failLegacyRoutes();
  const normalized = new Set();
  for (const route of routes) {
    const key = normalizeEvidenceRouteKey(route);
    if (!key || normalized.has(key)) failLegacyRoutes();
    normalized.add(key);
  }
  return normalized;
}

function parseExplicitIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = value.match(EXPLICIT_ISO_TIMESTAMP);
  if (!match) return null;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = "",
    zone,
    sign,
    offsetHourText = "0",
    offsetMinuteText = "0"
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHours = Number(offsetHourText);
  const offsetMinutes = Number(offsetMinuteText);
  const daysInMonth =
    month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    offsetHours < 0 ||
    offsetHours > 14 ||
    offsetMinutes < 0 ||
    offsetMinutes > 59 ||
    (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    return null;
  }
  const signedOffsetMinutes =
    zone === "Z"
      ? 0
      : (sign === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes);
  return (
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      Number(fraction.padEnd(3, "0"))
    ) -
    signedOffsetMinutes * 60_000
  );
}

function parseHalfOpenWindow(value) {
  if (typeof value !== "string") return null;
  const timestamps = value.split("/");
  if (timestamps.length !== 2) return null;
  const from = parseExplicitIsoTimestamp(timestamps[0]);
  const to = parseExplicitIsoTimestamp(timestamps[1]);
  if (from === null || to === null || from >= to) return null;
  return { from, to };
}

function plainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateLegacyHits(legacyHits, legacyRoutes) {
  const structuralCountFields = [
    "nonEmptyLines",
    "parsedLines",
    "beforeWindowLines",
    "inWindowLines",
    "atOrAfterWindowLines",
    "matchedRequests",
    "unmatchedRequests"
  ];
  if (
    !plainRecord(legacyHits) ||
    legacyHits.schemaVersion !== 1 ||
    legacyHits.status !== "ready" ||
    !plainRecord(legacyHits.evidence) ||
    legacyHits.evidence.complete !== true ||
    legacyHits.evidence.coverageBasis !== "operator_attested" ||
    legacyHits.evidence.apiPrefix !== "/api" ||
    legacyHits.evidence.parseFailures !== 0 ||
    !Number.isSafeInteger(legacyHits.evidence.inputSourceCount) ||
    legacyHits.evidence.inputSourceCount < 1 ||
    !Number.isSafeInteger(
      legacyHits.evidence.inWindowApiPrefixedRequests
    ) ||
    legacyHits.evidence.inWindowApiPrefixedRequests < 1 ||
    structuralCountFields.some(
      (field) =>
        !Number.isSafeInteger(legacyHits.evidence[field]) ||
        legacyHits.evidence[field] < 0
    ) ||
    legacyHits.evidence.nonEmptyLines < 1 ||
    legacyHits.evidence.inWindowLines < 1 ||
    legacyHits.evidence.parsedLines !== legacyHits.evidence.nonEmptyLines ||
    legacyHits.evidence.beforeWindowLines +
      legacyHits.evidence.inWindowLines +
      legacyHits.evidence.atOrAfterWindowLines !==
      legacyHits.evidence.parsedLines ||
    legacyHits.evidence.matchedRequests +
      legacyHits.evidence.unmatchedRequests !==
      legacyHits.evidence.inWindowLines ||
    !plainRecord(legacyHits.counts)
  ) {
    failLegacyHits();
  }
  const observationWindow = parseHalfOpenWindow(legacyHits.observationWindow);
  const coverageWindow = parseHalfOpenWindow(
    legacyHits.evidence.coverageWindow
  );
  if (
    observationWindow === null ||
    coverageWindow === null ||
    observationWindow.to > Date.now() ||
    coverageWindow.to > Date.now() ||
    coverageWindow.from > observationWindow.from ||
    coverageWindow.to < observationWindow.to
  ) {
    failLegacyHits();
  }

  const counts = {};
  const seen = new Set();
  let matchedCountTotal = 0;
  for (const [rawKey, value] of Object.entries(legacyHits.counts)) {
    const key = normalizeEvidenceRouteKey(rawKey);
    if (
      !key ||
      seen.has(key) ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      failLegacyHits();
    }
    seen.add(key);
    counts[key] = value;
    matchedCountTotal += value;
  }
  if (
    !Number.isSafeInteger(matchedCountTotal) ||
    matchedCountTotal !== legacyHits.evidence.matchedRequests ||
    [...legacyRoutes].some((key) => counts[key] === undefined)
  ) {
    failLegacyHits();
  }
  return {
    observationWindow: legacyHits.observationWindow,
    counts
  };
}

function joinRoute(prefix, suffix) {
  return normalizeRoute([prefix, suffix].filter(Boolean).join("/"));
}

function sourceFileFor(relativePath, source) {
  const scriptKind =
    extname(relativePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
}

function vueScript(source) {
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join("\n");
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorCall(node) {
  const expression = node.expression;
  if (ts.isCallExpression(expression)) {
    const name = ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : null;
    return { name, args: expression.arguments };
  }
  if (ts.isIdentifier(expression)) {
    return { name: expression.text, args: [] };
  }
  return { name: null, args: [] };
}

function expressionRoute(expression) {
  if (!expression) return "";
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    return (
      expression.head.text +
      expression.templateSpans
        .map((span) => `:param${span.literal.text}`)
        .join("")
    );
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${expressionRoute(expression.left)}${expressionRoute(expression.right)}`;
  }
  return ":param";
}

async function collectFiles(root, relativeRoot, predicate) {
  const absoluteRoot = join(root, relativeRoot);
  const output = [];
  async function visit(absolute) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const target = join(absolute, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else {
        const rel = posixPath(relative(root, target));
        if (predicate(rel)) output.push(rel);
      }
    }
  }
  await visit(absoluteRoot);
  return output.sort();
}

async function readSource(root, relativePath) {
  const raw = await readFile(join(root, relativePath), "utf8");
  return extname(relativePath) === ".vue" ? vueScript(raw) : raw;
}

function extractBackendRoutes(relativePath, source) {
  const ast = sourceFileFor(relativePath, source);
  const routes = [];
  for (const statement of ast.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const controller = decoratorsOf(statement)
      .map(decoratorCall)
      .find((decorator) => decorator.name === "Controller");
    if (!controller) continue;
    const prefix = expressionRoute(controller.args[0]);
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const decorator of decoratorsOf(member).map(decoratorCall)) {
        const method = HTTP_DECORATORS.get(decorator.name);
        if (!method) continue;
        const route = joinRoute(prefix, expressionRoute(decorator.args[0]));
        routes.push({
          method,
          route,
          key: `${method} ${route}`,
          controller: relativePath,
          handler: member.name?.getText(ast) ?? "anonymous"
        });
      }
    }
  }
  return routes;
}

function functionDefinitions(relativePath, source) {
  const ast = sourceFileFor(relativePath, source);
  const definitions = [];
  for (const statement of ast.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body &&
      hasExportModifier(statement)
    ) {
      definitions.push({ name: statement.name.text, node: statement, ast });
      continue;
    }
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        definitions.push({
          name: declaration.name.text,
          node: declaration.initializer,
          ast
        });
      }
    }
  }
  return definitions;
}

function methodFromApiFetch(call) {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return "GET";
  const property = options.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      candidate.name?.getText().replaceAll(/['"]/g, "") === "method"
  );
  if (!property || !ts.isPropertyAssignment(property)) return "GET";
  return expressionRoute(property.initializer).toUpperCase();
}

function wrapperRoutes(relativePath, source) {
  const wrappers = [];
  for (const definition of functionDefinitions(relativePath, source)) {
    const requests = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const helper = node.expression.text;
        let method = HTTP_HELPERS.get(helper);
        if (helper === "apiFetch") method = methodFromApiFetch(node);
        if (method && node.arguments[0]) {
          const route = normalizeRoute(expressionRoute(node.arguments[0]));
          if (isContractCapability(route)) {
            requests.push({ method, route, key: `${method} ${route}` });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(definition.node);
    wrappers.push({
      name: definition.name,
      apiFile: relativePath,
      requests: requests.filter(
        (request, index, all) =>
          all.findIndex((candidate) => candidate.key === request.key) === index
      )
    });
  }
  return wrappers;
}

function isContractCapability(route) {
  return (
    route.includes("contract") ||
    route.startsWith("/business-parties") ||
    route.startsWith("/company-entities") ||
    route.startsWith("/draft-retention") ||
    route === "/me/workbench-summary"
  );
}

function importedApiModule(specifier) {
  return /(?:^|\/)(?:contract-workbench|core-flow-read)\.api(?:\.[cm]?[jt]s)?$/.test(
    specifier
  );
}

function identifierUseCount(ast, name) {
  let count = 0;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return count;
}

function extractConsumers(relativePath, source, exportedWrappers) {
  const ast = sourceFileFor(relativePath, source);
  const consumers = [];
  const missing = [];

  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !importedApiModule(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (clause?.isTypeOnly || element.isTypeOnly) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        if (!exportedWrappers.has(imported)) {
          missing.push({ consumer: relativePath, wrapper: imported });
        } else if (identifierUseCount(ast, element.name.text) > 1) {
          consumers.push({ consumer: relativePath, wrapper: imported });
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      const namespace = bindings.name.text;
      function visitNamespace(node) {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === namespace &&
          exportedWrappers.has(node.name.text)
        ) {
          consumers.push({ consumer: relativePath, wrapper: node.name.text });
        }
        ts.forEachChild(node, visitNamespace);
      }
      visitNamespace(ast);
    }
  }

  const hasDynamicApiImport = [...source.matchAll(/import\((['"])(.*?)\1\)/g)].some(
    (match) => importedApiModule(match[2])
  );
  if (hasDynamicApiImport) {
    for (const wrapper of exportedWrappers) {
      if (new RegExp(`\\b${wrapper}\\b`).test(source)) {
        consumers.push({ consumer: relativePath, wrapper });
      }
    }
  }

  return { consumers, missing };
}

function dedupe(items, keyOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceForLegacy(key, runtimeRoutes, legacyHits) {
  const missingEvidence = [];
  if (runtimeRoutes === undefined) {
    missingEvidence.push("runtime_route_manifest");
  } else if (!runtimeRoutes.has(key)) {
    missingEvidence.push("runtime_route_not_found");
  }
  if (legacyHits === undefined) {
    missingEvidence.push("production_legacy_route_hits");
  } else if (legacyHits.counts[key] === undefined) {
    missingEvidence.push("production_legacy_route_not_measured");
  } else if (legacyHits.counts[key] !== 0) {
    missingEvidence.push("production_legacy_route_nonzero");
  }
  return missingEvidence;
}

async function collectNestRuntimeRoutes(root) {
  const previous = {
    skipDatabaseConnect: process.env.SKIP_DATABASE_CONNECT,
    fileStorageRoot: process.env.FILE_STORAGE_ROOT,
    fileDownloadSecret: process.env.FILE_DOWNLOAD_SECRET,
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET
  };
  Object.assign(process.env, {
    SKIP_DATABASE_CONNECT: "true",
    FILE_STORAGE_ROOT: join(tmpdir(), "jgzg-contract-capability-storage"),
    FILE_DOWNLOAD_SECRET: "contract-capability-file-secret-20260729",
    JWT_ACCESS_SECRET: "contract-capability-access-secret-20260729",
    JWT_REFRESH_SECRET: "contract-capability-refresh-secret-20260729"
  });
  let app;
  try {
    const apiRequire = createRequire(
      pathToFileURL(join(root, "services/api/package.json"))
    );
    const { NestFactory } = apiRequire("@nestjs/core");
    const { AppModule } = await import(
      `${pathToFileURL(join(root, "services/api/dist/app.module.js")).href}?capability=${Date.now()}`
    );
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    const instance = app.getHttpAdapter().getInstance();
    const stack = instance._router?.stack;
    if (!Array.isArray(stack)) {
      throw new Error("Nest Express route stack is unavailable");
    }
    const routes = [];
    for (const layer of stack) {
      if (!layer.route?.path || !layer.route?.methods) continue;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
    return [...new Set(routes)].sort();
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries({
      SKIP_DATABASE_CONNECT: previous.skipDatabaseConnect,
      FILE_STORAGE_ROOT: previous.fileStorageRoot,
      FILE_DOWNLOAD_SECRET: previous.fileDownloadSecret,
      JWT_ACCESS_SECRET: previous.jwtAccessSecret,
      JWT_REFRESH_SECRET: previous.jwtRefreshSecret
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function inspectCapabilityProject({
  root,
  internalRoutes = DEFAULT_INTERNAL_ROUTES,
  legacyRoutes = DEFAULT_LEGACY_ROUTES,
  runtimeRoutes,
  legacyHits
}) {
  const normalizedInternal = new Set(
    internalRoutes.map(normalizeRouteKey).filter(Boolean)
  );
  const normalizedLegacy = normalizeUniqueLegacyRoutes(legacyRoutes);
  const normalizedRuntime =
    runtimeRoutes === undefined
      ? undefined
      : new Set(runtimeRoutes.map(normalizeRouteKey).filter(Boolean));
  const normalizedHits =
    legacyHits === undefined
      ? undefined
      : validateLegacyHits(legacyHits, normalizedLegacy);

  const controllerFiles = await collectFiles(
    root,
    "services/api/src",
    (path) => path.endsWith(".controller.ts")
  );
  const backendRoutes = (
    await Promise.all(
      controllerFiles.map(async (path) =>
        extractBackendRoutes(path, await readSource(root, path))
      )
    )
  )
    .flat()
    .filter((route) => isContractCapability(route.route));

  const wrappers = (
    await Promise.all(
      API_FILES.map(async (path) => {
        try {
          return wrapperRoutes(path, await readSource(root, path));
        } catch (error) {
          if (error?.code === "ENOENT") return [];
          throw error;
        }
      })
    )
  ).flat();
  const exportedWrappers = new Set(wrappers.map((wrapper) => wrapper.name));

  const consumerFiles = [
    ...(await collectFiles(
      root,
      "apps/web-admin/src",
      (path) =>
        /\.(?:ts|tsx|vue|js|mjs)$/.test(path) &&
        !API_FILES.includes(path) &&
        !isTestFile(path)
    )),
    ...(await collectFiles(
      root,
      "services/api/scripts",
      (path) => /\.(?:ts|js|mjs|cjs)$/.test(path) && !isTestFile(path)
    )),
    ...(await collectFiles(
      root,
      "scripts",
      (path) =>
        /\.(?:ts|js|mjs|cjs)$/.test(path) &&
        !path.endsWith("inspect-contract-workbench-capabilities.mjs") &&
        !isTestFile(path)
    ))
  ];

  const consumerResults = await Promise.all(
    consumerFiles.map(async (path) =>
      extractConsumers(path, await readSource(root, path), exportedWrappers)
    )
  );
  const consumers = dedupe(
    consumerResults.flatMap((result) => result.consumers),
    (item) => `${item.wrapper}\0${item.consumer}`
  );
  const missingWrappers = dedupe(
    consumerResults.flatMap((result) => result.missing),
    (item) => `${item.wrapper}\0${item.consumer}`
  ).sort(
    (left, right) =>
      left.consumer.localeCompare(right.consumer) ||
      left.wrapper.localeCompare(right.wrapper)
  );

  const backendByKey = new Map(backendRoutes.map((route) => [route.key, route]));
  const wrapperRequests = wrappers.flatMap((wrapper) =>
    wrapper.requests.map((request) => ({
      ...request,
      wrapper: wrapper.name,
      apiFile: wrapper.apiFile
    }))
  );
  const capabilities = [];

  for (const request of wrapperRequests) {
    const routeConsumers = consumers
      .filter((consumer) => consumer.wrapper === request.wrapper)
      .map((consumer) => consumer.consumer)
      .sort();
    const backend = backendByKey.get(request.key);
    let classification;
    if (!backend) classification = "frontend_without_backend";
    else if (normalizedLegacy.has(request.key)) classification = "legacy_candidate";
    else if (normalizedInternal.has(request.key) && routeConsumers.length === 0) {
      classification = "backend_internal_only";
    } else if (routeConsumers.length === 0) classification = "backend_without_frontend";
    else classification = "matched";
    const missingEvidence =
      classification === "legacy_candidate"
        ? evidenceForLegacy(request.key, normalizedRuntime, normalizedHits)
        : [];
    capabilities.push({
      method: request.method,
      route: request.route,
      wrapper: request.wrapper,
      consumers: routeConsumers,
      backend: backend?.controller ?? null,
      classification,
      decision:
        classification === "backend_internal_only"
          ? "转内部"
          : classification === "frontend_without_backend"
            ? "补入口"
            : classification === "backend_without_frontend"
              ? "补入口"
              : classification === "legacy_candidate" && missingEvidence.length === 0
                ? "删除"
                : "保留",
      missingEvidence
    });
  }

  const wrapperKeys = new Set(wrapperRequests.map((request) => request.key));
  for (const backend of backendRoutes) {
    if (wrapperKeys.has(backend.key)) continue;
    let classification;
    if (normalizedLegacy.has(backend.key)) classification = "legacy_candidate";
    else if (normalizedInternal.has(backend.key)) classification = "backend_internal_only";
    else classification = "backend_without_frontend";
    const missingEvidence =
      classification === "legacy_candidate"
        ? evidenceForLegacy(backend.key, normalizedRuntime, normalizedHits)
        : [];
    capabilities.push({
      method: backend.method,
      route: backend.route,
      wrapper: null,
      consumers: [],
      backend: backend.controller,
      classification,
      decision:
        classification === "backend_internal_only"
          ? "转内部"
          : classification === "legacy_candidate" && missingEvidence.length === 0
            ? "删除"
            : classification === "legacy_candidate"
              ? "保留"
              : "补入口",
      missingEvidence
    });
  }

  capabilities.sort(
    (left, right) =>
      left.route.localeCompare(right.route) ||
      left.method.localeCompare(right.method) ||
      String(left.wrapper).localeCompare(String(right.wrapper))
  );

  const staticRouteKeys = new Set(backendRoutes.map((route) => route.key));
  const runtimeContractRouteKeys =
    normalizedRuntime === undefined
      ? undefined
      : new Set(
          [...normalizedRuntime].filter((key) =>
            isContractCapability(key.slice(key.indexOf(" ") + 1))
          )
        );
  return {
    capabilities,
    missingWrappers,
    evidence: {
      staticControllerRoutes: backendRoutes.length,
      staticApiRequests: wrapperRequests.length,
      runtimeRouteManifestProvided: normalizedRuntime !== undefined,
      runtimeRouteCount: normalizedRuntime?.size ?? null,
      staticRoutesMissingAtRuntime:
        runtimeContractRouteKeys === undefined
          ? null
          : [...staticRouteKeys].filter((key) => !runtimeContractRouteKeys.has(key)).length,
      runtimeRoutesMissingInSource:
        runtimeContractRouteKeys === undefined
          ? null
          : [...runtimeContractRouteKeys].filter((key) => !staticRouteKeys.has(key)).length,
      productionLegacyHitsProvided: normalizedHits !== undefined,
      observationWindow: normalizedHits?.observationWindow ?? null
    }
  };
}

function escapeCell(value) {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function renderMatrix(report) {
  const counts = new Map();
  for (const capability of report.capabilities) {
    counts.set(
      capability.classification,
      (counts.get(capability.classification) ?? 0) + 1
    );
  }
  const evidence = report.evidence;
  const rows = report.capabilities
    .map((item) => {
      const missing =
        item.missingEvidence.length > 0 ? item.missingEvidence.join(", ") : "—";
      return `| ${item.method} | \`${escapeCell(item.route)}\` | ${escapeCell(item.wrapper)} | ${escapeCell(item.consumers.join("<br>"))} | ${item.classification} | ${item.decision} | ${missing} |`;
    })
    .join("\n");
  const missingWrapperRows =
    report.missingWrappers.length === 0
      ? "- 无。"
      : report.missingWrappers
          .map(
            (item) =>
              `- \`${item.consumer}\` 引用了不存在的 API wrapper \`${item.wrapper}\`。`
          )
          .join("\n");

  return `# 合同工作台能力矩阵

> 本文件由 \`scripts/inspect-contract-workbench-capabilities.mjs\` 生成。静态关系不能单独证明生产零调用；“删除”必须同时具备实际 Nest route manifest 和批准观察窗口内的脱敏生产命中计数。

## 证据状态

| 证据 | 状态 |
| --- | --- |
| Controller 源码路由 | 已扫描 ${evidence.staticControllerRoutes} 条 |
| Web API 请求 | 已扫描 ${evidence.staticApiRequests} 条 |
| 实际 Nest route manifest | ${evidence.runtimeRouteManifestProvided ? `已通过 \`app.init()\` 读取，共 ${evidence.runtimeRouteCount} 条；源码缺运行时 ${evidence.staticRoutesMissingAtRuntime} 条，运行时缺源码 ${evidence.runtimeRoutesMissingInSource} 条` : "缺失；所有旧路由删除决定保持阻断"} |
| 生产或生产等价旧路由命中 | ${evidence.productionLegacyHitsProvided ? `已提供；观察窗口 ${escapeCell(evidence.observationWindow)}` : "缺失；不得据静态矩阵执行删除"} |

## 分类汇总

| 分类 | 数量 |
| --- | ---: |
| matched | ${counts.get("matched") ?? 0} |
| frontend_without_backend | ${counts.get("frontend_without_backend") ?? 0} |
| backend_without_frontend | ${counts.get("backend_without_frontend") ?? 0} |
| backend_internal_only | ${counts.get("backend_internal_only") ?? 0} |
| legacy_candidate | ${counts.get("legacy_candidate") ?? 0} |

## 不存在的页面 API wrapper

${missingWrapperRows}

## 能力与决策

| Method | Route | API wrapper | 生产消费者 | 分类 | 决策 | 删除缺失证据 |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## 复核结论

- 主体角色更新/删除、清单余量取消、授权 readiness 和签署材料变更等后端能力，如无生产消费者，保持“补入口”或经业务确认后“转内部”，不能仅因页面缺入口删除。
- \`listContractDrafts\`、void/restore、单行 add/update/delete/reorder 和 checkpoint 创建/恢复以实际消费者分类；只有 route manifest、调用图及生产零命中同时成立，才可由“保留”转为“删除”。
- 台账“删除草稿”当前委托 \`abandonContractDraft\` 调用 \`POST /contracts/:contractVersionId/abandonment\`，并提交 \`delete_pristine_draft\` 领域动作；旧 \`deletePristineContractDraft\` wrapper 无生产消费者。本矩阵不把受控物理 purge 暴露为日常页面能力。
- 当前矩阵没有授权物理删除。Release C1 只允许在证据齐备后退出旧调用代码；checkpoint 表物理删除仍属于需独立授权的 Release C2。
`;
}

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw capabilityInputError(
      "CAPABILITY_JSON_UNREADABLE",
      "Capability evidence JSON could not be read"
    );
  }
  try {
    return JSON.parse(source);
  } catch {
    throw capabilityInputError(
      "CAPABILITY_JSON_INVALID",
      "Capability evidence JSON failed validation"
    );
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write" || value === "--check") {
      result[value.slice(2)] = argv[index + 1];
      index += 1;
    } else if (value === "--runtime-manifest" || value === "--legacy-hits") {
      result[value.slice(2).replace("-", "_")] = argv[index + 1];
      index += 1;
    } else if (value === "--collect-runtime-manifest") {
      result.collect_runtime_manifest = true;
    } else if (value === "--no-runtime-manifest") {
      result.no_runtime_manifest = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (Boolean(args.write) === Boolean(args.check)) {
    throw new Error("Exactly one of --write or --check is required");
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runtimeManifest = args.runtime_manifest
    ? await readJson(resolve(root, args.runtime_manifest))
    : args.no_runtime_manifest
      ? undefined
      : await collectNestRuntimeRoutes(root);
  const legacyHits = args.legacy_hits
    ? await readJson(resolve(root, args.legacy_hits))
    : undefined;
  const report = await inspectCapabilityProject({
    root,
    runtimeRoutes:
      runtimeManifest === undefined
        ? undefined
        : Array.isArray(runtimeManifest)
          ? runtimeManifest
          : runtimeManifest.routes,
    legacyHits
  });
  const markdown = renderMatrix(report);
  const target = resolve(root, args.write ?? args.check);
  if (args.write) {
    await writeFile(target, markdown, "utf8");
    process.stdout.write(
      `${JSON.stringify({ status: "written", target: posixPath(relative(root, target)), ...report.evidence })}\n`
    );
    return;
  }
  const current = await readFile(target, "utf8");
  if (current !== markdown) {
    process.stderr.write(
      `${JSON.stringify({ status: "drift", target: posixPath(relative(root, target)) })}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ status: "matched", target: posixPath(relative(root, target)), ...report.evidence })}\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const safeInputError =
      typeof error?.code === "string" &&
      error.code.startsWith("CAPABILITY_");
    process.stderr.write(
      `${JSON.stringify({
        status: "blocked",
        code: safeInputError
          ? error.code
          : "CAPABILITY_INSPECTION_FAILED",
        message: safeInputError
          ? error.message
          : "Capability inspection failed"
      })}\n`
    );
    process.exitCode = 1;
  });
}

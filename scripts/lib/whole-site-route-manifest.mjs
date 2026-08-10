import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep
} from "node:path";

const AUTHORIZATION_SCOPE = "guard_metadata_only";
const SCHEMA_VERSION = 1;
const INSPECTION_ENV_KEYS = [
  "SKIP_DATABASE_CONNECT",
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_ROOT",
  "FILE_DOWNLOAD_SECRET",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET"
];
const REQUIRED_BUILD_CONFIGS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "services/api/package.json",
  "services/api/nest-cli.json",
  "services/api/tsconfig.json",
  "services/api/tsconfig.build.json",
  "packages/shared-domain/package.json",
  "packages/shared-domain/tsconfig.json"
];

function manifestError(code) {
  const error = new Error("Route manifest inspection failed");
  error.code = code;
  return error;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function metadataArray(value, { defaultValue, code }) {
  const resolved = value === undefined ? defaultValue : value;
  const values = Array.isArray(resolved) ? resolved : [resolved];
  if (
    values.length === 0 ||
    values.some((item) => typeof item !== "string")
  ) {
    throw manifestError(code);
  }
  return values;
}

function requestMethods(value, requestMethodNames) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    throw manifestError("ROUTE_MANIFEST_INVALID_METHOD_METADATA");
  }
  return values.map((item) => {
    const method = requestMethodNames.get(item);
    if (typeof method !== "string" || !method) {
      throw manifestError("ROUTE_MANIFEST_INVALID_METHOD_METADATA");
    }
    return method.toUpperCase();
  });
}

function booleanMetadata(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw manifestError("ROUTE_MANIFEST_INVALID_GUARD_METADATA");
  }
  return value;
}

function overriddenMetadata(reflector, key, handler, controllerClass) {
  return reflector.getAllAndOverride(key, [handler, controllerClass]);
}

function normalizeRequiredPositions(value, roleKeys) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((position) => typeof position !== "string")
  ) {
    throw manifestError("ROUTE_MANIFEST_INVALID_GUARD_METADATA");
  }
  const allowed = new Set(roleKeys);
  for (const position of value) {
    if (!allowed.has(position)) {
      throw manifestError("ROUTE_MANIFEST_UNKNOWN_POSITION");
    }
  }
  return [...new Set(value)].sort(compareStrings);
}

function normalizeRequiredAction(value, businessActions) {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw manifestError("ROUTE_MANIFEST_INVALID_GUARD_METADATA");
  }
  if (!new Set(businessActions).has(value)) {
    throw manifestError("ROUTE_MANIFEST_UNKNOWN_ACTION");
  }
  return value;
}

function guardAuthorization({
  isPublic,
  requiredPositions,
  requiredProjectAction
}) {
  if (requiredPositions.length && requiredProjectAction) {
    return "positions_and_project_action";
  }
  if (requiredPositions.length) return "positions";
  if (requiredProjectAction) return "project_action";
  return isPublic ? "public" : "authenticated_only";
}

function rawRoutePath(controllerPath, handlerPath) {
  const combined = [controllerPath, handlerPath]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return combined ? `/${combined}`.replace(/\/+/g, "/") : "/";
}

export function normalizeRoutePath(path) {
  if (typeof path !== "string") {
    throw manifestError("ROUTE_MANIFEST_INVALID_PATH_METADATA");
  }
  const normalized = `/${path}`
    .replace(/\/+/g, "/")
    .replace(
      /(^|\/):[A-Za-z_][A-Za-z0-9_]*(?:\([^/]*\))?[?+*]?/g,
      "$1:param"
    )
    .replace(/\/$/, "");
  return normalized || "/";
}

export function controllerSourceKey(controller, handler) {
  return `${controller}\u0000${handler}`;
}

async function controllerSourceFiles(root) {
  const sourceRoot = join(root, "services/api/src");
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".controller.ts") &&
        !/\.(?:spec|test)\.ts$/.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }
  await visit(sourceRoot);
  return files;
}

async function recursiveFiles(directory, accept) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && accept(entry.name)) {
        files.push(path);
      }
    }
  }
  await visit(directory);
  return files;
}

async function buildInputFiles(root) {
  const inputs = new Set(
    REQUIRED_BUILD_CONFIGS.map((path) => join(root, path))
  );
  for (const sourceRoot of [
    join(root, "services/api/src"),
    join(root, "packages/shared-domain/src")
  ]) {
    for (const path of await recursiveFiles(sourceRoot, (name) =>
      name.endsWith(".ts")
    )) {
      inputs.add(path);
    }
  }
  for (const configRoot of [
    join(root, "services/api"),
    join(root, "packages/shared-domain")
  ]) {
    for (const path of await recursiveFiles(
      configRoot,
      (name) => /^tsconfig(?:\.[^.]+)*\.json$/.test(name)
    )) {
      inputs.add(path);
    }
  }
  return [...inputs].sort(compareStrings);
}

export async function assertBuildArtifactFresh({ root }) {
  const resolvedRoot = resolve(root);
  const artifactPath = join(
    resolvedRoot,
    "services/api/dist/app.module.js"
  );
  let artifactStats;
  let inputs;
  try {
    [artifactStats, inputs] = await Promise.all([
      stat(artifactPath, { bigint: true }),
      buildInputFiles(resolvedRoot)
    ]);
  } catch {
    throw manifestError("ROUTE_MANIFEST_BUILD_STALE");
  }
  if (!artifactStats.isFile() || inputs.length === 0) {
    throw manifestError("ROUTE_MANIFEST_BUILD_STALE");
  }
  for (const input of inputs) {
    let inputStats;
    try {
      inputStats = await stat(input, { bigint: true });
    } catch {
      throw manifestError("ROUTE_MANIFEST_BUILD_STALE");
    }
    if (!inputStats.isFile() || inputStats.mtimeNs > artifactStats.mtimeNs) {
      throw manifestError("ROUTE_MANIFEST_BUILD_STALE");
    }
  }
}

function propertyName(typescript, node) {
  if (
    typescript.isIdentifier(node) ||
    typescript.isStringLiteral(node) ||
    typescript.isNumericLiteral(node)
  ) {
    return node.text;
  }
  return null;
}

export async function indexControllerSources({ root, typescript }) {
  if (!typescript?.createSourceFile) {
    throw manifestError("ROUTE_MANIFEST_SOURCE_MAPPING_INVALID");
  }
  const index = new Map();
  for (const absolutePath of await controllerSourceFiles(root)) {
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = typescript.createSourceFile(
      absolutePath,
      source,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS
    );
    if (sourceFile.parseDiagnostics?.length) {
      throw manifestError("ROUTE_MANIFEST_SOURCE_MAPPING_INVALID");
    }
    const relativePath = posixPath(relative(root, absolutePath));
    for (const statement of sourceFile.statements) {
      if (!typescript.isClassDeclaration(statement) || !statement.name) continue;
      const controllerName = statement.name.text;
      for (const member of statement.members) {
        if (!typescript.isMethodDeclaration(member) || !member.name) continue;
        const handlerName = propertyName(typescript, member.name);
        if (!handlerName) continue;
        const key = controllerSourceKey(controllerName, handlerName);
        if (index.has(key)) {
          throw manifestError("ROUTE_MANIFEST_SOURCE_MAPPING_DUPLICATE");
        }
        index.set(key, relativePath);
      }
    }
  }
  return index;
}

export function collectControllerRouteManifest({
  modulesContainer,
  metadataScanner,
  reflector,
  sourceIndex,
  metadataKeys,
  requestMethodNames,
  roleKeys,
  businessActions
}) {
  if (
    !modulesContainer?.values ||
    !metadataScanner?.getAllMethodNames ||
    !reflector?.get ||
    !reflector?.getAllAndOverride ||
    !(sourceIndex instanceof Map) ||
    !(requestMethodNames instanceof Map)
  ) {
    throw manifestError("ROUTE_MANIFEST_RUNTIME_METADATA_UNAVAILABLE");
  }

  const routes = [];
  const normalizedKeys = new Set();
  for (const moduleRef of modulesContainer.values()) {
    if (!moduleRef?.controllers?.values) {
      throw manifestError("ROUTE_MANIFEST_RUNTIME_METADATA_UNAVAILABLE");
    }
    for (const wrapper of moduleRef.controllers.values()) {
      const controllerClass = wrapper?.metatype;
      const prototype = controllerClass?.prototype;
      const controllerName = controllerClass?.name;
      if (
        typeof controllerClass !== "function" ||
        !prototype ||
        typeof controllerName !== "string" ||
        !controllerName
      ) {
        throw manifestError("ROUTE_MANIFEST_RUNTIME_METADATA_UNAVAILABLE");
      }

      const controllerPaths = metadataArray(
        reflector.get(metadataKeys.path, controllerClass),
        {
          defaultValue: "",
          code: "ROUTE_MANIFEST_INVALID_PATH_METADATA"
        }
      );
      const methodNames = metadataScanner.getAllMethodNames(prototype);
      for (const handlerName of methodNames) {
        const handler = prototype[handlerName];
        if (typeof handler !== "function") {
          throw manifestError("ROUTE_MANIFEST_RUNTIME_METADATA_UNAVAILABLE");
        }
        const methodMetadata = reflector.get(metadataKeys.method, handler);
        if (methodMetadata === undefined) continue;

        const sourceFile = sourceIndex.get(
          controllerSourceKey(controllerName, handlerName)
        );
        if (!sourceFile) {
          throw manifestError("ROUTE_MANIFEST_SOURCE_MAPPING_MISSING");
        }
        const handlerPaths = metadataArray(
          reflector.get(metadataKeys.path, handler),
          {
            defaultValue: "",
            code: "ROUTE_MANIFEST_INVALID_PATH_METADATA"
          }
        );
        const methods = requestMethods(methodMetadata, requestMethodNames);
        const isPublic = booleanMetadata(
          overriddenMetadata(
            reflector,
            metadataKeys.isPublic,
            handler,
            controllerClass
          )
        );
        const requiredPositions = normalizeRequiredPositions(
          overriddenMetadata(
            reflector,
            metadataKeys.requiredPositions,
            handler,
            controllerClass
          ),
          roleKeys
        );
        const requiredProjectAction = normalizeRequiredAction(
          overriddenMetadata(
            reflector,
            metadataKeys.requiredProjectAction,
            handler,
            controllerClass
          ),
          businessActions
        );
        if (
          isPublic &&
          (requiredPositions.length > 0 || requiredProjectAction !== null)
        ) {
          throw manifestError("ROUTE_MANIFEST_CONFLICTING_GUARD_METADATA");
        }
        const contractCutoverSurface = booleanMetadata(
          overriddenMetadata(
            reflector,
            metadataKeys.contractCutoverSurface,
            handler,
            controllerClass
          )
        );
        const contractCutoverLegacyWrite = booleanMetadata(
          overriddenMetadata(
            reflector,
            metadataKeys.contractCutoverLegacyWrite,
            handler,
            controllerClass
          )
        );
        const contractCutoverTombstoneWrite = booleanMetadata(
          overriddenMetadata(
            reflector,
            metadataKeys.contractCutoverTombstoneWrite,
            handler,
            controllerClass
          )
        );
        if (
          (contractCutoverLegacyWrite || contractCutoverTombstoneWrite) &&
          !contractCutoverSurface
        ) {
          throw manifestError("ROUTE_MANIFEST_INVALID_GUARD_METADATA");
        }

        for (const controllerPath of controllerPaths) {
          for (const handlerPath of handlerPaths) {
            const path = rawRoutePath(controllerPath, handlerPath);
            for (const method of methods) {
              const normalizedKey = `${method} ${normalizeRoutePath(path)}`;
              if (normalizedKeys.has(normalizedKey)) {
                throw manifestError("ROUTE_MANIFEST_DUPLICATE_ROUTE");
              }
              normalizedKeys.add(normalizedKey);
              routes.push({
                method,
                path,
                normalizedKey,
                controller: controllerName,
                handler: handlerName,
                sourceFile,
                authorizationScope: AUTHORIZATION_SCOPE,
                authentication: isPublic ? "public" : "authenticated",
                guardAuthorization: guardAuthorization({
                  isPublic,
                  requiredPositions,
                  requiredProjectAction
                }),
                isPublic,
                requiredPositions,
                requiredProjectAction,
                authorizationCombination:
                  requiredPositions.length && requiredProjectAction
                    ? "AND"
                    : null,
                contractCutoverSurface,
                contractCutoverLegacyWrite,
                contractCutoverTombstoneWrite
              });
            }
          }
        }
      }
    }
  }
  return routes.sort((left, right) =>
    compareStrings(left.normalizedKey, right.normalizedKey)
  );
}

function normalizedKeyFromRoute(value) {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.method === "string" &&
    typeof value.path === "string"
  ) {
    return `${value.method.toUpperCase()} ${normalizeRoutePath(value.path)}`;
  }
  if (typeof value !== "string") {
    throw manifestError("ROUTE_MANIFEST_RUNTIME_DRIFT");
  }
  const match = value.match(/^([A-Za-z_]+)\s+(\/.*)$/);
  if (!match) {
    throw manifestError("ROUTE_MANIFEST_RUNTIME_DRIFT");
  }
  return `${match[1].replace(/^_/, "").toUpperCase()} ${normalizeRoutePath(
    match[2]
  )}`;
}

function routeKeyMultiset(routes) {
  const counts = new Map();
  for (const route of routes) {
    const key = normalizedKeyFromRoute(route);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function assertRuntimeRouteParity(metadataRoutes, expressRoutes) {
  if (!Array.isArray(metadataRoutes) || !Array.isArray(expressRoutes)) {
    throw manifestError("ROUTE_MANIFEST_RUNTIME_DRIFT");
  }
  const metadata = routeKeyMultiset(metadataRoutes);
  const express = routeKeyMultiset(expressRoutes);
  if (metadata.size !== express.size) {
    throw manifestError("ROUTE_MANIFEST_RUNTIME_DRIFT");
  }
  for (const [key, count] of metadata) {
    if (express.get(key) !== count) {
      throw manifestError("ROUTE_MANIFEST_RUNTIME_DRIFT");
    }
  }
}

function expressAllMethodSet(allMethods) {
  if (
    !Array.isArray(allMethods) ||
    allMethods.length === 0 ||
    allMethods.some((method) => typeof method !== "string" || !method)
  ) {
    throw manifestError("ROUTE_MANIFEST_EXPRESS_METHODS_UNAVAILABLE");
  }
  return new Set(allMethods.map((method) => method.toLowerCase()));
}

export function collectExpressRouteKeys(app, allMethods) {
  const instance = app?.getHttpAdapter?.().getInstance?.();
  const stack = instance?._router?.stack ?? instance?.router?.stack;
  if (!Array.isArray(stack)) {
    throw manifestError("ROUTE_MANIFEST_EXPRESS_STACK_UNAVAILABLE");
  }
  const allMethodSet = expressAllMethodSet(allMethods);
  const routes = [];
  for (const layer of stack) {
    if (!layer?.route?.methods) continue;
    const paths = Array.isArray(layer.route.path)
      ? layer.route.path
      : [layer.route.path];
    if (paths.some((path) => typeof path !== "string")) {
      throw manifestError("ROUTE_MANIFEST_EXPRESS_STACK_UNAVAILABLE");
    }
    const enabledMethods = Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => method.toLowerCase());
    const concreteMethods = enabledMethods
      .filter((method) => method !== "_all")
      .sort(compareStrings);
    const representsAll =
      enabledMethods.includes("_all") ||
      (concreteMethods.length === allMethodSet.size &&
        concreteMethods.every((method) => allMethodSet.has(method)));
    const methods = representsAll ? ["ALL"] : concreteMethods;
    for (const method of methods) {
      for (const path of paths) {
        routes.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return routes;
}

export function renderRouteManifest(routes) {
  if (!Array.isArray(routes)) {
    throw manifestError("ROUTE_MANIFEST_RENDER_INVALID");
  }
  const sorted = [...routes].sort((left, right) =>
    compareStrings(String(left.normalizedKey), String(right.normalizedKey))
  );
  return `${JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      authorizationScope: AUTHORIZATION_SCOPE,
      routes: sorted
    },
    null,
    2
  )}\n`;
}

export async function writeOrCheckRouteManifest({
  mode,
  targetPath,
  rendered
}) {
  if (
    (mode !== "write" && mode !== "check") ||
    typeof targetPath !== "string" ||
    !targetPath ||
    typeof rendered !== "string"
  ) {
    throw manifestError("ROUTE_MANIFEST_CLI_INVALID");
  }
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered, "utf8");
    return;
  }
  let current;
  try {
    current = await readFile(targetPath, "utf8");
  } catch {
    throw manifestError("ROUTE_MANIFEST_BASELINE_DRIFT");
  }
  if (current !== rendered) {
    throw manifestError("ROUTE_MANIFEST_BASELINE_DRIFT");
  }
}

function snapshotEnvironment() {
  return new Map(
    INSPECTION_ENV_KEYS.map((key) => [key, process.env[key]])
  );
}

function restoreEnvironment(snapshot) {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function requestMethodNameMap(RequestMethod) {
  const names = new Map();
  for (const [name, value] of Object.entries(RequestMethod)) {
    if (Number.isInteger(value)) names.set(value, name);
  }
  return names;
}

export async function inspectBuiltNestRouteManifest({ root }) {
  const resolvedRoot = resolve(root);
  await assertBuildArtifactFresh({ root: resolvedRoot });
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "jgzg-whole-site-route-manifest-")
  );
  const environment = snapshotEnvironment();
  Object.assign(process.env, {
    SKIP_DATABASE_CONNECT: "true",
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: join(temporaryRoot, "private"),
    FILE_DOWNLOAD_SECRET: "whole-site-route-manifest-local-file-secret",
    JWT_ACCESS_SECRET: "whole-site-route-manifest-local-access-secret",
    JWT_REFRESH_SECRET: "whole-site-route-manifest-local-refresh-secret"
  });

  let app;
  let processorPrototype;
  let processorBootstrap;
  let closeFailed = false;
  try {
    const apiRequire = createRequire(
      join(resolvedRoot, "services/api/package.json")
    );
    const platformExpressRequire = createRequire(
      apiRequire.resolve("@nestjs/platform-express/package.json")
    );
    apiRequire("reflect-metadata");
    const {
      MetadataScanner,
      ModulesContainer,
      NestFactory,
      Reflector
    } = apiRequire("@nestjs/core");
    const { RequestMethod } = apiRequire("@nestjs/common");
    const { METHOD_METADATA, PATH_METADATA } = apiRequire(
      "@nestjs/common/constants"
    );
    const { ROLE_KEYS, BUSINESS_ACTIONS } = apiRequire(
      "@jiangkong/shared-domain"
    );
    const { IS_PUBLIC_KEY } = apiRequire(
      join(
        resolvedRoot,
        "services/api/dist/auth/decorators/public.decorator.js"
      )
    );
    const { REQUIRED_POSITIONS_KEY } = apiRequire(
      join(
        resolvedRoot,
        "services/api/dist/auth/decorators/require-positions.decorator.js"
      )
    );
    const { REQUIRED_PROJECT_ACTION_KEY } = apiRequire(
      join(
        resolvedRoot,
        "services/api/dist/auth/decorators/require-project-role.decorator.js"
      )
    );
    const {
      CONTRACT_CUTOVER_LEGACY_WRITE_KEY,
      CONTRACT_CUTOVER_SURFACE_KEY,
      CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY
    } = apiRequire(
      join(
        resolvedRoot,
        "services/api/dist/contract-cutover/contract-cutover.decorators.js"
      )
    );
    const { ContractDocumentProcessor } = apiRequire(
      join(
        resolvedRoot,
        "services/api/dist/contract-document/contract-document.processor.js"
      )
    );
    const { AppModule } = apiRequire(
      join(resolvedRoot, "services/api/dist/app.module.js")
    );
    if (
      typeof AppModule !== "function" ||
      typeof ContractDocumentProcessor !== "function"
    ) {
      throw manifestError("ROUTE_MANIFEST_BUILD_UNAVAILABLE");
    }

    processorPrototype = ContractDocumentProcessor.prototype;
    processorBootstrap = processorPrototype.onApplicationBootstrap;
    processorPrototype.onApplicationBootstrap = () => undefined;

    const sourceIndex = await indexControllerSources({
      root: resolvedRoot,
      typescript: apiRequire("typescript")
    });
    app = await NestFactory.create(AppModule, { logger: false });
    const routes = collectControllerRouteManifest({
      modulesContainer: app.get(ModulesContainer),
      metadataScanner: new MetadataScanner(),
      reflector: app.get(Reflector),
      sourceIndex,
      metadataKeys: {
        path: PATH_METADATA,
        method: METHOD_METADATA,
        isPublic: IS_PUBLIC_KEY,
        requiredPositions: REQUIRED_POSITIONS_KEY,
        requiredProjectAction: REQUIRED_PROJECT_ACTION_KEY,
        contractCutoverSurface: CONTRACT_CUTOVER_SURFACE_KEY,
        contractCutoverLegacyWrite: CONTRACT_CUTOVER_LEGACY_WRITE_KEY,
        contractCutoverTombstoneWrite: CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY
      },
      requestMethodNames: requestMethodNameMap(RequestMethod),
      roleKeys: ROLE_KEYS,
      businessActions: BUSINESS_ACTIONS
    });
    await app.init();
    assertRuntimeRouteParity(
      routes,
      collectExpressRouteKeys(app, platformExpressRequire("methods"))
    );
    return routes;
  } catch (error) {
    if (error?.code?.startsWith?.("ROUTE_MANIFEST_")) throw error;
    throw manifestError("ROUTE_MANIFEST_INSPECTION_FAILED");
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {
        closeFailed = true;
      }
    }
    if (processorPrototype && processorBootstrap) {
      processorPrototype.onApplicationBootstrap = processorBootstrap;
    }
    restoreEnvironment(environment);
    await rm(temporaryRoot, { recursive: true, force: true });
    if (closeFailed) {
      throw manifestError("ROUTE_MANIFEST_RESOURCE_CLOSE_FAILED");
    }
  }
}

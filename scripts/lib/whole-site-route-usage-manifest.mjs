import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { normalizeRoutePath } from "./whole-site-route-manifest.mjs";
import { normalizeWebApiPath } from "./whole-site-web-api-manifest.mjs";

const SCHEMA_VERSION = 1;
const NEST_MANIFEST_PATH =
  "docs/product/manifests/nest-business-routes.json";
const WEB_MANIFEST_PATH =
  "docs/product/manifests/web-api-wrappers.json";
const REGISTRY_PATH =
  "docs/product/manifests/route-usage.registry.json";
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT"
]);
const ROUTE_USAGES = new Set([
  "page",
  "external_takeover",
  "exit_candidate",
  "internal_task"
]);
const CONSUMER_SURFACES = [
  "web_api_wrapper",
  "auth_store",
  "signed_ticket_delivery",
  "machine_probe",
  "operator_endpoint",
  "none"
];
const MANUAL_CONSUMER_SURFACES = new Set([
  "signed_ticket_delivery",
  "machine_probe",
  "operator_endpoint"
]);
const PAGE_CONSUMER_SURFACES = new Set([
  "web_api_wrapper",
  "auth_store",
  "signed_ticket_delivery"
]);
const INTERNAL_CONSUMER_SURFACES = new Set([
  "machine_probe",
  "operator_endpoint"
]);
const EXIT_CANDIDATE_SEMANTICS =
  "candidate_only_no_deletion_authorization";

function manifestError(code) {
  const error = new Error("Route usage manifest inspection failed");
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
  return posixPath(relative(root, value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function uniqueStrings(values) {
  return [...new Set(values)].sort(compareStrings);
}

function exactKey(method, path) {
  return `${method} ${path}`;
}

function digestEntries(entries, identityFor) {
  return createHash("sha256")
    .update(entries.map(identityFor).sort(compareStrings).join("\n"))
    .digest("hex");
}

function compareExactRoutes(left, right) {
  return (
    compareStrings(left.method, right.method) ||
    compareStrings(left.path, right.path)
  );
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

function validateNestManifest(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(manifest.routes)
  ) {
    throw manifestError("ROUTE_USAGE_NEST_MANIFEST_INVALID");
  }
  const exactKeys = new Set();
  const normalizedKeys = new Set();
  const routes = manifest.routes.map((route) => {
    if (
      !isRecord(route) ||
      !HTTP_METHODS.has(route.method) ||
      !isNonEmptyString(route.path) ||
      !route.path.startsWith("/") ||
      !isNonEmptyString(route.normalizedKey) ||
      route.normalizedKey !==
        `${route.method} ${normalizeRoutePath(route.path)}` ||
      !isNonEmptyString(route.controller) ||
      !isNonEmptyString(route.handler) ||
      !isNonEmptyString(route.sourceFile)
    ) {
      throw manifestError("ROUTE_USAGE_NEST_MANIFEST_INVALID");
    }
    const key = exactKey(route.method, route.path);
    if (exactKeys.has(key)) {
      throw manifestError(
        "ROUTE_USAGE_NEST_EXACT_ROUTE_DUPLICATE"
      );
    }
    if (normalizedKeys.has(route.normalizedKey)) {
      throw manifestError(
        "ROUTE_USAGE_NEST_NORMALIZED_ROUTE_DUPLICATE"
      );
    }
    exactKeys.add(key);
    normalizedKeys.add(route.normalizedKey);
    return {
      ...route,
      sourceFile: posixPath(route.sourceFile)
    };
  });
  return routes.sort(compareExactRoutes);
}

function validateWebManifest(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(manifest.wrappers) ||
    !Array.isArray(manifest.authTransportExceptions)
  ) {
    throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
  }
  return manifest;
}

function validateCountMap(value, keys) {
  return (
    isRecord(value) &&
    keys.every((key) => isNonNegativeInteger(value[key])) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function validateRegistry(registry) {
  const usageKeys = [
    "page",
    "external_takeover",
    "exit_candidate",
    "internal_task",
    "unclassified"
  ];
  if (
    !isRecord(registry) ||
    registry.schemaVersion !== SCHEMA_VERSION ||
    registry.authorizationScope !==
      "route_usage_classification_only" ||
    registry.exitCandidateSemantics !==
      EXIT_CANDIDATE_SEMANTICS ||
    !Array.isArray(registry.overrides) ||
    !Array.isArray(registry.consumerSurfaceOverrides) ||
    !isRecord(registry.expectations) ||
    !isNonNegativeInteger(registry.expectations.routeCount) ||
    !isNonNegativeInteger(
      registry.expectations.classificationOverrideCount
    ) ||
    !isNonNegativeInteger(
      registry.expectations.derivedProductionPageCount
    ) ||
    !/^[a-f0-9]{64}$/.test(
      registry.expectations.classificationOverrideSha256
    ) ||
    !/^[a-f0-9]{64}$/.test(
      registry.expectations.consumerSurfaceOverrideSha256
    ) ||
    !validateCountMap(
      registry.expectations.usageCounts,
      usageKeys
    ) ||
    !validateCountMap(
      registry.expectations.consumerSurfaceCounts,
      CONSUMER_SURFACES
    )
  ) {
    throw manifestError("ROUTE_USAGE_REGISTRY_INVALID");
  }
  return registry;
}

function registryEntryIssue(entry) {
  if (!isRecord(entry)) return "entry_not_object";
  if (!HTTP_METHODS.has(entry.method)) return "method_invalid";
  if (
    !isNonEmptyString(entry.path) ||
    !entry.path.startsWith("/")
  ) {
    return "path_invalid";
  }
  if (!ROUTE_USAGES.has(entry.usage)) return "usage_invalid";
  if (!isNonEmptyString(entry.reason)) return "reason_invalid";
  return null;
}

function consumerSurfaceEntryIssue(entry) {
  if (!isRecord(entry)) return "entry_not_object";
  if (!HTTP_METHODS.has(entry.method)) return "method_invalid";
  if (
    !isNonEmptyString(entry.path) ||
    !entry.path.startsWith("/")
  ) {
    return "path_invalid";
  }
  if (!MANUAL_CONSUMER_SURFACES.has(entry.consumerSurface)) {
    return "consumer_surface_invalid";
  }
  if (!isNonEmptyString(entry.reason)) return "reason_invalid";
  if (entry.consumerSurface === "signed_ticket_delivery") {
    if (
      !Array.isArray(entry.ticketFollowups) ||
      entry.ticketFollowups.length === 0 ||
      entry.ticketFollowups.some(
        (followup) =>
          !isRecord(followup) ||
          !["GET", "HEAD"].includes(followup.method) ||
          !isNonEmptyString(followup.apiFile) ||
          !isNonEmptyString(followup.wrapper) ||
          !isNonEmptyString(followup.ticketField)
      )
    ) {
      return "ticket_followups_invalid";
    }
    const identities = entry.ticketFollowups.map((followup) =>
      [
        posixPath(followup.apiFile),
        followup.wrapper,
        followup.method,
        followup.ticketField
      ].join("\u0000")
    );
    if (new Set(identities).size !== identities.length) {
      return "ticket_followups_duplicate";
    }
  } else if (entry.ticketFollowups !== undefined) {
    return "ticket_followups_unexpected";
  }
  return null;
}

function normalizeRegistryEntries({
  entries,
  issueFor,
  duplicateBlocker,
  invalidBlocker
}) {
  const groups = new Map();
  entries.forEach((entry, index) => {
    const issue = issueFor(entry);
    if (issue) {
      invalidBlocker.push({
        index,
        exactKey:
          isNonEmptyString(entry?.method) &&
          isNonEmptyString(entry?.path)
            ? exactKey(entry.method, entry.path)
            : null,
        issue
      });
      return;
    }
    const normalized = {
      ...entry,
      reason: entry.reason.trim(),
      ...(Array.isArray(entry.ticketFollowups)
        ? {
            ticketFollowups: entry.ticketFollowups
              .map((followup) => ({
                apiFile: posixPath(followup.apiFile),
                wrapper: followup.wrapper,
                method: followup.method,
                ticketField: followup.ticketField
              }))
              .sort(
                (left, right) =>
                  compareStrings(left.apiFile, right.apiFile) ||
                  compareStrings(left.wrapper, right.wrapper) ||
                  compareStrings(left.method, right.method) ||
                  compareStrings(
                    left.ticketField,
                    right.ticketField
                  )
              )
          }
        : {})
    };
    const key = exactKey(normalized.method, normalized.path);
    const group = groups.get(key) ?? [];
    group.push(normalized);
    groups.set(key, group);
  });
  const unique = new Map();
  for (const [key, group] of groups) {
    if (group.length > 1) {
      duplicateBlocker.push({
        exactKey: key,
        count: group.length
      });
      continue;
    }
    unique.set(key, group[0]);
  }
  return unique;
}

function wrapperEvidence(webManifest) {
  const byRoute = new Map();
  const ticketFollowups = [];
  const wrapperIdentities = new Set();
  const requestIdentities = new Set();
  for (const wrapper of webManifest.wrappers) {
    if (
      !isRecord(wrapper) ||
      !isNonEmptyString(wrapper.name) ||
      !isNonEmptyString(wrapper.apiFile) ||
      !Array.isArray(wrapper.requests) ||
      !Array.isArray(wrapper.productionConsumers)
    ) {
      throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
    }
    const wrapperIdentity = [
      posixPath(wrapper.apiFile),
      wrapper.name
    ].join("\u0000");
    if (wrapperIdentities.has(wrapperIdentity)) {
      throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
    }
    wrapperIdentities.add(wrapperIdentity);
    const productionConsumers = uniqueStrings(
      wrapper.productionConsumers.filter(isNonEmptyString).map(posixPath)
    );
    if (productionConsumers.length === 0) continue;
    for (const request of wrapper.requests) {
      if (
        !isRecord(request) ||
        !["main", "ticket_followup"].includes(request.kind)
      ) {
        throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
      }
      const requestIdentity = [
        wrapperIdentity,
        request.kind,
        request.normalizedKey ?? request.ticketField ?? ""
      ].join("\u0000");
      if (requestIdentities.has(requestIdentity)) {
        throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
      }
      requestIdentities.add(requestIdentity);
      if (request.kind === "ticket_followup") {
        if (
          !["GET", "HEAD"].includes(request.method) ||
          !isNonEmptyString(request.ticketField)
        ) {
          throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
        }
        ticketFollowups.push({
          apiFile: posixPath(wrapper.apiFile),
          wrapper: wrapper.name,
          method: request.method,
          ticketField: request.ticketField,
          sourceLine: Number.isInteger(request.sourceLine)
            ? request.sourceLine
            : null,
          productionConsumers
        });
        continue;
      }
      if (request.kind !== "main") continue;
      if (
        !HTTP_METHODS.has(request.method) ||
        !isNonEmptyString(request.normalizedPath) ||
        request.normalizedPath !==
          normalizeWebApiPath(request.normalizedPath) ||
        !isNonEmptyString(request.normalizedKey) ||
        request.normalizedKey !==
          `${request.method} ${request.normalizedPath}`
      ) {
        throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
      }
      const evidence = {
        apiFile: posixPath(wrapper.apiFile),
        wrapper: wrapper.name,
        method: request.method,
        normalizedPath: request.normalizedPath ?? null,
        normalizedKey: request.normalizedKey,
        productionConsumers
      };
      const group = byRoute.get(request.normalizedKey) ?? [];
      group.push(evidence);
      byRoute.set(request.normalizedKey, group);
    }
  }
  for (const group of byRoute.values()) {
    group.sort(
      (left, right) =>
        compareStrings(left.apiFile, right.apiFile) ||
        compareStrings(left.wrapper, right.wrapper)
    );
  }
  ticketFollowups.sort(
    (left, right) =>
      compareStrings(left.apiFile, right.apiFile) ||
      compareStrings(left.wrapper, right.wrapper) ||
      compareStrings(left.ticketField, right.ticketField)
  );
  return { byRoute, ticketFollowups };
}

function authEvidence(webManifest) {
  const byRoute = new Map();
  for (const entry of webManifest.authTransportExceptions) {
    if (
      !isRecord(entry) ||
      !HTTP_METHODS.has(entry.method) ||
      !isNonEmptyString(entry.normalizedPath) ||
      entry.normalizedPath !==
        normalizeWebApiPath(entry.normalizedPath) ||
      !isNonEmptyString(entry.normalizedKey) ||
      entry.normalizedKey !==
        `${entry.method} ${entry.normalizedPath}` ||
      !isNonEmptyString(entry.sourceFile)
    ) {
      throw manifestError("ROUTE_USAGE_WEB_MANIFEST_INVALID");
    }
    const group = byRoute.get(entry.normalizedKey) ?? [];
    group.push({
      method: entry.method,
      normalizedPath: entry.normalizedPath ?? null,
      normalizedKey: entry.normalizedKey,
      sourceFile: posixPath(entry.sourceFile),
      transport: entry.transport ?? "auth_store_exception"
    });
    byRoute.set(entry.normalizedKey, group);
  }
  for (const group of byRoute.values()) {
    group.sort((left, right) =>
      compareStrings(left.sourceFile, right.sourceFile)
    );
  }
  return byRoute;
}

function ticketFollowupIdentity(followup) {
  return [
    posixPath(followup.apiFile),
    followup.wrapper,
    followup.method,
    followup.ticketField
  ].join("\u0000");
}

function emptyBlockers() {
  return {
    invalidRegistryEntries: [],
    duplicateRegistryEntries: [],
    staleRegistryEntries: [],
    invalidConsumerSurfaceEntries: [],
    duplicateConsumerSurfaceEntries: [],
    staleConsumerSurfaceEntries: [],
    productionWebRoutesWithoutNest: [],
    authRoutesWithoutNest: [],
    classificationConflicts: [],
    expectationMismatches: [],
    unclassifiedRoutes: []
  };
}

function blockerCount(blockers) {
  return Object.values(blockers).reduce(
    (total, entries) => total + entries.length,
    0
  );
}

function addExpectationMismatch(
  blockers,
  field,
  expected,
  actual
) {
  if (expected === actual) return;
  blockers.expectationMismatches.push({
    field,
    expected,
    actual
  });
}

function sortBlockers(blockers) {
  sortRecords(blockers.invalidRegistryEntries, [
    "index",
    "exactKey",
    "issue"
  ]);
  sortRecords(blockers.duplicateRegistryEntries, ["exactKey"]);
  sortRecords(blockers.staleRegistryEntries, ["exactKey"]);
  sortRecords(blockers.invalidConsumerSurfaceEntries, [
    "index",
    "exactKey",
    "issue"
  ]);
  sortRecords(blockers.duplicateConsumerSurfaceEntries, [
    "exactKey"
  ]);
  sortRecords(blockers.staleConsumerSurfaceEntries, ["exactKey"]);
  sortRecords(blockers.productionWebRoutesWithoutNest, [
    "normalizedKey"
  ]);
  sortRecords(blockers.authRoutesWithoutNest, ["normalizedKey"]);
  sortRecords(blockers.classificationConflicts, [
    "exactKey",
    "code"
  ]);
  sortRecords(blockers.expectationMismatches, ["field"]);
  sortRecords(blockers.unclassifiedRoutes, [
    "method",
    "path"
  ]);
}

function routeSummary(routes) {
  const usageCounts = {
    page: 0,
    external_takeover: 0,
    exit_candidate: 0,
    internal_task: 0,
    unclassified: 0
  };
  const consumerSurfaceCounts = Object.fromEntries(
    CONSUMER_SURFACES.map((surface) => [surface, 0])
  );
  for (const route of routes) {
    usageCounts[route.usage] += 1;
    consumerSurfaceCounts[route.consumerSurface] += 1;
  }
  return { usageCounts, consumerSurfaceCounts };
}

export function buildWholeSiteRouteUsageManifest({
  nestManifest,
  webManifest,
  registry,
  scope = {
    registry: REGISTRY_PATH,
    webApiManifest: WEB_MANIFEST_PATH,
    nestRouteManifest: NEST_MANIFEST_PATH
  }
}) {
  const nestRoutes = validateNestManifest(nestManifest);
  const validatedWebManifest = validateWebManifest(webManifest);
  const validatedRegistry = validateRegistry(registry);
  const blockers = emptyBlockers();
  const nestByExactKey = new Map(
    nestRoutes.map((route) => [
      exactKey(route.method, route.path),
      route
    ])
  );
  const nestByNormalizedKey = new Map(
    nestRoutes.map((route) => [route.normalizedKey, route])
  );
  const usageOverrides = normalizeRegistryEntries({
    entries: validatedRegistry.overrides,
    issueFor: registryEntryIssue,
    duplicateBlocker: blockers.duplicateRegistryEntries,
    invalidBlocker: blockers.invalidRegistryEntries
  });
  const surfaceOverrides = normalizeRegistryEntries({
    entries: validatedRegistry.consumerSurfaceOverrides,
    issueFor: consumerSurfaceEntryIssue,
    duplicateBlocker:
      blockers.duplicateConsumerSurfaceEntries,
    invalidBlocker: blockers.invalidConsumerSurfaceEntries
  });

  for (const [key] of usageOverrides) {
    if (nestByExactKey.has(key)) continue;
    blockers.staleRegistryEntries.push({ exactKey: key });
    usageOverrides.delete(key);
  }
  for (const [key] of surfaceOverrides) {
    if (nestByExactKey.has(key)) continue;
    blockers.staleConsumerSurfaceEntries.push({ exactKey: key });
    surfaceOverrides.delete(key);
  }

  const wrappers = wrapperEvidence(validatedWebManifest);
  const auth = authEvidence(validatedWebManifest);
  const ticketFollowupsByIdentity = new Map();
  for (const followup of wrappers.ticketFollowups) {
    if (followup.method !== "GET") continue;
    const identity = ticketFollowupIdentity(followup);
    if (ticketFollowupsByIdentity.has(identity)) {
      throw manifestError(
        "ROUTE_USAGE_TICKET_EVIDENCE_DUPLICATE"
      );
    }
    ticketFollowupsByIdentity.set(identity, followup);
  }
  for (const normalizedKey of wrappers.byRoute.keys()) {
    if (nestByNormalizedKey.has(normalizedKey)) continue;
    blockers.productionWebRoutesWithoutNest.push({
      normalizedKey,
      wrappers: wrappers.byRoute
        .get(normalizedKey)
        .map((entry) => ({
          apiFile: entry.apiFile,
          wrapper: entry.wrapper
        }))
    });
  }
  for (const normalizedKey of auth.keys()) {
    if (nestByNormalizedKey.has(normalizedKey)) continue;
    blockers.authRoutesWithoutNest.push({ normalizedKey });
  }
  for (const normalizedKey of wrappers.byRoute.keys()) {
    if (!auth.has(normalizedKey)) continue;
    throw manifestError(
      "ROUTE_USAGE_CONSUMER_SURFACE_CONFLICT"
    );
  }

  const routes = nestRoutes.map((route) => {
    const key = exactKey(route.method, route.path);
    const webApiWrappers =
      wrappers.byRoute.get(route.normalizedKey) ?? [];
    const authStore = auth.get(route.normalizedKey) ?? [];
    const manualSurface = surfaceOverrides.get(key) ?? null;
    const consumerSurface =
      webApiWrappers.length > 0
        ? "web_api_wrapper"
        : authStore.length > 0
          ? "auth_store"
          : manualSurface?.consumerSurface ?? "none";
    if (
      manualSurface &&
      (webApiWrappers.length > 0 || authStore.length > 0)
    ) {
      blockers.classificationConflicts.push({
        code: "MANUAL_CONSUMER_SURFACE_CONFLICTS_WITH_DERIVED_SURFACE",
        exactKey: key,
        derivedSurface:
          webApiWrappers.length > 0
            ? "web_api_wrapper"
            : "auth_store",
        manualSurface: manualSurface.consumerSurface
      });
    }
    const override = usageOverrides.get(key) ?? null;
    const usage =
      override?.usage ??
      (webApiWrappers.length > 0 || authStore.length > 0
        ? "page"
        : "unclassified");
    const classificationSource = override
      ? "registry_override"
      : usage === "page"
        ? "production_web_evidence"
        : "unclassified";
    const expectedTicketFollowups =
      manualSurface?.consumerSurface === "signed_ticket_delivery"
        ? manualSurface.ticketFollowups
        : [];
    const ticketFollowups = expectedTicketFollowups
      .map((followup) =>
        ticketFollowupsByIdentity.get(
          ticketFollowupIdentity(followup)
        )
      )
      .filter(Boolean);
    const missingTicketFollowups =
      expectedTicketFollowups.filter(
        (followup) =>
          !ticketFollowupsByIdentity.has(
            ticketFollowupIdentity(followup)
          )
      );
    if (
      usage === "exit_candidate" &&
      ["web_api_wrapper", "auth_store"].includes(consumerSurface)
    ) {
      blockers.classificationConflicts.push({
        code: "EXIT_CANDIDATE_HAS_PRODUCTION_WEB_CONSUMER",
        exactKey: key,
        consumerSurface
      });
    }
    if (
      usage === "page" &&
      !PAGE_CONSUMER_SURFACES.has(consumerSurface)
    ) {
      blockers.classificationConflicts.push({
        code: "PAGE_ROUTE_WITHOUT_PAGE_CONSUMER_SURFACE",
        exactKey: key,
        consumerSurface
      });
    }
    if (
      usage === "internal_task" &&
      !INTERNAL_CONSUMER_SURFACES.has(consumerSurface)
    ) {
      blockers.classificationConflicts.push({
        code: "INTERNAL_TASK_WITHOUT_INTERNAL_CONSUMER_SURFACE",
        exactKey: key,
        consumerSurface
      });
    }
    if (
      consumerSurface === "signed_ticket_delivery" &&
      (usage !== "page" || missingTicketFollowups.length > 0)
    ) {
      blockers.classificationConflicts.push({
        code:
          missingTicketFollowups.length > 0
            ? "SIGNED_TICKET_EVIDENCE_MISSING"
            : "SIGNED_TICKET_SURFACE_NOT_CLASSIFIED_AS_PAGE",
        exactKey: key,
        usage,
        missingEvidence: missingTicketFollowups
      });
    }
    if (
      INTERNAL_CONSUMER_SURFACES.has(consumerSurface) &&
      usage !== "internal_task"
    ) {
      blockers.classificationConflicts.push({
        code: "INTERNAL_CONSUMER_SURFACE_NOT_CLASSIFIED_INTERNAL",
        exactKey: key,
        usage,
        consumerSurface
      });
    }
    const result = {
      ...route,
      usage,
      classificationSource,
      classificationReason: override?.reason ?? null,
      consumerSurface,
      consumerEvidence: {
        webApiWrappers,
        authStore,
        ticketFollowups:
          consumerSurface === "signed_ticket_delivery"
            ? ticketFollowups
            : [],
        manualSurfaceReason: manualSurface?.reason ?? null
      },
      deletionAuthorized: false,
      exitCandidateSemantics:
        usage === "exit_candidate"
          ? EXIT_CANDIDATE_SEMANTICS
          : null
    };
    if (usage === "unclassified") {
      blockers.unclassifiedRoutes.push({
        method: route.method,
        path: route.path,
        normalizedKey: route.normalizedKey,
        controller: route.controller,
        handler: route.handler,
        sourceFile: route.sourceFile,
        consumerSurface
      });
    }
    return result;
  });

  const { usageCounts, consumerSurfaceCounts } =
    routeSummary(routes);
  const classificationOverrideSha256 = digestEntries(
    validatedRegistry.overrides,
    (entry) =>
      `${entry?.method ?? ""} ${entry?.path ?? ""} ${entry?.usage ?? ""}`
  );
  const consumerSurfaceOverrideSha256 = digestEntries(
    validatedRegistry.consumerSurfaceOverrides,
    (entry) =>
      `${entry?.method ?? ""} ${entry?.path ?? ""} ${entry?.consumerSurface ?? ""}`
  );
  const derivedProductionPageCount = routes.filter(
    (route) =>
      route.usage === "page" &&
      route.classificationSource === "production_web_evidence"
  ).length;
  const expected = validatedRegistry.expectations;
  addExpectationMismatch(
    blockers,
    "routeCount",
    expected.routeCount,
    routes.length
  );
  addExpectationMismatch(
    blockers,
    "classificationOverrideCount",
    expected.classificationOverrideCount,
    validatedRegistry.overrides.length
  );
  addExpectationMismatch(
    blockers,
    "derivedProductionPageCount",
    expected.derivedProductionPageCount,
    derivedProductionPageCount
  );
  addExpectationMismatch(
    blockers,
    "classificationOverrideSha256",
    expected.classificationOverrideSha256,
    classificationOverrideSha256
  );
  addExpectationMismatch(
    blockers,
    "consumerSurfaceOverrideSha256",
    expected.consumerSurfaceOverrideSha256,
    consumerSurfaceOverrideSha256
  );
  for (const [usage, count] of Object.entries(
    expected.usageCounts
  )) {
    addExpectationMismatch(
      blockers,
      `usageCounts.${usage}`,
      count,
      usageCounts[usage]
    );
  }
  for (const [surface, count] of Object.entries(
    expected.consumerSurfaceCounts
  )) {
    addExpectationMismatch(
      blockers,
      `consumerSurfaceCounts.${surface}`,
      count,
      consumerSurfaceCounts[surface]
    );
  }
  sortBlockers(blockers);
  const totalBlockers = blockerCount(blockers);
  return {
    schemaVersion: SCHEMA_VERSION,
    status: totalBlockers === 0 ? "ready" : "blocked",
    scope: {
      ...scope,
      authorizationScope: "route_usage_classification_only",
      deletionAuthorized: false,
      exitCandidateSemantics: EXIT_CANDIDATE_SEMANTICS
    },
    summary: {
      routeCount: routes.length,
      exactRouteCount: new Set(
        routes.map((route) =>
          exactKey(route.method, route.path)
        )
      ).size,
      normalizedRouteCount: new Set(
        routes.map((route) => route.normalizedKey)
      ).size,
      classificationOverrideCount:
        validatedRegistry.overrides.length,
      consumerSurfaceOverrideCount:
        validatedRegistry.consumerSurfaceOverrides.length,
      classificationOverrideSha256,
      consumerSurfaceOverrideSha256,
      derivedProductionPageCount,
      pageRouteCount: usageCounts.page,
      externalTakeoverCount: usageCounts.external_takeover,
      exitCandidateCount: usageCounts.exit_candidate,
      internalTaskCount: usageCounts.internal_task,
      unclassifiedCount: usageCounts.unclassified,
      consumerSurfaceCounts,
      blockerCount: totalBlockers
    },
    evidence: {
      upstreamWebManifestStatus:
        validatedWebManifest.status ?? null,
      productionWrapperRouteCount: wrappers.byRoute.size,
      authStoreRouteCount: auth.size,
      productionTicketFollowupCount:
        wrappers.ticketFollowups.length
    },
    routes,
    blockers
  };
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw manifestError(code);
  }
}

export async function inspectWholeSiteRouteUsageManifest({
  root,
  nestManifestPath = NEST_MANIFEST_PATH,
  webManifestPath = WEB_MANIFEST_PATH,
  registryPath = REGISTRY_PATH
}) {
  const resolvedRoot = resolve(root);
  const resolvedNestManifestPath = resolve(
    resolvedRoot,
    nestManifestPath
  );
  const resolvedWebManifestPath = resolve(
    resolvedRoot,
    webManifestPath
  );
  const resolvedRegistryPath = resolve(
    resolvedRoot,
    registryPath
  );
  const [nestManifest, webManifest, registry] = await Promise.all([
    readJson(
      resolvedNestManifestPath,
      "ROUTE_USAGE_NEST_MANIFEST_UNREADABLE"
    ),
    readJson(
      resolvedWebManifestPath,
      "ROUTE_USAGE_WEB_MANIFEST_UNREADABLE"
    ),
    readJson(
      resolvedRegistryPath,
      "ROUTE_USAGE_REGISTRY_UNREADABLE"
    )
  ]);
  return buildWholeSiteRouteUsageManifest({
    nestManifest,
    webManifest,
    registry,
    scope: {
      registry: displayPath(resolvedRoot, resolvedRegistryPath),
      webApiManifest: displayPath(
        resolvedRoot,
        resolvedWebManifestPath
      ),
      nestRouteManifest: displayPath(
        resolvedRoot,
        resolvedNestManifestPath
      )
    }
  });
}

export function renderWholeSiteRouteUsageManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeOrCheckWholeSiteRouteUsageManifest({
  mode,
  targetPath,
  rendered
}) {
  if (
    !isNonEmptyString(targetPath) ||
    typeof rendered !== "string"
  ) {
    throw manifestError("ROUTE_USAGE_MANIFEST_OUTPUT_INVALID");
  }
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered);
    return;
  }
  if (mode !== "check") {
    throw manifestError("ROUTE_USAGE_MANIFEST_INVALID_MODE");
  }
  let existing;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch {
    throw manifestError("ROUTE_USAGE_MANIFEST_MISSING");
  }
  if (existing !== rendered) {
    throw manifestError("ROUTE_USAGE_MANIFEST_DRIFT");
  }
}

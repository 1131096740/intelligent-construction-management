import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { normalizeRoutePath } from "./whole-site-route-manifest.mjs";
import {
  deriveDuplicateWebApiRoutes,
  inspectWholeSiteWebApiManifest,
  normalizeWebApiPath
} from "./whole-site-web-api-manifest.mjs";

export const CAPABILITY_MATRIX_PATH =
  "docs/product/manifests/whole-site-capability-matrix.json";
export const CAPABILITY_MATRIX_MARKDOWN_PATH =
  "docs/product/whole-site-capability-matrix.md";
export const CAPABILITY_MATRIX_INPUT_PATHS = Object.freeze({
  nestRoutes: "docs/product/manifests/nest-business-routes.json",
  webApiWrappers:
    "docs/product/manifests/web-api-wrappers.json",
  webPageActions:
    "docs/product/manifests/web-page-actions.json",
  routeUsage: "docs/product/manifests/route-usage.json"
});

const NEST_ROUTE_KEYS = [
  "authentication",
  "authorizationCombination",
  "authorizationScope",
  "contractCutoverLegacyWrite",
  "contractCutoverSurface",
  "controller",
  "guardAuthorization",
  "handler",
  "isPublic",
  "method",
  "normalizedKey",
  "path",
  "requiredPositions",
  "requiredProjectAction",
  "sourceFile"
];
const USAGE_ROUTE_KEYS = [
  ...NEST_ROUTE_KEYS,
  "classificationReason",
  "classificationSource",
  "consumerEvidence",
  "consumerSurface",
  "deletionAuthorized",
  "exitCandidateSemantics",
  "usage"
];
const WEB_BLOCKER_KEYS = [
  "authWithoutBackend",
  "consumerIssues",
  "duplicateWriteWrappers",
  "frontendWithoutBackend",
  "orphanWrappers",
  "unresolvedRequests"
];
const PAGE_BLOCKER_KEYS = [
  "clientRoleOrStatusGates",
  "duplicateRegistryEntries",
  "dynamicEventIssues",
  "invalidRegistryEntries",
  "parseIssues",
  "routeDiscoveryIssues",
  "staleRegistryEntries",
  "uncoveredMutationWrappers",
  "unresolvedComponentForwards",
  "unresolvedHandlers",
  "unresolvedRoutes",
  "unresolvedWrappers",
  "upstreamManifestIssues",
  "writeWithoutServerCapability"
];
const USAGE_BLOCKER_KEYS = [
  "authRoutesWithoutNest",
  "classificationConflicts",
  "duplicateConsumerSurfaceEntries",
  "duplicateRegistryEntries",
  "expectationMismatches",
  "invalidConsumerSurfaceEntries",
  "invalidRegistryEntries",
  "productionWebRoutesWithoutNest",
  "staleConsumerSurfaceEntries",
  "staleRegistryEntries",
  "unclassifiedRoutes"
];
const USAGES = new Set([
  "page",
  "external_takeover",
  "exit_candidate",
  "internal_task",
  "unclassified"
]);
const CONSUMER_SURFACES = new Set([
  "web_api_wrapper",
  "auth_store",
  "signed_ticket_delivery",
  "machine_probe",
  "operator_endpoint",
  "none"
]);
const MUTATION_METHODS = new Set([
  "DELETE",
  "PATCH",
  "POST",
  "PUT"
]);
const LIVE_WEB_MANIFESTS = new WeakSet();
const ACTION_USAGES = new Set(["page_action", "background"]);
const ACTION_SEMANTICS = new Set([
  "business_write",
  "technical_write"
]);
const EXIT_CANDIDATE_SEMANTICS =
  "candidate_only_no_deletion_authorization";

function matrixError(code, details = undefined) {
  const error = new Error("Whole-site capability matrix failed");
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assert(condition, code, details = undefined) {
  if (!condition) throw matrixError(code, details);
}

function assertObject(value, code) {
  assert(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value),
    code
  );
}

function assertExactKeys(value, keys, code) {
  assertObject(value, code);
  assert(
    isDeepStrictEqual(
      Object.keys(value).sort(),
      [...keys].sort()
    ),
    code,
    {
      expected: [...keys].sort(),
      actual: Object.keys(value).sort()
    }
  );
}

function assertArray(value, code) {
  assert(Array.isArray(value), code);
}

function assertString(value, code) {
  assert(typeof value === "string" && value.length > 0, code);
}

function assertInteger(value, code) {
  assert(Number.isInteger(value) && value >= 0, code);
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function sortBy(items, identityFor) {
  return [...items].sort((left, right) =>
    stableCompare(identityFor(left), identityFor(right))
  );
}

function uniqueStrings(values, code) {
  assertArray(values, code);
  for (const value of values) assertString(value, code);
  assert(new Set(values).size === values.length, code);
  return [...values].sort(stableCompare);
}

function routeExactKey(route) {
  return `${route.method}\u0000${route.path}`;
}

function wrapperKey(apiFile, wrapper) {
  return `${apiFile}\u0000${wrapper}`;
}

function mutationConsumerKey(apiFile, wrapper, consumer) {
  return `${apiFile}\u0000${wrapper}\u0000${consumer}`;
}

function actionBindingKey(actionId, binding, index) {
  return [
    actionId,
    binding.apiFile,
    binding.wrapper,
    binding.method,
    binding.normalizedKey,
    index
  ].join("\u0000");
}

function blockerCount(blockers) {
  return Object.values(blockers).reduce(
    (total, entries) => total + entries.length,
    0
  );
}

function assertBlockers(blockers, keys, code) {
  assertExactKeys(blockers, keys, code);
  for (const entries of Object.values(blockers)) {
    assertArray(entries, code);
  }
}

function assertStatus(status, blockers, code) {
  assert(status === "ready" || status === "blocked", code);
  const expected = blockerCount(blockers) === 0
    ? "ready"
    : "blocked";
  assert(status === expected, code, {
    expected,
    actual: status,
    blockerCount: blockerCount(blockers)
  });
}

function assertSha256(value, code) {
  assert(
    typeof value === "string" &&
      /^[a-f0-9]{64}$/.test(value),
    code
  );
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestEntries(entries, identityFor) {
  return sha256(
    entries
      .map(identityFor)
      .sort(stableCompare)
      .join("\n")
  );
}

function validateNestRoute(route) {
  assertExactKeys(
    route,
    NEST_ROUTE_KEYS,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(route.method, "CAPABILITY_MATRIX_INVALID_NEST_ROUTE");
  assert(
    route.method === route.method.toUpperCase(),
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(route.path, "CAPABILITY_MATRIX_INVALID_NEST_ROUTE");
  assert(
    route.path.startsWith("/"),
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    route.normalizedKey ===
      `${route.method} ${normalizeRoutePath(route.path)}`,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(
    route.controller,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(
    route.handler,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(
    route.sourceFile,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    route.authorizationScope === "guard_metadata_only",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    route.authentication === "public" ||
      route.authentication === "authenticated",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assertString(
    route.guardAuthorization,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    typeof route.isPublic === "boolean",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  uniqueStrings(
    route.requiredPositions,
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    route.requiredProjectAction === null ||
      typeof route.requiredProjectAction === "string",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    route.authorizationCombination === null ||
      route.authorizationCombination === "AND" ||
      route.authorizationCombination === "OR",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
  assert(
    typeof route.contractCutoverSurface === "boolean" &&
      typeof route.contractCutoverLegacyWrite === "boolean",
    "CAPABILITY_MATRIX_INVALID_NEST_ROUTE"
  );
}

function validateNestManifest(manifest) {
  assertExactKeys(
    manifest,
    ["authorizationScope", "routes", "schemaVersion"],
    "CAPABILITY_MATRIX_INVALID_NEST_MANIFEST"
  );
  assert(
    manifest.schemaVersion === 1 &&
      manifest.authorizationScope === "guard_metadata_only",
    "CAPABILITY_MATRIX_INVALID_NEST_MANIFEST"
  );
  assertArray(
    manifest.routes,
    "CAPABILITY_MATRIX_INVALID_NEST_MANIFEST"
  );
  const exactKeys = new Set();
  const normalizedKeys = new Set();
  for (const route of manifest.routes) {
    validateNestRoute(route);
    assert(
      !exactKeys.has(routeExactKey(route)),
      "CAPABILITY_MATRIX_DUPLICATE_NEST_ROUTE"
    );
    assert(
      !normalizedKeys.has(route.normalizedKey),
      "CAPABILITY_MATRIX_DUPLICATE_NEST_NORMALIZED_ROUTE"
    );
    exactKeys.add(routeExactKey(route));
    normalizedKeys.add(route.normalizedKey);
  }
}

function validateMainRequest(request) {
  const unresolved = Object.hasOwn(request, "unresolvedReason");
  assertExactKeys(
    request,
    [
      "bodyKind",
      "kind",
      "localCallChains",
      "method",
      "normalizedKey",
      "normalizedPath",
      "path",
      "sourceLine",
      ...(unresolved ? ["unresolvedReason"] : [])
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assert(
    request.kind === "main",
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_KIND"
  );
  assertString(
    request.method,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assert(
    request.method === request.method.toUpperCase(),
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  if (unresolved) {
    assert(
      (request.path === null ||
        typeof request.path === "string") &&
        request.normalizedPath === null &&
        request.normalizedKey === null,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
    );
    assertString(
      request.unresolvedReason,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
    );
  } else {
    assertString(
      request.path,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
    );
    assert(
      request.normalizedPath === normalizeWebApiPath(request.path),
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
    );
    assert(
      request.normalizedKey ===
        `${request.method} ${request.normalizedPath}`,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
    );
  }
  assertInteger(
    request.sourceLine,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assertString(
    request.bodyKind,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
}

function validateTicketRequest(request) {
  assertExactKeys(
    request,
    [
      "bodyKind",
      "kind",
      "localCallChains",
      "method",
      "sourceLine",
      "ticketField"
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assert(
    request.kind === "ticket_followup",
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_KIND"
  );
  assertString(
    request.method,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assertInteger(
    request.sourceLine,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assertString(
    request.ticketField,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
  assertString(
    request.bodyKind,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST"
  );
}

function validateRequestLocalCallChains(request, wrapper) {
  assertArray(
    request.localCallChains,
    "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
  );
  const identities = new Set();
  for (const chain of request.localCallChains) {
    assertArray(
      chain,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
    );
    assert(
      chain.length > 0 &&
        chain[0] === wrapper.name &&
        new Set(chain).size === chain.length,
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
    );
    for (const name of chain) {
      assertString(
        name,
        "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
      );
    }
    const identity = chain.join("\u0000");
    assert(
      !identities.has(identity),
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
    );
    identities.add(identity);
  }
}

function validateWrapper(wrapper) {
  const hasReturnProvenance = Object.hasOwn(
    wrapper,
    "returnProvenance"
  );
  assertExactKeys(
    wrapper,
    [
      "apiFile",
      "kind",
      "name",
      "productionConsumers",
      "requests",
      ...(hasReturnProvenance ? ["returnProvenance"] : []),
      "testConsumers",
      "unreachableConsumers"
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  assertString(
    wrapper.apiFile,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  assertString(
    wrapper.name,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  assert(
    wrapper.kind === "transport" || wrapper.kind === "pure",
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  if (hasReturnProvenance) {
    assert(
      [
        "transparent_main_response",
        "none",
        "unverified"
      ].includes(wrapper.returnProvenance),
      "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER_RETURN_PROVENANCE"
    );
  }
  uniqueStrings(
    wrapper.productionConsumers,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  uniqueStrings(
    wrapper.testConsumers,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  uniqueStrings(
    wrapper.unreachableConsumers,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  assertArray(
    wrapper.requests,
    "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
  );
  for (const request of wrapper.requests) {
    assertObject(request, "CAPABILITY_MATRIX_INVALID_WEB_REQUEST");
    if (request.kind === "main") {
      validateMainRequest(request);
    } else if (request.kind === "ticket_followup") {
      validateTicketRequest(request);
    } else {
      throw matrixError(
        "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_KIND"
      );
    }
    validateRequestLocalCallChains(request, wrapper);
  }
  if (wrapper.kind === "pure") {
    assert(
      wrapper.requests.length === 0,
      "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
    );
  } else {
    assert(
      wrapper.requests.some((request) => request.kind === "main"),
      "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER"
    );
  }
}

function classifyOrphan(wrapper) {
  return {
    apiFile: wrapper.apiFile,
    wrapper: wrapper.name,
    classification:
      wrapper.testConsumers.length > 0
        ? "test_only"
        : "unreferenced"
  };
}

function deriveUnresolvedRequests(wrappers) {
  return sortBy(
    wrappers.flatMap((wrapper) =>
      wrapper.requests
        .filter(
          (request) =>
            request.kind === "main" &&
            Object.hasOwn(request, "unresolvedReason")
        )
        .map((request) => ({
          apiFile: wrapper.apiFile,
          wrapper: wrapper.name,
          reason: request.unresolvedReason
        }))
    ),
    (entry) =>
      `${entry.apiFile}\u0000${entry.wrapper}\u0000${entry.reason}`
  );
}

function deriveConservativeDuplicateRoutes(wrappers) {
  return deriveDuplicateWebApiRoutes(
    wrappers.map((wrapper) => ({
      ...wrapper,
      requests: wrapper.requests.map((request) => ({
        ...request,
        localCallChains: []
      }))
    }))
  );
}

function deriveDuplicateRoutes(wrappers, delegationEvidenceTrusted) {
  return delegationEvidenceTrusted
    ? deriveDuplicateWebApiRoutes(wrappers)
    : deriveConservativeDuplicateRoutes(wrappers);
}

function validateAuthException(entry) {
  assertExactKeys(
    entry,
    [
      "method",
      "normalizedKey",
      "normalizedPath",
      "sourceFile",
      "transport"
    ],
    "CAPABILITY_MATRIX_INVALID_AUTH_TRANSPORT"
  );
  assert(
    entry.transport === "auth_store_exception" &&
      entry.normalizedKey ===
        `${entry.method} ${entry.normalizedPath}` &&
      entry.normalizedPath ===
        normalizeRoutePath(entry.normalizedPath),
    "CAPABILITY_MATRIX_INVALID_AUTH_TRANSPORT"
  );
  assertString(
    entry.sourceFile,
    "CAPABILITY_MATRIX_INVALID_AUTH_TRANSPORT"
  );
}

function validateWebSummary(manifest) {
  assertExactKeys(
    manifest.summary,
    [
      "apiModuleCount",
      "authTransportExceptionCount",
      "duplicateNormalizedRouteGroupCount",
      "exportedFunctionCount",
      "mainRequestBindingCount",
      "orphanWrapperCount",
      "productionConsumerCount",
      "pureExportCount",
      "requestEdgeCount",
      "testOnlyWrapperCount",
      "ticketFollowupCount",
      "transportWrapperCount",
      "unreferencedWrapperCount"
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_SUMMARY"
  );
  const wrappers = manifest.wrappers;
  const mainRequests = wrappers.flatMap((wrapper) =>
    wrapper.requests.filter((request) => request.kind === "main")
  );
  const ticketRequests = wrappers.flatMap((wrapper) =>
    wrapper.requests.filter(
      (request) => request.kind === "ticket_followup"
    )
  );
  const requestEdgeCount = new Set(
    wrappers.flatMap((wrapper) =>
      wrapper.kind === "transport"
        ? wrapper.requests.map(
            (request) =>
              `${wrapper.apiFile}\u0000${wrapper.name}\u0000${request.kind}\u0000${request.sourceLine}`
          )
        : []
    )
  ).size;
  const orphanWrappers = wrappers.filter(
    (wrapper) =>
      wrapper.kind === "transport" &&
      wrapper.productionConsumers.length === 0
  );
  const expected = {
    apiModuleCount: new Set(
      wrappers.map((wrapper) => wrapper.apiFile)
    ).size,
    exportedFunctionCount: wrappers.length,
    transportWrapperCount: wrappers.filter(
      (wrapper) => wrapper.kind === "transport"
    ).length,
    pureExportCount: wrappers.filter(
      (wrapper) => wrapper.kind === "pure"
    ).length,
    mainRequestBindingCount: mainRequests.length,
    ticketFollowupCount: ticketRequests.length,
    requestEdgeCount,
    productionConsumerCount: wrappers.filter(
      (wrapper) =>
        wrapper.kind === "transport" &&
        wrapper.productionConsumers.length > 0
    ).length,
    orphanWrapperCount: orphanWrappers.length,
    testOnlyWrapperCount: orphanWrappers.filter(
      (wrapper) => wrapper.testConsumers.length > 0
    ).length,
    unreferencedWrapperCount: orphanWrappers.filter(
      (wrapper) => wrapper.testConsumers.length === 0
    ).length,
    duplicateNormalizedRouteGroupCount:
      manifest.duplicateNormalizedRoutes.length,
    authTransportExceptionCount:
      manifest.authTransportExceptions.length
  };
  assert(
    isDeepStrictEqual(manifest.summary, expected),
    "CAPABILITY_MATRIX_INVALID_WEB_SUMMARY",
    { expected, actual: manifest.summary }
  );
}

function validateWebManifest(manifest) {
  assertExactKeys(
    manifest,
    [
      "authTransportExceptions",
      "blockers",
      "duplicateNormalizedRoutes",
      "evidence",
      "schemaVersion",
      "scope",
      "status",
      "summary",
      "wrappers"
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_MANIFEST"
  );
  assert(
    manifest.schemaVersion === 1,
    "CAPABILITY_MATRIX_INVALID_WEB_MANIFEST"
  );
  assertExactKeys(
    manifest.scope,
    ["apiRoot", "nestRouteManifest", "productionEntrypoint"],
    "CAPABILITY_MATRIX_INVALID_WEB_SCOPE"
  );
  assert(
    manifest.scope.apiRoot === "apps/web-admin/src/api" &&
      manifest.scope.productionEntrypoint ===
        "apps/web-admin/src/main.ts" &&
      manifest.scope.nestRouteManifest ===
        CAPABILITY_MATRIX_INPUT_PATHS.nestRoutes,
    "CAPABILITY_MATRIX_INVALID_WEB_SCOPE"
  );
  assertExactKeys(
    manifest.evidence,
    [
      "productionModuleCount",
      "reachableProductionModuleCount"
    ],
    "CAPABILITY_MATRIX_INVALID_WEB_EVIDENCE"
  );
  assertInteger(
    manifest.evidence.productionModuleCount,
    "CAPABILITY_MATRIX_INVALID_WEB_EVIDENCE"
  );
  assertInteger(
    manifest.evidence.reachableProductionModuleCount,
    "CAPABILITY_MATRIX_INVALID_WEB_EVIDENCE"
  );
  assertBlockers(
    manifest.blockers,
    WEB_BLOCKER_KEYS,
    "CAPABILITY_MATRIX_INVALID_WEB_BLOCKERS"
  );
  assertStatus(
    manifest.status,
    manifest.blockers,
    "CAPABILITY_MATRIX_WEB_STATUS_CONTRADICTION"
  );
  assertArray(
    manifest.wrappers,
    "CAPABILITY_MATRIX_INVALID_WEB_MANIFEST"
  );
  const identities = new Set();
  for (const wrapper of manifest.wrappers) {
    validateWrapper(wrapper);
    const identity = wrapperKey(wrapper.apiFile, wrapper.name);
    assert(
      !identities.has(identity),
      "CAPABILITY_MATRIX_DUPLICATE_WEB_WRAPPER"
    );
    identities.add(identity);
  }
  const expectedUnresolvedRequests = deriveUnresolvedRequests(
    manifest.wrappers
  );
  assert(
    isDeepStrictEqual(
      sortBy(
        manifest.blockers.unresolvedRequests,
        (entry) =>
          `${entry?.apiFile}\u0000${entry?.wrapper}\u0000${entry?.reason}`
      ),
      expectedUnresolvedRequests
    ),
    "CAPABILITY_MATRIX_WEB_UNRESOLVED_BLOCKER_DRIFT"
  );
  assertArray(
    manifest.authTransportExceptions,
    "CAPABILITY_MATRIX_INVALID_WEB_MANIFEST"
  );
  const authKeys = new Set();
  for (const entry of manifest.authTransportExceptions) {
    validateAuthException(entry);
    assert(
      !authKeys.has(entry.normalizedKey),
      "CAPABILITY_MATRIX_DUPLICATE_AUTH_TRANSPORT"
    );
    authKeys.add(entry.normalizedKey);
  }
  assertArray(
    manifest.duplicateNormalizedRoutes,
    "CAPABILITY_MATRIX_INVALID_WEB_MANIFEST"
  );
  const expectedDuplicates = deriveDuplicateRoutes(
    manifest.wrappers,
    LIVE_WEB_MANIFESTS.has(manifest)
  );
  assert(
    isDeepStrictEqual(
      manifest.duplicateNormalizedRoutes,
      expectedDuplicates
    ),
    "CAPABILITY_MATRIX_WEB_DUPLICATE_ROUTE_DRIFT"
  );
  const expectedOrphans = sortBy(
    manifest.wrappers
      .filter(
        (wrapper) =>
          wrapper.kind === "transport" &&
          wrapper.productionConsumers.length === 0
      )
      .map(classifyOrphan),
    (entry) => wrapperKey(entry.apiFile, entry.wrapper)
  );
  assert(
    isDeepStrictEqual(
      sortBy(
        manifest.blockers.orphanWrappers,
        (entry) => wrapperKey(entry.apiFile, entry.wrapper)
      ),
      expectedOrphans
    ),
    "CAPABILITY_MATRIX_WEB_ORPHAN_BLOCKER_DRIFT"
  );
  const expectedDuplicateWrites = expectedDuplicates.filter(
    (entry) =>
      MUTATION_METHODS.has(
        entry.normalizedKey.slice(
          0,
          entry.normalizedKey.indexOf(" ")
        )
      )
  );
  assert(
    isDeepStrictEqual(
      manifest.blockers.duplicateWriteWrappers,
      expectedDuplicateWrites
    ),
    "CAPABILITY_MATRIX_WEB_DUPLICATE_WRITE_BLOCKER_DRIFT"
  );
  validateWebSummary(manifest);
}

function validateCapability(capability) {
  assertObject(
    capability,
    "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
  );
  const keys = [
    "dominatesTrigger",
    "kind",
    "serverDerived",
    "source",
    ...(Object.hasOwn(capability, "key") ? ["key"] : [])
  ];
  assertExactKeys(
    capability,
    keys,
    "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
  );
  assertString(
    capability.kind,
    "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
  );
  assertString(
    capability.source,
    "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
  );
  assert(
    typeof capability.serverDerived === "boolean" &&
      typeof capability.dominatesTrigger === "boolean",
    "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
  );
  if (Object.hasOwn(capability, "key")) {
    assertString(
      capability.key,
      "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
    );
  }
}

function validateTrigger(trigger) {
  assertObject(trigger, "CAPABILITY_MATRIX_INVALID_ACTION_TRIGGER");
  assert(
    Object.hasOwn(trigger, "kind"),
    "CAPABILITY_MATRIX_INVALID_ACTION_TRIGGER"
  );
  assertString(
    trigger.kind,
    "CAPABILITY_MATRIX_INVALID_ACTION_TRIGGER"
  );
  assertInteger(
    trigger.sourceLine,
    "CAPABILITY_MATRIX_INVALID_ACTION_TRIGGER"
  );
  assertInteger(
    trigger.sourceColumn,
    "CAPABILITY_MATRIX_INVALID_ACTION_TRIGGER"
  );
}

function validateBindingShape(binding) {
  assertExactKeys(
    binding,
    [
      "acceptedProductionConsumers",
      "apiFile",
      "bodyKind",
      "causalProof",
      "causalVerified",
      "method",
      "nestRoute",
      "normalizedKey",
      "path",
      "productionConsumers",
      "ticketFollowups",
      "wrapper"
    ],
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.apiFile,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.wrapper,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.method,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.path,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.normalizedKey,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertString(
    binding.bodyKind,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assert(
    typeof binding.causalVerified === "boolean",
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertObject(
    binding.causalProof,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  uniqueStrings(
    binding.productionConsumers,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  uniqueStrings(
    binding.acceptedProductionConsumers,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertArray(
    binding.ticketFollowups,
    "CAPABILITY_MATRIX_INVALID_ACTION_BINDING"
  );
  assertExactKeys(
    binding.nestRoute,
    [
      "authentication",
      "authorizationScope",
      "controller",
      "guardAuthorization",
      "handler",
      "isPublic",
      "method",
      "normalizedKey",
      "path",
      "requiredPositions",
      "requiredProjectAction",
      "sourceFile"
    ],
    "CAPABILITY_MATRIX_INVALID_ACTION_NEST_ROUTE"
  );
}

function validatePageSummary(
  manifest,
  webManifest,
  actionBindings,
  mutationConsumers
) {
  assertExactKeys(
    manifest.summary,
    [
      "acceptedProductionMutationConsumerCount",
      "backgroundActionCount",
      "blockerCount",
      "candidateProductionMutationConsumerCount",
      "coveredProductionMutationConsumerCount",
      "pageActionCount",
      "parsedVueFileCount",
      "productionMutationConsumerPairCount",
      "propCallbackDirectiveCount",
      "reachableProductionModuleCount",
      "reachableVueFileCount",
      "registeredActionCount",
      "routeRootCount",
      "templateEventDirectiveCount",
      "totalVueFileCount"
    ],
    "CAPABILITY_MATRIX_INVALID_PAGE_SUMMARY"
  );
  for (const value of Object.values(manifest.summary)) {
    assertInteger(value, "CAPABILITY_MATRIX_INVALID_PAGE_SUMMARY");
  }
  const registeredEventActions = manifest.actions.filter(
    (action) => action.trigger.kind === "event"
  ).length;
  const registeredPropCallbackActions = manifest.actions.filter(
    (action) => action.trigger.kind === "prop_callback"
  ).length;
  assert(
    manifest.summary.totalVueFileCount ===
      manifest.evidence.totalVueFileCount &&
      manifest.summary.parsedVueFileCount ===
        manifest.evidence.parsedVueFileCount &&
      manifest.summary.reachableProductionModuleCount ===
        manifest.evidence.reachableProductionModuleCount &&
      manifest.evidence.totalProductionModuleCount ===
        webManifest.evidence.productionModuleCount &&
      manifest.summary.reachableVueFileCount <=
        manifest.summary.parsedVueFileCount &&
      manifest.summary.routeRootCount <=
        manifest.summary.reachableVueFileCount &&
      manifest.summary.templateEventDirectiveCount >=
        registeredEventActions &&
      manifest.summary.propCallbackDirectiveCount >=
        registeredPropCallbackActions,
    "CAPABILITY_MATRIX_INVALID_PAGE_SUMMARY"
  );
  const candidateKeys = new Set();
  const acceptedKeys = new Set();
  const coveredKeys = new Set();
  for (const { action, binding } of actionBindings) {
    for (const consumer of binding.productionConsumers) {
      candidateKeys.add(
        mutationConsumerKey(
          binding.apiFile,
          binding.wrapper,
          consumer
        )
      );
    }
    for (const consumer of binding.acceptedProductionConsumers) {
      const key = mutationConsumerKey(
        binding.apiFile,
        binding.wrapper,
        consumer
      );
      acceptedKeys.add(key);
      if (
        binding.causalVerified &&
        action.capability.serverDerived &&
        action.capability.dominatesTrigger
      ) {
        coveredKeys.add(key);
      }
    }
  }
  const expected = {
    registeredActionCount: manifest.actions.length,
    pageActionCount: manifest.actions.filter(
      (action) => action.usage === "page_action"
    ).length,
    backgroundActionCount: manifest.actions.filter(
      (action) => action.usage === "background"
    ).length,
    reachableVueFileCount:
      manifest.summary.reachableVueFileCount,
    routeRootCount: manifest.summary.routeRootCount,
    totalVueFileCount:
      manifest.evidence.totalVueFileCount,
    parsedVueFileCount:
      manifest.evidence.parsedVueFileCount,
    reachableProductionModuleCount:
      webManifest.evidence.reachableProductionModuleCount,
    templateEventDirectiveCount:
      manifest.summary.templateEventDirectiveCount,
    propCallbackDirectiveCount:
      manifest.summary.propCallbackDirectiveCount,
    coveredProductionMutationConsumerCount: coveredKeys.size,
    candidateProductionMutationConsumerCount: candidateKeys.size,
    acceptedProductionMutationConsumerCount: acceptedKeys.size,
    productionMutationConsumerPairCount: mutationConsumers.length,
    blockerCount: blockerCount(manifest.blockers)
  };
  assert(
    isDeepStrictEqual(manifest.summary, expected),
    "CAPABILITY_MATRIX_INVALID_PAGE_SUMMARY",
    { expected, actual: manifest.summary }
  );
}

function validatePageManifestShape(manifest) {
  assertExactKeys(
    manifest,
    [
      "actions",
      "blockers",
      "evidence",
      "schemaVersion",
      "scope",
      "status",
      "summary"
    ],
    "CAPABILITY_MATRIX_INVALID_PAGE_MANIFEST"
  );
  assert(
    manifest.schemaVersion === 1,
    "CAPABILITY_MATRIX_INVALID_PAGE_MANIFEST"
  );
  assertExactKeys(
    manifest.scope,
    [
      "authorizationScope",
      "nestRouteManifest",
      "productionEntrypoint",
      "registry",
      "webApiManifest"
    ],
    "CAPABILITY_MATRIX_INVALID_PAGE_SCOPE"
  );
  assert(
    manifest.scope.authorizationScope ===
      "ui_capability_binding_only" &&
      manifest.scope.registry ===
        "docs/product/manifests/web-page-actions.registry.json" &&
      manifest.scope.nestRouteManifest ===
        CAPABILITY_MATRIX_INPUT_PATHS.nestRoutes &&
      manifest.scope.webApiManifest ===
        CAPABILITY_MATRIX_INPUT_PATHS.webApiWrappers &&
      manifest.scope.productionEntrypoint ===
        "apps/web-admin/src/main.ts",
    "CAPABILITY_MATRIX_INVALID_PAGE_SCOPE"
  );
  assertExactKeys(
    manifest.evidence,
    [
      "parsedVueFileCount",
      "reachableProductionModuleCount",
      "totalProductionModuleCount",
      "totalVueFileCount"
    ],
    "CAPABILITY_MATRIX_INVALID_PAGE_EVIDENCE"
  );
  for (const value of Object.values(manifest.evidence)) {
    assertInteger(value, "CAPABILITY_MATRIX_INVALID_PAGE_EVIDENCE");
  }
  assert(
    manifest.evidence.parsedVueFileCount <=
      manifest.evidence.totalVueFileCount &&
      manifest.evidence.reachableProductionModuleCount <=
        manifest.evidence.totalProductionModuleCount,
    "CAPABILITY_MATRIX_INVALID_PAGE_EVIDENCE"
  );
  assertBlockers(
    manifest.blockers,
    PAGE_BLOCKER_KEYS,
    "CAPABILITY_MATRIX_INVALID_PAGE_BLOCKERS"
  );
  assertStatus(
    manifest.status,
    manifest.blockers,
    "CAPABILITY_MATRIX_PAGE_STATUS_CONTRADICTION"
  );
  assertArray(
    manifest.actions,
    "CAPABILITY_MATRIX_INVALID_PAGE_MANIFEST"
  );
  const ids = new Set();
  for (const action of manifest.actions) {
    assertExactKeys(
      action,
      [
        "bindings",
        "capability",
        "id",
        "ownerRoutePaths",
        "routePaths",
        "semantic",
        "sourceFile",
        "trigger",
        "usage"
      ],
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    assertString(action.id, "CAPABILITY_MATRIX_INVALID_ACTION");
    assert(
      !ids.has(action.id),
      "CAPABILITY_MATRIX_DUPLICATE_ACTION"
    );
    ids.add(action.id);
    assert(
      ACTION_USAGES.has(action.usage) &&
        ACTION_SEMANTICS.has(action.semantic),
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    assertString(
      action.sourceFile,
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    uniqueStrings(
      action.routePaths,
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    uniqueStrings(
      action.ownerRoutePaths,
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    validateTrigger(action.trigger);
    validateCapability(action.capability);
    assertArray(
      action.bindings,
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    assert(
      action.bindings.length > 0,
      "CAPABILITY_MATRIX_INVALID_ACTION"
    );
    for (const binding of action.bindings) {
      validateBindingShape(binding);
    }
  }
}

function validateUsageManifestShape(manifest) {
  assertExactKeys(
    manifest,
    [
      "blockers",
      "evidence",
      "routes",
      "schemaVersion",
      "scope",
      "status",
      "summary"
    ],
    "CAPABILITY_MATRIX_INVALID_USAGE_MANIFEST"
  );
  assert(
    manifest.schemaVersion === 1,
    "CAPABILITY_MATRIX_INVALID_USAGE_MANIFEST"
  );
  assertExactKeys(
    manifest.scope,
    [
      "authorizationScope",
      "deletionAuthorized",
      "exitCandidateSemantics",
      "nestRouteManifest",
      "registry",
      "webApiManifest"
    ],
    "CAPABILITY_MATRIX_INVALID_USAGE_SCOPE"
  );
  assert(
    manifest.scope.authorizationScope ===
      "route_usage_classification_only" &&
      manifest.scope.registry ===
        "docs/product/manifests/route-usage.registry.json" &&
      manifest.scope.deletionAuthorized === false &&
      manifest.scope.exitCandidateSemantics ===
        EXIT_CANDIDATE_SEMANTICS &&
      manifest.scope.nestRouteManifest ===
        CAPABILITY_MATRIX_INPUT_PATHS.nestRoutes &&
      manifest.scope.webApiManifest ===
        CAPABILITY_MATRIX_INPUT_PATHS.webApiWrappers,
    "CAPABILITY_MATRIX_INVALID_USAGE_SCOPE"
  );
  assertExactKeys(
    manifest.evidence,
    [
      "authStoreRouteCount",
      "productionTicketFollowupCount",
      "productionWrapperRouteCount",
      "upstreamWebManifestStatus"
    ],
    "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
  );
  assertBlockers(
    manifest.blockers,
    USAGE_BLOCKER_KEYS,
    "CAPABILITY_MATRIX_INVALID_USAGE_BLOCKERS"
  );
  assertStatus(
    manifest.status,
    manifest.blockers,
    "CAPABILITY_MATRIX_USAGE_STATUS_CONTRADICTION"
  );
  assertArray(
    manifest.routes,
    "CAPABILITY_MATRIX_INVALID_USAGE_MANIFEST"
  );
  for (const route of manifest.routes) {
    assertExactKeys(
      route,
      USAGE_ROUTE_KEYS,
      "CAPABILITY_MATRIX_INVALID_USAGE_ROUTE"
    );
    assert(
      USAGES.has(route.usage) &&
        CONSUMER_SURFACES.has(route.consumerSurface),
      "CAPABILITY_MATRIX_INVALID_USAGE_ROUTE"
    );
    assert(
      route.deletionAuthorized === false,
      "CAPABILITY_MATRIX_USAGE_DELETION_AUTHORIZED"
    );
    if (route.usage === "exit_candidate") {
      assert(
        route.exitCandidateSemantics ===
          EXIT_CANDIDATE_SEMANTICS &&
          route.consumerSurface === "none",
        "CAPABILITY_MATRIX_INVALID_EXIT_CANDIDATE"
      );
    } else {
      assert(
        route.exitCandidateSemantics === null,
        "CAPABILITY_MATRIX_INVALID_EXIT_CANDIDATE"
      );
    }
    assertObject(
      route.consumerEvidence,
      "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
    );
    assertExactKeys(
      route.consumerEvidence,
      [
        "authStore",
        "manualSurfaceReason",
        "ticketFollowups",
        "webApiWrappers"
      ],
      "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
    );
    assertArray(
      route.consumerEvidence.authStore,
      "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
    );
    assertArray(
      route.consumerEvidence.ticketFollowups,
      "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
    );
    assertArray(
      route.consumerEvidence.webApiWrappers,
      "CAPABILITY_MATRIX_INVALID_USAGE_EVIDENCE"
    );
  }
}

function validateUsageSummary(manifest) {
  assertExactKeys(
    manifest.summary,
    [
      "blockerCount",
      "classificationOverrideCount",
      "classificationOverrideSha256",
      "consumerSurfaceCounts",
      "consumerSurfaceOverrideCount",
      "consumerSurfaceOverrideSha256",
      "derivedProductionPageCount",
      "exactRouteCount",
      "exitCandidateCount",
      "externalTakeoverCount",
      "internalTaskCount",
      "normalizedRouteCount",
      "pageRouteCount",
      "routeCount",
      "unclassifiedCount"
    ],
    "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY"
  );
  assertSha256(
    manifest.summary.classificationOverrideSha256,
    "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY"
  );
  assertSha256(
    manifest.summary.consumerSurfaceOverrideSha256,
    "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY"
  );
  assertExactKeys(
    manifest.summary.consumerSurfaceCounts,
    [...CONSUMER_SURFACES],
    "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY"
  );
  const usageCount = (usage) =>
    manifest.routes.filter((route) => route.usage === usage)
      .length;
  const classificationOverrides = manifest.routes.filter(
    (route) => route.classificationSource === "registry_override"
  );
  const consumerSurfaceOverrides = manifest.routes.filter(
    (route) =>
      route.consumerEvidence.manualSurfaceReason !== null
  );
  const expected = {
    routeCount: manifest.routes.length,
    exactRouteCount: new Set(
      manifest.routes.map(routeExactKey)
    ).size,
    normalizedRouteCount: new Set(
      manifest.routes.map((route) => route.normalizedKey)
    ).size,
    classificationOverrideCount: classificationOverrides.length,
    consumerSurfaceOverrideCount: consumerSurfaceOverrides.length,
    classificationOverrideSha256: digestEntries(
      classificationOverrides,
      (route) =>
        `${route.method} ${route.path} ${route.usage}`
    ),
    consumerSurfaceOverrideSha256: digestEntries(
      consumerSurfaceOverrides,
      (route) =>
        `${route.method} ${route.path} ${route.consumerSurface}`
    ),
    derivedProductionPageCount: manifest.routes.filter(
      (route) =>
        route.classificationSource === "production_web_evidence"
    ).length,
    pageRouteCount: usageCount("page"),
    externalTakeoverCount: usageCount("external_takeover"),
    exitCandidateCount: usageCount("exit_candidate"),
    internalTaskCount: usageCount("internal_task"),
    unclassifiedCount: usageCount("unclassified"),
    consumerSurfaceCounts: Object.fromEntries(
      [...CONSUMER_SURFACES].map((surface) => [
        surface,
        manifest.routes.filter(
          (route) => route.consumerSurface === surface
        ).length
      ])
    ),
    blockerCount: blockerCount(manifest.blockers)
  };
  assert(
    isDeepStrictEqual(manifest.summary, expected),
    "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY",
    { expected, actual: manifest.summary }
  );
}

function selectedNestRoute(route) {
  return Object.fromEntries(
    NEST_ROUTE_KEYS.map((key) => [key, route[key]])
  );
}

function selectedActionNestRoute(route) {
  return {
    method: route.method,
    path: route.path,
    normalizedKey: route.normalizedKey,
    controller: route.controller,
    handler: route.handler,
    sourceFile: route.sourceFile,
    authorizationScope: route.authorizationScope,
    authentication: route.authentication,
    guardAuthorization: route.guardAuthorization,
    isPublic: route.isPublic,
    requiredPositions: route.requiredPositions,
    requiredProjectAction: route.requiredProjectAction
  };
}

function selectedWebEvidence(wrapper, request) {
  return {
    apiFile: wrapper.apiFile,
    wrapper: wrapper.name,
    method: request.method,
    normalizedPath: request.normalizedPath,
    normalizedKey: request.normalizedKey,
    productionConsumers: wrapper.productionConsumers
  };
}

function selectedTicketEvidence(wrapper, request) {
  return {
    apiFile: wrapper.apiFile,
    wrapper: wrapper.name,
    method: request.method,
    ticketField: request.ticketField,
    sourceLine: request.sourceLine,
    productionConsumers: wrapper.productionConsumers
  };
}

function mutationConsumersFor(wrappers) {
  const pairs = new Map();
  for (const wrapper of wrappers) {
    if (
      wrapper.kind !== "transport" ||
      wrapper.productionConsumers.length === 0
    ) {
      continue;
    }
    const mutationRequests = wrapper.requests.filter(
      (request) =>
        request.kind === "main" &&
        MUTATION_METHODS.has(request.method) &&
        typeof request.normalizedKey === "string"
    );
    if (mutationRequests.length === 0) continue;
    const normalizedKeys = [
      ...new Set(
        mutationRequests.map((request) => request.normalizedKey)
      )
    ].sort(stableCompare);
    for (const consumer of wrapper.productionConsumers) {
      const pair = {
        apiFile: wrapper.apiFile,
        wrapper: wrapper.name,
        consumer,
        normalizedKeys
      };
      pairs.set(
        mutationConsumerKey(
          wrapper.apiFile,
          wrapper.name,
          consumer
        ),
        pair
      );
    }
  }
  return sortBy(
    [...pairs.values()],
    (pair) =>
      mutationConsumerKey(
        pair.apiFile,
        pair.wrapper,
        pair.consumer
      )
  );
}

function selectedPageUncovered(pair) {
  return {
    code:
      "PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION",
    apiFile: pair.apiFile,
    wrapper: pair.wrapper,
    sourceFile: pair.consumer,
    normalizedKeys: pair.normalizedKeys
  };
}

function actionBindingReasons(action, binding) {
  const reasons = [];
  if (!MUTATION_METHODS.has(binding.method)) {
    reasons.push("binding_not_mutation");
  }
  if (!binding.causalVerified) reasons.push("causal_unverified");
  if (binding.acceptedProductionConsumers.length === 0) {
    reasons.push("no_accepted_consumer");
  }
  if (!action.capability.serverDerived) {
    reasons.push("capability_not_server_derived");
  }
  if (!action.capability.dominatesTrigger) {
    reasons.push("capability_not_dominating_trigger");
  }
  return reasons;
}

function buildActionBindings({
  pageManifest,
  wrappersByKey,
  nestByNormalizedKey
}) {
  const actionBindings = [];
  for (const action of pageManifest.actions) {
    action.bindings.forEach((binding, index) => {
      const wrapper = wrappersByKey.get(
        wrapperKey(binding.apiFile, binding.wrapper)
      );
      assert(
        wrapper,
        "CAPABILITY_MATRIX_ACTION_WRAPPER_MISSING",
        { actionId: action.id }
      );
      assert(
        wrapper.kind === "transport",
        "CAPABILITY_MATRIX_ACTION_WRAPPER_NOT_TRANSPORT",
        { actionId: action.id }
      );
      const request = wrapper.requests.find(
        (candidate) =>
          candidate.kind === "main" &&
          candidate.method === binding.method &&
          candidate.normalizedKey === binding.normalizedKey
      );
      assert(
        request,
        "CAPABILITY_MATRIX_ACTION_REQUEST_MISSING",
        { actionId: action.id }
      );
      assert(
        binding.path === request.path &&
          binding.bodyKind === request.bodyKind,
        "CAPABILITY_MATRIX_ACTION_REQUEST_DRIFT",
        { actionId: action.id }
      );
      const nestRoute = nestByNormalizedKey.get(
        binding.normalizedKey
      );
      assert(
        nestRoute &&
          nestRoute.method === binding.method,
        "CAPABILITY_MATRIX_ACTION_NEST_ROUTE_MISSING",
        { actionId: action.id }
      );
      assert(
        isDeepStrictEqual(
          binding.nestRoute,
          selectedActionNestRoute(nestRoute)
        ),
        "CAPABILITY_MATRIX_ACTION_NEST_ROUTE_DRIFT",
        { actionId: action.id }
      );
      for (const consumer of binding.productionConsumers) {
        assert(
          wrapper.productionConsumers.includes(consumer),
          "CAPABILITY_MATRIX_ACTION_CONSUMER_MISSING",
          { actionId: action.id, consumer }
        );
      }
      for (const consumer of binding.acceptedProductionConsumers) {
        assert(
          binding.productionConsumers.includes(consumer),
          "CAPABILITY_MATRIX_ACTION_ACCEPTED_CONSUMER_INVALID",
          { actionId: action.id, consumer }
        );
      }
      assert(
        binding.causalVerified ||
          binding.acceptedProductionConsumers.length === 0,
        "CAPABILITY_MATRIX_ACTION_ACCEPTED_WITHOUT_CAUSAL_PROOF",
        { actionId: action.id }
      );
      actionBindings.push({
        action,
        binding,
        index,
        identity: actionBindingKey(action.id, binding, index),
        reasons: actionBindingReasons(action, binding)
      });
    });
  }
  return actionBindings;
}

function expectedUnclassifiedBlockers(routes) {
  return routes
    .filter((route) => route.usage === "unclassified")
    .map((route) => ({
      method: route.method,
      path: route.path,
      normalizedKey: route.normalizedKey,
      controller: route.controller,
      handler: route.handler,
      sourceFile: route.sourceFile,
      consumerSurface: route.consumerSurface
    }));
}

function validateUsageEvidence({
  usageRoute,
  wrappers,
  authTransportExceptions,
  ticketEvidence
}) {
  const expectedWeb = [];
  for (const wrapper of wrappers) {
    if (
      wrapper.kind !== "transport" ||
      wrapper.productionConsumers.length === 0
    ) {
      continue;
    }
    for (const request of wrapper.requests) {
      if (
        request.kind === "main" &&
        request.normalizedKey === usageRoute.normalizedKey
      ) {
        expectedWeb.push(selectedWebEvidence(wrapper, request));
      }
    }
  }
  const expectedAuth = authTransportExceptions.filter(
    (entry) => entry.normalizedKey === usageRoute.normalizedKey
  );
  const actual = usageRoute.consumerEvidence;
  assert(
    isDeepStrictEqual(
      sortBy(
        actual.webApiWrappers,
        (entry) => wrapperKey(entry.apiFile, entry.wrapper)
      ),
      sortBy(
        expectedWeb,
        (entry) => wrapperKey(entry.apiFile, entry.wrapper)
      )
    ),
    "CAPABILITY_MATRIX_USAGE_WEB_EVIDENCE_DRIFT",
    { normalizedKey: usageRoute.normalizedKey }
  );
  assert(
    isDeepStrictEqual(actual.authStore, expectedAuth),
    "CAPABILITY_MATRIX_USAGE_AUTH_EVIDENCE_DRIFT",
    { normalizedKey: usageRoute.normalizedKey }
  );
  for (const entry of actual.ticketFollowups) {
    assert(
      ticketEvidence.some((expected) =>
        isDeepStrictEqual(entry, expected)
      ),
      "CAPABILITY_MATRIX_USAGE_TICKET_EVIDENCE_DRIFT",
      { normalizedKey: usageRoute.normalizedKey }
    );
  }
  if (usageRoute.consumerSurface === "web_api_wrapper") {
    assert(
      expectedWeb.length > 0 &&
        expectedAuth.length === 0 &&
        actual.ticketFollowups.length === 0 &&
        actual.manualSurfaceReason === null,
      "CAPABILITY_MATRIX_USAGE_SURFACE_CONTRADICTION"
    );
  } else if (usageRoute.consumerSurface === "auth_store") {
    assert(
      expectedAuth.length > 0 &&
        expectedWeb.length === 0 &&
        actual.ticketFollowups.length === 0 &&
        actual.manualSurfaceReason === null,
      "CAPABILITY_MATRIX_USAGE_SURFACE_CONTRADICTION"
    );
  } else if (
    usageRoute.consumerSurface === "signed_ticket_delivery"
  ) {
    assert(
      actual.ticketFollowups.length > 0 &&
        expectedWeb.length === 0 &&
        expectedAuth.length === 0 &&
        typeof actual.manualSurfaceReason === "string",
      "CAPABILITY_MATRIX_USAGE_SURFACE_CONTRADICTION"
    );
  } else if (
    usageRoute.consumerSurface === "machine_probe" ||
    usageRoute.consumerSurface === "operator_endpoint"
  ) {
    assert(
      expectedWeb.length === 0 &&
        expectedAuth.length === 0 &&
        actual.ticketFollowups.length === 0 &&
        typeof actual.manualSurfaceReason === "string",
      "CAPABILITY_MATRIX_USAGE_SURFACE_CONTRADICTION"
    );
  } else {
    assert(
      expectedWeb.length === 0 &&
        expectedAuth.length === 0 &&
        actual.ticketFollowups.length === 0 &&
        actual.manualSurfaceReason === null,
      "CAPABILITY_MATRIX_USAGE_SURFACE_CONTRADICTION"
    );
  }
}

function inputDescriptor(path, hash, status, summary) {
  return { path, sha256: hash, status, summary };
}

function escapeMarkdown(value) {
  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function listOrDash(values, valueFor = (value) => value) {
  return values.length > 0
    ? values.map(valueFor).join("<br>")
    : "—";
}

export function buildWholeSiteCapabilityMatrix({
  nestManifest,
  webManifest,
  pageManifest,
  usageManifest,
  inputHashes = {}
}) {
  validateNestManifest(nestManifest);
  validateWebManifest(webManifest);
  validatePageManifestShape(pageManifest);
  validateUsageManifestShape(usageManifest);

  const nestByExactKey = new Map(
    nestManifest.routes.map((route) => [
      routeExactKey(route),
      route
    ])
  );
  const nestByNormalizedKey = new Map(
    nestManifest.routes.map((route) => [
      route.normalizedKey,
      route
    ])
  );
  assert(
    usageManifest.routes.length === nestManifest.routes.length,
    "CAPABILITY_MATRIX_USAGE_ROUTE_SET_DRIFT"
  );
  const usageByExactKey = new Map();
  for (const usageRoute of usageManifest.routes) {
    const exactKey = routeExactKey(usageRoute);
    assert(
      !usageByExactKey.has(exactKey),
      "CAPABILITY_MATRIX_DUPLICATE_USAGE_ROUTE"
    );
    const nestRoute = nestByExactKey.get(exactKey);
    assert(
      nestRoute,
      "CAPABILITY_MATRIX_USAGE_ROUTE_SET_DRIFT",
      { exactKey }
    );
    assert(
      isDeepStrictEqual(
        selectedNestRoute(usageRoute),
        nestRoute
      ),
      "CAPABILITY_MATRIX_USAGE_ROUTE_METADATA_DRIFT",
      { exactKey }
    );
    usageByExactKey.set(exactKey, usageRoute);
  }

  const wrappersByKey = new Map(
    webManifest.wrappers.map((wrapper) => [
      wrapperKey(wrapper.apiFile, wrapper.name),
      wrapper
    ])
  );
  const mutationConsumers = mutationConsumersFor(
    webManifest.wrappers
  );
  const actionBindings = buildActionBindings({
    pageManifest,
    wrappersByKey,
    nestByNormalizedKey
  });
  validatePageSummary(
    pageManifest,
    webManifest,
    actionBindings,
    mutationConsumers
  );

  const acceptedMutationRequests = new Set();
  for (const { action, binding } of actionBindings) {
    if (
      !binding.causalVerified ||
      !action.capability.serverDerived ||
      !action.capability.dominatesTrigger ||
      !MUTATION_METHODS.has(binding.method)
    ) {
      continue;
    }
    for (const consumer of binding.acceptedProductionConsumers) {
      acceptedMutationRequests.add(
        `${mutationConsumerKey(
          binding.apiFile,
          binding.wrapper,
          consumer
        )}\u0000${binding.normalizedKey}`
      );
    }
  }
  const uncoveredMutationConsumers = mutationConsumers.filter(
    (pair) => {
      const pairKey = mutationConsumerKey(
        pair.apiFile,
        pair.wrapper,
        pair.consumer
      );
      return pair.normalizedKeys.some(
        (normalizedKey) =>
          !acceptedMutationRequests.has(
            `${pairKey}\u0000${normalizedKey}`
          )
      );
    }
  );
  assert(
    isDeepStrictEqual(
      sortBy(
        pageManifest.blockers.uncoveredMutationWrappers,
        (entry) =>
          `${entry.sourceFile}\u0000${entry.apiFile}\u0000${entry.wrapper}`
      ),
      sortBy(
        uncoveredMutationConsumers.map(selectedPageUncovered),
        (entry) =>
          `${entry.sourceFile}\u0000${entry.apiFile}\u0000${entry.wrapper}`
      )
    ),
    "CAPABILITY_MATRIX_PAGE_UNCOVERED_BLOCKER_DRIFT"
  );

  const webRequestsWithoutNest = [];
  for (const wrapper of webManifest.wrappers) {
    if (wrapper.kind !== "transport") continue;
    for (const request of wrapper.requests) {
      if (
        request.kind === "main" &&
        typeof request.normalizedKey === "string" &&
        !nestByNormalizedKey.has(request.normalizedKey)
      ) {
        webRequestsWithoutNest.push({
          apiFile: wrapper.apiFile,
          wrapper: wrapper.name,
          method: request.method,
          normalizedKey: request.normalizedKey,
          productionConsumers: wrapper.productionConsumers
        });
      }
    }
  }
  const expectedFrontendWithoutBackend =
    webRequestsWithoutNest.map((entry) => ({
      apiFile: entry.apiFile,
      wrapper: entry.wrapper,
      normalizedKey: entry.normalizedKey
    }));
  assert(
    isDeepStrictEqual(
      webManifest.blockers.frontendWithoutBackend,
      expectedFrontendWithoutBackend
    ),
    "CAPABILITY_MATRIX_WEB_BACKEND_BLOCKER_DRIFT"
  );
  const authRequestsWithoutNest =
    webManifest.authTransportExceptions
      .filter(
        (entry) =>
          !nestByNormalizedKey.has(entry.normalizedKey)
      )
      .map((entry) => ({
        sourceFile: entry.sourceFile,
        normalizedKey: entry.normalizedKey
      }));
  assert(
    isDeepStrictEqual(
      webManifest.blockers.authWithoutBackend,
      authRequestsWithoutNest
    ),
    "CAPABILITY_MATRIX_WEB_AUTH_BACKEND_BLOCKER_DRIFT"
  );

  assert(
    usageManifest.evidence.upstreamWebManifestStatus ===
      webManifest.status,
    "CAPABILITY_MATRIX_USAGE_UPSTREAM_STATUS_DRIFT"
  );
  assert(
    usageManifest.evidence.authStoreRouteCount ===
      webManifest.authTransportExceptions.length,
    "CAPABILITY_MATRIX_USAGE_EVIDENCE_SUMMARY_DRIFT"
  );
  const ticketEvidence = webManifest.wrappers.flatMap((wrapper) =>
    wrapper.requests
      .filter((request) => request.kind === "ticket_followup")
      .map((request) =>
        selectedTicketEvidence(wrapper, request)
      )
  );
  assert(
    usageManifest.evidence.productionTicketFollowupCount ===
      ticketEvidence.length,
    "CAPABILITY_MATRIX_USAGE_EVIDENCE_SUMMARY_DRIFT"
  );
  const productionWrapperRouteCount = new Set(
    webManifest.wrappers.flatMap((wrapper) =>
      wrapper.kind === "transport" &&
      wrapper.productionConsumers.length > 0
        ? wrapper.requests
            .filter(
              (request) =>
                request.kind === "main" &&
                typeof request.normalizedKey === "string"
            )
            .map((request) => request.normalizedKey)
        : []
    )
  ).size;
  assert(
    usageManifest.evidence.productionWrapperRouteCount ===
      productionWrapperRouteCount,
    "CAPABILITY_MATRIX_USAGE_EVIDENCE_SUMMARY_DRIFT"
  );

  for (const usageRoute of usageManifest.routes) {
    validateUsageEvidence({
      usageRoute,
      wrappers: webManifest.wrappers,
      authTransportExceptions:
        webManifest.authTransportExceptions,
      ticketEvidence
    });
  }
  validateUsageSummary(usageManifest);
  assert(
    isDeepStrictEqual(
      usageManifest.blockers.unclassifiedRoutes,
      expectedUnclassifiedBlockers(usageManifest.routes)
    ),
    "CAPABILITY_MATRIX_USAGE_UNCLASSIFIED_BLOCKER_DRIFT"
  );

  const unresolvedActions = actionBindings
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ action, binding, index, identity, reasons }) => ({
      actionId: action.id,
      bindingIndex: index,
      identity,
      apiFile: binding.apiFile,
      wrapper: binding.wrapper,
      normalizedKey: binding.normalizedKey,
      reasonCodes: reasons
    }));
  const upstreamManifestIssues = [
    ["web_api_wrappers", webManifest.status],
    ["web_page_actions", pageManifest.status],
    ["route_usage", usageManifest.status]
  ]
    .filter(([, status]) => status !== "ready")
    .map(([input, status]) => ({ input, status }));

  const blockers = {
    upstreamManifestIssues,
    webRequestsWithoutNest,
    authRequestsWithoutNest,
    orphanWrappers: webManifest.blockers.orphanWrappers,
    duplicateMutationRoutes:
      webManifest.blockers.duplicateWriteWrappers,
    unclassifiedRoutes:
      usageManifest.blockers.unclassifiedRoutes,
    uncoveredMutationConsumers,
    unresolvedActions
  };
  const actionBindingsByNormalizedKey = new Map();
  for (const entry of actionBindings) {
    const entries =
      actionBindingsByNormalizedKey.get(
        entry.binding.normalizedKey
      ) ?? [];
    entries.push(entry);
    actionBindingsByNormalizedKey.set(
      entry.binding.normalizedKey,
      entries
    );
  }
  const mutationPairsByNormalizedKey = new Map();
  for (const pair of mutationConsumers) {
    for (const normalizedKey of pair.normalizedKeys) {
      const entries =
        mutationPairsByNormalizedKey.get(normalizedKey) ?? [];
      entries.push(pair);
      mutationPairsByNormalizedKey.set(normalizedKey, entries);
    }
  }
  const duplicateMutationKeys = new Set(
    blockers.duplicateMutationRoutes.map(
      (entry) => entry.normalizedKey
    )
  );
  const orphanWrapperKeys = new Set(
    blockers.orphanWrappers.map((entry) =>
      wrapperKey(entry.apiFile, entry.wrapper)
    )
  );
  const unresolvedActionKeys = new Set(
    unresolvedActions.map((entry) => entry.identity)
  );
  const uncoveredMutationKeys = new Set(
    uncoveredMutationConsumers.map((pair) =>
      mutationConsumerKey(
        pair.apiFile,
        pair.wrapper,
        pair.consumer
      )
    )
  );

  const routes = sortBy(
    nestManifest.routes,
    (route) => `${route.normalizedKey}\u0000${route.path}`
  ).map((route) => {
    const usage = usageByExactKey.get(routeExactKey(route));
    const wrapperRequests = [];
    for (const wrapper of webManifest.wrappers) {
      if (wrapper.kind !== "transport") continue;
      for (const request of wrapper.requests) {
        if (
          request.kind === "main" &&
          request.normalizedKey === route.normalizedKey
        ) {
          wrapperRequests.push({
            apiFile: wrapper.apiFile,
            wrapper: wrapper.name,
            method: request.method,
            path: request.path,
            normalizedKey: request.normalizedKey,
            bodyKind: request.bodyKind,
            productionConsumers: wrapper.productionConsumers,
            testConsumers: wrapper.testConsumers
          });
        }
      }
    }
    const routeActionBindings =
      actionBindingsByNormalizedKey.get(route.normalizedKey) ?? [];
    const routeMutationPairs =
      mutationPairsByNormalizedKey.get(route.normalizedKey) ?? [];
    const uncoveredForRoute = routeMutationPairs.filter((pair) =>
      uncoveredMutationKeys.has(
        mutationConsumerKey(
          pair.apiFile,
          pair.wrapper,
          pair.consumer
        )
      )
    );
    const blockerCodes = new Set();
    if (usage.usage === "unclassified") {
      blockerCodes.add("ROUTE_USAGE_UNCLASSIFIED");
    }
    if (duplicateMutationKeys.has(route.normalizedKey)) {
      blockerCodes.add("DUPLICATE_MUTATION_ROUTE");
    }
    if (
      wrapperRequests.some((request) =>
        orphanWrapperKeys.has(
          wrapperKey(request.apiFile, request.wrapper)
        )
      )
    ) {
      blockerCodes.add("ORPHAN_WRAPPER");
    }
    if (uncoveredForRoute.length > 0) {
      blockerCodes.add("MUTATION_CONSUMER_UNCOVERED");
    }
    if (
      routeActionBindings.some((entry) =>
        unresolvedActionKeys.has(entry.identity)
      )
    ) {
      blockerCodes.add("ACTION_BINDING_UNRESOLVED");
    }
    return {
      route,
      usage: usage.usage,
      consumerSurface: usage.consumerSurface,
      wrapperRequests: sortBy(
        wrapperRequests,
        (entry) => wrapperKey(entry.apiFile, entry.wrapper)
      ),
      authTransports: usage.consumerEvidence.authStore,
      actions: routeActionBindings.map(
        ({ action, binding, index, identity, reasons }) => ({
          actionId: action.id,
          bindingIndex: index,
          identity,
          usage: action.usage,
          semantic: action.semantic,
          sourceFile: action.sourceFile,
          capability: action.capability,
          apiFile: binding.apiFile,
          wrapper: binding.wrapper,
          productionConsumers: binding.productionConsumers,
          acceptedProductionConsumers:
            binding.acceptedProductionConsumers,
          causalVerified: binding.causalVerified,
          accepted:
            reasons.length === 0 &&
            binding.acceptedProductionConsumers.length > 0,
          blockerCodes: reasons
        })
      ),
      mutationCoverage:
        routeMutationPairs.length === 0
          ? "not_applicable"
          : uncoveredForRoute.length === 0
            ? "covered"
            : "uncovered",
      blockerCodes: [...blockerCodes].sort(stableCompare)
    };
  });

  const hashes = {
    nestRoutes:
      inputHashes.nestRoutes ?? sha256(renderJson(nestManifest)),
    webApiWrappers:
      inputHashes.webApiWrappers ??
      sha256(renderJson(webManifest)),
    webPageActions:
      inputHashes.webPageActions ??
      sha256(renderJson(pageManifest)),
    routeUsage:
      inputHashes.routeUsage ??
      sha256(renderJson(usageManifest))
  };
  for (const value of Object.values(hashes)) {
    assertSha256(value, "CAPABILITY_MATRIX_INVALID_INPUT_HASH");
  }

  const summary = {
    routeCount: routes.length,
    pageRouteCount: routes.filter(
      (route) => route.usage === "page"
    ).length,
    externalTakeoverRouteCount: routes.filter(
      (route) => route.usage === "external_takeover"
    ).length,
    exitCandidateRouteCount: routes.filter(
      (route) => route.usage === "exit_candidate"
    ).length,
    internalTaskRouteCount: routes.filter(
      (route) => route.usage === "internal_task"
    ).length,
    unclassifiedRouteCount: routes.filter(
      (route) => route.usage === "unclassified"
    ).length,
    mainRequestBindingCount:
      webManifest.summary.mainRequestBindingCount,
    webRequestWithoutNestCount:
      webRequestsWithoutNest.length,
    authRequestWithoutNestCount:
      authRequestsWithoutNest.length,
    orphanWrapperCount: blockers.orphanWrappers.length,
    duplicateMutationRouteCount:
      blockers.duplicateMutationRoutes.length,
    registeredActionCount: pageManifest.actions.length,
    actionBindingCount: actionBindings.length,
    acceptedActionBindingCount: actionBindings.filter(
      ({ reasons, binding }) =>
        reasons.length === 0 &&
        binding.acceptedProductionConsumers.length > 0
    ).length,
    unresolvedActionBindingCount: unresolvedActions.length,
    productionMutationConsumerPairCount:
      mutationConsumers.length,
    coveredProductionMutationConsumerPairCount:
      mutationConsumers.length -
      uncoveredMutationConsumers.length,
    uncoveredProductionMutationConsumerPairCount:
      uncoveredMutationConsumers.length,
    blockerCount: blockerCount(blockers)
  };
  const status =
    summary.blockerCount === 0 ? "ready" : "blocked";
  return {
    schemaVersion: 1,
    status,
    scope: {
      authorizationScope:
        "cross_manifest_release_evidence_only",
      deletionAuthorized: false,
      inputs: CAPABILITY_MATRIX_INPUT_PATHS
    },
    inputManifests: {
      nestRoutes: inputDescriptor(
        CAPABILITY_MATRIX_INPUT_PATHS.nestRoutes,
        hashes.nestRoutes,
        "ready",
        { routeCount: nestManifest.routes.length }
      ),
      webApiWrappers: inputDescriptor(
        CAPABILITY_MATRIX_INPUT_PATHS.webApiWrappers,
        hashes.webApiWrappers,
        webManifest.status,
        webManifest.summary
      ),
      webPageActions: inputDescriptor(
        CAPABILITY_MATRIX_INPUT_PATHS.webPageActions,
        hashes.webPageActions,
        pageManifest.status,
        pageManifest.summary
      ),
      routeUsage: inputDescriptor(
        CAPABILITY_MATRIX_INPUT_PATHS.routeUsage,
        hashes.routeUsage,
        usageManifest.status,
        usageManifest.summary
      )
    },
    summary,
    blockers,
    routes
  };
}

async function readInput(root, relativePath, code) {
  const targetPath = resolve(root, relativePath);
  let rendered;
  try {
    rendered = await readFile(targetPath, "utf8");
  } catch {
    throw matrixError(code);
  }
  let manifest;
  try {
    manifest = JSON.parse(rendered);
  } catch {
    throw matrixError(code);
  }
  return { manifest, sha256: sha256(rendered) };
}

export async function inspectWholeSiteCapabilityMatrix({
  root,
  inputPaths = CAPABILITY_MATRIX_INPUT_PATHS
}) {
  const resolvedRoot = resolve(root);
  assertExactKeys(
    inputPaths,
    Object.keys(CAPABILITY_MATRIX_INPUT_PATHS),
    "CAPABILITY_MATRIX_INVALID_INPUT_PATHS"
  );
  const [
    nestInput,
    webInput,
    pageInput,
    usageInput
  ] = await Promise.all([
    readInput(
      resolvedRoot,
      inputPaths.nestRoutes,
      "CAPABILITY_MATRIX_NEST_INPUT_UNREADABLE"
    ),
    readInput(
      resolvedRoot,
      inputPaths.webApiWrappers,
      "CAPABILITY_MATRIX_WEB_INPUT_UNREADABLE"
    ),
    readInput(
      resolvedRoot,
      inputPaths.webPageActions,
      "CAPABILITY_MATRIX_PAGE_INPUT_UNREADABLE"
    ),
    readInput(
      resolvedRoot,
      inputPaths.routeUsage,
      "CAPABILITY_MATRIX_USAGE_INPUT_UNREADABLE"
    )
  ]);
  const liveWebManifest = await inspectWholeSiteWebApiManifest({
    root: resolvedRoot
  });
  assert(
    isDeepStrictEqual(webInput.manifest, liveWebManifest),
    "CAPABILITY_MATRIX_WEB_SOURCE_DRIFT"
  );
  LIVE_WEB_MANIFESTS.add(liveWebManifest);
  return buildWholeSiteCapabilityMatrix({
    nestManifest: nestInput.manifest,
    webManifest: liveWebManifest,
    pageManifest: pageInput.manifest,
    usageManifest: usageInput.manifest,
    inputHashes: {
      nestRoutes: nestInput.sha256,
      webApiWrappers: webInput.sha256,
      webPageActions: pageInput.sha256,
      routeUsage: usageInput.sha256
    }
  });
}

export function renderWholeSiteCapabilityMatrix(manifest) {
  return renderJson(manifest);
}

export function renderWholeSiteCapabilityMatrixMarkdown(manifest) {
  assertObject(
    manifest,
    "CAPABILITY_MATRIX_INVALID_RENDER_INPUT"
  );
  const lines = [
    "# 整站能力矩阵",
    "",
    `状态：\`${manifest.status}\`。本表仅交叉核验四份实施清单，不构成删除或生产写入授权。`,
    "",
    "## 输入证据",
    "",
    "| 输入 | 状态 | SHA-256 |",
    "| --- | --- | --- |"
  ];
  for (const [name, input] of Object.entries(
    manifest.inputManifests
  )) {
    lines.push(
      `| ${escapeMarkdown(name)} | ${escapeMarkdown(
        input.status
      )} | \`${input.sha256}\` |`
    );
  }
  lines.push(
    "",
    "## 汇总",
    "",
    "| 指标 | 数量 |",
    "| --- | ---: |"
  );
  for (const [name, value] of Object.entries(manifest.summary)) {
    lines.push(
      `| ${escapeMarkdown(name)} | ${escapeMarkdown(value)} |`
    );
  }
  lines.push(
    "",
    "## 路由矩阵",
    "",
    "| 方法 | 路径 | 用途 | 消费面 | Web wrapper | 动作 | 写入覆盖 | 阻塞 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const row of manifest.routes) {
    lines.push(
      `| ${escapeMarkdown(row.route.method)} | ${escapeMarkdown(
        row.route.path
      )} | ${escapeMarkdown(row.usage)} | ${escapeMarkdown(
        row.consumerSurface
      )} | ${listOrDash(
        row.wrapperRequests,
        (entry) =>
          `${escapeMarkdown(entry.apiFile)}#${escapeMarkdown(
            entry.wrapper
          )}`
      )} | ${listOrDash(
        row.actions,
        (entry) => escapeMarkdown(entry.actionId)
      )} | ${escapeMarkdown(
        row.mutationCoverage
      )} | ${listOrDash(
        row.blockerCodes,
        escapeMarkdown
      )} |`
    );
  }
  lines.push(
    "",
    "## 阻塞附录",
    "",
    "### 无后端路由的 Web 请求",
    "",
    ...(
      manifest.blockers.webRequestsWithoutNest.length > 0
        ? manifest.blockers.webRequestsWithoutNest.map(
            (entry) =>
              `- \`${entry.normalizedKey}\` — ${entry.apiFile}#${entry.wrapper}`
          )
        : ["- 无"]
    ),
    "",
    "### 无后端路由的 Auth transport",
    "",
    ...(
      manifest.blockers.authRequestsWithoutNest.length > 0
        ? manifest.blockers.authRequestsWithoutNest.map(
            (entry) =>
              `- \`${entry.normalizedKey}\` — ${entry.sourceFile}`
          )
        : ["- 无"]
    ),
    "",
    "### 孤儿 wrapper",
    "",
    ...(
      manifest.blockers.orphanWrappers.length > 0
        ? manifest.blockers.orphanWrappers.map(
            (entry) =>
              `- ${entry.apiFile}#${entry.wrapper}（${entry.classification}）`
          )
        : ["- 无"]
    ),
    "",
    "### 未覆盖写入消费者",
    "",
    ...(
      manifest.blockers.uncoveredMutationConsumers.length > 0
        ? manifest.blockers.uncoveredMutationConsumers.map(
            (entry) =>
              `- ${entry.apiFile}#${entry.wrapper} → ${entry.consumer}`
          )
        : ["- 无"]
    ),
    "",
    "### 未解决动作绑定",
    "",
    ...(
      manifest.blockers.unresolvedActions.length > 0
        ? manifest.blockers.unresolvedActions.map(
            (entry) =>
              `- ${entry.actionId}#${entry.bindingIndex} — ${entry.reasonCodes.join(", ")}`
          )
        : ["- 无"]
    ),
    ""
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeOrCheckWholeSiteCapabilityMatrix({
  mode,
  jsonTargetPath,
  markdownTargetPath,
  jsonRendered,
  markdownRendered
}) {
  assert(
    mode === "write" || mode === "check",
    "CAPABILITY_MATRIX_INVALID_WRITE_MODE"
  );
  assertString(
    jsonTargetPath,
    "CAPABILITY_MATRIX_INVALID_TARGET_PATH"
  );
  assertString(
    markdownTargetPath,
    "CAPABILITY_MATRIX_INVALID_TARGET_PATH"
  );
  assertString(
    jsonRendered,
    "CAPABILITY_MATRIX_INVALID_RENDERED_OUTPUT"
  );
  assertString(
    markdownRendered,
    "CAPABILITY_MATRIX_INVALID_RENDERED_OUTPUT"
  );
  if (mode === "write") {
    await Promise.all([
      mkdir(dirname(jsonTargetPath), { recursive: true }),
      mkdir(dirname(markdownTargetPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(jsonTargetPath, jsonRendered),
      writeFile(markdownTargetPath, markdownRendered)
    ]);
    return;
  }
  let actualJson;
  let actualMarkdown;
  try {
    [actualJson, actualMarkdown] = await Promise.all([
      readFile(jsonTargetPath, "utf8"),
      readFile(markdownTargetPath, "utf8")
    ]);
  } catch {
    throw matrixError("CAPABILITY_MATRIX_OUTPUT_MISSING");
  }
  assert(
    actualJson === jsonRendered,
    "CAPABILITY_MATRIX_JSON_DRIFT"
  );
  assert(
    actualMarkdown === markdownRendered,
    "CAPABILITY_MATRIX_MARKDOWN_DRIFT"
  );
}

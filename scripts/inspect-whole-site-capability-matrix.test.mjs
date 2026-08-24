import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildWholeSiteCapabilityMatrix,
  renderWholeSiteCapabilityMatrix,
  renderWholeSiteCapabilityMatrixMarkdown,
  writeOrCheckWholeSiteCapabilityMatrix
} from "./lib/whole-site-capability-matrix.mjs";
import {
  runWholeSiteCapabilityMatrixCli,
  verifyWholeSiteCapabilityMatrixReadyInputs
} from "./inspect-whole-site-capability-matrix.mjs";
import { deriveDuplicateWebApiRoutes } from "./lib/whole-site-web-api-manifest.mjs";

const EMPTY_WEB_BLOCKERS = {
  orphanWrappers: [],
  duplicateWriteWrappers: [],
  unresolvedRequests: [],
  frontendWithoutBackend: [],
  consumerIssues: [],
  authWithoutBackend: []
};
const EMPTY_PAGE_BLOCKERS = {
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
const EMPTY_USAGE_BLOCKERS = {
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
const SURFACES = [
  "web_api_wrapper",
  "auth_store",
  "signed_ticket_delivery",
  "machine_probe",
  "operator_endpoint",
  "none"
];
const MUTATIONS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function clone(value) {
  return structuredClone(value);
}

function digestEntries(entries, identityFor) {
  return createHash("sha256")
    .update(
      entries
        .map(identityFor)
        .sort((left, right) => left.localeCompare(right, "en"))
        .join("\n")
    )
    .digest("hex");
}

function normalize(path) {
  return path
    .split("?")[0]
    .replace(
      /(^|\/):[A-Za-z_][A-Za-z0-9_]*(?:\([^/]*\))?[?+*]?/g,
      "$1:param"
    );
}

function route(method, path, suffix = "Fixture") {
  return {
    method,
    path,
    normalizedKey: `${method} ${normalize(path)}`,
    controller: `${suffix}Controller`,
    handler: `handle${suffix}`,
    sourceFile: `services/api/src/${suffix.toLowerCase()}.controller.ts`,
    authorizationScope: "guard_metadata_only",
    authentication: "authenticated",
    guardAuthorization: "authenticated_only",
    isPublic: false,
    requiredPositions: [],
    requiredProjectAction: null,
    authorizationCombination: null,
    contractCutoverSurface: false,
    contractCutoverLegacyWrite: false,
    contractCutoverTombstoneWrite: false
  };
}

function wrapper(
  method,
  path,
  {
    name = "fixtureRequest",
    apiFile = "apps/web-admin/src/api/fixture.api.ts",
    productionConsumers = [
      "apps/web-admin/src/pages/FixturePage.vue"
    ],
    testConsumers = [],
    unreachableConsumers = [],
    sourceLine = 10,
    localCallChains = [[name]]
  } = {}
) {
  const normalizedPath = normalize(path);
  return {
    name,
    apiFile,
    kind: "transport",
    requests: [
      {
        kind: "main",
        sourceLine,
        localCallChains,
        method,
        path,
        normalizedPath,
        normalizedKey: `${method} ${normalizedPath}`,
        bodyKind: MUTATIONS.has(method) ? "json" : "none"
      }
    ],
    productionConsumers,
    testConsumers,
    unreachableConsumers
  };
}

function duplicateRoutes(wrappers) {
  return deriveDuplicateWebApiRoutes(wrappers);
}

function webManifest(
  wrappers,
  {
    frontendWithoutBackend = [],
    extraBlockers = {}
  } = {}
) {
  const duplicates = duplicateRoutes(wrappers);
  const orphans = wrappers
    .filter(
      (item) =>
        item.kind === "transport" &&
        item.productionConsumers.length === 0
    )
    .map((item) => ({
      apiFile: item.apiFile,
      wrapper: item.name,
      classification:
        item.testConsumers.length > 0
          ? "test_only"
          : item.unreachableConsumers.length > 0
            ? "unreachable_only"
            : "unreferenced"
    }))
    .sort((left, right) =>
      `${left.apiFile}\u0000${left.wrapper}`.localeCompare(
        `${right.apiFile}\u0000${right.wrapper}`,
        "en"
      )
    );
  const blockers = {
    ...clone(EMPTY_WEB_BLOCKERS),
    orphanWrappers: orphans,
    duplicateWriteWrappers: duplicates.filter((entry) =>
      MUTATIONS.has(entry.normalizedKey.split(" ")[0])
    ),
    frontendWithoutBackend,
    ...extraBlockers
  };
  const main = wrappers.flatMap((item) =>
    item.requests.filter((request) => request.kind === "main")
  );
  const tickets = wrappers.flatMap((item) =>
    item.requests.filter(
      (request) => request.kind === "ticket_followup"
    )
  );
  return {
    schemaVersion: 1,
    status: Object.values(blockers).some(
      (entries) => entries.length > 0
    )
      ? "blocked"
      : "ready",
    scope: {
      apiRoot: "apps/web-admin/src/api",
      productionEntrypoint: "apps/web-admin/src/main.ts",
      nestRouteManifest:
        "docs/product/manifests/nest-business-routes.json"
    },
    summary: {
      apiModuleCount: new Set(
        wrappers.map((item) => item.apiFile)
      ).size,
      exportedFunctionCount: wrappers.length,
      transportWrapperCount: wrappers.length,
      pureExportCount: 0,
      mainRequestBindingCount: main.length,
      ticketFollowupCount: tickets.length,
      requestEdgeCount: main.length + tickets.length,
      productionConsumerCount: wrappers.filter(
        (item) => item.productionConsumers.length > 0
      ).length,
      orphanWrapperCount: orphans.length,
      testOnlyWrapperCount: orphans.filter(
        (entry) => entry.classification === "test_only"
      ).length,
      unreferencedWrapperCount: orphans.filter(
        (entry) => entry.classification === "unreferenced"
      ).length,
      duplicateNormalizedRouteGroupCount: duplicates.length,
      authTransportExceptionCount: 0
    },
    evidence: {
      productionModuleCount: 1,
      reachableProductionModuleCount: 1
    },
    wrappers,
    authTransportExceptions: [],
    duplicateNormalizedRoutes: duplicates,
    blockers
  };
}

function mutationPairs(web) {
  return web.wrappers.flatMap((item) => {
    const normalizedKeys = [
      ...new Set(
        item.requests
          .filter(
            (request) =>
              request.kind === "main" &&
              MUTATIONS.has(request.method)
          )
          .map((request) => request.normalizedKey)
      )
    ].sort();
    return normalizedKeys.length === 0
      ? []
      : item.productionConsumers.map((consumer) => ({
          apiFile: item.apiFile,
          wrapper: item.name,
          consumer,
          normalizedKeys
        }));
  });
}

function actionFor(nestRoute, item, { accepted }) {
  const consumer = item.productionConsumers[0];
  const request = item.requests[0];
  return {
    id: "fixture.save",
    usage: "page_action",
    routePaths: ["/fixtures"],
    ownerRoutePaths: ["/fixtures"],
    sourceFile: consumer,
    trigger: {
      element: "t-button",
      event: "click",
      handler: "save",
      kind: "event",
      sourceLine: 10,
      sourceColumn: 4
    },
    semantic: "business_write",
    capability: {
      kind: "detail_action",
      source: "detail.availableActions",
      key: "save",
      serverDerived: true,
      dominatesTrigger: accepted
    },
    bindings: [
      {
        apiFile: item.apiFile,
        wrapper: item.name,
        method: request.method,
        path: request.path,
        normalizedKey: request.normalizedKey,
        bodyKind: request.bodyKind,
        nestRoute: {
          method: nestRoute.method,
          path: nestRoute.path,
          normalizedKey: nestRoute.normalizedKey,
          controller: nestRoute.controller,
          handler: nestRoute.handler,
          sourceFile: nestRoute.sourceFile,
          authorizationScope: nestRoute.authorizationScope,
          authentication: nestRoute.authentication,
          guardAuthorization: nestRoute.guardAuthorization,
          isPublic: nestRoute.isPublic,
          requiredPositions: nestRoute.requiredPositions,
          requiredProjectAction:
            nestRoute.requiredProjectAction
        },
        productionConsumers: [consumer],
        acceptedProductionConsumers: accepted
          ? [consumer]
          : [],
        causalVerified: accepted,
        causalProof: { localCallChain: ["save"] },
        ticketFollowups: []
      }
    ]
  };
}

function uncoveredBlocker(pair) {
  return {
    code:
      "PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION",
    apiFile: pair.apiFile,
    wrapper: pair.wrapper,
    sourceFile: pair.consumer,
    normalizedKeys: pair.normalizedKeys
  };
}

function pageManifest(web, actions, { unresolved = false } = {}) {
  const pairs = mutationPairs(web);
  const accepted = new Set();
  const candidates = new Set();
  for (const action of actions) {
    for (const binding of action.bindings) {
      if (!MUTATIONS.has(binding.method)) continue;
      for (const consumer of binding.productionConsumers) {
        candidates.add(
          `${binding.apiFile}\u0000${binding.wrapper}\u0000${consumer}`
        );
      }
      if (
        binding.causalVerified &&
        action.capability.serverDerived &&
        action.capability.dominatesTrigger
      ) {
        for (const consumer of binding.acceptedProductionConsumers) {
          accepted.add(
            `${binding.apiFile}\u0000${binding.wrapper}\u0000${consumer}`
          );
        }
      }
    }
  }
  const uncovered = pairs.filter(
    (pair) =>
      !accepted.has(
        `${pair.apiFile}\u0000${pair.wrapper}\u0000${pair.consumer}`
      )
  );
  const blockers = {
    ...clone(EMPTY_PAGE_BLOCKERS),
    unresolvedWrappers: unresolved
      ? [{ code: "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED" }]
      : [],
    uncoveredMutationWrappers: uncovered.map(uncoveredBlocker),
    upstreamManifestIssues:
      web.status === "blocked"
        ? [
            {
              code: "UPSTREAM_WEB_MANIFEST_BLOCKED",
              status: "blocked"
            }
          ]
        : []
  };
  const totalBlockers = Object.values(blockers).reduce(
    (total, entries) => total + entries.length,
    0
  );
  return {
    schemaVersion: 1,
    status: totalBlockers === 0 ? "ready" : "blocked",
    scope: {
      registry:
        "docs/product/manifests/web-page-actions.registry.json",
      webApiManifest:
        "docs/product/manifests/web-api-wrappers.json",
      nestRouteManifest:
        "docs/product/manifests/nest-business-routes.json",
      productionEntrypoint: "apps/web-admin/src/main.ts",
      authorizationScope: "ui_capability_binding_only"
    },
    summary: {
      registeredActionCount: actions.length,
      pageActionCount: actions.filter(
        (action) => action.usage === "page_action"
      ).length,
      backgroundActionCount: actions.filter(
        (action) => action.usage === "background"
      ).length,
      reachableVueFileCount: 1,
      routeRootCount: 1,
      totalVueFileCount: 1,
      parsedVueFileCount: 1,
      reachableProductionModuleCount: 1,
      templateEventDirectiveCount: actions.length,
      propCallbackDirectiveCount: 0,
      coveredProductionMutationConsumerCount: accepted.size,
      candidateProductionMutationConsumerCount: candidates.size,
      acceptedProductionMutationConsumerCount: accepted.size,
      productionMutationConsumerPairCount: pairs.length,
      blockerCount: totalBlockers
    },
    evidence: {
      totalProductionModuleCount: 1,
      reachableProductionModuleCount: 1,
      totalVueFileCount: 1,
      parsedVueFileCount: 1
    },
    actions,
    blockers
  };
}

function webEvidence(web, normalizedKey) {
  return web.wrappers.flatMap((item) =>
    item.productionConsumers.length === 0
      ? []
      : item.requests
          .filter(
            (request) =>
              request.kind === "main" &&
              request.normalizedKey === normalizedKey
          )
          .map((request) => ({
            apiFile: item.apiFile,
            wrapper: item.name,
            method: request.method,
            normalizedPath: request.normalizedPath,
            normalizedKey: request.normalizedKey,
            productionConsumers: item.productionConsumers
          }))
  );
}

function usageEntry(
  nestRoute,
  web,
  {
    usage,
    consumerSurface,
    classificationSource,
    manualSurfaceReason = null
  } = {}
) {
  const evidence = webEvidence(web, nestRoute.normalizedKey);
  const resolvedSurface =
    consumerSurface ??
    (evidence.length > 0 ? "web_api_wrapper" : "none");
  const resolvedUsage =
    usage ?? (evidence.length > 0 ? "page" : "external_takeover");
  return {
    ...nestRoute,
    usage: resolvedUsage,
    classificationSource:
      classificationSource ??
      (evidence.length > 0
        ? "production_web_evidence"
        : "registry_override"),
    classificationReason:
      evidence.length > 0 ? null : `${resolvedUsage}_fixture`,
    consumerSurface: resolvedSurface,
    consumerEvidence: {
      webApiWrappers: evidence,
      authStore: [],
      ticketFollowups: [],
      manualSurfaceReason
    },
    deletionAuthorized: false,
    exitCandidateSemantics:
      resolvedUsage === "exit_candidate"
        ? "candidate_only_no_deletion_authorization"
        : null
  };
}

function usageManifest(nestRoutes, web, routeOptions = []) {
  const routes = nestRoutes.map((item, index) =>
    usageEntry(item, web, routeOptions[index])
  );
  const classificationOverrides = routes.filter(
    (item) => item.classificationSource === "registry_override"
  );
  const consumerSurfaceOverrides = routes.filter(
    (item) =>
      item.consumerEvidence.manualSurfaceReason !== null
  );
  const unclassified = routes
    .filter((item) => item.usage === "unclassified")
    .map((item) => ({
      method: item.method,
      path: item.path,
      normalizedKey: item.normalizedKey,
      controller: item.controller,
      handler: item.handler,
      sourceFile: item.sourceFile,
      consumerSurface: item.consumerSurface
    }));
  const blockers = {
    ...clone(EMPTY_USAGE_BLOCKERS),
    unclassifiedRoutes: unclassified
  };
  const status = unclassified.length === 0 ? "ready" : "blocked";
  const countUsage = (name) =>
    routes.filter((item) => item.usage === name).length;
  return {
    schemaVersion: 1,
    status,
    scope: {
      registry: "docs/product/manifests/route-usage.registry.json",
      webApiManifest:
        "docs/product/manifests/web-api-wrappers.json",
      nestRouteManifest:
        "docs/product/manifests/nest-business-routes.json",
      authorizationScope: "route_usage_classification_only",
      deletionAuthorized: false,
      exitCandidateSemantics:
        "candidate_only_no_deletion_authorization"
    },
    summary: {
      routeCount: routes.length,
      exactRouteCount: routes.length,
      normalizedRouteCount: routes.length,
      classificationOverrideCount: routes.filter(
        (item) =>
          item.classificationSource === "registry_override"
      ).length,
      consumerSurfaceOverrideCount: routes.filter(
        (item) =>
          item.consumerEvidence.manualSurfaceReason !== null
      ).length,
      classificationOverrideSha256: digestEntries(
        classificationOverrides,
        (item) => `${item.method} ${item.path} ${item.usage}`
      ),
      consumerSurfaceOverrideSha256: digestEntries(
        consumerSurfaceOverrides,
        (item) =>
          `${item.method} ${item.path} ${item.consumerSurface}`
      ),
      derivedProductionPageCount: routes.filter(
        (item) =>
          item.classificationSource ===
          "production_web_evidence"
      ).length,
      pageRouteCount: countUsage("page"),
      externalTakeoverCount: countUsage("external_takeover"),
      exitCandidateCount: countUsage("exit_candidate"),
      internalTaskCount: countUsage("internal_task"),
      unclassifiedCount: countUsage("unclassified"),
      consumerSurfaceCounts: Object.fromEntries(
        SURFACES.map((surface) => [
          surface,
          routes.filter(
            (item) => item.consumerSurface === surface
          ).length
        ])
      ),
      blockerCount: unclassified.length
    },
    evidence: {
      upstreamWebManifestStatus: web.status,
      productionWrapperRouteCount: new Set(
        web.wrappers.flatMap((item) =>
          item.productionConsumers.length > 0
            ? item.requests
                .filter(
                  (request) =>
                    request.kind === "main" &&
                    typeof request.normalizedKey === "string"
                )
                .map((request) => request.normalizedKey)
            : []
        )
      ).size,
      authStoreRouteCount: 0,
      productionTicketFollowupCount: 0
    },
    routes,
    blockers
  };
}

function fixture({ mutation = "none" } = {}) {
  const nestRoutes = [route("GET", "/fixtures/:fixtureId")];
  const wrappers = [
    wrapper("GET", "/fixtures/:param", {
      name: "fetchFixture"
    })
  ];
  if (mutation !== "none") {
    nestRoutes.push(route("POST", "/fixtures", "SaveFixture"));
    wrappers.push(
      wrapper("POST", "/fixtures", {
        name: "saveFixture"
      })
    );
  }
  const web = webManifest(wrappers);
  const actions =
    mutation === "none"
      ? []
      : [
          actionFor(nestRoutes[1], wrappers[1], {
            accepted: mutation === "accepted"
          })
        ];
  const page = pageManifest(web, actions, {
    unresolved: mutation === "candidate"
  });
  const usage = usageManifest(nestRoutes, web);
  return {
    nestManifest: {
      schemaVersion: 1,
      authorizationScope: "guard_metadata_only",
      routes: nestRoutes
    },
    webManifest: web,
    pageManifest: page,
    usageManifest: usage
  };
}

function build(input = fixture()) {
  return buildWholeSiteCapabilityMatrix(input);
}

test("builds a ready GET route matrix", () => {
  const matrix = build();
  assert.equal(matrix.status, "ready");
  assert.equal(matrix.summary.routeCount, 1);
  assert.equal(matrix.routes[0].mutationCoverage, "not_applicable");
});

test("carries a GET-only fresh-read binding without classifying it as a mutation", () => {
  const input = fixture();
  const action = actionFor(
    input.nestManifest.routes[0],
    input.webManifest.wrappers[0],
    { accepted: true }
  );
  action.id = "fixture.definition";
  action.semantic = "business_write";
  action.capability = {
    kind: "server_definition",
    source: "definition.key",
    serverDerived: true,
    dominatesTrigger: true,
    freshRead: {
      apiFile: input.webManifest.wrappers[0].apiFile,
      name: input.webManifest.wrappers[0].name,
      method: "GET",
      mode: "read_only_probe",
      binding: {
        actor: "actor",
        company: "company",
        scene: "scene",
        action: "action",
        definitionRevision: "definitionRevision"
      },
      submissionTarget: "independent"
    }
  };
  input.pageManifest = pageManifest(input.webManifest, [action]);

  const matrix = build(input);
  assert.equal(matrix.status, "ready");
  assert.deepEqual(
    matrix.routes[0].actions[0].capability.freshRead,
    action.capability.freshRead
  );
  assert.equal(matrix.routes[0].actions[0].accepted, false);
  assert.equal(matrix.routes[0].mutationCoverage, "not_applicable");
  assert.equal(
    matrix.summary.coveredProductionMutationConsumerPairCount,
    0
  );

  for (const freshRead of [
    { ...action.capability.freshRead, method: "POST" },
    { ...action.capability.freshRead, submissionTarget: "create_target" }
  ]) {
    const invalid = clone(input);
    invalid.pageManifest.actions[0].capability.freshRead = freshRead;
    assert.throws(
      () => build(invalid),
      (error) =>
        error?.code === "CAPABILITY_MATRIX_INVALID_ACTION_CAPABILITY"
    );
  }
});

test("accepts a causally verified server-capability mutation", () => {
  const matrix = build(fixture({ mutation: "accepted" }));
  assert.equal(matrix.status, "ready");
  assert.equal(
    matrix.summary.coveredProductionMutationConsumerPairCount,
    1
  );
});

test("blocks an accepted write action bound only to GET", () => {
  const input = fixture();
  const getWrapper = input.webManifest.wrappers[0];
  input.pageManifest = pageManifest(
    input.webManifest,
    [
      actionFor(input.nestManifest.routes[0], getWrapper, {
        accepted: true
      })
    ]
  );

  const matrix = build(input);
  assert.equal(matrix.status, "blocked");
  assert.equal(matrix.summary.unresolvedActionBindingCount, 1);
  assert.deepEqual(
    matrix.blockers.unresolvedActions[0].reasonCodes,
    ["binding_not_mutation"]
  );
  assert.equal(matrix.routes[0].actions[0].accepted, false);
});

test("keeps a composite GET preflight as non-blocking causal evidence", () => {
  const input = fixture();
  const postRoute = route("POST", "/fixtures", "SaveFixture");
  input.nestManifest.routes.push(postRoute);
  const mixed = wrapper("GET", "/fixtures/:param", {
    name: "mixedFixture"
  });
  mixed.requests.push({
    kind: "main",
    sourceLine: 11,
    localCallChains: [["mixedFixture"]],
    method: "POST",
    path: "/fixtures",
    normalizedPath: "/fixtures",
    normalizedKey: "POST /fixtures",
    bodyKind: "json"
  });
  input.webManifest = webManifest([mixed]);
  const action = actionFor(input.nestManifest.routes[0], mixed, {
    accepted: true
  });
  action.bindings.push(
    actionFor(
      postRoute,
      { ...mixed, requests: [mixed.requests[1]] },
      { accepted: true }
    ).bindings[0]
  );
  input.pageManifest = pageManifest(input.webManifest, [action]);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);
  assert.equal(matrix.status, "ready");
  assert.equal(matrix.summary.actionBindingCount, 2);
  assert.equal(matrix.summary.acceptedActionBindingCount, 1);
  assert.equal(matrix.summary.unresolvedActionBindingCount, 0);
  assert.equal(
    matrix.summary.coveredProductionMutationConsumerPairCount,
    1
  );

  const getRoute = matrix.routes.find(
    (entry) => entry.route.normalizedKey === "GET /fixtures/:param"
  );
  assert.equal(getRoute.actions.length, 1);
  assert.equal(getRoute.actions[0].causalVerified, true);
  assert.equal(getRoute.actions[0].accepted, false);
  assert.deepEqual(getRoute.actions[0].blockerCodes, []);
  assert.equal(getRoute.mutationCoverage, "not_applicable");
  assert.deepEqual(getRoute.blockerCodes, []);

  const mutationRoute = matrix.routes.find(
    (entry) => entry.route.normalizedKey === "POST /fixtures"
  );
  assert.equal(mutationRoute.actions.length, 1);
  assert.equal(mutationRoute.actions[0].accepted, true);
  assert.equal(mutationRoute.mutationCoverage, "covered");
  assert.deepEqual(mutationRoute.blockerCodes, []);
});

test("does not treat GET action coverage as mutation coverage on the same wrapper", () => {
  const input = fixture();
  const postRoute = route("POST", "/fixtures", "SaveFixture");
  input.nestManifest.routes.push(postRoute);
  const mixed = wrapper("GET", "/fixtures/:param", {
    name: "mixedFixture"
  });
  mixed.requests.push({
    kind: "main",
    sourceLine: 11,
    localCallChains: [["mixedFixture"]],
    method: "POST",
    path: "/fixtures",
    normalizedPath: "/fixtures",
    normalizedKey: "POST /fixtures",
    bodyKind: "json"
  });
  input.webManifest = webManifest([mixed]);
  input.pageManifest = pageManifest(
    input.webManifest,
    [actionFor(input.nestManifest.routes[0], mixed, {
      accepted: true
    })]
  );
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);
  assert.equal(matrix.status, "blocked");
  assert.equal(matrix.summary.uncoveredProductionMutationConsumerPairCount, 1);
});

test("rejects an auth transport whose route is absent from Nest", () => {
  const input = fixture();
  input.webManifest.authTransportExceptions.push({
    sourceFile: "apps/web-admin/src/auth/auth.store.ts",
    transport: "auth_store_exception",
    method: "POST",
    normalizedPath: "/ghost",
    normalizedKey: "POST /ghost"
  });
  input.webManifest.summary.authTransportExceptionCount = 1;
  input.usageManifest.evidence.authStoreRouteCount = 1;

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_AUTH_BACKEND_BLOCKER_DRIFT"
  );
});

test("rejects a forged Web request-edge count", () => {
  const input = fixture();
  input.webManifest.summary.requestEdgeCount += 1;
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_WEB_SUMMARY"
  );
});

test("rejects forged registry paths and usage override digests", () => {
  const pageScope = fixture();
  pageScope.pageManifest.scope.registry = "docs/product/manifests/other.json";
  assert.throws(
    () => build(pageScope),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_PAGE_SCOPE"
  );

  const usageScope = fixture();
  usageScope.usageManifest.scope.registry =
    "docs/product/manifests/other.json";
  assert.throws(
    () => build(usageScope),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_USAGE_SCOPE"
  );

  const digest = fixture();
  digest.usageManifest.summary.classificationOverrideSha256 =
    "f".repeat(64);
  assert.throws(
    () => build(digest),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_USAGE_SUMMARY"
  );
});

test("rejects contradictory page reachability evidence", () => {
  const input = fixture();
  input.pageManifest.summary.routeRootCount = 2;
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_PAGE_SUMMARY"
  );
});

test("represents external and internal route classifications", () => {
  const input = fixture();
  const external = route("GET", "/external", "External");
  const internal = route("GET", "/health", "Health");
  input.nestManifest.routes.push(external, internal);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest,
    [
      undefined,
      { usage: "external_takeover" },
      {
        usage: "internal_task",
        consumerSurface: "machine_probe",
        manualSurfaceReason: "health_probe"
      }
    ]
  );
  const matrix = build(input);
  assert.equal(matrix.summary.externalTakeoverRouteCount, 1);
  assert.equal(matrix.summary.internalTaskRouteCount, 1);
});

test("rejects a missing usage route", () => {
  const input = fixture();
  input.usageManifest.routes = [];
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_USAGE_ROUTE_SET_DRIFT"
  );
});

test("rejects mutated usage route metadata", () => {
  const input = fixture();
  input.usageManifest.routes[0].handler = "other";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_USAGE_ROUTE_METADATA_DRIFT"
  );
});

test("blocks a Web main request without a Nest route", () => {
  const input = fixture();
  const missing = wrapper("GET", "/missing", {
    name: "missing",
    productionConsumers: [],
    testConsumers: ["apps/web-admin/src/api/fixture.api.test.ts"]
  });
  input.webManifest = webManifest(
    [...input.webManifest.wrappers, missing],
    {
      frontendWithoutBackend: [
        {
          apiFile: missing.apiFile,
          wrapper: missing.name,
          normalizedKey: missing.requests[0].normalizedKey
        }
      ]
    }
  );
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );
  const matrix = build(input);
  assert.equal(matrix.summary.webRequestWithoutNestCount, 1);
  assert.equal(matrix.status, "blocked");
});

test("blocks an orphan wrapper even when its route exists", () => {
  const input = fixture();
  const orphanRoute = route("GET", "/orphan", "Orphan");
  const orphan = wrapper("GET", "/orphan", {
    name: "orphan",
    productionConsumers: [],
    testConsumers: ["apps/web-admin/src/api/fixture.api.test.ts"]
  });
  input.nestManifest.routes.push(orphanRoute);
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    orphan
  ]);
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );
  const matrix = build(input);
  assert.equal(matrix.summary.orphanWrapperCount, 1);
});

test("accepts an unreachable-only orphan classification", () => {
  const input = fixture();
  const orphanRoute = route("GET", "/legacy", "Legacy");
  const orphan = wrapper("GET", "/legacy", {
    name: "legacyRequest",
    productionConsumers: [],
    unreachableConsumers: [
      "apps/web-admin/src/pages/LegacyPage.vue"
    ]
  });
  input.nestManifest.routes.push(orphanRoute);
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    orphan
  ]);
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);

  assert.equal(matrix.summary.orphanWrapperCount, 1);
  assert.deepEqual(input.webManifest.blockers.orphanWrappers, [
    {
      apiFile: orphan.apiFile,
      wrapper: orphan.name,
      classification: "unreachable_only"
    }
  ]);
});

test("ignores ticket followups from unreachable-only wrappers", () => {
  const input = fixture();
  const legacyRoute = route("GET", "/legacy", "Legacy");
  const legacy = wrapper("GET", "/legacy", {
    name: "legacyDownload",
    productionConsumers: [],
    unreachableConsumers: [
      "apps/web-admin/src/pages/LegacyPage.vue"
    ]
  });
  legacy.requests.push({
    kind: "ticket_followup",
    sourceLine: 11,
    method: "GET",
    ticketField: "downloadUrl",
    bodyKind: "none",
    localCallChains: [[legacy.name]]
  });
  input.nestManifest.routes.push(legacyRoute);
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    legacy
  ]);
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);

  assert.equal(matrix.summary.orphanWrapperCount, 1);
  assert.equal(
    input.usageManifest.evidence.productionTicketFollowupCount,
    0
  );
});

test("blocks duplicate mutation wrappers", () => {
  const input = fixture({ mutation: "accepted" });
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    wrapper("POST", "/fixtures", {
      name: "saveFixtureAgain",
      productionConsumers: [],
      testConsumers: ["apps/web-admin/src/api/fixture.api.test.ts"],
      sourceLine: 11
    })
  ]);
  input.pageManifest = pageManifest(
    input.webManifest,
    input.pageManifest.actions
  );
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );
  const matrix = build(input);
  assert.equal(matrix.summary.duplicateMutationRouteCount, 1);
});

test("refuses delegated-route suppression without live analyzer evidence", () => {
  const input = fixture();
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    wrapper("GET", "/fixtures/:param", {
      name: "fetchFixtureWithPreparation",
      localCallChains: [
        [
          "fetchFixtureWithPreparation",
          "prepareFixtureRequest",
          "fetchFixture"
        ]
      ]
    })
  ]);
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_DUPLICATE_ROUTE_DRIFT"
  );
});

test("blocks independent sibling wrappers that merely share one transport site", () => {
  const input = fixture({ mutation: "accepted" });
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    wrapper("POST", "/fixtures", {
      name: "saveFixtureAgain"
    })
  ]);
  input.pageManifest = pageManifest(
    input.webManifest,
    input.pageManifest.actions
  );
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);
  assert.equal(matrix.summary.duplicateMutationRouteCount, 1);
  assert.equal(matrix.status, "blocked");
});

test("rejects call-chain evidence that is not rooted at its wrapper", () => {
  const input = fixture();
  input.webManifest.wrappers[0].requests[0].localCallChains = [
    ["forgedFixtureRequest"]
  ];

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_CALL_CHAINS"
  );
});

test("rederives duplicate routes instead of trusting forged suppression output", () => {
  const input = fixture({ mutation: "accepted" });
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    wrapper("POST", "/fixtures", {
      name: "saveFixtureAgain"
    })
  ]);
  input.webManifest.duplicateNormalizedRoutes = [];
  input.webManifest.blockers.duplicateWriteWrappers = [];
  input.webManifest.summary.duplicateNormalizedRouteGroupCount = 0;
  input.webManifest.status = "ready";

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_DUPLICATE_ROUTE_DRIFT"
  );
});

test("rejects coherent forged call-chain suppression without live source evidence", () => {
  const input = fixture();
  input.webManifest = webManifest([
    ...input.webManifest.wrappers,
    wrapper("GET", "/fixtures/:param", {
      name: "fetchFixtureForged",
      localCallChains: [
        ["fetchFixtureForged", "fetchFixture"]
      ]
    })
  ]);
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );
  assert.deepEqual(
    input.webManifest.duplicateNormalizedRoutes,
    []
  );

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_DUPLICATE_ROUTE_DRIFT"
  );
});

test("blocks an uncovered production mutation consumer", () => {
  const input = fixture({ mutation: "candidate" });
  input.pageManifest.actions = [];
  input.pageManifest = pageManifest(input.webManifest, []);
  const matrix = build(input);
  assert.equal(
    matrix.summary.uncoveredProductionMutationConsumerPairCount,
    1
  );
});

test("rejects an action binding to an unknown wrapper", () => {
  const input = fixture({ mutation: "candidate" });
  input.pageManifest.actions[0].bindings[0].wrapper = "unknown";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_ACTION_WRAPPER_MISSING"
  );
});

test("rejects an accepted consumer absent from the candidate binding", () => {
  const input = fixture({ mutation: "accepted" });
  input.pageManifest.actions[0].bindings[0]
    .acceptedProductionConsumers = ["missing.vue"];
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_ACTION_ACCEPTED_CONSUMER_INVALID"
  );
});

test("does not count a candidate binding as accepted coverage", () => {
  const matrix = build(fixture({ mutation: "candidate" }));
  assert.equal(matrix.summary.acceptedActionBindingCount, 0);
  assert.equal(matrix.routes[1].mutationCoverage, "uncovered");
});

test("blocks a client-only role capability", () => {
  const input = fixture({ mutation: "candidate" });
  const action = input.pageManifest.actions[0];
  action.capability.kind = "client_role_or_status";
  action.capability.serverDerived = false;
  const matrix = build(input);
  assert(
    matrix.blockers.unresolvedActions[0].reasonCodes.includes(
      "capability_not_server_derived"
    )
  );
});

test("blocks a non-dominating server capability", () => {
  const matrix = build(fixture({ mutation: "candidate" }));
  assert(
    matrix.blockers.unresolvedActions[0].reasonCodes.includes(
      "capability_not_dominating_trigger"
    )
  );
});

test("rejects route-usage Web evidence drift", () => {
  const input = fixture();
  input.usageManifest.routes[0].consumerEvidence.webApiWrappers = [];
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_USAGE_WEB_EVIDENCE_DRIFT"
  );
});

test("rejects an exit candidate with an active consumer surface", () => {
  const input = fixture();
  const entry = input.usageManifest.routes[0];
  entry.usage = "exit_candidate";
  entry.exitCandidateSemantics =
    "candidate_only_no_deletion_authorization";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_EXIT_CANDIDATE"
  );
});

test("rejects route-level deletion authorization", () => {
  const input = fixture();
  input.usageManifest.routes[0].deletionAuthorized = true;
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_USAGE_DELETION_AUTHORIZED"
  );
});

test("rejects a false-ready upstream status", () => {
  const input = fixture();
  input.webManifest.blockers.consumerIssues.push({
    code: "fixture"
  });
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_STATUS_CONTRADICTION"
  );
});

test("rejects a blocked status with no blockers", () => {
  const input = fixture();
  input.pageManifest.status = "blocked";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_PAGE_STATUS_CONTRADICTION"
  );
});

test("preserves unresolved Web request evidence as a blocked matrix input", () => {
  const input = fixture();
  const request = input.webManifest.wrappers[0].requests[0];
  Object.assign(request, {
    path: null,
    normalizedPath: null,
    normalizedKey: null,
    unresolvedReason: "dynamic_path"
  });
  input.webManifest.blockers.unresolvedRequests = [
    {
      apiFile: input.webManifest.wrappers[0].apiFile,
      wrapper: input.webManifest.wrappers[0].name,
      reason: "dynamic_path"
    }
  ];
  input.webManifest.status = "blocked";
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  const matrix = build(input);
  assert.equal(matrix.status, "blocked");
  assert.equal(
    matrix.inputManifests.webApiWrappers.status,
    "blocked"
  );
});

test("rederives unresolved Web request blockers instead of trusting ready input", () => {
  const input = fixture();
  const request = input.webManifest.wrappers[0].requests[0];
  Object.assign(request, {
    path: null,
    normalizedPath: null,
    normalizedKey: null,
    unresolvedReason: "dynamic_path"
  });
  input.pageManifest = pageManifest(input.webManifest, []);
  input.usageManifest = usageManifest(
    input.nestManifest.routes,
    input.webManifest
  );

  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_WEB_UNRESOLVED_BLOCKER_DRIFT"
  );
});

test("rejects an unknown Web request kind", () => {
  const input = fixture();
  input.webManifest.wrappers[0].requests[0].kind = "stream";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_INVALID_WEB_REQUEST_KIND"
  );
});

test("accepts optional legal Web wrapper return provenance", () => {
  const values = [
    undefined,
    "transparent_main_response",
    "none",
    "unverified"
  ];
  for (const value of values) {
    const input = fixture();
    if (value !== undefined) {
      input.webManifest.wrappers[0].returnProvenance = value;
    }
    assert.equal(build(input).status, "ready", value ?? "missing");
  }
});

test("rejects an unknown Web wrapper return provenance", () => {
  const input = fixture();
  input.webManifest.wrappers[0].returnProvenance =
    "fabricated_response";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_INVALID_WEB_WRAPPER_RETURN_PROVENANCE"
  );
});

test("rejects duplicate Nest normalized routes", () => {
  const input = fixture();
  input.nestManifest.routes.push(
    route("GET", "/fixtures/:otherId", "Duplicate")
  );
  assert.throws(
    () => build(input),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_DUPLICATE_NEST_NORMALIZED_ROUTE"
  );
});

test("rejects an unknown route usage", () => {
  const input = fixture();
  input.usageManifest.routes[0].usage = "maybe";
  assert.throws(
    () => build(input),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_USAGE_ROUTE"
  );
});

test("rejects JSON output drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jgzg-matrix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const matrix = build();
  const jsonTargetPath = join(root, "matrix.json");
  const markdownTargetPath = join(root, "matrix.md");
  const jsonRendered = renderWholeSiteCapabilityMatrix(matrix);
  const markdownRendered =
    renderWholeSiteCapabilityMatrixMarkdown(matrix);
  await writeOrCheckWholeSiteCapabilityMatrix({
    mode: "write",
    jsonTargetPath,
    markdownTargetPath,
    jsonRendered,
    markdownRendered
  });
  await writeFile(jsonTargetPath, "{}\n");
  await assert.rejects(
    writeOrCheckWholeSiteCapabilityMatrix({
      mode: "check",
      jsonTargetPath,
      markdownTargetPath,
      jsonRendered,
      markdownRendered
    }),
    (error) => error?.code === "CAPABILITY_MATRIX_JSON_DRIFT"
  );
});

test("rejects Markdown output drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jgzg-matrix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const matrix = build();
  const jsonTargetPath = join(root, "matrix.json");
  const markdownTargetPath = join(root, "matrix.md");
  const jsonRendered = renderWholeSiteCapabilityMatrix(matrix);
  const markdownRendered =
    renderWholeSiteCapabilityMatrixMarkdown(matrix);
  await writeOrCheckWholeSiteCapabilityMatrix({
    mode: "write",
    jsonTargetPath,
    markdownTargetPath,
    jsonRendered,
    markdownRendered
  });
  await writeFile(markdownTargetPath, "# drift\n");
  await assert.rejects(
    writeOrCheckWholeSiteCapabilityMatrix({
      mode: "check",
      jsonTargetPath,
      markdownTargetPath,
      jsonRendered,
      markdownRendered
    }),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_MARKDOWN_DRIFT"
  );
});

test("rejects write plus require-ready before inspection", async () => {
  const root = await mkdtemp(join(tmpdir(), "jgzg-matrix-"));
  let inspected = false;
  await assert.rejects(
    runWholeSiteCapabilityMatrixCli(
      ["--write", "--require-ready"],
      {
        root,
        inspectMatrix: async () => {
          inspected = true;
        }
      }
    ),
    (error) =>
      error?.code === "CAPABILITY_MATRIX_INVALID_ARGUMENTS"
  );
  assert.equal(inspected, false);
  await assert.rejects(
    access(
      join(
        root,
        "docs/product/manifests/whole-site-capability-matrix.json"
      )
    ),
    (error) => error?.code === "ENOENT"
  );
});

test("live readiness checks all four inputs before rejecting blocked status", async () => {
  const calls = [];
  const inspect = (name, value) => async () => {
    calls.push(`inspect-${name}`);
    return value;
  };
  const render = (name) => () => `${name}\n`;
  const check = (name) => async ({ mode, rendered }) => {
    assert.equal(mode, "check");
    assert.equal(rendered, `${name}\n`);
    calls.push(`check-${name}`);
  };
  await assert.rejects(
    verifyWholeSiteCapabilityMatrixReadyInputs({
      root: "/tmp",
      inspectNestManifest: inspect("nest", []),
      renderNestManifest: render("nest"),
      checkNestManifest: check("nest"),
      inspectWebManifest: inspect("web", { status: "blocked" }),
      renderWebManifest: render("web"),
      checkWebManifest: check("web"),
      inspectPageManifest: inspect("page", { status: "blocked" }),
      renderPageManifest: render("page"),
      checkPageManifest: check("page"),
      inspectUsageManifest: inspect("usage", {
        status: "blocked"
      }),
      renderUsageManifest: render("usage"),
      checkUsageManifest: check("usage")
    }),
    (error) =>
      error?.code ===
      "CAPABILITY_MATRIX_READY_INPUT_BLOCKED"
  );
  assert.deepEqual(
    new Set(calls),
    new Set([
      "inspect-nest",
      "inspect-web",
      "inspect-page",
      "inspect-usage",
      "check-nest",
      "check-web",
      "check-page",
      "check-usage"
    ])
  );
});

test("renders JSON and Markdown deterministically", () => {
  const matrix = build(fixture({ mutation: "accepted" }));
  const markdown = renderWholeSiteCapabilityMatrixMarkdown(matrix);
  assert.equal(
    renderWholeSiteCapabilityMatrix(matrix),
    renderWholeSiteCapabilityMatrix(build(fixture({
      mutation: "accepted"
    })))
  );
  assert.equal(
    markdown,
    renderWholeSiteCapabilityMatrixMarkdown(build(fixture({
      mutation: "accepted"
    })))
  );
  assert.equal(markdown.endsWith("\n"), true);
  assert.equal(markdown.endsWith("\n\n"), false);
});

test("write and check preserve both generated outputs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jgzg-matrix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const matrix = build();
  const jsonTargetPath = join(root, "matrix.json");
  const markdownTargetPath = join(root, "matrix.md");
  const jsonRendered = renderWholeSiteCapabilityMatrix(matrix);
  const markdownRendered =
    renderWholeSiteCapabilityMatrixMarkdown(matrix);
  await writeOrCheckWholeSiteCapabilityMatrix({
    mode: "write",
    jsonTargetPath,
    markdownTargetPath,
    jsonRendered,
    markdownRendered
  });
  await writeOrCheckWholeSiteCapabilityMatrix({
    mode: "check",
    jsonTargetPath,
    markdownTargetPath,
    jsonRendered,
    markdownRendered
  });
  assert.equal(await readFile(jsonTargetPath, "utf8"), jsonRendered);
  assert.equal(
    await readFile(markdownTargetPath, "utf8"),
    markdownRendered
  );
});

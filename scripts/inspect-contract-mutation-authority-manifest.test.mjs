import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContractMutationAuthorityManifest
} from "./lib/contract-mutation-authority-manifest.mjs";
import {
  assertRouteUsageMatchesRuntime
} from "./inspect-contract-mutation-authority-manifest.mjs";

function route(overrides = {}) {
  return {
    method: "POST",
    path: "/contracts/:contractVersionId/command",
    controller: "ContractController",
    handler: "command",
    contractCutoverSurface: true,
    contractCutoverLegacyWrite: false,
    contractCutoverTombstoneWrite: false,
    usage: "page",
    ...overrides
  };
}

function classifyRoute(entry) {
  if (entry.handler === "saveDraft") {
    return {
      authority: "aggregate_member_writer",
      authorityRule: "contract_draft_aggregate_save"
    };
  }
  if (entry.handler === "retired" || entry.handler === "confirm") {
    return {
      authority: "exit_candidate",
      authorityRule: "registered_exit_candidate"
    };
  }
  return {
    authority: "governed_specialized_command",
    authorityRule: "governed_specialized_command"
  };
}

test("classifies each contract mutation once and projects only executable actions", () => {
  const manifest = buildContractMutationAuthorityManifest({
    routeUsage: {
      routes: [
        route({
          method: "PUT",
          path: "/contract-drafts/:contractVersionId",
          controller: "ContractDraftController",
          handler: "saveDraft"
        }),
        route({
          path: "/contract-workbench/:contractVersionId/retired",
          controller: "ContractWorkbenchController",
          handler: "retired",
          usage: "exit_candidate"
        }),
        route()
      ]
    },
    classifyRoute,
    operationTargets: {
      save_contract_draft: {
        method: "PUT",
        controller: "ContractDraftController",
        handler: "saveDraft"
      },
      retired_contract_operation: {
        method: "POST",
        controller: "ContractWorkbenchController",
        handler: "retired"
      }
    },
    classifyTarget: classifyRoute
  });

  assert.equal(manifest.status, "ready");
  assert.deepEqual(manifest.summary.authorityCounts, {
    aggregate_member_writer: 1,
    governed_specialized_command: 1,
    exit_candidate: 1
  });
  assert.deepEqual(manifest.actionProjection.advertisedActionKeys, [
    "save_contract_draft"
  ]);
});

test("does not advertise tombstoned contract mutation writes", () => {
  const manifest = buildContractMutationAuthorityManifest({
    routeUsage: {
      routes: [
        route({
          path: "/contract-workbench/:contractVersionId/parties",
          controller: "BusinessPartyController",
          handler: "tombstoned",
          contractCutoverTombstoneWrite: true
        })
      ]
    },
    classifyRoute,
    operationTargets: {
      tombstoned_party_write: {
        method: "POST",
        controller: "BusinessPartyController",
        handler: "tombstoned"
      }
    },
    classifyTarget: classifyRoute
  });

  assert.equal(manifest.status, "ready");
  assert.deepEqual(manifest.routes, [{
    method: "POST",
    path: "/contract-workbench/:contractVersionId/parties",
    controller: "BusinessPartyController",
    handler: "tombstoned",
    tombstoned: true,
    authority: "governed_specialized_command",
    authorityRule: "governed_specialized_command"
  }]);
  assert.deepEqual(manifest.actionProjection.advertisedActionKeys, []);
  assert.equal(manifest.actionProjection.targets[0].advertised, false);
});

test("blocks route-usage authority drift", () => {
  const manifest = buildContractMutationAuthorityManifest({
    routeUsage: {
      routes: [
        route({
          path: "/contract-workbench/:contractVersionId/retired",
          controller: "ContractWorkbenchController",
          handler: "retired",
          usage: "page"
        })
      ]
    },
    classifyRoute,
    operationTargets: {},
    classifyTarget: classifyRoute
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(manifest.blockers.routeAuthorityDrift, [
    {
      method: "POST",
      path: "/contract-workbench/:contractVersionId/retired",
      usage: "page",
      authority: "exit_candidate"
    }
  ]);
});

test("excludes read routes but blocks a legacy takeover confirmation with a live consumer", () => {
  const manifest = buildContractMutationAuthorityManifest({
    routeUsage: {
      routes: [
        route({
          method: "GET",
          path: "/contract-workbench/:contractVersionId"
        }),
        route({
          path: "/projects/:projectId/contract-takeovers/:takeoverId/confirmation",
          controller: "ContractTakeoverController",
          handler: "confirm",
          contractCutoverLegacyWrite: true,
          usage: "external_takeover"
        })
      ]
    },
    classifyRoute,
    operationTargets: {},
    classifyTarget: classifyRoute
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.summary.routeCount, 1);
  assert.deepEqual(manifest.blockers.routeAuthorityDrift, [{
    method: "POST",
    path: "/projects/:projectId/contract-takeovers/:takeoverId/confirmation",
    usage: "external_takeover",
    authority: "exit_candidate"
  }]);
});

test("blocks a route-usage manifest that omits a runtime contract mutation", () => {
  assert.throws(
    () => assertRouteUsageMatchesRuntime({
      nestManifest: [route()],
      routeUsage: { routes: [] }
    }),
    (error) => error?.code === "CONTRACT_MUTATION_AUTHORITY_RUNTIME_ROUTE_DRIFT"
  );
});

test("blocks a stale legacy-write flag for a runtime contract mutation", () => {
  assert.throws(
    () => assertRouteUsageMatchesRuntime({
      nestManifest: [route({ contractCutoverLegacyWrite: true })],
      routeUsage: { routes: [route({ contractCutoverLegacyWrite: false })] }
    }),
    (error) => error?.code === "CONTRACT_MUTATION_AUTHORITY_RUNTIME_ROUTE_DRIFT"
  );
});

test("blocks a stale tombstone-write flag for a runtime contract mutation", () => {
  assert.throws(
    () => assertRouteUsageMatchesRuntime({
      nestManifest: [route({ contractCutoverTombstoneWrite: true })],
      routeUsage: { routes: [route({ contractCutoverTombstoneWrite: false })] }
    }),
    (error) => error?.code === "CONTRACT_MUTATION_AUTHORITY_RUNTIME_ROUTE_DRIFT"
  );
});

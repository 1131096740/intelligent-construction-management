import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractContractExitCandidates,
  inspectCapabilityProject
} from "./inspect-contract-workbench-capabilities.mjs";
import { inspectProductionRouteHits } from "./ops/inspect-production-route-hits.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./inspect-contract-workbench-capabilities.mjs", import.meta.url)
);
const OBSERVATION_WINDOW =
  "2026-07-01T00:00:00.000Z/2026-07-29T00:00:00.000Z";

function readyLegacyHits({
  schemaVersion = 1,
  status = "ready",
  observationWindow = OBSERVATION_WINDOW,
  counts = { "PATCH /contract-workbench/:param": 0 },
  complete = true,
  coverageWindow = OBSERVATION_WINDOW,
  coverageBasis = "operator_attested",
  apiPrefix = "/api",
  inputSourceCount = 1,
  inWindowApiPrefixedRequests = 1,
  parseFailures = 0,
  evidenceOverrides = {}
} = {}) {
  const safeCountTotal = Object.values(counts).reduce(
    (total, value) =>
      Number.isSafeInteger(value) && value >= 0 ? total + value : total,
    0
  );
  return {
    schemaVersion,
    status,
    observationWindow,
    counts,
    evidence: {
      complete,
      coverageWindow,
      coverageBasis,
      apiPrefix,
      inputSourceCount,
      inWindowApiPrefixedRequests,
      nonEmptyLines: safeCountTotal + 3,
      parsedLines: safeCountTotal + 3,
      beforeWindowLines: 1,
      inWindowLines: safeCountTotal + 1,
      atOrAfterWindowLines: 1,
      matchedRequests: safeCountTotal,
      unmatchedRequests: 1,
      parseFailures,
      ...evidenceOverrides
    }
  };
}

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "contract-capability-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, source, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("matches dynamic routes and reports a wrapper without backend", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Get(":contractId")
          read() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function fetchWorkbench(id) {
          return readJson(\`/contract-workbench/\${encodeURIComponent(id)}\`);
        }
        export function submitMissing(id) {
          return postJson(\`/contract-missing/\${id}/submission\`, {});
        }
      `,
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup lang="ts">
        import { fetchWorkbench, submitMissing } from "../../api/contract-workbench.api";
        const load = () => fetchWorkbench("c-1");
        const submit = () => submitMissing("c-1");
        </script>
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root, legacyRoutes: [] });
      assert.equal(
        report.capabilities.find((item) => item.wrapper === "fetchWorkbench")?.classification,
        "matched"
      );
      assert.equal(
        report.capabilities.find((item) => item.wrapper === "submitMissing")?.classification,
        "frontend_without_backend"
      );
    }
  );
});

test("matches governed contract path helpers to their controller route", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractVersionId/signing/material-change")
          materialChange() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": `
        function governedContractPath(contractVersionId, tail) {
          return \`/contracts/\${contractVersionId}/\${tail}\`;
        }
        export function reportSigningMaterialChange(contractVersionId) {
          return postJson(
            governedContractPath(contractVersionId, "signing/material-change"),
            {}
          );
        }
      `,
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup>
        import { reportSigningMaterialChange } from "../../api/core-flow-read.api";
        const submit = () => reportSigningMaterialChange("version-1");
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root, legacyRoutes: [] });
      const capability = report.capabilities.find(
        (item) => item.wrapper === "reportSigningMaterialChange"
      );
      assert.equal(capability?.route, "/contracts/:param/signing/material-change");
      assert.equal(capability?.classification, "matched");
    }
  );
});

test("attributes a private transport helper route to its exported orchestrator", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-bills")
        export class ExampleController {
          @Post(":billId/rows/:rowKey/remainder-cancellation")
          cancelRemainder() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        function cancelContractBillRemainder(billId, rowKey) {
          return apiFetch(
            \`/contract-bills/\${billId}/rows/\${rowKey}/remainder-cancellation\`,
            { method: "POST" }
          );
        }
        export function executeContractBillRemainderCancellation(billId, rowKey) {
          return cancelContractBillRemainder(billId, rowKey);
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup>
        import { executeContractBillRemainderCancellation } from "../../api/contract-workbench.api";
        const cancel = () => executeContractBillRemainderCancellation("bill-1", "row-1");
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root, legacyRoutes: [] });
      const route = report.capabilities.filter(
        (item) =>
          item.route ===
          "/contract-bills/:param/rows/:param/remainder-cancellation"
      );
      assert.equal(route.length, 1);
      assert.equal(
        route[0]?.wrapper,
        "executeContractBillRemainderCancellation"
      );
      assert.deepEqual(route[0]?.consumers, [
        "apps/web-admin/src/pages/contracts/Page.vue"
      ]);
      assert.equal(route[0]?.classification, "matched");
    }
  );
});

test("finds a page import that points to no API wrapper", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractId/void")
          voidDraft() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function voidDraft(id) {
          return postJson(\`/contracts/\${id}/void\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup>
        import { voidDraft, purgeDraft } from "../../api/contract-workbench.api";
        const actions = [voidDraft, purgeDraft];
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root });
      assert.deepEqual(report.missingWrappers, [
        {
          consumer: "apps/web-admin/src/pages/contracts/Page.vue",
          wrapper: "purgeDraft"
        }
      ]);
    }
  );
});

test("keeps composable, callback and dynamic import consumers", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-drafts")
        export class ExampleController {
          @Put(":contractVersionId")
          save() {}
          @Post(":contractVersionId/submission")
          submit() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export const saveAggregate = (id, body) =>
          putJson(\`/contract-drafts/\${id}\`, body);
        export function submitAggregate(id) {
          return postJson(\`/contract-drafts/\${id}/submission\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/composables/useDraft.ts": `
        import { saveAggregate } from "../api/contract-workbench.api";
        export const useDraft = () => ({ onSave: saveAggregate });
      `,
      "apps/web-admin/src/pages/contracts/Dynamic.vue": `
        <script setup>
        const loadAction = async () => {
          const api = await import("../../api/contract-workbench.api");
          registerCallback(api.submitAggregate);
        };
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root });
      for (const wrapper of ["saveAggregate", "submitAggregate"]) {
        const capability = report.capabilities.find((item) => item.wrapper === wrapper);
        assert.equal(capability?.classification, "matched");
        assert.equal(capability?.consumers.length, 1);
      }
    }
  );
});

test("classifies controller routes with no consumer and registered internal routes", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Post("orphan")
          orphan() {}
          @Post("maintenance")
          maintenance() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({
        root,
        internalRoutes: ["POST /contract-workbench/maintenance"]
      });
      assert.equal(
        report.capabilities.find((item) => item.route === "/contract-workbench/orphan")
          ?.classification,
        "backend_without_frontend"
      );
      assert.equal(
        report.capabilities.find((item) => item.route === "/contract-workbench/maintenance")
          ?.classification,
        "backend_internal_only"
      );
    }
  );
});

test("classifies an audited route with no production consumer as exit candidate only", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractVersionId/approval-submission")
          submitLegacy() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({
        root,
        exitCandidates: [
          {
            normalizedKey: "POST /contracts/:param/approval-submission",
            usage: "exit_candidate",
            consumerSurface: "none",
            productionConsumers: [],
            deletionAuthorized: false
          }
        ]
      });
      const candidate = report.capabilities.find(
        (item) => item.route === "/contracts/:param/approval-submission"
      );
      assert.equal(candidate?.classification, "exit_candidate");
      assert.equal(candidate?.decision, "候选退出");
      assert.equal(candidate?.deletionAuthorized, false);
      assert.deepEqual(candidate?.missingEvidence, [
        "production_exit_candidate_zero_calls",
        "independent_deletion_authorization"
      ]);
      assert.equal(report.evidence.exitCandidateCount, 1);
    }
  );
});

test("fails closed when an exit candidate regains a production consumer", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractVersionId/approval-submission")
          submitLegacy() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function submitLegacy(id) {
          return postJson(\`/contracts/\${id}/approval-submission\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup>
        import { submitLegacy } from "../../api/contract-workbench.api";
        const submit = () => submitLegacy("c-1");
        </script>
      `
    },
    async (root) => {
      await assert.rejects(
        () =>
          inspectCapabilityProject({
            root,
            exitCandidates: [
              {
                normalizedKey: "POST /contracts/:param/approval-submission",
                usage: "exit_candidate",
                consumerSurface: "none",
                productionConsumers: [],
                deletionAuthorized: false
              }
            ]
          }),
        (error) => error.code === "CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT"
      );
    }
  );
});

test("does not treat an unreachable legacy page as a production consumer", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractVersionId/approval-submission")
          submitLegacy() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function submitLegacy(id) {
          return postJson(\`/contracts/\${id}/approval-submission\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/pages/contracts/LegacyPage.vue": `
        <script setup>
        import { submitLegacy } from "../../api/contract-workbench.api";
        const submit = () => submitLegacy("c-1");
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({
        root,
        exitCandidates: [
          {
            normalizedKey:
              "POST /contracts/:param/approval-submission",
            usage: "exit_candidate",
            consumerSurface: "none",
            productionConsumers: [],
            deletionAuthorized: false
          }
        ],
        liveWebManifest: {
          wrappers: [
            {
              apiFile:
                "apps/web-admin/src/api/contract-workbench.api.ts",
              name: "submitLegacy",
              productionConsumers: [],
              unreachableConsumers: [
                "apps/web-admin/src/pages/contracts/LegacyPage.vue"
              ]
            }
          ]
        }
      });

      const candidate = report.capabilities.find(
        (item) =>
          item.route ===
          "/contracts/:param/approval-submission"
      );
      assert.equal(candidate?.classification, "exit_candidate");
      assert.deepEqual(candidate?.consumers, []);
    }
  );
});

test("rejects invalid or deletion-authorized exit candidate input", async () => {
  await withFixture({}, async (root) => {
    for (const exitCandidates of [
      [
        {
          normalizedKey: "POST /contracts/:param/approval-submission",
          usage: "exit_candidate",
          consumerSurface: "none",
          productionConsumers: [],
          deletionAuthorized: true
        }
      ],
      [
        {
          normalizedKey: "not-a-route",
          usage: "exit_candidate",
          consumerSurface: "none",
          productionConsumers: [],
          deletionAuthorized: false
        }
      ],
      [
        {
          normalizedKey: "POST /contracts/:param/approval-submission",
          usage: "exit_candidate",
          consumerSurface: "web_api_wrapper",
          productionConsumers: ["apps/web-admin/src/pages/contracts/Page.vue"],
          deletionAuthorized: false
        }
      ]
    ]) {
      await assert.rejects(
        () => inspectCapabilityProject({ root, exitCandidates }),
        (error) => error.code === "CAPABILITY_EXIT_CANDIDATES_INVALID"
      );
    }
  });
});

test("extracts only contract-scoped candidates from a deletion-safe route usage manifest", () => {
  const route = (normalizedKey, usage = "exit_candidate") => ({
    method: normalizedKey.split(" ")[0],
    path: normalizedKey.slice(normalizedKey.indexOf(" ") + 1),
    normalizedKey,
    usage,
    consumerSurface: usage === "exit_candidate" ? "none" : "web_api_wrapper",
    consumerEvidence: {
      webApiWrappers: [],
      authStore: [],
      ticketFollowups: [],
      manualSurfaceReason: null
    },
    deletionAuthorized: false,
    exitCandidateSemantics:
      usage === "exit_candidate"
        ? "candidate_only_no_deletion_authorization"
        : null
  });
  const routeUsage = {
    schemaVersion: 1,
    scope: {
      authorizationScope: "route_usage_classification_only",
      deletionAuthorized: false,
      exitCandidateSemantics: "candidate_only_no_deletion_authorization"
    },
    routes: [
      route("POST /contracts/:param/approval-submission"),
      route("POST /spot-procurements/:param/invoices"),
      route("GET /contracts/:param", "page")
    ]
  };
  assert.deepEqual(extractContractExitCandidates(routeUsage), [
    {
      normalizedKey: "POST /contracts/:param/approval-submission",
      usage: "exit_candidate",
      consumerSurface: "none",
      productionConsumers: [],
      deletionAuthorized: false
    }
  ]);
  assert.throws(
    () =>
      extractContractExitCandidates({
        ...routeUsage,
        scope: { ...routeUsage.scope, deletionAuthorized: true }
      }),
    (error) => error.code === "CAPABILITY_ROUTE_USAGE_INVALID"
  );
});

test("requires runtime manifest and legacy hit evidence before a candidate-exit decision", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Patch(":contractVersionId")
          legacySave() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const withoutEvidence = await inspectCapabilityProject({
        root,
        legacyRoutes: ["PATCH /contract-workbench/:param"]
      });
      const blocked = withoutEvidence.capabilities.find(
        (item) => item.route === "/contract-workbench/:param"
      );
      assert.equal(blocked?.classification, "legacy_candidate");
      assert.equal(blocked?.decision, "保留");
      assert.deepEqual(blocked?.missingEvidence, [
        "runtime_route_manifest",
        "production_legacy_route_hits",
        "independent_deletion_authorization"
      ]);

      const withEvidence = await inspectCapabilityProject({
        root,
        legacyRoutes: ["PATCH /contract-workbench/:param"],
        runtimeRoutes: ["PATCH /contract-workbench/:contractVersionId"],
        legacyHits: readyLegacyHits()
      });
      const candidate = withEvidence.capabilities.find(
        (item) => item.route === "/contract-workbench/:param"
      );
      assert.equal(candidate?.decision, "候选退出");
      assert.deepEqual(candidate?.missingEvidence, [
        "independent_deletion_authorization"
      ]);
    }
  );
});

test("rejects incomplete or non-ready legacy hit evidence", async () => {
  await withFixture({}, async (root) => {
    for (const legacyHits of [
      readyLegacyHits({ schemaVersion: 2 }),
      readyLegacyHits({ status: "blocked" }),
      readyLegacyHits({ complete: false }),
      readyLegacyHits({ coverageBasis: "inferred" }),
      readyLegacyHits({ apiPrefix: "/apix" }),
      readyLegacyHits({ apiPrefix: null }),
      readyLegacyHits({ parseFailures: 1 }),
      readyLegacyHits({ inputSourceCount: 0 }),
      readyLegacyHits({ inputSourceCount: 1.5 }),
      readyLegacyHits({ inWindowApiPrefixedRequests: 0 }),
      readyLegacyHits({ inWindowApiPrefixedRequests: -1 }),
      readyLegacyHits({ inWindowApiPrefixedRequests: 1.5 })
    ]) {
      await assert.rejects(
        () =>
          inspectCapabilityProject({
            root,
            legacyRoutes: ["PATCH /contract-workbench/:param"],
            legacyHits
          }),
        (error) => {
          assert.equal(error.code, "CAPABILITY_LEGACY_HITS_INVALID");
          assert.equal(error.message.includes("blocked"), false);
          return true;
        }
      );
    }
  });
});

test("rejects invalid or uncovered legacy observation windows", async () => {
  await withFixture({}, async (root) => {
    for (const legacyHits of [
      readyLegacyHits({
        observationWindow:
          "2026-07-29T00:00:00.000Z/2026-07-01T00:00:00.000Z"
      }),
      readyLegacyHits({
        observationWindow:
          "2026-07-01T00:00:00/2026-07-29T00:00:00.000Z"
      }),
      readyLegacyHits({
        coverageWindow:
          "2026-07-01T00:00:01.000Z/2026-07-29T00:00:00.000Z"
      }),
      readyLegacyHits({
        coverageWindow:
          "2026-07-01T00:00:00.000Z/2026-07-28T23:59:59.000Z"
      }),
      readyLegacyHits({
        coverageWindow:
          "2026-02-30T00:00:00.000Z/2026-07-29T00:00:00.000Z"
      }),
      readyLegacyHits({
        observationWindow:
          "9999-07-01T00:00:00.000Z/9999-07-29T00:00:00.000Z",
        coverageWindow:
          "9999-07-01T00:00:00.000Z/9999-07-29T00:00:00.000Z"
      }),
      readyLegacyHits({
        coverageWindow:
          "2026-07-01T00:00:00.000Z/9999-07-29T00:00:00.000Z"
      })
    ]) {
      await assert.rejects(
        () =>
          inspectCapabilityProject({
            root,
            legacyRoutes: ["PATCH /contract-workbench/:param"],
            legacyHits
          }),
        (error) => error.code === "CAPABILITY_LEGACY_HITS_INVALID"
      );
    }
  });
});

test("requires every configured legacy route and safe non-negative counts", async () => {
  await withFixture({}, async (root) => {
    for (const counts of [
      {},
      { "PATCH /contract-workbench/:param": -1 },
      { "PATCH /contract-workbench/:param": 1.5 },
      { "PATCH /contract-workbench/:param": Number.MAX_SAFE_INTEGER + 1 },
      { "PATCH /contract-workbench/:param": "0" },
      {
        "PATCH /contract-workbench/:contractVersionId": 0,
        "patch /contract-workbench/:param": 0
      },
      {
        "PATCH /contract-workbench/:param": 0,
        "not a route key containing secret-token": 0
      }
    ]) {
      await assert.rejects(
        () =>
          inspectCapabilityProject({
            root,
            legacyRoutes: ["PATCH /contract-workbench/:param"],
            legacyHits: readyLegacyHits({ counts })
          }),
        (error) => {
          assert.equal(error.code, "CAPABILITY_LEGACY_HITS_INVALID");
          assert.equal(error.message.includes("secret-token"), false);
          return true;
        }
      );
    }
  });
});

test("requires internally consistent structural route-hit counts", async () => {
  await withFixture({}, async (root) => {
    const invalidEvidence = [
      ...[
        "nonEmptyLines",
        "parsedLines",
        "beforeWindowLines",
        "inWindowLines",
        "atOrAfterWindowLines",
        "matchedRequests",
        "unmatchedRequests"
      ].map((field) => readyLegacyHits({ evidenceOverrides: { [field]: -1 } })),
      readyLegacyHits({ evidenceOverrides: { parsedLines: 4 } }),
      readyLegacyHits({ evidenceOverrides: { beforeWindowLines: 2 } }),
      readyLegacyHits({ evidenceOverrides: { unmatchedRequests: 2 } }),
      readyLegacyHits({ evidenceOverrides: { matchedRequests: 1 } }),
      readyLegacyHits({
        evidenceOverrides: {
          nonEmptyLines: 2,
          parsedLines: 2,
          beforeWindowLines: 1,
          inWindowLines: 0,
          atOrAfterWindowLines: 1,
          matchedRequests: 0,
          unmatchedRequests: 0
        }
      }),
      readyLegacyHits({
        evidenceOverrides: {
          nonEmptyLines: 0,
          parsedLines: 0,
          beforeWindowLines: 0,
          inWindowLines: 0,
          atOrAfterWindowLines: 0
        }
      })
    ];
    for (const legacyHits of invalidEvidence) {
      await assert.rejects(
        () =>
          inspectCapabilityProject({
            root,
            legacyRoutes: ["PATCH /contract-workbench/:param"],
            legacyHits
          }),
        (error) => error.code === "CAPABILITY_LEGACY_HITS_INVALID"
      );
    }
  });
});

test("rejects configured legacy routes that collide after normalization", async () => {
  await withFixture({}, async (root) => {
    await assert.rejects(
      () =>
        inspectCapabilityProject({
          root,
          legacyRoutes: [
            "PATCH /contract-workbench/:contractVersionId",
            "patch /contract-workbench/:param"
          ],
          legacyHits: readyLegacyHits()
        }),
      (error) => error.code === "CAPABILITY_LEGACY_ROUTES_INVALID"
    );
  });
});

test("accepts additional well-formed observed routes", async () => {
  await withFixture({}, async (root) => {
    const report = await inspectCapabilityProject({
      root,
      legacyRoutes: ["PATCH /contract-workbench/:param"],
      legacyHits: readyLegacyHits({
        counts: {
          "PATCH /contract-workbench/:contractVersionId": 0,
          "POST /auth/wx-login": 3
        }
      })
    });
    assert.equal(report.evidence.productionLegacyHitsProvided, true);
  });
});

test("accepts the production route observer report without schema translation", async () => {
  const legacyHits = inspectProductionRouteHits({
    logText:
      '127.0.0.1 - - [15/Jul/2026:00:00:00 +0000] "GET /api/health HTTP/1.1" 200 2 "-" "observer"',
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-29T00:00:00.000Z",
    coverageFrom: "2026-07-01T00:00:00.000Z",
    coverageTo: "2026-07-29T00:00:00.000Z",
    apiPrefix: "/api",
    now: Date.parse("2026-07-30T00:00:00.000Z"),
    routes: ["PATCH /contract-workbench/:contractVersionId"]
  });
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Patch(":contractVersionId")
          legacySave() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({
        root,
        legacyRoutes: ["PATCH /contract-workbench/:param"],
        runtimeRoutes: ["PATCH /contract-workbench/:contractVersionId"],
        legacyHits
      });
      const candidate = report.capabilities.find(
        (item) => item.route === "/contract-workbench/:param"
      );
      assert.equal(candidate?.decision, "候选退出");
      assert.deepEqual(candidate?.missingEvidence, [
        "independent_deletion_authorization"
      ]);
    }
  );
});

test("CLI fails safely for invalid or damaged legacy hit JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-capability-cli-"));
  try {
    const outputPath = join(root, "matrix.md");
    const invalidPath = join(root, "invalid.json");
    const damagedPath = join(root, "damaged.json");
    await writeFile(
      invalidPath,
      JSON.stringify(readyLegacyHits({ status: "secret-status-value" })),
      "utf8"
    );
    await writeFile(
      damagedPath,
      '{"schemaVersion":1,"status":"ready","secret":"do-not-print"',
      "utf8"
    );

    for (const path of [invalidPath, damagedPath]) {
      const result = spawnSync(
        process.execPath,
        [
          SCRIPT_PATH,
          "--write",
          outputPath,
          "--no-runtime-manifest",
          "--legacy-hits",
          path
        ],
        { encoding: "utf8" }
      );
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.includes("secret-status-value"), false);
      assert.equal(result.stderr.includes("do-not-print"), false);
      assert.equal(JSON.parse(result.stderr).status, "blocked");
    }

    const unexpectedFailure = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--write",
        root,
        "--no-runtime-manifest"
      ],
      { encoding: "utf8" }
    );
    assert.notEqual(unexpectedFailure.status, 0);
    assert.equal(unexpectedFailure.stdout, "");
    assert.equal(unexpectedFailure.stderr.includes(root), false);
    assert.deepEqual(JSON.parse(unexpectedFailure.stderr), {
      status: "blocked",
      code: "CAPABILITY_INSPECTION_FAILED",
      message: "Capability inspection failed"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI reads route usage and renders candidate-only exit decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-capability-cli-exit-"));
  try {
    const outputPath = join(root, "matrix.md");
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--write",
        outputPath,
        "--no-runtime-manifest"
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.ok(receipt.exitCandidateCount > 0);
    assert.equal(receipt.exitCandidateDeletionAuthorized, false);
    const markdown = await readFile(outputPath, "utf8");
    assert.match(markdown, /\| exit_candidate \| \d+ \|/);
    assert.match(markdown, /\| exit_candidate \| 候选退出 \| 否 \|/);
    assert.match(markdown, /production_exit_candidate_zero_calls/);
    assert.match(markdown, /independent_deletion_authorization/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

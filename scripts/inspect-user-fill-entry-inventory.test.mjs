import assert from "node:assert/strict";
import test from "node:test";

import { buildUserFillEntryInventory } from "./lib/user-fill-entry-inventory.mjs";

const activeAction = {
  id: "fixture.submit",
  usage: "page_action",
  routePaths: ["/业务"],
  sourceFile: "apps/web-admin/src/pages/FixturePage.vue",
  trigger: { element: "t-button", event: "click", handler: "submit" },
  semantic: "business_write",
  capability: { kind: "server_definition", source: "definition.key" },
  bindings: [
    {
      normalizedKey: "POST /fixtures",
      acceptedProductionConsumers: [
        "apps/web-admin/src/pages/FixturePage.vue"
      ],
      causalVerified: true
    }
  ]
};

const oldWrite = {
  method: "POST",
  path: "/legacy-fixtures",
  normalizedKey: "POST /legacy-fixtures",
  controller: "LegacyFixtureController",
  handler: "create",
  sourceFile: "services/api/src/legacy-fixture.controller.ts",
  usage: "exit_candidate",
  consumerSurface: "none"
};

test("清单同时覆盖当前统一候选和旧写入口 410 墓碑", () => {
  const inventory = buildUserFillEntryInventory({
    pageManifest: {
      status: "ready",
      blockers: {},
      actions: [activeAction]
    },
    routeUsageManifest: {
      status: "ready",
      blockers: {},
      routes: [oldWrite]
    },
    retiredWriteEntries: [
      { controller: "LegacyFixtureController", handler: "create" }
    ]
  });

  assert.equal(inventory.status, "ready");
  assert.deepEqual(inventory.summary, {
    activeBusinessActionCount: 1,
    technicalActionCount: 0,
    activeBindingCount: 1,
    retiredWriteEntryCount: 1,
    retainedReadonlyExitCount: 0,
    uncoveredRetiredWriteCount: 0,
    staleRetiredWriteCount: 0,
    blockerCount: 0
  });
  assert.equal(inventory.activeEntries[0].status, "unified_candidate");
  assert.equal(inventory.retiredEntries[0].status, "gone");
});

test("任一旧写候选未进入墓碑都失败关闭", () => {
  const inventory = buildUserFillEntryInventory({
    pageManifest: {
      status: "ready",
      blockers: {},
      actions: [activeAction]
    },
    routeUsageManifest: {
      status: "ready",
      blockers: {},
      routes: [oldWrite]
    },
    retiredWriteEntries: []
  });

  assert.equal(inventory.status, "blocked");
  assert.deepEqual(inventory.blockers.uncoveredRetiredWrites, [
    "LegacyFixtureController.create"
  ]);
});

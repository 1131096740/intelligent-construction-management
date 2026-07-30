import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectWholeSitePageActionManifest,
  renderWholeSitePageActionManifest,
  writeOrCheckWholeSitePageActionManifest
} from "./lib/whole-site-page-action-manifest.mjs";
import { runWholeSitePageActionManifestCli } from "./inspect-whole-site-page-action-manifest.mjs";

async function write(root, path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function route(normalizedKey = "POST /examples/:param/submission") {
  const [method, path] = normalizedKey.split(" ");
  return {
    method,
    path,
    normalizedKey,
    controller: "ExampleController",
    handler: "submit",
    sourceFile: "services/api/src/example/example.controller.ts",
    authorizationScope: "guard_metadata_only",
    authentication: "authenticated",
    guardAuthorization: "project_action",
    isPublic: false,
    requiredPositions: [],
    requiredProjectAction: "contract.create",
    authorizationCombination: null,
    contractCutoverSurface: false,
    contractCutoverLegacyWrite: false
  };
}

function wrapper({
  name = "submitExample",
  normalizedKey = "POST /examples/:param/submission",
  productionConsumers = [
    "apps/web-admin/src/pages/ExamplePage.vue"
  ],
  requests
} = {}) {
  const [method, path] = normalizedKey.split(" ");
  return {
    name,
    apiFile: "apps/web-admin/src/api/example.api.ts",
    kind: "transport",
    requests:
      requests ?? [
        {
          kind: "main",
          sourceLine: 1,
          method,
          path,
          normalizedPath: path,
          normalizedKey,
          bodyKind: "json"
        }
      ],
    testConsumers: [],
    productionConsumers,
    unreachableConsumers: []
  };
}

function capabilityReadWrapper() {
  return wrapper({
    name: "getExample",
    normalizedKey: "GET /examples/:param"
  });
}

function registryAction(overrides = {}) {
  return {
    id: "example.submit",
    usage: "page_action",
    routePaths: ["/example"],
    sourceFile: "apps/web-admin/src/pages/ExamplePage.vue",
    trigger: {
      element: "t-button",
      event: "click",
      handler: "submit"
    },
    semantic: "business_write",
    capability: {
      kind: "detail_action",
      source: "detail.availableActions",
      key: "submit_approval"
    },
    wrappers: [
      {
        apiFile: "apps/web-admin/src/api/example.api.ts",
        name: "submitExample"
      }
    ],
    ...overrides
  };
}

async function fixture({
  actions = [registryAction()],
  wrappers = [wrapper()],
  routes = [route()],
  main = `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
app.use(router);
`,
  routeIndex = `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
export const router = createRouter({
  history: {},
  routes: webAdminRoutes
});
`,
  routeRecords = `export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/ExamplePage.vue") }];\n`,
  webManifestOverrides = {},
  nestManifestOverrides = {},
  extraFiles = {},
  page = `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-page-actions-"));
  const effectiveWrappers = [...wrappers];
  if (
    !effectiveWrappers.some(
      (item) =>
        item.apiFile === "apps/web-admin/src/api/example.api.ts" &&
        item.name === "getExample"
    )
  ) {
    effectiveWrappers.push(capabilityReadWrapper());
  }
  const effectiveRoutes = [...routes];
  if (
    !effectiveRoutes.some(
      (item) => item.normalizedKey === "GET /examples/:param"
    )
  ) {
    effectiveRoutes.push({
      ...route("GET /examples/:param"),
      handler: "get"
    });
  }
  await write(
    root,
    "apps/web-admin/src/main.ts",
    main
  );
  await write(
    root,
    "apps/web-admin/src/routes/index.ts",
    routeIndex
  );
  await write(
    root,
    "apps/web-admin/src/routes/route-records.ts",
    routeRecords
  );
  await write(root, "apps/web-admin/src/pages/ExamplePage.vue", page);
  await write(
    root,
    "apps/web-admin/src/api/example.api.ts",
    `export async function getExample() { return { availableActions: [] }; }
export async function submitExample() { return undefined; }\n`
  );
  await write(
    root,
    "docs/product/manifests/web-api-wrappers.json",
    `${JSON.stringify({
      schemaVersion: 1,
      status: "ready",
      scope: {
        apiRoot: "apps/web-admin/src/api",
        productionEntrypoint: "apps/web-admin/src/main.ts",
        nestRouteManifest:
          "docs/product/manifests/nest-business-routes.json"
      },
      summary: {},
      evidence: {
        productionModuleCount: 5,
        reachableProductionModuleCount: 5
      },
      wrappers: effectiveWrappers,
      authTransportExceptions: [],
      blockers: {},
      ...webManifestOverrides
    }, null, 2)}\n`
  );
  await write(
    root,
    "docs/product/manifests/nest-business-routes.json",
    `${JSON.stringify({
      schemaVersion: 1,
      authorizationScope: "guard_metadata_only",
      routes: effectiveRoutes,
      ...nestManifestOverrides
    }, null, 2)}\n`
  );
  await write(
    root,
    "docs/product/manifests/web-page-actions.registry.json",
    `${JSON.stringify({ schemaVersion: 1, actions }, null, 2)}\n`
  );
  for (const [path, contents] of Object.entries(extraFiles)) {
    await write(root, path, contents);
  }
  return root;
}

function blockerCodes(manifest) {
  const codes = new Set();
  for (const [key, value] of Object.entries(manifest.blockers ?? {})) {
    if (Array.isArray(value) && value.length > 0) codes.add(key);
    for (const entry of Array.isArray(value) ? value : []) {
      if (entry && typeof entry.code === "string") codes.add(entry.code);
      if (entry && typeof entry.issue === "string") codes.add(entry.issue);
    }
  }
  for (const issue of manifest.issues ?? []) {
    if (typeof issue?.code === "string") codes.add(issue.code);
  }
  return codes;
}

test("joins a server-gated visible action through its wrapper to the Nest route", async () => {
  const root = await fixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions.length, 1);
  assert.equal(manifest.actions[0].id, "example.submit");
  assert.deepEqual(manifest.actions[0].routePaths, ["/example"]);
  assert.equal(manifest.actions[0].bindings[0].normalizedKey, "POST /examples/:param/submission");
  assert.equal(manifest.actions[0].bindings[0].nestRoute.handler, "submit");
  assert.equal(blockerCodes(manifest).size, 0);
});

test("keeps approve and reject variants distinct while sharing one wrapper and action key", async () => {
  const approve = registryAction({
    id: "example.review.approve",
    trigger: {
      element: "t-button",
      event: "click",
      handler: "review",
      variant: "approve"
    },
    capability: {
      kind: "detail_action",
      source: "detail.availableActions",
      key: "review_approval"
    }
  });
  const reject = {
    ...approve,
    id: "example.review.reject",
    trigger: { ...approve.trigger, variant: "reject" }
  };
  const root = await fixture({
    actions: [approve, reject],
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) { return detail.availableActions.some((item) => item.key === key && item.enabled); }
async function review(decision: "approve" | "reject") { await submitExample(decision); }
</script>
<template>
  <template v-if="actionEnabled('review_approval')">
    <t-button @click="review('approve')">通过</t-button>
    <t-button @click="review('reject')">驳回</t-button>
  </template>
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.deepEqual(
    manifest.actions.map((action) => action.id),
    ["example.review.approve", "example.review.reject"]
  );
});

test("fails closed when a business write is gated only by client role or status", async () => {
  const root = await fixture({
    actions: [
      registryAction({
        capability: {
          kind: "client_role_or_status",
          source: "editable"
        }
      })
    ],
    page: `<script setup lang="ts">
import { submitExample } from "../api/example.api";
const editable = true;
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="editable" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(
    [...blockerCodes(manifest)].some((code) =>
      /CLIENT_ROLE|LOCAL|WRITE_WITHOUT_SERVER/u.test(code)
    )
  );
});

test("fails closed for missing wrappers and missing Nest routes", async () => {
  const missingWrapperRoot = await fixture({
    actions: [
      registryAction({
        wrappers: [
          {
            apiFile: "apps/web-admin/src/api/example.api.ts",
            name: "missingWrapper"
          }
        ]
      })
    ]
  });
  const missingWrapper = await inspectWholeSitePageActionManifest({
    root: missingWrapperRoot
  });
  assert.equal(missingWrapper.status, "blocked");
  assert.ok(
    [...blockerCodes(missingWrapper)].some((code) =>
      /WRAPPER_NOT_IN_MANIFEST|MISSING_WRAPPER/u.test(code)
    )
  );

  const missingRouteRoot = await fixture({ routes: [] });
  const missingRoute = await inspectWholeSitePageActionManifest({
    root: missingRouteRoot
  });
  assert.equal(missingRoute.status, "blocked");
  assert.ok(
    [...blockerCodes(missingRoute)].some((code) =>
      /WRAPPER_ROUTE_MISSING|ROUTE_MISSING/u.test(code)
    )
  );
});

test("reports a production mutation wrapper with no action or background classification", async () => {
  const uncovered = wrapper({
    name: "backgroundWrite",
    normalizedKey: "POST /examples/:param/background"
  });
  const root = await fixture({
    wrappers: [wrapper(), uncovered],
    routes: [route(), route("POST /examples/:param/background")]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(
    [...blockerCodes(manifest)].some((code) =>
      /PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION|UNCOVERED/u.test(code)
    )
  );
});

test("does not require a Nest join for a ticket follow-up GET", async () => {
  const requests = [
    wrapper().requests[0],
    {
      kind: "ticket_followup",
      sourceLine: 2,
      method: "GET",
      ticketField: "downloadPath",
      bodyKind: "none"
    }
  ];
  const root = await fixture({ wrappers: [wrapper({ requests })] });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.actions[0].bindings[0].ticketFollowups.length, 1);
  assert.equal(blockerCodes(manifest).size, 0);
});

test("requires a symbol-aware causal chain from the exact trigger handler to its wrapper", async () => {
  const unrelatedRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function unrelatedSave() { await submitExample("not-the-click-handler"); }
async function submit() { return undefined; }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const unrelated = await inspectWholeSitePageActionManifest({
    root: unrelatedRoot
  });
  assert.equal(unrelated.status, "blocked");
  assert.ok(
    blockerCodes(unrelated).has("ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED")
  );
  assert.equal(
    unrelated.summary.acceptedProductionMutationConsumerCount,
    0
  );
  assert.equal(unrelated.actions[0].bindings[0].causalVerified, false);

  const transitiveRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample as persistExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function persist() { await persistExample("example-1"); }
async function submit() { await persist(); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const transitive = await inspectWholeSitePageActionManifest({
    root: transitiveRoot
  });
  assert.equal(transitive.status, "ready");
  assert.equal(transitive.actions[0].bindings[0].causalVerified, true);
  assert.deepEqual(
    transitive.actions[0].bindings[0].causalProof.localCallChain,
    ["submit", "persist", "persistExample"]
  );
  assert.equal(
    transitive.summary.acceptedProductionMutationConsumerCount,
    1
  );
});

test("rejects fake availableActions names, string occurrences, and authenticated-self exceptions", async () => {
  const fakeCollectionRoot = await fixture({
    page: `<script setup lang="ts">
import { submitExample } from "../api/example.api";
const fakeAvailableActions = [{ key: "submit_approval", enabled: true }];
function actionEnabled(key: string) {
  return fakeAvailableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const fakeCollection = await inspectWholeSitePageActionManifest({
    root: fakeCollectionRoot
  });
  assert.equal(fakeCollection.status, "blocked");
  assert.ok(
    blockerCodes(fakeCollection).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
  assert.equal(fakeCollection.actions[0].capability.dominatesTrigger, false);

  const stringOccurrenceRoot = await fixture({
    page: `<script setup lang="ts">
import { submitExample } from "../api/example.api";
const saveError = "detail.availableActions submit_approval enabled";
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="saveError" @click="submit">提交审批</t-button>
</template>
`
  });
  const stringOccurrence = await inspectWholeSitePageActionManifest({
    root: stringOccurrenceRoot
  });
  assert.equal(stringOccurrence.status, "blocked");
  assert.ok(
    blockerCodes(stringOccurrence).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );

  const authenticatedSelfRoot = await fixture({
    actions: [
      registryAction({
        capability: {
          kind: "authenticated_self_exception",
          source: "current authenticated user"
        }
      })
    ]
  });
  const authenticatedSelf = await inspectWholeSitePageActionManifest({
    root: authenticatedSelfRoot
  });
  assert.equal(authenticatedSelf.status, "blocked");
  assert.ok(
    blockerCodes(authenticatedSelf).has(
      "AUTHENTICATED_SELF_EXCEPTION_UNVERIFIED"
    )
  );
  assert.equal(authenticatedSelf.actions[0].capability.serverDerived, false);
});

test("blocks stale or internally inconsistent upstream manifests", async () => {
  const blockedWebRoot = await fixture({
    webManifestOverrides: {
      status: "blocked",
      blockers: {
        orphanWrappers: [{ name: "submitExample" }]
      }
    }
  });
  const blockedWeb = await inspectWholeSitePageActionManifest({
    root: blockedWebRoot
  });
  assert.equal(blockedWeb.status, "blocked");
  assert.ok(blockerCodes(blockedWeb).has("UPSTREAM_WEB_MANIFEST_BLOCKED"));

  const mismatchedWebRoot = await fixture({
    webManifestOverrides: {
      scope: {
        productionEntrypoint: "apps/web-admin/src/other-main.ts"
      },
      evidence: {
        productionModuleCount: 999,
        reachableProductionModuleCount: 998
      }
    }
  });
  const mismatchedWeb = await inspectWholeSitePageActionManifest({
    root: mismatchedWebRoot
  });
  assert.equal(mismatchedWeb.status, "blocked");
  assert.ok(
    blockerCodes(mismatchedWeb).has("UPSTREAM_WEB_MANIFEST_SCOPE_MISMATCH")
  );
  assert.ok(
    blockerCodes(mismatchedWeb).has("UPSTREAM_WEB_MANIFEST_EVIDENCE_MISMATCH")
  );

  const nestScopeRoot = await fixture({
    nestManifestOverrides: {
      authorizationScope: "claimed_full_authorization"
    }
  });
  const nestScope = await inspectWholeSitePageActionManifest({
    root: nestScopeRoot
  });
  assert.equal(nestScope.status, "blocked");
  assert.ok(
    blockerCodes(nestScope).has("UPSTREAM_NEST_AUTHORIZATION_SCOPE_INVALID")
  );
});

test("validates request identities, rejects duplicates, and rejects mutating ticket follow-ups", async () => {
  const badWrapperRequest = wrapper();
  badWrapperRequest.requests[0] = {
    ...badWrapperRequest.requests[0],
    method: "PUT"
  };
  const badWebRoot = await fixture({
    wrappers: [badWrapperRequest]
  });
  const badWeb = await inspectWholeSitePageActionManifest({
    root: badWebRoot
  });
  assert.equal(badWeb.status, "blocked");
  assert.ok(
    blockerCodes(badWeb).has("UPSTREAM_WEB_REQUEST_IDENTITY_INVALID")
  );

  const badNestRoot = await fixture({
    routes: [
      {
        ...route(),
        method: "PUT"
      }
    ]
  });
  const badNest = await inspectWholeSitePageActionManifest({
    root: badNestRoot
  });
  assert.equal(badNest.status, "blocked");
  assert.ok(
    blockerCodes(badNest).has("UPSTREAM_NEST_ROUTE_IDENTITY_INVALID")
  );

  const duplicateRoot = await fixture({
    wrappers: [wrapper(), wrapper()],
    routes: [route(), route()]
  });
  const duplicates = await inspectWholeSitePageActionManifest({
    root: duplicateRoot
  });
  assert.equal(duplicates.status, "blocked");
  assert.ok(
    blockerCodes(duplicates).has("UPSTREAM_WEB_WRAPPER_DUPLICATE")
  );
  assert.ok(
    blockerCodes(duplicates).has("UPSTREAM_NEST_ROUTE_DUPLICATE")
  );

  const mutatingTicketRoot = await fixture({
    wrappers: [
      wrapper({
        requests: [
          wrapper().requests[0],
          {
            kind: "ticket_followup",
            sourceLine: 2,
            method: "POST",
            ticketField: "commitPath",
            bodyKind: "json"
          }
        ]
      })
    ]
  });
  const mutatingTicket = await inspectWholeSitePageActionManifest({
    root: mutatingTicketRoot
  });
  assert.equal(mutatingTicket.status, "blocked");
  assert.ok(
    blockerCodes(mutatingTicket).has(
      "TICKET_FOLLOWUP_MUTATION_UNRESOLVED"
    )
  );
});

test("anchors routes to webAdminRoutes, rejects duplicate paths, and requires background ownership", async () => {
  const rogueAction = registryAction({
    id: "rogue.submit",
    routePaths: ["/rogue"],
    sourceFile: "apps/web-admin/src/pages/RoguePage.vue"
  });
  const rogueWrapper = wrapper({
    productionConsumers: ["apps/web-admin/src/pages/RoguePage.vue"]
  });
  const rogueRouteRoot = await fixture({
    actions: [rogueAction],
    wrappers: [rogueWrapper],
    routeRecords: `export const fakeRoutes = [{ path: "/rogue", component: () => import("../pages/RoguePage.vue") }];
export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/ExamplePage.vue") }];
`,
    extraFiles: {
      "apps/web-admin/src/pages/RoguePage.vue": `<script setup lang="ts">
import { submitExample } from "../api/example.api";
const detail = { availableActions: [{ key: "submit_approval", enabled: true }] };
function actionEnabled(key: string) { return detail.availableActions.some((item) => item.key === key && item.enabled); }
async function submit() { await submitExample(); }
</script><template><t-button v-if="actionEnabled('submit_approval')" @click="submit">提交</t-button></template>`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    }
  });
  const rogueRoute = await inspectWholeSitePageActionManifest({
    root: rogueRouteRoot
  });
  assert.equal(rogueRoute.status, "blocked");
  assert.ok(blockerCodes(rogueRoute).has("PAGE_ROUTE_MISSING"));

  const duplicatePathRoot = await fixture({
    routeRecords: `export const webAdminRoutes = [
  { path: "/example", component: () => import("../pages/ExamplePage.vue") },
  { path: "/example", component: () => import("../pages/ExamplePage.vue") }
];\n`
  });
  const duplicatePath = await inspectWholeSitePageActionManifest({
    root: duplicatePathRoot
  });
  assert.equal(duplicatePath.status, "blocked");
  assert.ok(blockerCodes(duplicatePath).has("PAGE_ROUTE_PATH_DUPLICATE"));

  const backgroundRoot = await fixture({
    actions: [
      registryAction({
        id: "example.background",
        usage: "background",
        routePaths: [],
        trigger: {
          element: "module",
          event: "call",
          handler: "submit"
        }
      })
    ]
  });
  const background = await inspectWholeSitePageActionManifest({
    root: backgroundRoot
  });
  assert.equal(background.status, "blocked");
  assert.ok(
    blockerCodes(background).has("BACKGROUND_ROUTE_OWNERSHIP_MISSING")
  );
});

test("does not follow type-only imports as production reachability edges", async () => {
  const root = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
import type { FakeReachability } from "./FakeTypeOnly";
const app = createApp({});
app.use(router);
`,
    extraFiles: {
      "apps/web-admin/src/FakeTypeOnly.ts": `export interface FakeReachability { value: string }\n`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 5
      }
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.evidence.totalProductionModuleCount, 6);
  assert.equal(manifest.evidence.reachableProductionModuleCount, 5);
});

test("requires the server read result to flow into the exact capability root", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { computed } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = computed(() => {
  void getExample("discarded-read");
  return { availableActions: [{ key: "submit_approval", enabled: true }] };
});
function actionEnabled(key: string) {
  return detail.value.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
  assert.equal(manifest.actions[0].capability.dominatesTrigger, false);
});

test("accepts only actual event roots and rejects wrapper calls after an unconditional return", async () => {
  const passedCallbackRoot = await fixture({
    actions: [
      registryAction({
        trigger: {
          element: "t-button",
          event: "click",
          handler: "submitExample"
        }
      })
    ],
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function track(callback: () => unknown) { return callback; }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="track(submitExample)">提交审批</t-button>
</template>
`
  });
  const passedCallback = await inspectWholeSitePageActionManifest({
    root: passedCallbackRoot
  });
  assert.equal(passedCallback.status, "blocked");
  assert.ok(
    blockerCodes(passedCallback).has("REGISTRY_TRIGGER_MISSING")
  );

  const unreachableCallRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  return;
  await submitExample("unreachable");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const unreachableCall = await inspectWholeSitePageActionManifest({
    root: unreachableCallRoot
  });
  assert.equal(unreachableCall.status, "blocked");
  assert.ok(
    blockerCodes(unreachableCall).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );

  const staticallyDeadBranchRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  if (false) {
    await submitExample("statically-unreachable");
  }
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const staticallyDeadBranch =
    await inspectWholeSitePageActionManifest({
      root: staticallyDeadBranchRoot
    });
  assert.equal(staticallyDeadBranch.status, "blocked");
  assert.ok(
    blockerCodes(staticallyDeadBranch).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );
});

test("excludes statically unreachable wrapper calls from causal proof", async () => {
  const cases = [
    {
      name: "false-and",
      body: `false && submitExample("dead-and");`
    },
    {
      name: "true-or",
      body: `true || submitExample("dead-or");`
    },
    {
      name: "constant-ternary",
      body: `true ? undefined : submitExample("dead-ternary");`
    },
    {
      name: "while-false",
      body: `while (false) { await submitExample("dead-loop"); }`
    },
    {
      name: "returning-if",
      body: `if (true) { return; }
  await submitExample("dead-after-if");`
    },
    {
      name: "if-zero",
      body: `if (0) { await submitExample("dead-zero"); }`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
});

test("fails closed for additional constant and unmodeled causal control flow", async () => {
  const cases = [
    {
      name: "for-false",
      body: `for (; false; ) { await submitExample("dead-for"); }`
    },
    {
      name: "empty-template-if",
      body: "if (``) { await submitExample(\"dead-template\"); }"
    },
    {
      name: "void-zero-if",
      body: `if (void 0) { await submitExample("dead-void"); }`
    },
    {
      name: "terminating-while",
      body: `while (true) { return; }
  await submitExample("dead-after-loop");`
    },
    {
      name: "nonmatching-switch",
      body: `switch ("selected") {
    case "other":
      await submitExample("dead-switch");
      break;
    default:
      break;
  }`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
});

test("fails closed for unknown conditions and models nullish coalescing independently", async () => {
  const cases = [
    {
      name: "unknown-member-if",
      body: `if (detail.enabled) { await submitExample("unknown-if"); }`
    },
    {
      name: "const-alias-if",
      body: `const enabled = false;
  if (enabled) { await submitExample("dead-alias-if"); }`
    },
    {
      name: "const-alias-or",
      body: `const enabled = true;
  enabled || submitExample("dead-alias-or");`
    },
    {
      name: "literal-false-ternary",
      body: `false ? submitExample("dead-ternary") : undefined;`
    },
    {
      name: "true-nullish",
      body: `true ?? submitExample("dead-true-nullish");`
    },
    {
      name: "zero-nullish",
      body: `0 ?? submitExample("dead-zero-nullish");`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
});

test("fails closed for logical assignment and optional-chain causal fallbacks", async () => {
  const cases = [
    {
      name: "logical-and-assignment",
      body: `let value: unknown = true;
  value &&= submitExample("conditional-and-assignment");`
    },
    {
      name: "logical-or-assignment",
      body: `let value: unknown = false;
  value ||= submitExample("conditional-or-assignment");`
    },
    {
      name: "nullish-assignment",
      body: `let value: unknown = null;
  value ??= submitExample("conditional-nullish-assignment");`
    },
    {
      name: "optional-call",
      body: `const maybe: undefined | ((value: unknown) => unknown) = undefined;
  maybe?.(await submitExample("optional-call-argument"));`
    },
    {
      name: "optional-method",
      body: `const maybe: { method(value: unknown): unknown } | undefined = undefined;
  maybe?.method(await submitExample("optional-method-argument"));`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
});

test("fails closed for conditional AssignmentPattern defaults", async () => {
  const cases = [
    {
      name: "object-destructuring-default",
      body: `const { value = await submitExample("object-default") } = { value: 1 };
  void value;`
    },
    {
      name: "array-destructuring-default",
      body: `const [value = await submitExample("array-default")] = [1];
  void value;`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }

  const handlerDefaultRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit(value = submitExample("handler-default")) {
  void value;
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const handlerDefault =
    await inspectWholeSitePageActionManifest({
      root: handlerDefaultRoot
    });
  assert.equal(handlerDefault.status, "blocked");
  assert.ok(
    blockerCodes(handlerDefault).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );
});

test("does not treat deferred instance field initializers as causal calls", async () => {
  const cases = [
    {
      name: "public-instance-field",
      body: `class Deferred {
    value = submitExample("deferred-public");
  }
  void Deferred;`
    },
    {
      name: "private-instance-field",
      body: `class Deferred {
    #value = submitExample("deferred-private");
  }
  void Deferred;`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }

  const staticFieldRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  class Immediate {
    static value = submitExample("static-field");
  }
  void Immediate;
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const staticField =
    await inspectWholeSitePageActionManifest({
      root: staticFieldRoot
    });
  assert.equal(
    staticField.status,
    "ready",
    JSON.stringify(staticField.blockers)
  );

  for (const [name, body] of [
    [
      "throwing-static-block",
      `static { throw new Error("stop"); }
    static value = submitExample("unreachable-after-throw");`
    ],
    [
      "non-terminating-static-block",
      `static { while (true) {} }
    static value = submitExample("unreachable-after-loop");`
    ]
  ]) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  class NeverCalls {
    ${body}
  }
  void NeverCalls;
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      name
    );
  }
});

test("stops causal proof after deterministic local non-returning calls", async () => {
  const cases = [
    {
      name: "throwing-local-helper",
      declarations: `function stop(): never {
  throw new Error("stop");
}`,
      body: `stop();
  await submitExample("unreachable-after-helper");`
    },
    {
      name: "non-terminating-local-helper",
      declarations: `function stop(): never {
  while (true) {}
}`,
      body: `stop();
  await submitExample("unreachable-after-loop-helper");`
    },
    {
      name: "throwing-iife",
      declarations: "",
      body: `(() => { throw new Error("stop"); })();
  await submitExample("unreachable-after-iife");`
    },
    {
      name: "throwing-helper-alias",
      declarations: `function boom(): never {
  throw new Error("stop");
}
const stop = boom;`,
      body: `stop();
  await submitExample("unreachable-after-alias");`
    },
    {
      name: "throwing-object-helper",
      declarations: `const helpers = {
  stop(): never { throw new Error("stop"); }
};`,
      body: `helpers.stop();
  await submitExample("unreachable-after-object-helper");`
    },
    {
      name: "throwing-shadowed-helper",
      declarations: `function stop() { return undefined; }`,
      body: `function stop(): never { throw new Error("stop"); }
  stop();
  await submitExample("unreachable-after-shadow");`
    },
    {
      name: "throwing-class-before-call",
      declarations: "",
      body: `class Stop {
    static { throw new Error("stop"); }
  }
  void Stop;
  await submitExample("unreachable-after-class");`
    },
    {
      name: "throwing-static-field-iife",
      declarations: "",
      body: `class Stop {
    static first = (() => { throw new Error("stop"); })();
    static second = submitExample("unreachable-static-field");
  }
  void Stop;`
    }
  ];
  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
${entry.declarations}
async function submit() {
  ${entry.body}
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
});

test("treats an explicit dialog on-confirm binding as the terminal action callback", async () => {
  const root = await fixture({
    actions: [
      registryAction({
        trigger: {
          element: "t-dialog",
          event: "confirm",
          handler: "submit"
        }
      })
    ],
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-dialog
    v-if="actionEnabled('submit_approval')"
    :on-confirm="submit"
  />
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].trigger.kind, "prop_callback");
  assert.equal(manifest.actions[0].trigger.event, "confirm");
  assert.equal(manifest.actions[0].trigger.handler, "submit");
});

test("requires webAdminRoutes to feed the createRouter instance consumed by main", async () => {
  for (const [name, prelude] of [
    [
      "throwing-local-helper",
      `stop();
function stop(): never { throw new Error("stop"); }`
    ],
    [
      "throwing-iife",
      `(() => { throw new Error("stop"); })();`
    ],
    [
      "throwing-helper-alias",
      `function boom(): never { throw new Error("stop"); }
const stop = boom;
stop();`
    ],
    [
      "throwing-object-helper",
      `const helpers = {
  stop(): never { throw new Error("stop"); }
};
helpers.stop();`
    ]
  ]) {
    const root = await fixture({
      main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
${prelude}
app.use(router);
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
      ),
      name
    );
  }

  for (const [name, mutation] of [
    [
      "direct-eval-app-mutation",
      `eval("app.use = () => app");`
    ],
    [
      "tagged-template-app-escape",
      "String.raw`${app}`;"
    ],
    [
      "create-app-rewrite",
      `// @ts-ignore
createApp = (() => ({ use: () => undefined })) as any;`
    ]
  ]) {
    const root = await fixture({
      main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
${mutation}
app.use(router);
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
      ),
      name
    );
  }

  const removedRouteThroughAliasRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
const remove = router.removeRoute;
remove("example");
app.use(router);
`
  });
  const removedRouteThroughAlias =
    await inspectWholeSitePageActionManifest({
      root: removedRouteThroughAliasRoot
    });
  assert.equal(removedRouteThroughAlias.status, "blocked");
  assert.ok(
    blockerCodes(removedRouteThroughAlias).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  for (const [name, mutation] of [
    [
      "object-pattern-app-member",
      `({ replacement: app.use } = { replacement: (() => undefined) as any });`
    ],
    [
      "array-pattern-app-member",
      `[app.use] = [(() => undefined) as any];`
    ]
  ]) {
    const root = await fixture({
      main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
${mutation}
app.use(router);
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
      ),
      name
    );
  }

  for (const [name, mutation] of [
    [
      "router-install-assignment",
      `(router as any).install = () => undefined;`
    ],
    [
      "router-install-delete",
      `delete (router as any).install;`
    ],
    [
      "router-object-assign",
      `Object.assign(router as any, { install: () => undefined });`
    ]
  ]) {
    const root = await fixture({
      main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
${mutation}
app.use(router);
`
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
      ),
      name
    );
  }

  for (const [name, routeIndex] of [
    [
      "routes-spread-override",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
export const router = createRouter({
  routes: webAdminRoutes,
  ...{ routes: [] }
});
`
    ],
    [
      "routes-computed-override",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
export const router = createRouter({
  routes: webAdminRoutes,
  ["routes"]: []
});
`
    ],
    [
      "routes-source-mutation",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
webAdminRoutes.length = 0;
export const router = createRouter({ routes: webAdminRoutes });
`
    ],
    [
      "router-post-install-mutation",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
export const router = createRouter({ routes: webAdminRoutes });
(router as any).install = () => undefined;
`
    ],
    [
      "router-reassignable-export",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
export let router = createRouter({ routes: webAdminRoutes });
router = { install: () => undefined } as any;
`
    ],
    [
      "create-router-rewrite",
      `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
// @ts-ignore
createRouter = (() => ({ install: () => undefined })) as any;
export const router = createRouter({ routes: webAdminRoutes });
`
    ]
  ]) {
    const root = await fixture({ routeIndex });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });
    assert.equal(
      manifest.status,
      "blocked",
      `${name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
      ),
      name
    );
  }

  const routeRecordsMutationRoot = await fixture({
    routeRecords: `export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/ExamplePage.vue") }];
webAdminRoutes.length = 0;
`
  });
  const routeRecordsMutation =
    await inspectWholeSitePageActionManifest({
      root: routeRecordsMutationRoot
    });
  assert.equal(routeRecordsMutation.status, "blocked");
  assert.ok(
    blockerCodes(routeRecordsMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const crossModuleMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
import "./mutate-router";
const app = createApp({});
app.use(router);
`,
    extraFiles: {
      "apps/web-admin/src/mutate-router.ts": `import { router } from "./routes";
(router as any).install = () => undefined;
`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    }
  });
  const crossModuleMutation =
    await inspectWholeSitePageActionManifest({
      root: crossModuleMutationRoot
    });
  assert.equal(crossModuleMutation.status, "blocked");
  assert.ok(
    blockerCodes(crossModuleMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const reexportedRouterMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
import "./mutate-router";
const app = createApp({});
app.use(router);
`,
    extraFiles: {
      "apps/web-admin/src/router-bridge.ts": `export { router } from "./routes";
`,
      "apps/web-admin/src/mutate-router.ts": `import { router } from "./router-bridge";
(router as any).install = () => undefined;
`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 7,
        reachableProductionModuleCount: 7
      }
    }
  });
  const reexportedRouterMutation =
    await inspectWholeSitePageActionManifest({
      root: reexportedRouterMutationRoot
    });
  assert.equal(reexportedRouterMutation.status, "blocked");
  assert.ok(
    blockerCodes(reexportedRouterMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const reexportedRoutesMutationRoot = await fixture({
    routeIndex: `import { createRouter } from "vue-router";
import { webAdminRoutes } from "./route-records";
import "../mutate-routes";
export const router = createRouter({ routes: webAdminRoutes });
`,
    extraFiles: {
      "apps/web-admin/src/routes-bridge.ts": `export { webAdminRoutes } from "./routes/route-records";
`,
      "apps/web-admin/src/mutate-routes.ts": `import { webAdminRoutes } from "./routes-bridge";
webAdminRoutes.length = 0;
`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 7,
        reachableProductionModuleCount: 7
      }
    }
  });
  const reexportedRoutesMutation =
    await inspectWholeSitePageActionManifest({
      root: reexportedRoutesMutationRoot
    });
  assert.equal(reexportedRoutesMutation.status, "blocked");
  assert.ok(
    blockerCodes(reexportedRoutesMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const dynamicRouterMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
await import("./routes").then((module) => {
  (module.router as any).install = () => undefined;
});
app.use(router);
`
  });
  const dynamicRouterMutation =
    await inspectWholeSitePageActionManifest({
      root: dynamicRouterMutationRoot
    });
  assert.equal(dynamicRouterMutation.status, "blocked");
  assert.ok(
    blockerCodes(dynamicRouterMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const dynamicUnknownRouterMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
const target = "./routes";
await import(target).then((module) => {
  (module.router as any).install = () => undefined;
});
app.use(router);
`
  });
  const dynamicUnknownRouterMutation =
    await inspectWholeSitePageActionManifest({
      root: dynamicUnknownRouterMutationRoot
    });
  assert.equal(dynamicUnknownRouterMutation.status, "blocked");
  assert.ok(
    blockerCodes(dynamicUnknownRouterMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const deletedUseRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
delete (app as any).use;
app.use(router);
`
  });
  const deletedUse = await inspectWholeSitePageActionManifest({
    root: deletedUseRoot
  });
  assert.equal(deletedUse.status, "blocked");
  assert.ok(
    blockerCodes(deletedUse).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const assignedAliasMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
let alias: any;
alias = app;
alias.use = () => alias;
app.use(router);
`
  });
  const assignedAliasMutation =
    await inspectWholeSitePageActionManifest({
      root: assignedAliasMutationRoot
    });
  assert.equal(assignedAliasMutation.status, "blocked");
  assert.ok(
    blockerCodes(assignedAliasMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const objectAssignRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
Object.assign(app as any, { use: () => app });
app.use(router);
`
  });
  const objectAssign =
    await inspectWholeSitePageActionManifest({
      root: objectAssignRoot
    });
  assert.equal(objectAssign.status, "blocked");
  assert.ok(
    blockerCodes(objectAssign).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const definePropertyRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
Object.defineProperty(app as any, "use", { value: () => app });
app.use(router);
`
  });
  const defineProperty =
    await inspectWholeSitePageActionManifest({
      root: definePropertyRoot
    });
  assert.equal(defineProperty.status, "blocked");
  assert.ok(
    blockerCodes(defineProperty).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const tsWrappedMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
(app as any).use = () => app;
app.use(router);
`
  });
  const tsWrappedMutation =
    await inspectWholeSitePageActionManifest({
      root: tsWrappedMutationRoot
    });
  assert.equal(tsWrappedMutation.status, "blocked");
  assert.ok(
    blockerCodes(tsWrappedMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const aliasMutationRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
const alias = app;
alias.use = () => alias;
app.use(router);
`
  });
  const aliasMutation =
    await inspectWholeSitePageActionManifest({
      root: aliasMutationRoot
    });
  assert.equal(aliasMutation.status, "blocked");
  assert.ok(
    blockerCodes(aliasMutation).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const tsWrappedUpdateRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({}) as any;
(app as any).version++;
app.use(router);
`
  });
  const tsWrappedUpdate =
    await inspectWholeSitePageActionManifest({
      root: tsWrappedUpdateRoot
    });
  assert.equal(tsWrappedUpdate.status, "blocked");
  assert.ok(
    blockerCodes(tsWrappedUpdate).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const thrownBeforeUseRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
throw new Error("stop");
app.use(router);
`
  });
  const thrownBeforeUse =
    await inspectWholeSitePageActionManifest({
      root: thrownBeforeUseRoot
    });
  assert.equal(thrownBeforeUse.status, "blocked");
  assert.ok(
    blockerCodes(thrownBeforeUse).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const infiniteLoopBeforeUseRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
while (true) {}
app.use(router);
`
  });
  const infiniteLoopBeforeUse =
    await inspectWholeSitePageActionManifest({
      root: infiniteLoopBeforeUseRoot
    });
  assert.equal(infiniteLoopBeforeUse.status, "blocked");
  assert.ok(
    blockerCodes(infiniteLoopBeforeUse).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const routerAsOptionRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const plugin = { install() {} };
createApp({}).use(plugin, router);
`
  });
  const routerAsOption =
    await inspectWholeSitePageActionManifest({
      root: routerAsOptionRoot
    });
  assert.equal(routerAsOption.status, "blocked");
  assert.ok(
    blockerCodes(routerAsOption).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const reassignedUseRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const app = createApp({});
app.use = () => app;
app.use(router);
`
  });
  const reassignedUse =
    await inspectWholeSitePageActionManifest({
      root: reassignedUseRoot
    });
  assert.equal(reassignedUse.status, "blocked");
  assert.ok(
    blockerCodes(reassignedUse).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const conditionalAssignmentRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
let gate = false;
gate &&= createApp({}).use(router);
`
  });
  const conditionalAssignment =
    await inspectWholeSitePageActionManifest({
      root: conditionalAssignmentRoot
    });
  assert.equal(conditionalAssignment.status, "blocked");
  assert.ok(
    blockerCodes(conditionalAssignment).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const deadCreateAppBranchRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
if (false) {
  createApp({}).use(router);
}
`
  });
  const deadCreateAppBranch =
    await inspectWholeSitePageActionManifest({
      root: deadCreateAppBranchRoot
    });
  assert.equal(deadCreateAppBranch.status, "blocked");
  assert.ok(
    blockerCodes(deadCreateAppBranch).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const reboundAppRoot = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
const fakeApp = { use(value: unknown) { return value; } };
let app = createApp({});
app = fakeApp;
app.use(router);
`
  });
  const reboundApp = await inspectWholeSitePageActionManifest({
    root: reboundAppRoot
  });
  assert.equal(reboundApp.status, "blocked");
  assert.ok(
    blockerCodes(reboundApp).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const fakeAppRoot = await fixture({
    main: `import { router } from "./routes";
const fakeApp = { use(value: unknown) { return value; } };
fakeApp.use(router);
`
  });
  const fakeApp = await inspectWholeSitePageActionManifest({
    root: fakeAppRoot
  });
  assert.equal(fakeApp.status, "blocked");
  assert.ok(
    blockerCodes(fakeApp).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const sideEffectRoot = await fixture({
    main: `import "./routes/route-records";\n`,
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 5,
        reachableProductionModuleCount: 4
      }
    }
  });
  const sideEffect = await inspectWholeSitePageActionManifest({
    root: sideEffectRoot
  });
  assert.equal(sideEffect.status, "blocked");
  assert.ok(
    blockerCodes(sideEffect).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );

  const deadRouterRoot = await fixture({
    main: `import { router } from "./routes";
void router;
`
  });
  const deadRouter = await inspectWholeSitePageActionManifest({
    root: deadRouterRoot
  });
  assert.equal(deadRouter.status, "blocked");
  assert.ok(
    blockerCodes(deadRouter).has(
      "WEB_ADMIN_ROUTES_ROUTER_CONSUMPTION_UNVERIFIED"
    )
  );
});

test("rendering and write/check are deterministic while require-ready rejects blockers", async () => {
  const root = await fixture();
  const first = await inspectWholeSitePageActionManifest({ root });
  const second = await inspectWholeSitePageActionManifest({ root });
  const rendered = renderWholeSitePageActionManifest(first);
  assert.equal(rendered, renderWholeSitePageActionManifest(second));
  assert.doesNotMatch(rendered, /generatedAt|\/Users\//u);

  const targetPath = join(
    root,
    "docs/product/manifests/web-page-actions.json"
  );
  await writeOrCheckWholeSitePageActionManifest({
    mode: "write",
    targetPath,
    rendered
  });
  await writeOrCheckWholeSitePageActionManifest({
    mode: "check",
    targetPath,
    rendered
  });
  assert.equal(await readFile(targetPath, "utf8"), rendered);

  await runWholeSitePageActionManifestCli(["--check"], { root });
  const blockedRoot = await fixture({
    actions: [
      registryAction({
        capability: {
          kind: "none",
          source: "local form state"
        }
      })
    ]
  });
  await runWholeSitePageActionManifestCli(["--write"], {
    root: blockedRoot
  });
  await assert.rejects(
    runWholeSitePageActionManifestCli(
      ["--check", "--require-ready"],
      { root: blockedRoot }
    ),
    (error) => error?.code === "PAGE_ACTION_MANIFEST_BLOCKED"
  );
});

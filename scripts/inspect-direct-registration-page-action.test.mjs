import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web-admin/src";
const page = `${web}/pages/contracts/ContractWorkbenchPage.vue`;
const composable = `${web}/pages/contracts/workbench/use-direct-contract-registration.ts`;
const coordinates = `${web}/pages/contracts/workbench/direct-pending-draft.ts`;
const coreApi = `${web}/api/core-flow-read.api.ts`;
const draftApi = `${web}/api/contract-workbench.api.ts`;
const routePath = "/合同工作台/:contractId";
const commands = {
  lookup: { name: "fetchDirectSignedContractResult", apiFile: coreApi, method: "GET", path: "/contracts/:param/archive-requests/:param", action: "contract.submit" },
  write: { name: "archiveSignedContractV2", apiFile: coreApi, method: "POST", path: "/contracts/:param/signed-archive", action: "contract.submit" },
  read: { name: "fetchContractDraftWorkbench", apiFile: draftApi, method: "GET", path: "/contract-drafts/:param/workbench", action: "contract.create" }
};

const freshCapability = { kind: "server_boolean", source: "directPendingCapabilities.registrationEnabled" };
const writeWrapper = { apiFile: coreApi, name: commands.write.name };
const confirm = {
  id: "contract-direct-registration.confirm", usage: "page_action", routePaths: [routePath], sourceFile: page,
  trigger: { element: "t-dialog", event: "confirm", handler: "confirmDirectRegistration" },
  semantic: "business_write", capability: freshCapability, wrappers: [writeWrapper]
};
const resume = {
  ...confirm, id: "contract-direct-registration.resume-original",
  trigger: { element: "t-button", event: "click", handler: "directRegistration", variant: "resume-original" }
};

const lookup = {
  id: "contract-direct-registration.lookup-original", usage: "page_action", routePaths: [routePath], sourceFile: page,
  trigger: { element: "t-button", event: "click", handler: "directRegistration", variant: "lookup-original" },
  semantic: "read_only", capability: { kind: "none", source: "localStorage.pending" },
  wrappers: [{ apiFile: coreApi, name: commands.lookup.name }]
};

async function fixture(t, { actions = [lookup], pageEdit = text => text, composableEdit = text => text, coordinatesEdit = text => text, coreEdit = text => text } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-direct-registration-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, data) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof data === "string" ? data : JSON.stringify(data));
  };
  const main = `import { createApp } from "vue"; import { router } from "./routes"; createApp({}).use(router);`;
  const router = `import { createRouter } from "vue-router"; import { webAdminRoutes } from "./route-records";
    export const router = createRouter({ history: {}, routes: webAdminRoutes });`;
  const records = `export const webAdminRoutes = [{ path: "${routePath}", component: () => import("../pages/contracts/ContractWorkbenchPage.vue") }];`;
  const source = path => readFile(join(sourceRoot, path), "utf8");
  const wrappers = Object.values(commands).map(item => ({
    apiFile: item.apiFile, name: item.name, kind: "transport",
    returnProvenance: item.method === "GET" ? "transparent_main_response" : "none",
    requests: [{ kind: "main", method: item.method, path: item.path, normalizedPath: item.path,
      normalizedKey: item.method + " " + item.path, bodyKind: item.method === "GET" ? "none" : "json" }],
    productionConsumers: [composable], testConsumers: [], unreachableConsumers: []
  }));
  const routes = Object.values(commands).map(item => ({
    path: item.path, normalizedKey: item.method + " " + item.path, method: item.method, sourceFile: "services/api/src/contract/contract.controller.ts",
    authorizationScope: "guard_metadata_only", authentication: "authenticated", guardAuthorization: "project_action",
    isPublic: false, requiredPositions: [], requiredProjectAction: item.action, authorizationCombination: null
  }));
  await Promise.all([
    write(`${web}/main.ts`, main), write(`${web}/routes/index.ts`, router), write(`${web}/routes/route-records.ts`, records),
    source(page).then(pageEdit).then(text => write(page, text)),
    source(composable).then(composableEdit).then(text => write(composable, text)),
    source(coordinates).then(coordinatesEdit).then(text => write(coordinates, text)),
    source(coreApi).then(coreEdit).then(text => write(coreApi, text)),
    ...[draftApi, `${web}/api/api-fetch.ts`, `${web}/auth/auth.store.ts`, "packages/shared-domain/src/permissions.ts"].map(path => source(path).then(text => write(path, text))),
    write("docs/product/manifests/web-page-actions.registry.json", { schemaVersion: 1, actions }),
    write("docs/product/manifests/web-api-wrappers.json", { schemaVersion: 1, status: "ready", wrappers, blockers: {}, authTransportExceptions: [],
      evidence: { productionModuleCount: 10, reachableProductionModuleCount: 10 },
      scope: { apiRoot: "apps/web-admin/src/api", productionEntrypoint: "apps/web-admin/src/main.ts", nestRouteManifest: "docs/product/manifests/nest-business-routes.json" } }),
    write("docs/product/manifests/nest-business-routes.json", { schemaVersion: 1, authorizationScope: "guard_metadata_only", routes })
  ]);
  return inspectWholeSitePageActionManifest({ root });
}

test("recognizes the explicit original-key lookup as a GET-only action", async t => {
  const manifest = await fixture(t);
  const action = manifest.actions.find(entry => entry.id === lookup.id);
  assert.equal(action.trigger.kind, "event");
  assert.deepEqual(action.bindings.map(binding => [binding.normalizedKey, binding.causalVerified]), [
    ["GET /contracts/:param/archive-requests/:param", true]
  ]);
  assert.ok(manifest.blockers.uncoveredMutationWrappers.some(blocker => blocker.wrapper === commands.write.name));
});

test("does not bless the explicit same-key continuation as a read-only action", async t => {
  const manifest = await fixture(t, {
    pageEdit: text => text.replace('@click="directRegistration.query()"', '@click="directRegistration.query(true)"')
  });
  assert.ok(manifest.blockers.staleRegistryEntries.some(blocker => blocker.actionId === lookup.id));
});

test("rejects a write hidden in the original-result read", async t => {
  const manifest = await fixture(t, {
    composableEdit: text => text.replace("    if (started !== epoch) return \"stale\";",
      "    await archiveSignedContractV2(intent.versionId, intent.body, () => true);\n    if (started !== epoch) return \"stale\";")
  });
  assert.ok(manifest.blockers.unresolvedWrappers.some(blocker =>
    blocker.actionId === lookup.id && blocker.code === "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"));
});

test("certifies both direct writes from fresh server capability and keeps original lookup separate", async t => {
  const manifest = await fixture(t, { actions: [confirm, lookup, resume] });
  for (const row of [confirm, resume]) {
    const action = manifest.actions.find(entry => entry.id === row.id);
    assert.ok(action.bindings.every(binding => binding.causalVerified), row.id);
    assert.deepEqual(action.bindings[0].acceptedProductionConsumers, [composable], JSON.stringify(manifest.blockers));
    assert.equal(action.capability.serverDerived, true, row.id);
    assert.equal(action.capability.dominatesTrigger, true, row.id);
  }
  assert.ok(!manifest.blockers.uncoveredMutationWrappers.some(blocker => blocker.wrapper === commands.write.name));
});

for (const [name, option, original, changed] of [
  ["wrong actor", "pageEdit", "actor: computed(() => authStore.user?.id)", 'actor: computed(() => "another-actor")'],
  ["lost service capability", "coordinatesEdit", "record(workbench.directPendingCapabilities)?.registrationEnabled !== true", "false"],
  ["wrong source version", "coordinatesEdit",
    'kind.relationship !== "outside" ||\n    locator?.contractId !== contractId || locator.contractVersionId !== versionId',
    'kind.relationship !== "outside" ||\n    locator?.contractId !== contractId || false'],
  ["different fresh read version", "composableEdit", "fetchContractDraftWorkbench(captured.versionId", 'fetchContractDraftWorkbench("another-version"'],
  ["different file order", "composableEdit", "id === right[index]", "right.includes(id)"],
  ["removed in-lock epoch guard", "composableEdit", "|| !sendCurrent(captured, started)) return;", ") return;"],
  ["sent marker after the write", "composableEdit", 'localStorage.setItem(storageKey, JSON.stringify({ ...intent, phase: "sent" }));', 'void storageKey;'],
  ["enabled auto retry", "coreEdit", 'const options = { retryUnauthorized: false, responseIsCurrent };', 'const options = { retryUnauthorized: true, responseIsCurrent };'],
  ["forced result unknown", "composableEdit", 'if (result?.status === "unknown") {', 'if (true) {']
]) {
  test(`rejects direct write evidence with ${name}`, async t => {
    const manifest = await fixture(t, { actions: [confirm, lookup, resume], [option]: text => {
      const mutated = text.replace(original, changed);
      assert.notEqual(mutated, text);
      return mutated;
    } });
    for (const row of [confirm, resume]) {
      const action = manifest.actions.find(entry => entry.id === row.id);
      assert.equal(action.bindings[0].causalVerified, false, row.id);
      assert.equal(action.capability.dominatesTrigger, false, row.id);
    }
    assert.ok(manifest.blockers.uncoveredMutationWrappers.some(blocker => blocker.wrapper === commands.write.name));
  });
}

test("requires the original GET to return unknown before any same-key continuation", async t => {
  const manifest = await fixture(t, { actions: [confirm, lookup, resume], composableEdit: text =>
    text.replace('if (await read(intent, started, storageKey) !== "unknown" || !continueOriginal || started !== epoch) return;',
      'if (!continueOriginal || started !== epoch) return;')
  });
  const action = manifest.actions.find(entry => entry.id === resume.id);
  assert.equal(action.bindings[0].causalVerified, false);
});

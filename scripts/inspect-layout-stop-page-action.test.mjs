import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web-admin/src";
const page = web + "/pages/contract-templates/LayoutTemplateEditorPage.vue";
const docs = "docs/product/manifests/";
const registry = docs + "web-page-actions.registry.json";
const nest = docs + "nest-business-routes.json";
const api = docs + "web-api-wrappers.json";
const actionId = "layout-template.stop";
const apiNames = new Set(["getLayoutVersionMaintenanceCapability", "stopLayoutTemplateVersion"]);

const original = path => readFile(join(root, path), "utf8");
const originalJson = async path => JSON.parse(await original(path));

async function fixture(t, change = text => text) {
  const isolated = await mkdtemp(join(tmpdir(), "jg-layout-stop-page-action-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const write = async (path, value) => {
    await mkdir(dirname(join(isolated, path)), { recursive: true });
    await writeFile(join(isolated, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  const [registryValue, apiValue, nestValue, pageSource] = await Promise.all([
    originalJson(registry), originalJson(api), originalJson(nest), original(page)
  ]);
  const action = registryValue.actions.find(row => row.id === actionId);
  assert.ok(action);
  const wrappers = apiValue.wrappers.filter(row => apiNames.has(row.name));
  assert.equal(wrappers.length, 2);
  const requestKeys = new Set(wrappers.flatMap(row => row.requests.map(request => request.normalizedKey)));
  const routes = nestValue.routes.filter(row => requestKeys.has(row.normalizedKey));
  assert.equal(routes.length, 2);

  await Promise.all([
    write(web + "/main.ts", 'import { createApp } from "vue"; import { router } from "./routes"; createApp({}).use(router);'),
    write(web + "/routes/index.ts", 'import { createRouter } from "vue-router"; import { webAdminRoutes } from "./route-records"; export const router = createRouter({ history: {}, routes: webAdminRoutes });'),
    write(web + "/routes/route-records.ts", "export const webAdminRoutes = [{ path: " + JSON.stringify(action.routePaths[0]) +
      ', component: () => import("../pages/contract-templates/LayoutTemplateEditorPage.vue") }];'),
    write(page, change(pageSource)),
    ...wrappers.map(row => original(row.apiFile).then(source => write(row.apiFile, source))),
    original("packages/shared-domain/src/permissions.ts").then(source => write("packages/shared-domain/src/permissions.ts", source)),
    write(registry, { schemaVersion: 1, actions: [action] }),
    write(api, { ...apiValue, wrappers, blockers: {}, authTransportExceptions: [],
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 } }),
    write(nest, { schemaVersion: 1, authorizationScope: "guard_metadata_only", routes })
  ]);
  const manifest = await inspectWholeSitePageActionManifest({ root: isolated });
  return { manifest, action: manifest.actions.find(row => row.id === actionId) };
}

test("proves layout stop from the current authorized version and rejects stale continuations", async t => {
  const { manifest, action } = await fixture(t);
  assert.equal(action?.bindings[0]?.causalVerified, true, JSON.stringify(manifest.blockers));
  assert.equal(action.capability.serverDerived, true);
  assert.equal(action.capability.dominatesTrigger, true);
  assert.ok(!manifest.blockers.uncoveredMutationWrappers.some(row => row.wrapper === "stopLayoutTemplateVersion"));
});

for (const [name, originalText, changed] of [
  ["a different read version", "getLayoutVersionMaintenanceCapability(context.versionId)", "getLayoutVersionMaintenanceCapability(selectedVersionId.value)"],
  ["a different write version", "return stopLayoutTemplateVersion(context.versionId);", "return stopLayoutTemplateVersion(selectedVersionId.value);"],
  ["a skipped stale guard", "  if (!riskStopResultCanWrite(context)) return;\n  const matchesRequestedVersion", "  const matchesRequestedVersion"],
  ["a skipped version comparison", "capability.versionId === context.versionId", "capability.versionId === selectedVersionId.value"],
  ["a missing operation check", 'capability.availableActions.some(action => action.key === "risk_stop" && action.enabled)',
    'capability.availableActions.some(action => action.key === "risk_stop")'],
  ["a shadowed error constructor", "async function stopCurrentVersionWithCapability",
    "class Error { constructor() { stopLayoutTemplateVersion(selectedVersionId.value); } }\nasync function stopCurrentVersionWithCapability"],
  ["a weakened local operation identity", "context.operationId === riskStopOperationId;", "context.operationId > 0;"]
]) {
  test("rejects layout stop with " + name, async t => {
    const { manifest, action } = await fixture(t, text => {
      assert.ok(text.includes(originalText), "fixture must exercise the mutation");
      return text.replace(originalText, changed);
    });
    assert.equal(action?.bindings[0]?.causalVerified, false, JSON.stringify(manifest.blockers));
    assert.ok(manifest.blockers.uncoveredMutationWrappers.some(row => row.wrapper === "stopLayoutTemplateVersion"));
  });
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web-admin/src";
const page = web + "/pages/contracts/ContractSignedArchiveSection.vue";
const detail = web + "/pages/contracts/ContractDetailPage.vue";
const consumer = web + "/pages/contracts/use-contract-signed-archive.ts";
const api = web + "/api/core-flow-read.api.ts";
const docs = "docs/product/manifests/";
const read = path => readFile(join(root, path), "utf8");
const names = new Set(["archiveSignedContractV2", "fetchContractDetail", "fetchSignedContractArchiveV2Result", "fetchContractChangeEligibility", "uploadPrivateFile"]);
const actionIds = ["contract-generated-archive.confirm", "contract-generated-archive.resume-original"];

async function fixture(t, { transform = s => s, only = null, apiEdit = s => s, parentEdit = s => s, routeEdit = route => route } = {}) {
  const isolated = await mkdtemp(join(tmpdir(), "jg-generated-archive-action-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const write = async (path, value) => {
    await mkdir(dirname(join(isolated, path)), { recursive: true });
    await writeFile(join(isolated, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  const readJson = async path => JSON.parse(await read(path));
  const [webValue, nestValue, registryValue] = await Promise.all([
    readJson(docs + "web-api-wrappers.json"), readJson(docs + "nest-business-routes.json"), readJson(docs + "web-page-actions.registry.json")
  ]);
  const wrappers = webValue.wrappers.filter(w => w.apiFile === api && names.has(w.name)).map(w => ({
    ...w, productionConsumers: [consumer], testConsumers: [], unreachableConsumers: []
  }));
  assert.equal(wrappers.length, names.size);
  const keys = new Set(wrappers.flatMap(w => w.requests.map(r => r.normalizedKey)));
  const routes = nestValue.routes.filter(r => keys.has(r.normalizedKey)).map(routeEdit);
  const actions = registryValue.actions.filter(row => actionIds.includes(row.id) && (only === null || row.id === only));
  assert.equal(actions.length, only === null ? 2 : 1);
  await Promise.all([
    write(web + "/main.ts", 'import { createApp } from "vue"; import { router } from "./routes"; createApp({}).use(router);'),
    write(web + "/routes/index.ts", 'import { createRouter } from "vue-router"; import { webAdminRoutes } from "./route-records"; export const router = createRouter({ history: {}, routes: webAdminRoutes });'),
    write(web + "/routes/route-records.ts", 'export const webAdminRoutes = [{ path: "/合同管理/:contractId", component: () => import("../pages/contracts/ContractDetailPage.vue") }];'),
    read(page).then(source => write(page, source)),
    read(consumer).then(transform).then(source => write(consumer, source)),
    read(api).then(apiEdit).then(source => write(api, source)),
    read(detail).then(parentEdit).then(source => write(detail, source)),
    ...[web + "/api/api-fetch.ts", web + "/auth/auth.store.ts", web + "/api/error-message.ts",
      web + "/pages/contracts/contract-detail.config.ts", web + "/pages/contracts/contract-change.state.ts",
      "packages/shared-domain/src/permissions.ts"].map(path => read(path).then(source => write(path, source))),
    write(docs + "web-page-actions.registry.json", { schemaVersion: 1, actions }),
    write(docs + "web-api-wrappers.json", { ...webValue, wrappers, blockers: {}, authTransportExceptions: [],
      evidence: { productionModuleCount: 12, reachableProductionModuleCount: 12 } }),
    write(docs + "nest-business-routes.json", { schemaVersion: 1, authorizationScope: "guard_metadata_only", routes })
  ]);
  return inspectWholeSitePageActionManifest({ root: isolated });
}

test("proves generated archive confirmation and same-key continuation separately", async t => {
  const manifest = await fixture(t);
  for (const id of actionIds) {
    const action = manifest.actions.find(row => row.id === id);
    const requests = id === actionIds[0]
      ? ["POST /contracts/:param/signed-archive", "POST /files"]
      : ["POST /contracts/:param/signed-archive"];
    assert.deepEqual(action?.bindings.map(binding => binding.normalizedKey), requests);
    for (const binding of action.bindings) {
      assert.equal(binding.causalVerified, true, JSON.stringify(manifest.blockers));
      assert.deepEqual(binding.acceptedProductionConsumers, [consumer]);
    }
    assert.equal(action.capability.serverDerived, true);
    assert.equal(action.capability.dominatesTrigger, true);
  }
  assert.equal(uncovered(manifest, "archiveSignedContractV2"), false);
  assert.equal(uncovered(manifest, "uploadPrivateFile"), false);
});

function uncovered(manifest, wrapper) {
  return manifest.blockers.uncoveredMutationWrappers.some(row => row.wrapper === wrapper && row.sourceFile === consumer);
}

function replaceExact(original, changed) {
  return source => {
    assert.equal(source.split(original).length, 2, original);
    return source.replace(original, changed);
  };
}

for (const [label, original, changed, actionId] of [
  ["missing first fresh coordinates", "!archiveEligible(uploadContext) || !sameCoordinates(uploadContext, captured)", "!archiveEligible(uploadContext)", actionIds[0]],
  ["a continuation without unknown result", 'if (await readArchive(intent, started) !== "unknown" || !current(started)) return;', "if (!current(started)) return;", actionIds[1]],
  ["a reissued continuation key", "await sendArchive(intent, started);\n    } catch (error) { if (current(started)) message.value = error", "await sendArchive({ ...intent, body: { ...intent.body, idempotencyKey: crypto.randomUUID() } }, started);\n    } catch (error) { if (current(started)) message.value = error", actionIds[1]],
  ["a write without a current actor", "archiveSignedContractV2(intent.versionId, intent.body, () => current(started))", "archiveSignedContractV2(intent.versionId, intent.body, () => true)", actionIds[0]],
  ["missing post-upload document coordinates",
    'if (!archiveEligible(value) || !sameCoordinates(value, captured))',
    "if (!archiveEligible(value))", actionIds[0]],
  ["stale pre-upload scope", "if (!current(started)) return;\n      const uploadContext",
    "if (false) return;\n      const uploadContext", actionIds[0]],
  ["a different ordered upload key", "uploadPrivateFile(item.file, item.name, item.localId, () => current(started))",
    "uploadPrivateFile(item.file, item.name, crypto.randomUUID(), () => current(started))", actionIds[0]],
  ["a different contract lookup",
    "fetchContractDetail(input.routeContractId.value, { versionId });\n      if (!current(started)) return;\n      const uploadContext",
    "fetchContractDetail(versionId, { versionId });\n      if (!current(started)) return;\n      const uploadContext", actionIds[0]],
  ["a hydrated intent missing digest check", "if (saved.requestSha256 !== expected) throw new Error();", "if (false) throw new Error();", actionIds[1]],
  ["a result lookup using the wrong key", "fetchSignedContractArchiveV2Result(intent.versionId, intent.body.idempotencyKey)",
    "fetchSignedContractArchiveV2Result(intent.versionId, intent.requestSha256)", actionIds[1]]
]) {
  test("rejects generated archive with " + label, async t => {
    const manifest = await fixture(t, { transform: replaceExact(original, changed) });
    const action = manifest.actions.find(row => row.id === actionId);
    assert.equal(action.capability.dominatesTrigger, false, JSON.stringify(manifest.blockers));
    assert.ok(manifest.blockers.unresolvedWrappers.some(row => row.actionId === actionId), JSON.stringify(manifest.blockers));
    assert.equal(uncovered(manifest, "archiveSignedContractV2"), true);
  });
}

for (const only of actionIds) {
  test("does not clear paired generated archive coverage with only " + only, async t => {
    const manifest = await fixture(t, { only });
    assert.equal(uncovered(manifest, "archiveSignedContractV2"), true);
    assert.equal(uncovered(manifest, "uploadPrivateFile"), only === actionIds[1]);
  });
}

test("rejects upload with an automatic unauthorized retry", async t => {
  const manifest = await fixture(t, { apiEdit: replaceExact(
    "const options = responseIsCurrent ? { retryUnauthorized: false, responseIsCurrent } : undefined;",
    "const options = responseIsCurrent ? { retryUnauthorized: true, responseIsCurrent } : undefined;") });
  assert.equal(uncovered(manifest, "uploadPrivateFile"), true);
  assert.equal(uncovered(manifest, "archiveSignedContractV2"), true);
  const resume = manifest.actions.find(action => action.id === actionIds[1]);
  assert.equal(resume.bindings[0].causalVerified, true);
});

test("rejects an archive parent pointing the section at a different contract route", async t => {
  const manifest = await fixture(t, { parentEdit: replaceExact(':route-contract-id="routeContractId()"', ':route-contract-id="routeVersionId()"') });
  assert.equal(uncovered(manifest, "uploadPrivateFile"), true);
  assert.equal(uncovered(manifest, "archiveSignedContractV2"), true);
});

test("rejects a public original-request lookup", async t => {
  const manifest = await fixture(t, { routeEdit: route => route.normalizedKey === "GET /contracts/:param/archive-requests/:param" ?
    { ...route, authentication: "public", isPublic: true, guardAuthorization: "public" } : route });
  assert.equal(uncovered(manifest, "archiveSignedContractV2"), true);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web-admin/src";
const page = `${web}/pages/contracts/ContractDetailPage.vue`;
const api = `${web}/api/core-flow-read.api.ts`;
const routePath = "/合同管理/:contractId";
const id = "contract.signing-material-change";
const registryPath = "docs/product/manifests/web-page-actions.registry.json";
const webManifestPath = "docs/product/manifests/web-api-wrappers.json";
const nestManifestPath = "docs/product/manifests/nest-business-routes.json";
const source = path => readFile(join(sourceRoot, path), "utf8");
const fromSource = async path => JSON.parse(await source(path));

async function fixture(t, { pageEdit = text => text, apiEdit = text => text, routeEdit = route => route } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-signing-material-page-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, data) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof data === "string" ? data : JSON.stringify(data));
  };
  const registry = await fromSource(registryPath);
  const webManifest = await fromSource(webManifestPath);
  const nestManifest = await fromSource(nestManifestPath);
  const names = ["fetchContractDetail", "executeContractSigningMaterialChange"];
  const wrappers = webManifest.wrappers.filter(wrapper => wrapper.apiFile === api && names.includes(wrapper.name))
    .map(wrapper => ({ ...wrapper, productionConsumers: [page] }));
  const keys = new Set(wrappers.flatMap(wrapper => wrapper.requests.map(request => request.normalizedKey)));
  const routes = nestManifest.routes.filter(route => keys.has(route.normalizedKey)).map(routeEdit);
  await Promise.all([
    write(`${web}/main.ts`, 'import { createApp } from "vue"; import { router } from "./routes"; createApp({}).use(router);'),
    write(`${web}/routes/index.ts`, 'import { createRouter } from "vue-router"; import { webAdminRoutes } from "./route-records"; export const router = createRouter({ history: {}, routes: webAdminRoutes });'),
    write(`${web}/routes/route-records.ts`, `export const webAdminRoutes = [{ path: "${routePath}", component: () => import("../pages/contracts/ContractDetailPage.vue") }];`),
    source(page).then(pageEdit).then(text => write(page, text)),
    source(api).then(apiEdit).then(text => write(api, text)),
    ...[`${web}/api/api-fetch.ts`, `${web}/components/approval-self-review.config.ts`, `${web}/components/SensitiveActionDialog.vue`, "packages/shared-domain/src/permissions.ts"].map(path => source(path).then(text => write(path, text))),
    write(registryPath, { schemaVersion: 1, actions: registry.actions.filter(row => row.id === id) }),
    write(webManifestPath, { schemaVersion: 1, status: "ready", wrappers, blockers: {}, authTransportExceptions: [],
      evidence: { productionModuleCount: 8, reachableProductionModuleCount: 8 }, scope: webManifest.scope }),
    write(nestManifestPath, { schemaVersion: 1, authorizationScope: "guard_metadata_only", routes })
  ]);
  return inspectWholeSitePageActionManifest({ root });
}


function materialAction(manifest) {
  return manifest.actions.find(row => row.id === id);
}

test("certifies the explicit signing material change confirmation for the fresh same-version seal task", async t => {
  const manifest = await fixture(t);
  const action = materialAction(manifest);
  assert.equal(action.trigger.kind, "event");
  assert.equal(action.capability.serverDerived, true);
  assert.equal(action.capability.dominatesTrigger, true);
  assert.deepEqual(action.bindings.map(binding => binding.normalizedKey), [
    "GET /contracts/:param", "POST /contracts/:param/signing/material-change"
  ]);
  for (const binding of action.bindings) {
    assert.equal(binding.causalVerified, true);
    assert.deepEqual(binding.acceptedProductionConsumers, [page], JSON.stringify(manifest.blockers));
  }
});

function editFunction(text, name, original, changed) {
  const start = text.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  const end = text.indexOf("\n}\n", start);
  const body = text.slice(start, end);
  assert.ok(body.includes(original), `${name}: ${original}`);
  return text.slice(0, start) + body.replace(original, changed) + text.slice(end);
}

function assertRejected(manifest) {
  const action = materialAction(manifest);
  assert.equal(action.capability.serverDerived, false);
  assert.equal(action.capability.dominatesTrigger, false);
  for (const binding of action.bindings) {
    assert.equal(binding.causalVerified, false);
    assert.deepEqual(binding.acceptedProductionConsumers, []);
  }
}

for (const [label, target, name, original, changed] of [
  ["confirmation loses the current dialog owner", "pageEdit", "confirmSigningMaterialChange",
    "current: signingMaterialChangeSubmissionIsCurrent", "current: () => true"],
  ["captured seal task omits the dialog comparison", "pageEdit", "captureSigningMaterialChangeSubmission",
    "coordinates.expectedSealTaskId !==\n      owner.expectedSealTaskId", "false"],
  ["GET uses a different route coordinate", "apiEdit", "executeContractSigningMaterialChange",
    "fetchContractDetail(context.routeContractId)", "fetchContractDetail(context.contractVersionId)"],
  ["current ownership is unchecked after GET", "apiEdit", "executeContractSigningMaterialChange",
    "!input.current(context, fresh)", "false"],
  ["GET omits the enabled capability", "apiEdit", "assertContractSigningMaterialChangePreflight",
    'action.key === "report_signing_material_change" && action.enabled', 'action.key === "report_signing_material_change"'],
  ["GET omits the same version check", "apiEdit", "assertContractSigningMaterialChangePreflight",
    "fresh.contractVersionId !== context.contractVersionId", "false"],
  ["GET omits the same signing task status", "apiEdit", "assertContractSigningMaterialChangePreflight",
    "fresh.sealTask.status !==\n      MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS[context.expectedStatus]", "false"],
  ["POST targets a different version", "apiEdit", "executeContractSigningMaterialChange",
    "context.contractVersionId", "context.contractId"],
  ["POST uses a different draft revision", "apiEdit", "executeContractSigningMaterialChange",
    "expectedRevision: context.expectedRevision", "expectedRevision: context.expectedRevision + 1"],
  ["POST replaces the captured status", "apiEdit", "executeContractSigningMaterialChange",
    "expectedStatus: context.expectedStatus", 'expectedStatus: "in_seal"']
]) {
  test(`rejects signing material change evidence when ${label}`, async t => {
    assertRejected(await fixture(t, { [target]: text => editFunction(text, name, original, changed) }));
  });
}

test("requires the enabled confirmation opening action in the page template", async t => {
  assertRejected(await fixture(t, { pageEdit: text => {
    const click = '@click="requestSigningMaterialChange"';
    assert.ok(text.includes(click));
    return text.replace(click, '@click="requestContractSealCompletion"');
  } }));
});

test("rejects a same-name local substitute for the imported command", async t => {
  assertRejected(await fixture(t, { pageEdit: text => {
    const imported = "  executeContractSigningMaterialChange,";
    assert.ok(text.includes(imported));
    return text.replace(imported, "  executeContractSigningMaterialChange as originalMaterialChange,")
      .replace("function confirmSigningMaterialChange(",
        "const executeContractSigningMaterialChange = (input: unknown) => originalMaterialChange(input);\nfunction confirmSigningMaterialChange(");
  } }));
});

test("rejects a public contract detail GET as the capability source", async t => {
  assertRejected(await fixture(t, { routeEdit: route => route.normalizedKey === "GET /contracts/:param" ? {
    ...route, authentication: "public", isPublic: true, guardAuthorization: "public"
  } : route }));
});

test("retains the authorization compatibility check for the fresh contract detail GET", async t => {
  const action = materialAction(await fixture(t, { routeEdit: route => route.normalizedKey === "GET /contracts/:param" ? {
    ...route, guardAuthorization: "project_action", requiredProjectAction: "contract.create"
  } : route }));
  assert.equal(action.capability.serverDerived, false);
  for (const binding of action.bindings) {
    assert.equal(binding.causalVerified, true);
    assert.deepEqual(binding.acceptedProductionConsumers, []);
  }
});

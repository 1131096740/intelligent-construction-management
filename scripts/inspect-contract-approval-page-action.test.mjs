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
const ids = ["contract-approval.review-approve", "contract-approval.review-reject", "contract-approval.withdraw"];
const registryPath = "docs/product/manifests/web-page-actions.registry.json";
const webManifestPath = "docs/product/manifests/web-api-wrappers.json";
const nestManifestPath = "docs/product/manifests/nest-business-routes.json";
const source = path => readFile(join(sourceRoot, path), "utf8");
const fromSource = async path => JSON.parse(await source(path));

async function fixture(t, { pageEdit = text => text, apiEdit = text => text, routeEdit = route => route } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-approval-page-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, data) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof data === "string" ? data : JSON.stringify(data));
  };
  const registry = await fromSource(registryPath);
  const webManifest = await fromSource(webManifestPath);
  const nestManifest = await fromSource(nestManifestPath);
  const names = ["fetchContractDetail", "executeContractApprovalReviewAction", "executeContractApprovalWithdrawalAction"];
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
    write(registryPath, { schemaVersion: 1, actions: registry.actions.filter(row => ids.includes(row.id)) }),
    write(webManifestPath, { schemaVersion: 1, status: "ready", wrappers, blockers: {}, authTransportExceptions: [],
      evidence: { productionModuleCount: 8, reachableProductionModuleCount: 8 }, scope: webManifest.scope }),
    write(nestManifestPath, { schemaVersion: 1, authorizationScope: "guard_metadata_only", routes })
  ]);
  return inspectWholeSitePageActionManifest({ root });
}

test("certifies approval, rejection and withdrawal from a fresh contract and the same approval round", async t => {
  const manifest = await fixture(t);
  for (const id of ids) {
    const action = manifest.actions.find(row => row.id === id);
    assert.equal(action.trigger.kind, "event", id);
    assert.equal(action.capability.serverDerived, true, id);
    assert.equal(action.capability.dominatesTrigger, true, id);
    assert.equal(action.bindings[0].causalVerified, true, id);
    assert.deepEqual(action.bindings[0].acceptedProductionConsumers, [page], JSON.stringify(manifest.blockers));
  }
});

function editFunction(text, name, original, changed) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = text.indexOf("\n}", start);
  const body = text.slice(start, end);
  assert.ok(body.includes(original), `${name}: ${original}`);
  return text.slice(0, start) + body.replace(original, changed) + text.slice(end);
}

const reviewIds = ids.slice(0, 2);
const withdrawalIds = ids.slice(2);
for (const [label, target, name, original, changed, affected] of [
  ["another GET contract coordinate", "apiEdit", "prepareContractApprovalReviewAction", "context.routeContractId", "context.contractVersionId", reviewIds],
  ["ignored current version", "apiEdit", "assertContractApprovalReviewPreflight", "preflight.contractVersionId !== context.contractVersionId", "false", reviewIds],
  ["ignored server enabled action", "apiEdit", "assertContractApprovalWithdrawalPreflight", 'action.key === "withdraw_approval" && action.enabled', 'action.key === "withdraw_approval"', withdrawalIds],
  ["wrong approval instance check", "apiEdit", "assertContractApprovalWithdrawalPreflight", "context.expectedApprovalInstanceId", "context.contractVersionId", withdrawalIds],
  ["skipped current guard before sending", "apiEdit", "executeContractApprovalReviewAction", "!input.current(frozenCapturedContext, prepared)", "false", reviewIds],
  ["POST writes another contract version", "apiEdit", "executeContractApprovalWithdrawalAction", "activeContext.contractVersionId", "activeContext.contractId", withdrawalIds],
  ["payload drops the reviewed approval node", "apiEdit", "contractApprovalReviewActionPayload", "expectedNodeIndex: context.expectedNodeIndex", "expectedNodeIndex: 0", reviewIds],
  ["normalized freeze substitutes the approval revision", "apiEdit", "normalizeContractApprovalWithdrawalAction", "input.expectedApprovalUpdatedAt.trim()", "input.expectedContractUpdatedAt.trim()", withdrawalIds],
  ["approve confirmation captures rejection", "pageEdit", "confirmContractReviewApprove", 'captureContractReviewContext("approve", values.password)', 'captureContractReviewContext("reject", values.password)', ids.slice(0, 1)],
  ["withdrawal uses an unbound current callback", "pageEdit", "confirmContractWithdrawal", "current: contractWithdrawalSubmissionIsCurrent", "current: () => true", withdrawalIds],
  ["review capture drops its saved approval instance", "pageEdit", "captureContractReviewContext", "expectedApprovalInstanceId: dialog.expectedApprovalInstanceId", "expectedApprovalInstanceId: dialog.contractVersionId", reviewIds]
]) {
  test(`rejects approval evidence with ${label}`, async t => {
    const manifest = await fixture(t, { [target]: text => editFunction(text, name, original, changed) });
    for (const id of affected) {
      const action = manifest.actions.find(row => row.id === id);
      assert.equal(action.capability.dominatesTrigger, false, id);
      assert.equal(action.bindings[0].causalVerified, false, id);
      assert.deepEqual(action.bindings[0].acceptedProductionConsumers, [], id);
    }
    for (const id of ids.filter(id => !affected.includes(id))) {
      const action = manifest.actions.find(row => row.id === id);
      assert.equal(action.capability.dominatesTrigger, true, id);
    }
  });
}

test("requires the preflight callback's real imported binding", async t => {
  const manifest = await fixture(t, { pageEdit: text => {
    const imported = "  prepareContractApprovalReviewAction,";
    assert.ok(text.includes(imported));
    return text.replace(imported, "  prepareContractApprovalReviewAction as originalPrepareReview,")
      .replace("function confirmContractReviewApprove(", "const prepareContractApprovalReviewAction = (input: unknown) => originalPrepareReview(input);\nfunction confirmContractReviewApprove(");
  } });
  for (const id of reviewIds) {
    const action = manifest.actions.find(row => row.id === id);
    assert.equal(action.bindings[0].causalVerified, false, id);
    assert.equal(action.capability.dominatesTrigger, false, id);
  }
});

test("retains the existing authorization compatibility gate for a fresh GET", async t => {
  const manifest = await fixture(t, { routeEdit: route => route.normalizedKey === "GET /contracts/:param" ? {
    ...route, guardAuthorization: "project_action", requiredProjectAction: "contract.create"
  } : route });
  for (const id of ids) {
    const action = manifest.actions.find(row => row.id === id);
    assert.equal(action.bindings[0].causalVerified, true, id);
    assert.equal(action.capability.serverDerived, false, id);
    assert.deepEqual(action.bindings[0].acceptedProductionConsumers, [], id);
  }
});

test("rejects a public detail GET as an approval capability source", async t => {
  const manifest = await fixture(t, { routeEdit: route => route.normalizedKey === "GET /contracts/:param" ? {
    ...route, authentication: "public", isPublic: true, guardAuthorization: "public"
  } : route });
  for (const id of ids) {
    const action = manifest.actions.find(row => row.id === id);
    assert.equal(action.bindings[0].causalVerified, false, id);
    assert.equal(action.capability.serverDerived, false, id);
  }
});

test("requires the approval dialog itself to belong to the current contract route", async t => {
  const manifest = await fixture(t, { pageEdit: text => editFunction(
    text, "currentContractReviewDialogContext", "capability.id !== routeId", "false"
  ) });
  for (const id of reviewIds) {
    const action = manifest.actions.find(row => row.id === id);
    assert.equal(action.bindings[0].causalVerified, false, id);
  }
});

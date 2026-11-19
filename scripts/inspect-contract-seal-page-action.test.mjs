import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web-admin/src";
const section = `${web}/pages/contracts/ContractSignedArchiveSection.vue`;
const composable = `${web}/pages/contracts/use-contract-signed-archive.ts`;
const detail = `${web}/pages/contracts/ContractDetailPage.vue`;
const api = `${web}/api/core-flow-read.api.ts`;
const confirmId = "contract-seal-v2.confirm";
const resumeId = "contract-seal-v2.resume-original";
const lookupId = "contract-seal-v2.lookup-original";
const writeWrapper = "confirmContractSealV2";
const createAction = (id, element, event, handler, writing = true) => ({
  id, usage: "page_action", routePaths: ["/合同管理/:contractId"], sourceFile: section,
  trigger: { element, event, handler },
  semantic: writing ? "business_write" : "read_only",
  capability: writing ? { kind: "server_boolean", source: "v2Lifecycle.sealAction.eligible" }
    : { kind: "none", source: "localStorage.sealIntent" },
  wrappers: [{ apiFile: api, name: writing ? writeWrapper : "fetchContractDetail" }]
});
const actions = [
  createAction(confirmId, "t-dialog", "confirm", "submitSeal"),
  createAction(resumeId, "t-dialog", "confirm", "submitSealContinue"),
  createAction(lookupId, "t-button", "click", "querySeal", false)
];

async function fixture(t, { entries = actions, edits = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-seal-page-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(sourceRoot, web), join(root, web), { recursive: true });
  for (const path of [
    "docs/product/manifests/web-api-wrappers.json",
    "docs/product/manifests/nest-business-routes.json",
    "packages/shared-domain/src/permissions.ts"
  ]) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(sourceRoot, path), target);
  }
  await writeFile(join(root, "docs/product/manifests/web-page-actions.registry.json"),
    JSON.stringify({ schemaVersion: 1, actions: entries }));
  for (const [path, from, to] of edits) {
    const target = join(root, path);
    const original = await readFile(target, "utf8");
    assert.equal(original.split(from).length, 2, path);
    await writeFile(target, original.replace(from, to));
  }
  return inspectWholeSitePageActionManifest({ root });
}

function actionFor(manifest, id) {
  const action = manifest.actions.find(entry => entry.id === id);
  assert.ok(action, id);
  return action;
}

function sealUncovered(manifest) {
  return manifest.blockers.uncoveredMutationWrappers.some(blocker =>
    blocker.wrapper === writeWrapper && blocker.sourceFile === composable);
}

test("binds both seal POSTs to separate fresh proofs and keeps lookup GET only", async t => {
  const manifest = await fixture(t);
  for (const id of [confirmId, resumeId]) {
    const action = actionFor(manifest, id);
    assert.equal(action.capability.serverDerived, true, id);
    assert.equal(action.capability.dominatesTrigger, true, id);
    assert.deepEqual(action.bindings.map(binding => [binding.normalizedKey, binding.causalVerified]), [
      ["POST /contracts/:param/seal-confirmation", true]
    ]);
  }
  assert.deepEqual(actionFor(manifest, lookupId).bindings.map(binding => [binding.normalizedKey, binding.causalVerified]), [
    ["GET /contracts/:param", true]
  ]);
  assert.equal(sealUncovered(manifest), false);
});

test("one successful write action cannot cover the shared seal consumer", async t => {
  const manifest = await fixture(t, { entries: actions.filter(action => action.id !== resumeId) });
  assert.equal(actionFor(manifest, confirmId).bindings[0].causalVerified, true);
  assert.equal(sealUncovered(manifest), true);
});

test("first confirmation remains certified but cannot cover a continuation that skips the original GET", async t => {
  const manifest = await fixture(t, { edits: [[composable,
    "if (await readSeal(intent, started) || !current(started)) return;",
    "if (!current(started)) return;"
  ]] });
  assert.equal(actionFor(manifest, confirmId).bindings[0].causalVerified, true);
  assert.equal(actionFor(manifest, resumeId).bindings[0].causalVerified, false);
  assert.equal(actionFor(manifest, lookupId).bindings[0].causalVerified, true);
  assert.equal(sealUncovered(manifest), true);
});

test("continuation remains certified but cannot cover a first confirmation that skips saving the original intent", async t => {
  const manifest = await fixture(t, { edits: [[composable,
    'persist("seal", intent); sealIntent.value = intent;',
    "sealIntent.value = intent;"
  ]] });
  assert.equal(actionFor(manifest, confirmId).bindings[0].causalVerified, false);
  assert.equal(actionFor(manifest, resumeId).bindings[0].causalVerified, true);
  assert.equal(sealUncovered(manifest), true);
});

for (const [name, path, from, to] of [
  ["a changed approval round", composable,
    "value.approvalInstanceId === body.expectedApprovalInstanceId",
    'value.approvalInstanceId === "another-round"'],
  ["a changed task", composable, "value.sealTaskId === body.expectedSealTaskId",
    'value.sealTaskId === "another-task"'],
  ["a different restored actor", composable,
    'saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId || !validCoordinates(saved.body)',
    'saved.versionId !== input.detail.value.contractVersionId || !validCoordinates(saved.body)'],
  ["an automatically retried POST", api,
    '}/seal-confirmation`, body, { retryUnauthorized: false, responseIsCurrent }',
    '}/seal-confirmation`, body, { responseIsCurrent }'],
  ["a stale response callback", composable,
    'try { await confirmContractSealV2(intent.versionId, intent.body, () => current(started)); } catch { /* Recovery only reads the original task. */ }',
    'try { await confirmContractSealV2(intent.versionId, intent.body, () => true); } catch { /* Recovery only reads the original task. */ }']
]) {
  test(`seal write proof rejects ${name}`, async t => {
    const manifest = await fixture(t, { edits: [[path, from, to]] });
    assert.equal(actionFor(manifest, confirmId).bindings[0].causalVerified, false);
    assert.equal(sealUncovered(manifest), true);
  });
}

test("lookup rejects a write injected into the parent completion callback", async t => {
  const manifest = await fixture(t, { edits: [[detail,
    "v2ConfirmedReceipt.value = { ...completion, routeContractId: routeContractId() };",
    "v2ConfirmedReceipt.value = { ...completion, routeContractId: routeContractId() }; void confirmContractArchive(completion.versionId);"
  ]] });
  assert.equal(actionFor(manifest, lookupId).bindings[0].causalVerified, false);
});

test("lookup rejects a changed version in the original task read", async t => {
  const manifest = await fixture(t, { edits: [[composable,
    'async function readSeal(intent: SealIntent, started: OperationScope) {\n    const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });',
    'async function readSeal(intent: SealIntent, started: OperationScope) {\n    const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: "another-version" });'
  ]] });
  assert.equal(actionFor(manifest, lookupId).bindings[0].causalVerified, false);
});

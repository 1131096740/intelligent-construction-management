import assert from "node:assert/strict";
import {
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectWholeSitePageActionManifest,
  renderWholeSitePageActionManifest,
  verifyDocumentContentCoordinatesFunctionSource,
  verifyFinalContractDraftRevisionGuardSource,
  verifyFinalContractWriteGuardSequence,
  verifySameDocumentContentFunctionSource,
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
    contractCutoverLegacyWrite: false,
    contractCutoverTombstoneWrite: false
  };
}

function wrapper({
  apiFile = "apps/web-admin/src/api/example.api.ts",
  name = "submitExample",
  normalizedKey = "POST /examples/:param/submission",
  productionConsumers = [
    "apps/web-admin/src/pages/ExamplePage.vue"
  ],
  requests,
  returnProvenance
} = {}) {
  const [method, path] = normalizedKey.split(" ");
  return {
    name,
    apiFile,
    kind: "transport",
    ...(returnProvenance
      ? { returnProvenance }
      : {}),
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
    normalizedKey: "GET /examples/:param",
    returnProvenance: "transparent_main_response"
  });
}

function definitionReadWrapper({
  normalizedKey = "GET /examples/:param"
} = {}) {
  return wrapper({
    name: "fetchBusinessEntryDefinition",
    normalizedKey,
    returnProvenance: "transparent_main_response"
  });
}

function serverDefinitionAction(overrides = {}) {
  return registryAction({
    trigger: {
      element: "t-button",
      event: "click",
      handler: "submit"
    },
    capability: {
      kind: "server_definition",
      source: "definition.key",
      freshRead: {
        apiFile: "apps/web-admin/src/api/example.api.ts",
        name: "fetchBusinessEntryDefinition",
        method: "GET",
        mode: "read_only_probe",
        binding: {
          actor: "actor",
          company: "company",
          scene: "scene",
          action: "action",
          definitionRevision: "definitionRevision"
        },
        submissionTarget: "independent"
      }
    },
    ...overrides
  });
}

function serverDefinitionPage({
  gate = "definition?.key",
  handlerRead = true,
  readExpression = `fetchBusinessEntryDefinition(
    "example",
    { scope: "global" },
    { entityType: "example", entityId: "example-1" }
  )`
} = {}) {
  return `<script setup lang="ts">
import { ref } from "vue";
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
const definition = ref(null);
async function load() {
  definition.value = await ${readExpression};
}
void load();
async function submit() {
  ${handlerRead ? `await ${readExpression};` : ""}
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="${gate}" @click="submit">提交</t-button>
</template>
`;
}

async function serverDefinitionFixture(options = {}) {
  return fixture({
    actions: [serverDefinitionAction()],
    wrappers: [
      wrapper(),
      definitionReadWrapper()
    ],
    routes: [route()],
    extraFiles: {
      "apps/web-admin/src/api/example.api.ts": `export async function fetchBusinessEntryDefinition() {
  return { key: "example", version: 1, fields: [], rules: [] };
}
export async function submitExample() { return undefined; }
`,
      ...(options.extraFiles ?? {})
    },
    page: serverDefinitionPage(options),
    ...options.fixtureOverrides
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
  pagePath = "apps/web-admin/src/pages/ExamplePage.vue",
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
  await write(root, pagePath, page);
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
  await write(
    root,
    "packages/shared-domain/src/permissions.ts",
    `export const ACTION_REQUIRED_ROLES = {
  "contract.create": ["contract_staff", "contract_director"],
  "project.affiliate_company_contract.confirm": ["contract_director"]
} as const;\n`
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

async function authoritySnapshotFixture(t, actionId = null) {
  const root = await mkdtemp(join(tmpdir(), "jgzg-authority-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(
    join(process.cwd(), "apps/web-admin/src"),
    join(root, "apps/web-admin/src"),
    { recursive: true }
  );
  for (const path of [
    "docs/product/manifests/web-api-wrappers.json",
    "docs/product/manifests/nest-business-routes.json",
    "docs/product/manifests/web-page-actions.registry.json",
    "packages/shared-domain/src/permissions.ts"
  ]) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(process.cwd(), path), target);
  }
  if (actionId) {
    const registryPath = join(root, "docs/product/manifests/web-page-actions.registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.actions = registry.actions.filter((action) => action.id === actionId);
    assert.equal(registry.actions.length, 1);
    await writeFile(registryPath, JSON.stringify(registry));
  }
  return root;
}

test("accepts governed contract draft and final-file write chains", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const manifest = await inspectWholeSitePageActionManifest({ root });

  for (const {
    actionId,
    consumer
  } of [
    {
      actionId: "contract-draft.delete-pristine",
      consumer:
        "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts"
    },
    {
      actionId: "contract-draft.abandon-application",
      consumer:
        "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts"
    },
    {
      actionId: "contract-final.upload-file",
      consumer:
        "apps/web-admin/src/pages/contracts/ContractDetailPage.vue"
    },
    {
      actionId: "contract-archive.upload-file",
      consumer:
        "apps/web-admin/src/pages/contracts/ContractDetailPage.vue"
    },
    {
      actionId: "contract-final.associate",
      consumer:
        "apps/web-admin/src/pages/contracts/ContractDetailPage.vue"
    }
  ]) {
    const action = manifest.actions.find(
      (candidate) => candidate.id === actionId
    );
    assert.ok(action, actionId);
    assert.equal(action.capability.serverDerived, true, actionId);
    assert.equal(action.capability.dominatesTrigger, true, actionId);
    assert.ok(
      action.bindings.every((binding) => binding.causalVerified),
      actionId
    );
    assert.deepEqual(
      action.bindings.flatMap((binding) => binding.acceptedProductionConsumers),
      action.bindings.map(() => consumer),
      actionId
    );
  }
});

test("rejects tampered contract lifecycle and final-file write chains", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const workbenchPath = join(
    root,
    "apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue"
  );
  const workbenchSource = await readFile(workbenchPath, "utf8");
  const wrongCommand = workbenchSource.replace(
    "const outcome = await lifecycle.commands.deletePristineDraft(request);",
    "const outcome = await lifecycle.commands.abandonApplication(request);"
  );
  const shadowedLifecycle = wrongCommand.replace(
    `async function confirmAbandonApplication(request: {
  reason: string;
  password: string;
}) {
  const outcome = await lifecycle.commands.abandonApplication(request);`,
    `async function confirmAbandonApplication(request: {
  reason: string;
  password: string;
}) {
  const lifecycle = {
    commands: {
      abandonApplication: draft.lifecycle.commands.deletePristineDraft
    }
  };
  const outcome = await lifecycle.commands.abandonApplication(request);`
  );
  assert.notEqual(shadowedLifecycle, workbenchSource);
  await writeFile(workbenchPath, shadowedLifecycle);

  const detailPath = join(
    root,
    "apps/web-admin/src/pages/contracts/ContractDetailPage.vue"
  );
  const detailSource = await readFile(detailPath, "utf8");
  const shadowedHelper = detailSource.replace(
    "  const currentContent = documentContentCoordinatesFromValues(",
    `  const sameDocumentContent = () => true;
  const currentContent = documentContentCoordinatesFromValues(`
  );
  const removedTerminalWrapper = shadowedHelper.replace(
    "  return uploadMutuallySignedContract(contractVersionId, {",
    "  return Promise.resolve({"
  );
  assert.notEqual(removedTerminalWrapper, detailSource);
  await writeFile(detailPath, removedTerminalWrapper);

  const manifest = await inspectWholeSitePageActionManifest({ root });
  for (const actionId of [
    "contract-draft.delete-pristine",
    "contract-draft.abandon-application",
    "contract-final.upload-file",
    "contract-final.associate"
  ]) {
    const action = manifest.actions.find(
      (candidate) => candidate.id === actionId
    );
    assert.ok(action, actionId);
    assert.equal(action.capability.serverDerived, true, actionId);
    assert.ok(
      action.bindings.every(
        (binding) => !binding.causalVerified
      ),
      actionId
    );
  }
  assert.ok(
    blockerCodes(manifest).has("ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED")
  );
});

test("rejects each missing final-contract write guard", async () => {
  const sourcePath = join(
    process.cwd(),
    "apps/web-admin/src/pages/contracts/ContractDetailPage.vue"
  );
  const fileSource = await readFile(sourcePath, "utf8");
  const handlerSource = (name, nextName) => {
    const start = fileSource.indexOf(`async function ${name}(`);
    const end = fileSource.indexOf(`async function ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, name);
    return fileSource.slice(start, end);
  };
  const sameContentStart = fileSource.indexOf(
    "function sameDocumentContent("
  );
  const sameContentEnd = fileSource.indexOf(
    "const stagedFinalAssociations",
    sameContentStart
  );
  const sameContentSource = fileSource.slice(
    sameContentStart,
    sameContentEnd
  );
  assert.equal(
    verifySameDocumentContentFunctionSource(sameContentSource),
    true
  );
  for (const tampered of [
    sameContentSource.replace(
      "return Boolean(",
      "return true || Boolean("
    ),
    sameContentSource.replace(
      "  return Boolean(",
      "  if (left) return true;\n  return Boolean("
    )
  ]) {
    assert.notEqual(tampered, sameContentSource);
    assert.equal(
      verifySameDocumentContentFunctionSource(tampered),
      false
    );
  }
  const coordinateStart = fileSource.indexOf(
    "function documentContentCoordinatesFromValues("
  );
  const coordinateEnd = fileSource.indexOf(
    "function documentContentCoordinates(",
    coordinateStart
  );
  const coordinateSource = fileSource.slice(
    coordinateStart,
    coordinateEnd
  );
  assert.equal(
    verifyDocumentContentCoordinatesFunctionSource(
      coordinateSource
    ),
    true
  );
  const staleCoordinateSource = coordinateSource.replace(
    `documentContentRevision: Number(documentContentRevision),
    documentContentFingerprint`,
    `documentContentRevision: Number(contractDetail.value?.documentContentRevision),
    documentContentFingerprint: contractDetail.value?.documentContentFingerprint`
  );
  assert.notEqual(staleCoordinateSource, coordinateSource);
  assert.equal(
    verifyDocumentContentCoordinatesFunctionSource(
      staleCoordinateSource
    ),
    false
  );
  const disabledCoordinateGuard = coordinateSource.replace(
    `  if (
    !Number.isInteger(documentContentRevision)`,
    `  if (
    false &&
    !Number.isInteger(documentContentRevision)`
  );
  assert.notEqual(disabledCoordinateGuard, coordinateSource);
  assert.equal(
    verifyDocumentContentCoordinatesFunctionSource(
      disabledCoordinateGuard
    ),
    false
  );

  const associationSource = handlerSource(
    "associateContractFinalFileWithCapability",
    "returnContractFinalFileWithCapability"
  );
  assert.equal(
    verifyFinalContractDraftRevisionGuardSource(
      associationSource
    ),
    true
  );
  const deadGuardSource = associationSource.replace(
    `  if (!Number.isInteger(capability.draftRevision) || Number(capability.draftRevision) < 1) {
    throw new Error("合同聚合修订坐标缺失，请刷新后重试");
  }`,
    `  if (false) {
    if (!Number.isInteger(capability.draftRevision) || Number(capability.draftRevision) < 1) {
      throw new Error("合同聚合修订坐标缺失，请刷新后重试");
    }
  }`
  );
  assert.notEqual(deadGuardSource, associationSource);
  assert.equal(
    verifyFinalContractDraftRevisionGuardSource(
      deadGuardSource
    ),
    false
  );
  const cases = [
    {
      name: "合同编号",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      from: "capability.id === contractId;",
      to: "true;"
    },
    {
      name: "合同版本",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      from: "capability.contractVersionId === contractVersionId;",
      to: "true;"
    },
    {
      name: "服务端动作",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      from: "capability.availableActionKeys.includes(\"upload_final_contract\");",
      to: "true;"
    },
    {
      name: "内容修订",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      fileFrom:
        "left.documentContentRevision === right.documentContentRevision &&",
      fileTo: "true &&"
    },
    {
      name: "内容指纹",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      fileFrom:
        "left.documentContentFingerprint === right.documentContentFingerprint",
      fileTo: "true"
    },
    {
      name: "内容坐标来源",
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability",
      from: "capability.documentContentRevision",
      to: "expectedContent.documentContentRevision"
    },
    {
      name: "聚合修订整数",
      actionId: "contract-final.associate",
      handler: "associateContractFinalFileWithCapability",
      next: "returnContractFinalFileWithCapability",
      from: "Number.isInteger(capability.draftRevision)",
      to: "true"
    },
    {
      name: "聚合修订正数",
      actionId: "contract-final.associate",
      handler: "associateContractFinalFileWithCapability",
      next: "returnContractFinalFileWithCapability",
      from: "Number(capability.draftRevision) < 1",
      to: "false"
    },
    {
      name: "聚合修订传递",
      actionId: "contract-final.associate",
      handler: "associateContractFinalFileWithCapability",
      next: "returnContractFinalFileWithCapability",
      from: "    sourceRevision\n  });",
      to: "    sourceRevision: 1\n  });"
    }
  ];

  for (const fixture of [
    {
      actionId: "contract-final.upload-file",
      handler: "uploadContractFinalPrivateFileWithCapability",
      next: "associateContractFinalFileWithCapability"
    },
    {
      actionId: "contract-final.associate",
      handler: "associateContractFinalFileWithCapability",
      next: "returnContractFinalFileWithCapability"
    }
  ]) {
    assert.equal(
      verifyFinalContractWriteGuardSequence({
        actionId: fixture.actionId,
        handlerSource: handlerSource(fixture.handler, fixture.next),
        fileSource
      }),
      true,
      fixture.actionId
    );
  }

  for (const fixture of cases) {
    const originalHandler = handlerSource(
      fixture.handler,
      fixture.next
    );
    const tamperedHandler = fixture.from
      ? originalHandler.replace(fixture.from, fixture.to)
      : originalHandler;
    const tamperedFile = fixture.fileFrom
      ? fileSource.replace(fixture.fileFrom, fixture.fileTo)
      : fileSource;
    assert.equal(
      verifyFinalContractWriteGuardSequence({
        actionId: fixture.actionId,
        handlerSource: tamperedHandler,
        fileSource: tamperedFile
      }),
      false,
      fixture.name
    );
  }
});

test("guarded workbench load preserves the exact draft authority snapshot", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  for (const id of ["contract-draft.delete-pristine", "contract-draft.abandon-application"]) {
    const action = manifest.actions.find(candidate => candidate.id === id);
    assert.equal(action?.capability.serverDerived, true, id);
    assert.equal(action.capability.dominatesTrigger, true, id);
    assert.ok(action.bindings.every(binding => binding.causalVerified), id);
  }
});

for (const [name, replacement] of [
  ["different call", "fetchContractWorkbench(requestedVersionId)"],
  ["different version", 'fetchContractDraftWorkbench("another-version")']
]) {
  test(`guarded workbench load rejects a ${name} in one branch`, async (t) => {
    const root = await authoritySnapshotFixture(t);
    const sourcePath = join(root, "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts");
    const source = await readFile(sourcePath, "utf8");
    const original = ": fetchContractDraftWorkbench(requestedVersionId));";
    assert.equal(source.split(original).length, 2);
    await writeFile(sourcePath, source.replace(original, `: ${replacement});`));

    const manifest = await inspectWholeSitePageActionManifest({ root });
    for (const id of ["contract-draft.delete-pristine", "contract-draft.abandon-application"]) {
      const action = manifest.actions.find(candidate => candidate.id === id);
      assert.equal(action?.capability.serverDerived, false, id);
      assert.ok(manifest.blockers.unresolvedWrappers.some(item => item.actionId === id));
    }
  });
}

test("draft operation preflight preserves fresh server proof for both request arms", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  for (const id of ["contract-draft.lease-acquire", "contract-draft.manual-save", "contract-workbench.submit"]) {
    const action = manifest.actions.find(candidate => candidate.id === id);
    assert.equal(action?.capability.serverDerived, true, id);
    assert.equal(action.capability.dominatesTrigger, true, id);
    assert.ok(action.bindings.every(binding => binding.causalVerified), id);
  }
});

for (const [name, from, replacement] of [
  ["different GET", ": fetchContractDraftOperationCapabilities(contractVersionId));",
    ": fetchContractDraftWorkbench(contractVersionId));"],
  ["different version", "? fetchContractDraftOperationCapabilities(contractVersionId, { retryUnauthorized: false, responseIsCurrent })",
    '? fetchContractDraftOperationCapabilities("another-version", { retryUnauthorized: false, responseIsCurrent })']
]) {
  test(`draft operation preflight rejects a ${name} in one arm`, async (t) => {
    const root = await authoritySnapshotFixture(t);
    const sourcePath = join(root, "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts");
    const source = await readFile(sourcePath, "utf8");
    assert.equal(source.split(from).length, 2);
    await writeFile(sourcePath, source.replace(from, replacement));

    const manifest = await inspectWholeSitePageActionManifest({ root });
    for (const id of ["contract-draft.lease-acquire", "contract-draft.manual-save", "contract-workbench.submit"]) {
      const action = manifest.actions.find(candidate => candidate.id === id);
      assert.equal(action?.capability.serverDerived, false, id);
      assert.ok(manifest.blockers.unresolvedWrappers.some(item => item.actionId === id));
    }
  });
}

for (const [name, from, replacement] of [
  ["wrong revision", "operationCapabilities.version.draftRevision !== expectedRevision",
    "operationCapabilities.version.draftRevision !== 1"],
  ["skipped permission guard", "!operationCapabilities.draftOperationAvailableActions.includes(operation)",
    "false"],
  ["different write version", "return acquireContractDraftEditLease(contractVersionId);",
    'return acquireContractDraftEditLease("another-version");']
]) {
  test(`draft operation preflight rejects ${name}`, async (t) => {
    const root = await authoritySnapshotFixture(t);
    const sourcePath = join(root, "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts");
    const source = await readFile(sourcePath, "utf8");
    assert.equal(source.split(from).length, 2);
    await writeFile(sourcePath, source.replace(from, replacement));

    const manifest = await inspectWholeSitePageActionManifest({ root });
    const id = "contract-draft.lease-acquire";
    const action = manifest.actions.find(candidate => candidate.id === id);
    assert.equal(action?.capability.serverDerived, false);
    assert.ok(manifest.blockers.unresolvedWrappers.some(item => item.actionId === id));
  });
}

test("draft operation preflight rejects skipping submission content verification", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const sourcePath = join(root, "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts");
  const source = await readFile(sourcePath, "utf8");
  const check = "current.version.documentContentFingerprint !== payload.documentContentFingerprint";
  assert.equal(source.split(check).length, 2);
  await writeFile(sourcePath, source.replace(check, "false"));

  const manifest = await inspectWholeSitePageActionManifest({ root });
  const id = "contract-workbench.submit";
  const action = manifest.actions.find(candidate => candidate.id === id);
  assert.equal(action?.capability.serverDerived, false);
  assert.ok(manifest.blockers.unresolvedWrappers.some(item => item.actionId === id));
});

test("draft creation derives authority for both writes from the same project GET", async (t) => {
  const root = await authoritySnapshotFixture(t, "contract-draft.create");
  const manifest = await inspectWholeSitePageActionManifest({ root });
  const [action] = manifest.actions;
  assert.equal(action?.id, "contract-draft.create");
  assert.equal(action.capability.serverDerived, true);
  assert.equal(action.capability.dominatesTrigger, true);
  assert.equal(action.bindings.length, 1);
  assert.equal(action.bindings[0].causalVerified, true);
});

for (const [name, original, replacement] of [
  ["a different guarded GET project",
    "fetchContractCreateCapabilities(payload.projectId, { retryUnauthorized: false",
    'fetchContractCreateCapabilities("different-project", { retryUnauthorized: false'],
  ["a different returned project coordinate",
    "capability.projectId === payload.projectId",
    'capability.projectId === "different-project"'],
  ["a different write project",
    "return createWorkbenchDraft(payload, direct.current);",
    'return createWorkbenchDraft({ ...payload, projectId: "different-project" }, direct.current);'],
  ["a missing upward permission check",
    'upward && !capability.availableActions.includes("create_upward_direct_draft")',
    "false"],
  ["an unguarded generic GET",
    `await (direct
    ? fetchContractCreateCapabilities(payload.projectId, { retryUnauthorized: false, responseIsCurrent: direct.current }, upward ? "upward" : undefined)
    : fetchContractCreateCapabilities(payload.projectId))`,
    'await fetchContractCreateCapabilities("different-project")']
]) {
  test(`draft creation rejects ${name}`, async (t) => {
    const root = await authoritySnapshotFixture(t, "contract-draft.create");
    const sourcePath = join(root, "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts");
    const source = await readFile(sourcePath, "utf8");
    assert.equal(source.split(original).length, 2);
    await writeFile(sourcePath, source.replace(original, replacement));

    const manifest = await inspectWholeSitePageActionManifest({ root });
    const [action] = manifest.actions;
    assert.equal(action?.id, "contract-draft.create");
    assert.equal(action.capability.serverDerived, false);
    assert.equal(action.capability.dominatesTrigger, false);
    assert.equal(action.bindings[0].causalVerified, false);
  });
}

test("rejects a replaced server read before authority snapshot capture", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const sourcePath = join(
    root,
    "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts"
  );
  const source = await readFile(sourcePath, "utf8");
  const tampered = source.replace(
    "    workbenchReceipt.value = structuredClone(result);",
    `    result.availableActions = [];
    result = { availableActions: [] };
    workbenchReceipt.value = structuredClone(result);`
  );
  assert.notEqual(tampered, source);
  await writeFile(sourcePath, tampered);

  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  const action = manifest.actions.find(
    (candidate) => candidate.id === "contract-draft.delete-pristine"
  );
  assert.equal(action?.capability.serverDerived, false);
});

test("rejects a mutation below the authority snapshot receipt", async (t) => {
  const root = await authoritySnapshotFixture(t);
  const sourcePath = join(
    root,
    "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts"
  );
  const source = await readFile(sourcePath, "utf8");
  const tampered = source.replace(
    "    workbenchReceipt.value = structuredClone(result);",
    `    workbenchReceipt.value = structuredClone(result);
    workbenchReceipt.value.availableActions.push({
      key: "delete_pristine_draft",
      enabled: true
    });`
  );
  assert.notEqual(tampered, source);
  await writeFile(sourcePath, tampered);

  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  const action = manifest.actions.find(
    (candidate) => candidate.id === "contract-draft.delete-pristine"
  );
  assert.equal(action?.capability.serverDerived, false);
});

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

test("rejects a capability GET whose actor positions cannot perform the mutation action", async () => {
  const mutationRoute = {
    ...route(),
    requiredProjectAction:
      "project.affiliate_company_contract.confirm"
  };
  const capabilityRoute = {
    ...route("GET /examples/:param"),
    handler: "get",
    guardAuthorization: "positions",
    requiredPositions: ["contract_staff"],
    requiredProjectAction: null
  };
  const root = await fixture({
    routes: [mutationRoute, capabilityRoute]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.actions[0].capability.serverDerived,
    false
  );
  assert.equal(
    manifest.summary.acceptedProductionMutationConsumerCount,
    0
  );
  assert.ok(
    blockerCodes(manifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
  assert.equal(
    manifest.blockers.writeWithoutServerCapability[0]?.reason,
    "capability_get_authorization_incompatible"
  );
});

test("rejects partial GET actor overlap with an OR-role mutation action", async () => {
  const capabilityRoute = {
    ...route("GET /examples/:param"),
    handler: "get",
    guardAuthorization: "positions",
    requiredPositions: ["contract_director"],
    requiredProjectAction: null
  };
  const root = await fixture({
    routes: [route(), capabilityRoute]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.actions[0].capability.serverDerived,
    false
  );
  assert.equal(
    manifest.blockers.writeWithoutServerCapability[0]?.reason,
    "capability_get_authorization_incompatible"
  );
});

test("checks position-only mutation actors without requiring a project action", async () => {
  const mutationRoute = {
    ...route(),
    guardAuthorization: "positions",
    requiredPositions: ["contract_staff", "contract_director"],
    requiredProjectAction: null
  };
  const capabilityRoute = {
    ...route("GET /examples/:param"),
    handler: "get",
    guardAuthorization: "positions",
    requiredPositions: ["contract_director"],
    requiredProjectAction: null
  };
  const root = await fixture({
    routes: [mutationRoute, capabilityRoute]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.blockers.writeWithoutServerCapability[0]?.reason,
    "capability_get_authorization_incompatible"
  );
});

test("intersects every sequential mutation route actor set", async () => {
  const fileRoute = {
    ...route("POST /files"),
    handler: "upload",
    guardAuthorization: "authenticated_only",
    requiredProjectAction: null
  };
  const restrictedRoute = route();
  const requests = [
    {
      kind: "main",
      sourceLine: 1,
      method: "POST",
      path: "/files",
      normalizedPath: "/files",
      normalizedKey: "POST /files",
      bodyKind: "form_data"
    },
    {
      kind: "main",
      sourceLine: 2,
      method: "POST",
      path: "/examples/:param/submission",
      normalizedPath: "/examples/:param/submission",
      normalizedKey: "POST /examples/:param/submission",
      bodyKind: "json"
    }
  ];
  const root = await fixture({
    wrappers: [wrapper({ requests })],
    routes: [fileRoute, restrictedRoute]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(
    manifest.actions[0].capability.serverDerived,
    true
  );
  assert.equal(
    manifest.summary.acceptedProductionMutationConsumerCount,
    1
  );
});

test("fails closed when sequential mutation actor sets have an empty intersection", async () => {
  const requests = [
    {
      kind: "main",
      sourceLine: 1,
      method: "POST",
      path: "/examples/:param/submission",
      normalizedPath: "/examples/:param/submission",
      normalizedKey: "POST /examples/:param/submission",
      bodyKind: "json"
    },
    {
      kind: "main",
      sourceLine: 2,
      method: "POST",
      path: "/examples/:param/confirmation",
      normalizedPath: "/examples/:param/confirmation",
      normalizedKey: "POST /examples/:param/confirmation",
      bodyKind: "json"
    }
  ];
  const firstRoute = {
    ...route(),
    guardAuthorization: "positions",
    requiredPositions: ["contract_staff"],
    requiredProjectAction: null
  };
  const secondRoute = {
    ...route("POST /examples/:param/confirmation"),
    handler: "confirm",
    guardAuthorization: "positions",
    requiredPositions: ["contract_director"],
    requiredProjectAction: null
  };
  const root = await fixture({
    wrappers: [wrapper({ requests })],
    routes: [firstRoute, secondRoute]
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.actions[0].capability.serverDerived,
    false
  );
  assert.equal(
    manifest.blockers.writeWithoutServerCapability[0]?.reason,
    "capability_get_authorization_incompatible"
  );
});

test("fails closed when the shared action-role policy cannot be resolved", async () => {
  const root = await fixture({
    extraFiles: {
      "packages/shared-domain/src/permissions.ts":
        "export const ACTION_REQUIRED_ROLES = makePolicy();\n"
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.summary.acceptedProductionMutationConsumerCount,
    0
  );
  assert.ok(
    blockerCodes(manifest).has("ACTION_ROLE_POLICY_UNRESOLVED")
  );
});

test("fails closed when an alias mutates the shared action-role policy", async () => {
  const root = await fixture({
    extraFiles: {
      "packages/shared-domain/src/permissions.ts": `
        export const ACTION_REQUIRED_ROLES = {
          "contract.create": ["contract_staff", "contract_director"]
        } as const;
        const contractRoles = ACTION_REQUIRED_ROLES["contract.create"];
        contractRoles.push("contract_director");
      `
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.summary.acceptedProductionMutationConsumerCount,
    0
  );
  assert.ok(
    blockerCodes(manifest).has("ACTION_ROLE_POLICY_UNRESOLVED")
  );
});

test("accepts a selected server string action only through an exact includes gate", async () => {
  const action = registryAction({
    trigger: {
      element: "sensitive-action-dialog",
      event: "confirm",
      handler: "submit"
    },
    capability: {
      kind: "available_action_string",
      source: "selectedActions",
      key: "confirm"
    }
  });
  const page = `<script setup lang="ts">
import { shallowRef } from "vue";
import { getExample, submitExample } from "../api/example.api";
let rawCapability = null;
const selectedActions = shallowRef(null);
let retainedCapability = null;
const selectedContext = shallowRef(null);
async function load() {
  const response = await getExample("example-1");
  rawCapability = response;
  selectedActions.value =
    rawCapability.contracts[0].availableActions;
  retainedCapability = rawCapability;
  const selectedCapability = rawCapability.contracts[0];
  selectedContext.value = {
    contractId: selectedCapability.id
  };
}
void load();
void retainedCapability;
void selectedContext;
function confirmEnabled(key: string) {
  return (
    selectedActions.value !== null &&
    selectedActions.value.includes(key)
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <sensitive-action-dialog
    v-if="confirmEnabled('confirm')"
    @confirm="submit"
  />
</template>
`;
  const root = await fixture({ actions: [action], page });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify({
      action: manifest.actions[0],
      blockers: manifest.blockers
    })
  );
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);

  const localRoot = await fixture({
    actions: [action],
    page: page.replace(
      "selectedActions.value =\n    rawCapability.contracts[0].availableActions;",
      'selectedActions.value = ["confirm"];'
    )
  });
  const localManifest = await inspectWholeSitePageActionManifest({
    root: localRoot
  });

  assert.equal(localManifest.status, "blocked");
  assert.equal(
    localManifest.actions[0].capability.serverDerived,
    false
  );
  assert.equal(
    localManifest.actions[0].capability.dominatesTrigger,
    false
  );

  const unsafeVariants = [
    [
      "wrong action key",
      page.replace(
        "selectedActions.value.includes(key)",
        'selectedActions.value.includes("reject")'
      ),
      true
    ],
    [
      "direct mutation",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  selectedActions.value.push("confirm");'
      ),
      false
    ],
    [
      "alias mutation",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  const selectedAlias = selectedActions.value;\n  selectedAlias[0] = "confirm";'
      ),
      false
    ],
    [
      "projected source mutation",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  rawCapability.contracts[0].availableActions.push("confirm");'
      ),
      false
    ],
    [
      "projected source alias mutation",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  const sourceAlias = rawCapability.contracts[0].availableActions;\n  sourceAlias[0] = "confirm";'
      ),
      false
    ],
    [
      "projected source parameter escape",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  function escape(actions: unknown) { return actions; }\n  escape(rawCapability.contracts[0].availableActions);'
      ),
      false
    ],
    [
      "projected source carrier alias mutation",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  response.contracts[0].availableActions.push("confirm");'
      ),
      false
    ],
    [
      "projected source alias later becomes protected",
      page.replace(
        "rawCapability.contracts[0].availableActions;",
        'rawCapability.contracts[0].availableActions;\n  let sourceAlias = rawCapability.contracts[0].displayName;\n  sourceAlias = rawCapability.contracts[0].availableActions;\n  sourceAlias.push("confirm");'
      ),
      false
    ],
    [
      "projected source static dotted key mutation",
      page
        .replaceAll(
          "rawCapability.contracts[0]",
          'rawCapability["contracts.list"][0]'
        )
        .replace(
          'rawCapability["contracts.list"][0].availableActions;',
          'rawCapability["contracts.list"][0].availableActions;\n  rawCapability["contracts.list"][0].availableActions.push("confirm");'
        ),
      false
    ]
  ];
  for (const [
    label,
    unsafePage,
    expectedServerDerived
  ] of unsafeVariants) {
    const unsafeRoot = await fixture({
      actions: [action],
      page: unsafePage
    });
    const unsafeManifest =
      await inspectWholeSitePageActionManifest({
        root: unsafeRoot
      });

    assert.equal(
      unsafeManifest.status,
      "blocked",
      `${label}: ${JSON.stringify(unsafeManifest.actions[0])}`
    );
    assert.equal(
      unsafeManifest.actions[0].capability.serverDerived,
      expectedServerDerived,
      label
    );
    assert.equal(
      unsafeManifest.actions[0].capability.dominatesTrigger,
      false,
      label
    );
  }
});

test("accepts a fail-closed server capability preflight for a background mutation", async () => {
  const action = registryAction({
    id: "example.background",
    usage: "background",
    trigger: {
      element: "module",
      event: "call",
      handler: "submit"
    },
    capability: {
      kind: "available_action_string",
      source: "operationCapabilities.availableActions",
      key: "submit_approval"
    }
  });
  const page = `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
async function submit() {
  const operationCapabilities = await getExample("example-1");
  const operationAllowed = operationCapabilities.availableActions.includes(
    "submit_approval"
  );
  if (!operationAllowed) {
    throw new Error("operation unavailable");
  }
  return submitExample("example-1");
}
void submit;
</script>
<template><div /></template>
`;
  const root = await fixture({ actions: [action], page });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);

  const unsafeRoot = await fixture({
    actions: [action],
    page: page.replace(
      'const operationCapabilities = await getExample("example-1");',
      'const mutation = submitExample("example-1");\n  const operationCapabilities = await getExample("example-1");'
    ).replace(
      'return submitExample("example-1");',
      "return mutation;"
    )
  });
  const unsafe = await inspectWholeSitePageActionManifest({ root: unsafeRoot });
  assert.equal(unsafe.status, "blocked");
  assert.equal(unsafe.actions[0].capability.dominatesTrigger, false);

  const callbackMutationRoot = await fixture({
    actions: [action],
    page: page.replace(
      "  const operationAllowed = operationCapabilities.availableActions.includes(",
      '  operationCapabilities.availableActions.map(() => submitExample("example-1"));\n  const operationAllowed = operationCapabilities.availableActions.includes('
    )
  });
  const callbackMutation = await inspectWholeSitePageActionManifest({
    root: callbackMutationRoot
  });
  assert.equal(callbackMutation.status, "blocked");
  assert.equal(
    callbackMutation.actions[0].capability.dominatesTrigger,
    false
  );
});

test("accepts a local server-derived detail action preflight for a background mutation", async () => {
  const action = registryAction({
    id: "example.background-detail-action",
    usage: "background",
    trigger: {
      element: "module",
      event: "call",
      handler: "submit"
    },
    capability: {
      kind: "detail_action",
      source: "operationCapabilities.availableActions",
      key: "submit_approval"
    }
  });
  const page = `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
async function submit() {
  const operationCapabilities = await getExample("example-1");
  const matchesRequestedExample = operationCapabilities.id === "example-1";
  if (!matchesRequestedExample) {
    throw new Error("operation changed");
  }
  const operationAllowed = operationCapabilities.availableActions.some(
    (action) => action.key === "submit_approval" && action.enabled
  );
  if (!operationAllowed) {
    throw new Error("operation unavailable");
  }
  return submitExample("example-1");
}
void submit;
</script>
<template><div /></template>
`;
  const root = await fixture({ actions: [action], page });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

test("accepts a project definition pipeline only when fresh capability and validated values dominate the write", async () => {
  const businessEntrySource = `
export async function fetchBusinessEntryDefinition(...args) { return args; }
export async function validateBusinessEntryDraft(...args) { return args; }
`;
  const projectExtraFiles = {
    "apps/web-admin/src/api/business-entry.api.ts": businessEntrySource
  };
  const projectWebManifestOverrides = {
    evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
  };
  const action = registryAction({
    id: "example.project-definition-pipeline",
    capability: {
      kind: "server_boolean",
      source: "profile.canManage"
    },
    wrappers: [
      { apiFile: "apps/web-admin/src/api/business-entry.api.ts", name: "validateBusinessEntryDraft" },
      { apiFile: "apps/web-admin/src/api/example.api.ts", name: "submitExample" }
    ]
  });
  const page = `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
import { fetchBusinessEntryDefinition, validateBusinessEntryDraft } from "../api/business-entry.api";
const profile = ref(null);
async function submit() {
  const projectId = "project-1";
  const capability = await getExample(projectId);
  const operationAllowed = capability.canManage;
  if (!operationAllowed) throw new Error("revoked");
  profile.value = capability;
  const definition = await fetchBusinessEntryDefinition("project_profile", { scope: "project", projectId }, { entityType: "project", entityId: projectId }, "edit");
  if (definition.key !== "project_profile") throw new Error("stale");
  const values = { name: "A" };
  const validation = await validateBusinessEntryDraft({ scope: "project", projectId }, { sceneKey: definition.key, definitionVersion: definition.version, target: { entityType: "project", entityId: projectId }, values }, "edit");
  if (!validation.valid) return;
  return submitExample(projectId, { name: validation.values.name });
}
</script><template><t-button v-if="profile.canManage" @click="submit">提交</t-button></template>`;
  const wrappers = [
    wrapper(),
    wrapper({ name: "getExample", normalizedKey: "GET /examples/:param", returnProvenance: "transparent_main_response" }),
    wrapper({ apiFile: "apps/web-admin/src/api/business-entry.api.ts", name: "fetchBusinessEntryDefinition", normalizedKey: "GET /examples/:param/definition", returnProvenance: "transparent_main_response" }),
    wrapper({ apiFile: "apps/web-admin/src/api/business-entry.api.ts", name: "validateBusinessEntryDraft", normalizedKey: "POST /examples/:param/validate", productionConsumers: ["apps/web-admin/src/pages/ExamplePage.vue"] })
  ];
  const routes = [route(), route("GET /examples/:param"), route("GET /examples/:param/definition"), route("POST /examples/:param/validate")];
  const root = await fixture({
    actions: [action], wrappers, routes, page,
    extraFiles: projectExtraFiles,
    webManifestOverrides: projectWebManifestOverrides
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));

  const masterAction = { ...action, capability: { kind: "server_boolean", source: "profile.canManageMasterData" } };
  const masterPage = page.replaceAll("canManage", "canManageMasterData");
  const masterRoot = await fixture({ actions: [masterAction], wrappers, routes, page: masterPage, extraFiles: projectExtraFiles, webManifestOverrides: projectWebManifestOverrides });
  const masterManifest = await inspectWholeSitePageActionManifest({ root: masterRoot });
  assert.equal(masterManifest.status, "ready", JSON.stringify(masterManifest.blockers));
  for (const unsafePage of [
    masterPage.replace("const operationAllowed = capability.canManageMasterData;", "const operationAllowed = true;"),
    masterPage.replace("const operationAllowed = capability.canManageMasterData;", "const operationAllowed = capability.canManage;")
  ]) {
    const unsafeRoot = await fixture({ actions: [masterAction], wrappers, routes, page: unsafePage, extraFiles: projectExtraFiles, webManifestOverrides: projectWebManifestOverrides });
    assert.equal((await inspectWholeSitePageActionManifest({ root: unsafeRoot })).status, "blocked");
  }

  const staleRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      "definitionVersion: definition.version",
      "definitionVersion: 1"
    ),
    extraFiles: projectExtraFiles,
    webManifestOverrides: projectWebManifestOverrides
  });
  const stale = await inspectWholeSitePageActionManifest({ root: staleRoot });
  assert.equal(stale.status, "blocked");

  for (const [name, unsafePage] of [
    ["fresh capability is not rebound to the declared source", page.replace("  profile.value = capability;\n", "")],
    ["capability read uses another project", page.replace("getExample(projectId)", 'getExample("other-project")')],
    ["final write uses another project", page.replace("submitExample(projectId", 'submitExample("other-project"')],
    ["validated result is discarded", page.replace("{ name: validation.values.name }", "{ name: values.name }")],
    ["an unvalidated fallback is mixed into the final field", page.replace(
      "{ name: validation.values.name }",
      "{ name: validation.values.name || values.name }"
    )],
    ["a draft object cannot be indexed by a validated key", page.replace(
      "{ name: validation.values.name }",
      "{ name: values[validation.values.name] }"
    )],
    ["comment cannot forge the final coordinate", page.replace(
      "return submitExample(projectId, { name: validation.values.name });",
      '/* submitExample(projectId, { name: validation.values.name }) */\n  return submitExample("other-project", { name: values.name });'
    )]
  ]) {
    const unsafeRoot = await fixture({
      actions: [action], wrappers, routes, page: unsafePage,
      extraFiles: projectExtraFiles,
      webManifestOverrides: projectWebManifestOverrides
    });
    const unsafe = await inspectWholeSitePageActionManifest({ root: unsafeRoot });
    assert.equal(unsafe.status, "blocked", name);
  }

  const validationOnlyAction = registryAction({
    id: "example.project-definition-validation-only",
    capability: {
      kind: "server_definition",
      source: "definition.key",
      freshRead: {
        apiFile: "apps/web-admin/src/api/business-entry.api.ts",
        name: "fetchBusinessEntryDefinition",
        method: "GET",
        mode: "read_only_probe",
        binding: {
          actor: "fresh actor",
          company: "fresh company",
          scene: "fresh scene",
          action: "fresh action",
          definitionRevision: "fresh definition revision"
        },
        submissionTarget: "independent"
      }
    },
    wrappers: [
      { apiFile: "apps/web-admin/src/api/business-entry.api.ts", name: "validateBusinessEntryDraft" }
    ]
  });
  const validationOnlyPage = `<script setup lang="ts">
import { fetchBusinessEntryDefinition, validateBusinessEntryDraft } from "../api/business-entry.api";
async function submit() {
  const projectId = "project-1";
  const definition = await fetchBusinessEntryDefinition("project_profile", { scope: "project", projectId }, { entityType: "project", entityId: projectId }, "edit");
  if (definition.key !== "project_profile") throw new Error("stale");
  const values = { name: "A" };
  const validation = await validateBusinessEntryDraft({ scope: "project", projectId }, { sceneKey: definition.key, definitionVersion: definition.version, target: { entityType: "project", entityId: projectId }, values }, "edit");
  if (!validation.valid) return;
  return validation.values.name;
}
</script><template><t-button @click="submit">校验</t-button></template>`;
  const validationOnlyRoot = await fixture({
    actions: [validationOnlyAction],
    wrappers: wrappers.filter((item) =>
      ["fetchBusinessEntryDefinition", "validateBusinessEntryDraft"].includes(item.name)
    ),
    routes: routes.filter((item) =>
      ["GET /examples/:param/definition", "POST /examples/:param/validate"].includes(item.normalizedKey)
    ),
    page: validationOnlyPage,
    extraFiles: projectExtraFiles,
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 5 }
    }
  });
  const validationOnly = await inspectWholeSitePageActionManifest({ root: validationOnlyRoot });
  assert.equal(validationOnly.status, "ready", JSON.stringify(validationOnly.blockers));

  const foreignSourceRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      'from "../api/business-entry.api";',
      'from "../api/foreign-business-entry.api";'
    ),
    extraFiles: {
      ...projectExtraFiles,
      "apps/web-admin/src/api/foreign-business-entry.api.ts": businessEntrySource
    },
    webManifestOverrides: {
      evidence: { productionModuleCount: 7, reachableProductionModuleCount: 6 }
    }
  });
  const foreignSource = await inspectWholeSitePageActionManifest({ root: foreignSourceRoot });
  assert.equal(foreignSource.status, "blocked");
});

test("accepts a guarded upload callback only when one voucher result flows into the final write", async () => {
  const action = registryAction({
    id: "example.guarded-upload-pipeline",
    capability: {
      kind: "detail_action",
      source: "detail.availableActions",
      key: "record_refund"
    },
    wrappers: [
      { apiFile: "apps/web-admin/src/api/example.api.ts", name: "uploadExample" },
      { apiFile: "apps/web-admin/src/api/example.api.ts", name: "recordExample" }
    ]
  });
  const helperSource = `export async function prepareWithUpload(file, upload) {
  const voucher = await upload(file, file.name);
  return { voucherFileId: voucher.id, amount: "10" };
}`;
  const page = `<script setup lang="ts">
import { getExample, uploadExample, recordExample } from "../api/example.api";
import { prepareWithUpload } from "./write-validation";
async function submit() {
  const paymentId = "payment-1";
  const procurementId = "procurement-1";
  const detail = await getExample(paymentId);
  if (detail.payment.id !== paymentId || detail.payment.procurement.id !== procurementId) throw new Error("changed");
  const operationAllowed = detail.availableActions.some((action) => action.key === "record_refund" && action.enabled === true);
  if (!operationAllowed) throw new Error("revoked");
  const file = { name: "voucher.png" };
  const payload = await prepareWithUpload(file, (value, name) => uploadExample(paymentId, procurementId, value, name));
  return recordExample(paymentId, procurementId, payload);
}
</script><template><t-button @click="submit">提交</t-button></template>`;
  const wrappers = [
    wrapper({ name: "recordExample" }),
    wrapper({ name: "uploadExample", normalizedKey: "POST /examples/:param/upload", productionConsumers: ["apps/web-admin/src/pages/ExamplePage.vue"] }),
    wrapper({ name: "getExample", normalizedKey: "GET /examples/:param", returnProvenance: "transparent_main_response" })
  ];
  const routes = [route(), route("POST /examples/:param/upload"), route("GET /examples/:param")];
  const root = await fixture({
    actions: [action],
    wrappers,
    routes,
    page,
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));

  const currentTaskAction = {
    ...action,
    capability: {
      ...action.capability,
      source: "detail.currentTask"
    }
  };
  const currentTaskPage = page.replace(
    'detail.availableActions.some((action) => action.key === "record_refund" && action.enabled === true)',
    'detail.currentTask.key === "record_refund" && detail.currentTask.enabled === true'
  );
  const currentTaskRoot = await fixture({
    actions: [currentTaskAction], wrappers, routes, page: currentTaskPage,
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
  });
  const currentTask = await inspectWholeSitePageActionManifest({ root: currentTaskRoot });
  assert.equal(currentTask.status, "ready", JSON.stringify(currentTask.blockers));

  const mismatchedSourceRoot = await fixture({
    actions: [{
      ...currentTaskAction,
      capability: { ...currentTaskAction.capability, source: "detail.availableActions" }
    }],
    wrappers,
    routes,
    page: currentTaskPage,
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
  });
  const mismatchedSource = await inspectWholeSitePageActionManifest({ root: mismatchedSourceRoot });
  assert.equal(mismatchedSource.status, "blocked", "registry source must match the proven current task");

  for (const [name, unsafePage] of [
    ["current task key differs", currentTaskPage.replace(
      'detail.currentTask.key === "record_refund"',
      'detail.currentTask.key === "other"'
    )],
    ["current task is disabled", currentTaskPage.replace(
      "detail.currentTask.enabled === true",
      "detail.currentTask.enabled === false"
    )]
  ]) {
    const unsafeRoot = await fixture({
      actions: [currentTaskAction], wrappers, routes, page: unsafePage,
      webManifestOverrides: {
        evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
      },
      extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
    });
    const unsafe = await inspectWholeSitePageActionManifest({ root: unsafeRoot });
    assert.equal(unsafe.status, "blocked", name);
  }

  const retainedPage = page
    .replace(
      '  const file = { name: "voucher.png" };',
      `  const file = { name: "voucher.png" };
  const attempt = { value: null as null | { paymentId: string; procurementId: string; payload: { voucherFileId: string; amount: string; amountCents: string } } };
  const retained = attempt.value;
  const expected = detail.discrepancy?.refundExpectedAmountCents;
  if (retained && (retained.paymentId !== paymentId || retained.procurementId !== procurementId)) {
    attempt.value = null;
    throw new Error("changed");
  }
  if (retained && retained.payload.amountCents !== expected) {
    attempt.value = null;
    throw new Error("amount changed");
  }`
    )
    .replace(
      "const payload = await prepareWithUpload",
      "const payload = retained?.payload ?? await prepareWithUpload"
    );
  const retainedRoot = await fixture({
    actions: [action], wrappers, routes, page: retainedPage,
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
  });
  const retained = await inspectWholeSitePageActionManifest({ root: retainedRoot });
  assert.equal(retained.status, "ready", JSON.stringify(retained.blockers));

  for (const [name, unsafePage] of [
    ["retained amount is not rebound to the fresh amount", retainedPage.replace(
      "retained.payload.amountCents !== expected",
      'retained.payload.amountCents !== "10"'
    )],
    ["retained coordinate mismatch does not clear the attempt", retainedPage.replace(
      'attempt.value = null;\n    throw new Error("changed");',
      'throw new Error("changed");'
    )]
  ]) {
    const unsafeRoot = await fixture({
      actions: [action], wrappers, routes, page: unsafePage,
      webManifestOverrides: {
        evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
      },
      extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
    });
    const unsafe = await inspectWholeSitePageActionManifest({ root: unsafeRoot });
    assert.equal(unsafe.status, "blocked", name);
  }

  const lostVoucherRoot = await fixture({
    actions: [action], wrappers, routes, page,
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource.replace(
      "return { voucherFileId: voucher.id, amount: \"10\" };",
      "return { voucherFileId: \"detached\", amount: \"10\" };"
      )
    }
  });
  const lostVoucher = await inspectWholeSitePageActionManifest({ root: lostVoucherRoot });
  assert.equal(lostVoucher.status, "blocked");

  const wrongCoordinateRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      "uploadExample(paymentId, procurementId, value, name)",
      'uploadExample("other-payment", procurementId, value, name)'
    ),
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource
    }
  });
  const wrongCoordinate = await inspectWholeSitePageActionManifest({ root: wrongCoordinateRoot });
  assert.equal(wrongCoordinate.status, "blocked");

  const wrongProcurementRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      "recordExample(paymentId, procurementId, payload)",
      'recordExample(paymentId, "other-procurement", payload)'
    ),
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
  });
  const wrongProcurement = await inspectWholeSitePageActionManifest({ root: wrongProcurementRoot });
  assert.equal(wrongProcurement.status, "blocked");

  const disabledActionRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      'action.key === "record_refund" && action.enabled === true',
      'action.key === "record_refund" && action.enabled === false'
    ),
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: { "apps/web-admin/src/pages/write-validation.ts": helperSource }
  });
  const disabledAction = await inspectWholeSitePageActionManifest({ root: disabledActionRoot });
  assert.equal(disabledAction.status, "blocked");

  const duplicateUploadRoot = await fixture({
    actions: [action], wrappers, routes, page,
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource.replace(
        "const voucher = await upload(file, file.name);",
        "await upload(file, file.name);\n  const voucher = await upload(file, file.name);"
      )
    }
  });
  const duplicateUpload = await inspectWholeSitePageActionManifest({ root: duplicateUploadRoot });
  assert.equal(duplicateUpload.status, "blocked");

  const escapedCallbackRoot = await fixture({
    actions: [action], wrappers, routes, page,
    webManifestOverrides: {
      evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource.replace(
        "const voucher = await upload(file, file.name);",
        "const escaped = upload;\n  const voucher = await upload(file, file.name);"
      )
    }
  });
  const escapedCallback = await inspectWholeSitePageActionManifest({ root: escapedCallbackRoot });
  assert.equal(escapedCallback.status, "blocked");

  const unknownHelperRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      'import { prepareWithUpload } from "./write-validation";',
      `async function prepareWithUpload(file, upload) {
  const voucher = await upload(file, file.name);
  return { voucherFileId: voucher.id, amount: "10" };
}`
    ),
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 5,
        reachableProductionModuleCount: 5
      }
    }
  });
  const unknownHelper = await inspectWholeSitePageActionManifest({ root: unknownHelperRoot });
  assert.equal(unknownHelper.status, "blocked");

  const oneWrapperOnlyRoot = await fixture({
    actions: [action], wrappers, routes,
    page: page.replace(
      "return recordExample(paymentId, procurementId, payload);",
      'return recordExample("other-payment", procurementId, payload);'
    ),
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    },
    extraFiles: {
      "apps/web-admin/src/pages/write-validation.ts": helperSource
    }
  });
  const oneWrapperOnly = await inspectWholeSitePageActionManifest({ root: oneWrapperOnlyRoot });
  assert.equal(oneWrapperOnly.status, "blocked");
  assert.equal(
    oneWrapperOnly.actions[0].bindings.find((binding) => binding.wrapper === "recordExample")?.causalVerified,
    false
  );
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

  const mismatchedRoot = await fixture({
    actions: [approve],
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) { return detail.availableActions.some((item) => item.key === key && item.enabled); }
async function review(decision: "approve" | "reject") {
  void decision;
  await submitExample("reject");
}
</script>
<template>
  <t-button v-if="actionEnabled('review_approval')" @click="review('approve')">通过</t-button>
</template>
`
  });
  const mismatched = await inspectWholeSitePageActionManifest({
    root: mismatchedRoot
  });

  assert.equal(mismatched.status, "blocked");
  assert.ok(
    blockerCodes(mismatched).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );
  assert.equal(
    mismatched.actions[0].bindings[0].causalVerified,
    false
  );

  for (const [name, reviewBody] of [
    [
      "reassigned local payload",
      `async function review(decision: "approve" | "reject") {
  let payload = { action: decision };
  payload = { action: "reject" };
  await submitExample(payload);
}`
    ],
    [
      "reassigned member payload",
      `async function review(decision: "approve" | "reject") {
  const payload = { action: decision };
  payload.action = "reject";
  await submitExample(payload);
}`
    ],
    [
      "reassigned alias member payload",
      `async function review(decision: "approve" | "reject") {
  const payload = { action: decision };
  const alias = payload;
  alias.action = "reject";
  await submitExample(payload);
}`
    ],
    [
      "variant only in unrelated analytics field",
      `async function review(decision: "approve" | "reject") {
  await submitExample({
    decision: "reject",
    analytics: { label: decision }
  });
}`
    ],
    [
      "dead branch cannot overwrite the live reject payload",
      `async function review(decision: "approve" | "reject") {
  let payload = { action: "reject" };
  if (false) {
    payload = { action: decision };
  }
  await submitExample(payload);
}`
    ],
    [
      "unknown branch can overwrite a scalar variant",
      `async function review(decision: "approve" | "reject") {
  if (Math.random() > 0.5) {
    decision = "reject";
  }
  await submitExample(decision);
}`
    ],
    [
      "object mutator overwrites the variant",
      `async function review(decision: "approve" | "reject") {
  const payload = { action: decision };
  Object.assign(payload, { action: "reject" });
  await submitExample(payload);
}`
    ],
    [
      "delete removes the variant",
      `async function review(decision: "approve" | "reject") {
  const payload = { action: decision };
  delete payload.action;
  await submitExample(payload);
}`
    ],
    [
      "local helper mutates the variant",
      `function mutate(payload: { action: string }) {
  payload.action = "reject";
}
async function review(decision: "approve" | "reject") {
  const payload = { action: decision };
  mutate(payload);
  await submitExample(payload);
}`
    ],
    [
      "object destructuring overwrites the scalar variant",
      `async function review(decision: "approve" | "reject") {
  ({ decision } = { decision: "reject" });
  await submitExample(decision);
}`
    ],
    [
      "array destructuring overwrites the scalar variant",
      `async function review(decision: "approve" | "reject") {
  [decision] = ["reject"];
  await submitExample(decision);
}`
    ],
    [
      "callback array mutates the captured scalar variant",
      `async function review(decision: "approve" | "reject") {
  const callbacks = [
    () => {
      decision = "reject";
    }
  ];
  callbacks.forEach((callback) => callback());
  await submitExample(decision);
}`
    ],
    [
      "local object method mutates the captured scalar variant",
      `async function review(decision: "approve" | "reject") {
  const helper = {
    mutate() {
      decision = "reject";
    }
  };
  helper.mutate();
  await submitExample(decision);
}`
    ],
    [
      "local object alias method mutates the captured scalar variant",
      `async function review(decision: "approve" | "reject") {
  const helpers = {
    mutate() {
      decision = "reject";
    }
  };
  const alias = helpers;
  alias.mutate();
  await submitExample(decision);
}`
    ],
    [
      "destructured local method mutates the captured scalar variant",
      `async function review(decision: "approve" | "reject") {
  const helpers = {
    mutate() {
      decision = "reject";
    }
  };
  const { mutate } = helpers;
  mutate();
  await submitExample(decision);
}`
    ]
  ]) {
    const bypassRoot = await fixture({
      actions: [approve],
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) { return detail.availableActions.some((item) => item.key === key && item.enabled); }
${reviewBody}
</script>
<template>
  <t-button v-if="actionEnabled('review_approval')" @click="review('approve')">通过</t-button>
</template>
`
    });
    const bypass = await inspectWholeSitePageActionManifest({
      root: bypassRoot
    });
    assert.equal(
      bypass.status,
      "blocked",
      `${name}: ${JSON.stringify(bypass.blockers)}`
    );
    assert.equal(
      bypass.actions[0].bindings[0].causalVerified,
      false,
      name
    );
  }

  const importedCallbackRoot = await fixture({
    actions: [approve],
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
import { runMutation } from "../lib/run-mutation";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (item) => item.key === key && item.enabled
  );
}
async function review(decision: "approve" | "reject") {
  runMutation(() => {
    decision = "reject";
  });
  await submitExample(decision);
}
</script>
<template>
  <t-button
    v-if="actionEnabled('review_approval')"
    @click="review('approve')"
  >
    通过
  </t-button>
</template>
`,
    extraFiles: {
      "apps/web-admin/src/lib/run-mutation.ts":
        `export function runMutation(callback: () => void) {
  callback();
}
`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    }
  });
  const importedCallback =
    await inspectWholeSitePageActionManifest({
      root: importedCallbackRoot
    });
  assert.equal(importedCallback.status, "blocked");
  assert.equal(
    importedCallback.actions[0].bindings[0].causalVerified,
    false
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

for (const codeParameter of ["", ", code"]) {
test(`consumes the exact registered self-profile facade auth transport exception${codeParameter ? " with SMS code" : ""}`, async () => {
  const root = await fixture({
    actions: [
      registryAction({
        id: "user-self-profile.update",
        sourceFile: "apps/web-admin/src/pages/settings/SettingsPage.vue",
        routePaths: ["/example"],
        trigger: {
          element: "t-button",
          event: "click",
          handler: "submitProfile"
        },
        wrappers: [
          {
            apiFile: "apps/web-admin/src/lib/user-self-profile.ts",
            name: "updateProfile"
          }
        ]
      })
    ],
    wrappers: [wrapper({
      name: "getExample",
      normalizedKey: "GET /examples/:param",
      returnProvenance: "transparent_main_response",
      productionConsumers: ["apps/web-admin/src/pages/settings/SettingsPage.vue"]
    })],
    routes: [route("PATCH /auth/profile")],
    pagePath: "apps/web-admin/src/pages/settings/SettingsPage.vue",
    routeRecords: `export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/settings/SettingsPage.vue") }];\n`,
    page: `<script setup lang="ts">
import { getExample } from "../../api/example.api";
import { updateProfile } from "../../lib/user-self-profile";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submitProfile() {
  await updateProfile("A", "13800000000", "password");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submitProfile">保存</t-button>
</template>
`,
    extraFiles: {
      "apps/web-admin/src/lib/user-self-profile.ts": `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword${codeParameter}) { return useAuthStore().updateProfile(name, phone, currentPassword${codeParameter}); }\n`,
      "apps/web-admin/src/auth/auth.store.ts": `export function useAuthStore() { return { updateProfile() { return undefined; } }; }\n`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 7,
        reachableProductionModuleCount: 7
      },
      authTransportExceptions: [
        {
          method: "PATCH",
          normalizedPath: "/auth/profile",
          normalizedKey: "PATCH /auth/profile",
          sourceFile: "apps/web-admin/src/auth/auth.store.ts",
          transport: "auth_store_exception"
        }
      ]
    }
  });

  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.blockers.unresolvedWrappers.length, 0);
  assert.deepEqual(
    manifest.actions.find((action) => action.id === "user-self-profile.update")
      ?.bindings[0]?.normalizedKey,
    "PATCH /auth/profile"
  );
});

}

test("fails closed for unregistered or mismatched self-profile auth exception evidence", async () => {
  const exactWrapper = {
    apiFile: "apps/web-admin/src/lib/user-self-profile.ts",
    name: "updateProfile"
  };
  const exactException = {
    method: "PATCH",
    normalizedPath: "/auth/profile",
    normalizedKey: "PATCH /auth/profile",
    sourceFile: "apps/web-admin/src/auth/auth.store.ts",
    transport: "auth_store_exception"
  };
  const createRoot = async ({
    actionWrapper = exactWrapper,
    authTransportExceptions = [exactException],
    includeAction = true,
    facadeSource = `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword) { return useAuthStore().updateProfile(name, phone, currentPassword); }\n`
  } = {}) =>
    fixture({
      actions: includeAction ? [
        registryAction({
          id: "user-self-profile.update",
          sourceFile: "apps/web-admin/src/pages/settings/SettingsPage.vue",
          routePaths: ["/example"],
          trigger: {
            element: "t-button",
            event: "click",
            handler: "submitProfile"
          },
          wrappers: [actionWrapper]
        })
      ] : [],
      wrappers: [wrapper({
        name: "getExample",
        normalizedKey: "GET /examples/:param",
        returnProvenance: "transparent_main_response",
        productionConsumers: ["apps/web-admin/src/pages/settings/SettingsPage.vue"]
      })],
      routes: [route("PATCH /auth/profile")],
      pagePath: "apps/web-admin/src/pages/settings/SettingsPage.vue",
      routeRecords: `export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/settings/SettingsPage.vue") }];\n`,
      page: `<script setup lang="ts">
import { getExample } from "../../api/example.api";
import { updateProfile } from "../../lib/user-self-profile";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submitProfile() {
  await updateProfile("A", "13800000000", "password");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submitProfile">保存</t-button>
</template>
`,
      extraFiles: {
        "apps/web-admin/src/lib/user-self-profile.ts": facadeSource,
        "apps/web-admin/src/auth/auth.store.ts": `export function useAuthStore() { return { updateProfile() { return undefined; } }; }\n`
      },
      webManifestOverrides: {
        evidence: {
          productionModuleCount: 7,
          reachableProductionModuleCount: 7
        },
        authTransportExceptions
      }
    });

  const cases = [
    {
      name: "facade action registration missing",
      includeAction: false
    },
    {
      name: "unregistered exception",
      authTransportExceptions: []
    },
    {
      name: "facade file mismatch",
      actionWrapper: {
        ...exactWrapper,
        apiFile: "apps/web-admin/src/lib/other-profile.ts"
      }
    },
    {
      name: "facade function mismatch",
      actionWrapper: {
        ...exactWrapper,
        name: "saveProfile"
      }
    },
    {
      name: "method mismatch",
      authTransportExceptions: [
        { ...exactException, method: "POST", normalizedKey: "POST /auth/profile" }
      ]
    },
    {
      name: "route mismatch",
      authTransportExceptions: [
        { ...exactException, normalizedPath: "/auth/other", normalizedKey: "PATCH /auth/other" }
      ]
    },
    {
      name: "facade no-op",
      facadeSource: `export function updateProfile() { return undefined; }\n`
    },
    {
      name: "facade argument order mismatch",
      facadeSource: `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword) { return useAuthStore().updateProfile(phone, name, currentPassword); }\n`
    },
    {
      name: "SMS facade drops code",
      facadeSource: `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword, code) { return useAuthStore().updateProfile(name, phone, currentPassword); }\n`
    },
    {
      name: "SMS facade replaces code",
      facadeSource: `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword, code) { return useAuthStore().updateProfile(name, phone, currentPassword, "fixed-code"); }\n`
    },
    {
      name: "SMS facade reorders code",
      facadeSource: `import { useAuthStore } from "../auth/auth.store";\nexport function updateProfile(name, phone, currentPassword, code) { return useAuthStore().updateProfile(name, phone, code, currentPassword); }\n`
    },
    {
      name: "transport owner mismatch",
      authTransportExceptions: [
        { ...exactException, sourceFile: "apps/web-admin/src/auth/other.store.ts" }
      ]
    },
    {
      name: "transport kind mismatch",
      authTransportExceptions: [
        { ...exactException, transport: "generic_exception" }
      ]
    }
  ];

  for (const testCase of cases) {
    const root = await createRoot(testCase);
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", testCase.name);
    assert.ok(
      testCase.includeAction === false
        ? manifest.blockers.uncoveredMutationWrappers.some(
            (entry) => entry.wrapper === "updateProfile"
          )
        : manifest.blockers.unresolvedWrappers.some(
            (entry) => entry.code === "WRAPPER_NOT_IN_MANIFEST"
          ),
      testCase.name
    );
  }
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

test("accepts fail-closed early-return guards before the direct wrapper call", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
let operation = null;
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function submit() {
  if (operation) {
    return operation;
  }
  if (!detail) {
    return Promise.resolve({ status: "not_started" });
  }
  const request = submitExample("example-1");
  operation = request.finally(() => undefined);
  return operation;
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(
    manifest.actions[0].bindings[0].causalVerified,
    true
  );
  assert.deepEqual(
    manifest.actions[0].bindings[0].causalProof
      .localCallChain,
    ["submit", "submitExample"]
  );
});

test("rejects custom same-named collection methods in early-return guards", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
const custom = {
  some() {
    while (true) {
      // A user-defined method with an Array-like name is not a pure read.
    }
  }
};
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function guard() {
  return custom.some();
}
function submit() {
  if (guard()) return;
  return submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.actions[0].bindings[0].causalVerified,
    false
  );
  assert.ok(
    blockerCodes(manifest).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );
});

test("rejects coercive operations in fail-closed early-return guards", async () => {
  const cases = [
    {
      name: "Number coercion",
      setup:
        "let value = { [Symbol.toPrimitive]() { while (true) {} } };",
      guard: "Number(value)"
    },
    {
      name: "String coercion",
      setup:
        'let value = { toString() { throw new Error("blocked"); } };',
      guard: "String(value)"
    },
    {
      name: "loose equality coercion",
      setup:
        "let value = { valueOf() { while (true) {} } };",
      guard: "value == 1"
    },
    {
      name: "relational coercion",
      setup:
        "let value = { valueOf() { while (true) {} } };",
      guard: "value > 0"
    },
    {
      name: "unary numeric coercion",
      setup:
        "let value = { valueOf() { while (true) {} } };",
      guard: "+value"
    },
    {
      name: "template interpolation coercion",
      setup:
        'let value = { toString() { throw new Error("blocked"); } };',
      guard: "`${value}`"
    },
    {
      name: "computed object key coercion",
      setup:
        'let value = { toString() { throw new Error("blocked"); } };',
      guard: "Boolean({ [value]: true })"
    },
    {
      name: "default parameter execution",
      setup: `let value;
function guard(candidate = (() => { while (true) {} })()) {
  return Boolean(candidate);
}`,
      guard: "guard(value)"
    },
    {
      name: "destructured parameter getter",
      setup: `let value = { get flag() { while (true) {} } };
function guard({ flag }) {
  return Boolean(flag);
}`,
      guard: "guard(value)"
    }
  ];

  for (const current of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
${current.setup}
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function submit() {
  if (${current.guard}) return;
  return submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked", current.name);
    assert.equal(
      manifest.actions[0].bindings[0].causalVerified,
      false,
      current.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      current.name
    );
  }
});

test("excludes wrapper calls behind statically truthy early-return guards", async () => {
  const cases = [
    {
      name: "immutable const",
      setup: "const always = true;",
      guard: "always"
    },
    {
      name: "literal comparison",
      setup: "",
      guard: "1 === 1"
    },
    {
      name: "literal arithmetic",
      setup: "",
      guard: "1 + 1 === 2"
    },
    {
      name: "pure global coercion",
      setup: "",
      guard: "Boolean(true)"
    },
    {
      name: "pure helper",
      setup: "function always() { return true; }",
      guard: "always()"
    },
    {
      name: "immutable object member",
      setup: "const flags = { always: true };",
      guard: "flags.always"
    },
    {
      name: "local accessor",
      setup:
        "const flags = { get always() { while (true) {} } };",
      guard: "flags.always"
    },
    {
      name: "mutable local accessor",
      setup:
        "let flags = { get always() { while (true) {} } };",
      guard: "flags.always"
    },
    {
      name: "mutable throwing accessor",
      setup:
        'let flags = { get always() { throw new Error("blocked"); } };',
      guard: "flags.always"
    },
    {
      name: "delete expression",
      setup: "const flags = { always: true };",
      guard: "delete flags.always"
    },
    {
      name: "truthy literal coercion",
      setup: "",
      guard: "!![]"
    },
    {
      name: "pure identity helper",
      setup: "function identity(value: boolean) { return value; }",
      guard: "identity(true)"
    }
  ];

  for (const current of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
${current.setup}
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function submit() {
  if (${current.guard}) return;
  return submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });

    assert.equal(
      manifest.status,
      "blocked",
      current.name
    );
    assert.equal(
      manifest.actions[0].bindings[0].causalVerified,
      false,
      current.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      current.name
    );
  }
});

test("binds independent handlers to declared wrapper payload variants", async () => {
  const compositeWrapper = wrapper({
    requests: [
      {
        kind: "main",
        sourceLine: 1,
        method: "GET",
        path: "/examples/:param",
        normalizedPath: "/examples/:param",
        normalizedKey: "GET /examples/:param",
        bodyKind: "none"
      },
      {
        kind: "main",
        sourceLine: 2,
        method: "POST",
        path: "/examples/:param/submission",
        normalizedPath: "/examples/:param/submission",
        normalizedKey: "POST /examples/:param/submission",
        bodyKind: "json"
      }
    ]
  });
  const action = (id, key, handler, variant) =>
    registryAction({
      id,
      trigger: {
        element: "t-button",
        event: "click",
        handler
      },
      capability: {
        kind: "detail_action",
        source: "detail.availableActions",
        key
      },
      wrappers: [
        {
          apiFile: "apps/web-admin/src/api/example.api.ts",
          name: "submitExample",
          variant
        }
      ]
    });
  const actions = [
    action(
      "example.delete-pristine",
      "delete_pristine_draft",
      "deletePristine",
      "delete_pristine_draft"
    ),
    action(
      "example.abandon-application",
      "abandon_application",
      "abandonApplication",
      "abandon_application"
    )
  ];
  const page = (deleteAction) => `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((item) => item.key === key && item.enabled);
}
async function deletePristine() {
  await submitExample({ action: "${deleteAction}" });
}
async function abandonApplication() {
  await submitExample({ action: "abandon_application" });
}
</script>
<template>
  <t-button v-if="actionEnabled('delete_pristine_draft')" @click="deletePristine">删除</t-button>
  <t-button v-if="actionEnabled('abandon_application')" @click="abandonApplication">放弃</t-button>
</template>
`;
  const routes = [
    route("GET /examples/:param"),
    route("POST /examples/:param/submission")
  ];
  const root = await fixture({
    actions,
    wrappers: [compositeWrapper],
    routes,
    page: page("delete_pristine_draft")
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions.length, 2);
  assert.ok(
    manifest.actions.every(
      (entry) =>
        entry.bindings.length === 2 &&
        entry.bindings.every((binding) => binding.causalVerified)
    )
  );

  const mismatchedRoot = await fixture({
    actions,
    wrappers: [compositeWrapper],
    routes,
    page: page("abandon_application")
  });
  const mismatched = await inspectWholeSitePageActionManifest({
    root: mismatchedRoot
  });
  const deleteAction = mismatched.actions.find(
    (entry) => entry.id === "example.delete-pristine"
  );
  const abandonAction = mismatched.actions.find(
    (entry) => entry.id === "example.abandon-application"
  );

  assert.equal(mismatched.status, "blocked");
  assert.ok(
    deleteAction.bindings.every((binding) => !binding.causalVerified)
  );
  assert.ok(
    abandonAction.bindings.every((binding) => binding.causalVerified)
  );
});

test("rejects an empty declared wrapper payload variant", async () => {
  const action = registryAction({
    wrappers: [
      {
        apiFile: "apps/web-admin/src/api/example.api.ts",
        name: "submitExample",
        variant: ""
      }
    ]
  });
  const root = await fixture({ actions: [action] });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(blockerCodes(manifest).has("wrappers_invalid"));
});

test("requires write calls and template handlers to resolve to their actual bindings", async () => {
  const shadowedCalls = [
    {
      name: "named import",
      imports:
        'import { getExample, submitExample } from "../api/example.api";',
      submit: `async function submit() {
  function submitExample() {
    return undefined;
  }
  await submitExample();
}`
    },
    {
      name: "namespace import",
      imports: `import { getExample } from "../api/example.api";
import * as api from "../api/example.api";`,
      submit: `async function submit() {
  const api = {
    submitExample() {
      return undefined;
    }
  };
  await api.submitExample();
}`
    }
  ];
  for (const candidate of shadowedCalls) {
    const root = await fixture({
      page: `<script setup lang="ts">
${candidate.imports}
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
${candidate.submit}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(
      manifest.status,
      "blocked",
      candidate.name
    );
    assert.equal(
      manifest.actions[0].bindings[0].causalVerified,
      false,
      candidate.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      candidate.name
    );
  }

  const nestedOnlyRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
function unrelated() {
  async function submit() {
    await submitExample("example-1");
  }
  return submit;
}
void unrelated;
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const nestedOnly =
    await inspectWholeSitePageActionManifest({
      root: nestedOnlyRoot
    });
  assert.equal(nestedOnly.status, "blocked");
  assert.ok(
    blockerCodes(nestedOnly).has(
      "ACTION_HANDLER_UNRESOLVED"
    )
  );

  const nestedHelperRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await save();
}
function unrelated() {
  async function save() {
    await submitExample("example-1");
  }
  return save;
}
void unrelated;
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const nestedHelper =
    await inspectWholeSitePageActionManifest({
      root: nestedHelperRoot
    });
  assert.equal(nestedHelper.status, "blocked");
  assert.equal(
    nestedHelper.actions[0].bindings[0].causalVerified,
    false
  );
  assert.ok(
    blockerCodes(nestedHelper).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );

  const nestedArgumentHelperRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample(check());
}
function unrelated() {
  function check() {
    return "example-1";
  }
  return check;
}
void unrelated;
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const nestedArgumentHelper =
    await inspectWholeSitePageActionManifest({
      root: nestedArgumentHelperRoot
    });
  assert.equal(nestedArgumentHelper.status, "blocked");
  assert.equal(
    nestedArgumentHelper.actions[0].bindings[0]
      .causalVerified,
    false
  );
  assert.ok(
    blockerCodes(nestedArgumentHelper).has(
      "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
    )
  );

  const topLevelRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const topLevel =
    await inspectWholeSitePageActionManifest({
      root: topLevelRoot
    });
  assert.equal(
    topLevel.status,
    "ready",
    JSON.stringify(topLevel.blockers)
  );
  assert.equal(
    topLevel.actions[0].bindings[0].causalVerified,
    true
  );
});

test("accepts only a throw-only fail-closed preflight helper used as a direct wrapper argument", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
const currentId = "example-1";
let error = "";
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
function currentContext() {
  return { id: currentId };
}
function contextIsCurrent(context: { id: string }) {
  return Boolean(context.id) && context.id === currentId;
}
function preflightId() {
  const context = currentContext();
  const action = detail.availableActions.find(
    (item) => item.key === "submit_approval"
  );
  if (!contextIsCurrent(context) || !action?.enabled) {
    error = "页面上下文已失效";
    throw new Error(error);
  }
  return context.id;
}
function submit() {
  return submitExample(preflightId());
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(
    manifest.actions[0].bindings[0].causalVerified,
    true
  );
  assert.deepEqual(
    manifest.actions[0].bindings[0].causalProof
      .localCallChain,
    ["submit", "submitExample"]
  );
});

test("rejects non-terminating, side-effecting, dual-branch, try, and loop preflight helpers", async () => {
  const cases = [
    {
      name: "return-branch",
      body: `if (!id) { return "fallback"; }
  return id;`
    },
    {
      name: "silent-branch",
      body: `if (!id) { error = "ignored"; }
  return id;`
    },
    {
      name: "branch-wrapper",
      body: `if (!id) {
    submitExample("other-example");
    throw new Error("stale");
  }
  return id;`
    },
    {
      name: "branch-unknown-side-effect",
      extra: `function mutateUnexpectedly() { error = "mutated"; }`,
      body: `if (!id) {
    mutateUnexpectedly();
    throw new Error("stale");
  }
  return id;`
    },
    {
      name: "dynamic-dual-branch",
      body: `if (!id) {
    throw new Error("stale");
  } else {
    error = "continued";
  }
  return id;`
    },
    {
      name: "try-guard",
      body: `try {
    if (!id) throw new Error("stale");
  } finally {
    error = "";
  }
  return id;`
    },
    {
      name: "loop-guard",
      body: `while (!id) {
    throw new Error("stale");
  }
  return id;`
    },
    {
      name: "default-parameter-side-effect",
      setup: "let input;",
      parameters:
        "id = (() => { while (true) {} })()",
      skipIdInitialization: true,
      call: "preflightId(input)",
      body: `if (!id) {
    throw new Error("stale");
  }
  return id;`
    },
    {
      name: "destructured-parameter-getter",
      setup:
        "let context = { get id() { while (true) {} } };",
      parameters: "{ id }",
      skipIdInitialization: true,
      call: "preflightId(context)",
      body: `if (!id) {
    throw new Error("stale");
  }
  return id;`
    }
  ];

  for (const entry of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
const currentId = "example-1";
let error = "";
${entry.setup ?? ""}
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
${entry.extra ?? ""}
function preflightId(${entry.parameters ?? ""}) {
  ${entry.skipIdInitialization ? "" : "const id = currentId;"}
  ${entry.body}
}
function submit() {
  return submitExample(${entry.call ?? "preflightId()"});
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });

    assert.equal(
      manifest.status,
      "blocked",
      `${entry.name}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.equal(
      manifest.actions[0].bindings[0].causalVerified,
      false,
      entry.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"
      ),
      entry.name
    );
  }
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
  assert.deepEqual(
    blockedWeb.actions[0].bindings[0].acceptedProductionConsumers,
    []
  );

  const fakeReadyRoot = await fixture({
    webManifestOverrides: {
      status: "ready",
      blockers: {
        orphanWrappers: [
          {
            apiFile: "apps/web-admin/src/api/example.api.ts",
            wrapper: "unrelatedUnusedExample"
          }
        ]
      }
    }
  });
  const fakeReady =
    await inspectWholeSitePageActionManifest({
      root: fakeReadyRoot
    });
  assert.equal(fakeReady.status, "blocked");
  assert.ok(
    blockerCodes(fakeReady).has(
      "UPSTREAM_WEB_MANIFEST_BLOCKED"
    )
  );
  assert.deepEqual(
    fakeReady.actions[0].bindings[0]
      .acceptedProductionConsumers,
    []
  );

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
  assert.deepEqual(
    mismatchedWeb.actions[0].bindings[0].acceptedProductionConsumers,
    []
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
  assert.deepEqual(
    nestScope.actions[0].bindings[0].acceptedProductionConsumers,
    []
  );
});

test("accepts a self-consistent binding while preserving unrelated upstream and uncovered blockers", async () => {
  const sourceFile =
    "apps/web-admin/src/pages/ExamplePage.vue";
  const apiFile = "apps/web-admin/src/api/example.api.ts";
  const root = await fixture({
    wrappers: [
      wrapper(),
      wrapper({
        name: "archiveExample",
        normalizedKey:
          "POST /examples/:param/archive",
        productionConsumers: [sourceFile]
      }),
      wrapper({
        name: "unusedExample",
        normalizedKey:
          "POST /examples/:param/unused",
        productionConsumers: []
      })
    ],
    routes: [
      route(),
      route("POST /examples/:param/archive"),
      route("POST /examples/:param/unused")
    ],
    webManifestOverrides: {
      status: "blocked",
      blockers: {
        orphanWrappers: [
          {
            apiFile,
            wrapper: "unusedExample",
            classification: "unreferenced"
          }
        ]
      }
    },
    extraFiles: {
      [apiFile]: `export async function getExample() { return { availableActions: [] }; }
export async function submitExample() { return undefined; }
export async function archiveExample() { return undefined; }
export async function unusedExample() { return undefined; }
`
    },
    page: `<script setup lang="ts">
import { archiveExample, getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() {
  await submitExample("example-1");
}
async function archiveForLater() {
  await archiveExample("example-1");
}
void archiveForLater;
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "UPSTREAM_WEB_MANIFEST_BLOCKED"
    )
  );
  assert.deepEqual(
    manifest.actions[0].bindings[0]
      .acceptedProductionConsumers,
    [sourceFile]
  );
  assert.equal(
    manifest.summary
      .acceptedProductionMutationConsumerCount,
    1
  );
  assert.equal(
    manifest.summary
      .coveredProductionMutationConsumerCount,
    1
  );
  assert.equal(
    manifest.summary.productionMutationConsumerPairCount,
    2
  );
  assert.ok(
    manifest.blockers.uncoveredMutationWrappers.some(
      (entry) => entry.wrapper === "archiveExample"
    )
  );
});

test("keeps exact local action coverage when the upstream wrapper is in a duplicate-write group", async () => {
  const sourceFile =
    "apps/web-admin/src/pages/ExamplePage.vue";
  const apiFile = "apps/web-admin/src/api/example.api.ts";
  const root = await fixture({
    webManifestOverrides: {
      status: "blocked",
      blockers: {
        duplicateWriteWrappers: [
          {
            normalizedKey:
              "POST /examples/:param/submission",
            wrappers: [
              {
                apiFile,
                wrapper: "submitExample"
              },
              {
                apiFile,
                wrapper: "submitExampleAgain"
              }
            ]
          }
        ]
      }
    }
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "UPSTREAM_WEB_MANIFEST_BLOCKED"
    )
  );
  assert.deepEqual(
    manifest.actions[0].bindings[0]
      .acceptedProductionConsumers,
    [sourceFile]
  );
  assert.equal(
    manifest.summary
      .coveredProductionMutationConsumerCount,
    1
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
  assert.deepEqual(
    badWeb.actions[0].bindings[0].acceptedProductionConsumers,
    []
  );

  const staleConsumerRoot = await fixture({
    wrappers: [
      wrapper({
        productionConsumers: [
          "apps/web-admin/src/pages/RoguePage.vue"
        ]
      })
    ]
  });
  const staleConsumer =
    await inspectWholeSitePageActionManifest({
      root: staleConsumerRoot
    });
  assert.equal(staleConsumer.status, "blocked");
  assert.ok(
    blockerCodes(staleConsumer).has(
      "WRAPPER_NOT_REFERENCED_BY_ACTION_SOURCE"
    )
  );
  assert.deepEqual(
    staleConsumer.actions[0].bindings[0]
      .acceptedProductionConsumers,
    []
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
  assert.deepEqual(
    badNest.actions[0].bindings[0].acceptedProductionConsumers,
    []
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
  assert.deepEqual(
    duplicates.actions[0].bindings[0]
      .acceptedProductionConsumers,
    []
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

test("rejects-invalid-upstream-nest-route-identities", async () => {
  const pageSourceFile = "apps/web-admin/src/pages/ExamplePage.vue";
  const apiFile = "apps/web-admin/src/api/example.api.ts";
  const businessRoutes = [
    {
      key: "GET /business-entry-definitions/:param",
      wrapper: "fetchBusinessEntryDefinition",
      handler: "readBusinessEntryDefinition",
      action: "business-entry-definition.read"
    },
    {
      key: "POST /business-entry-definitions/:param/create-target",
      wrapper: "issueBusinessEntryCreateTarget",
      handler: "createBusinessEntryTarget",
      action: "business-entry-definition.create-target"
    },
    {
      key: "POST /business-entry-definitions/:param/validate",
      wrapper: "validateBusinessEntryDraft",
      handler: "runValidateBusinessEntryDraft",
      action: "business-entry-definition.validate"
    }
  ];
  const actionFor = ({ wrapper: wrapperName, handler, action }) =>
    registryAction({
      id: action,
      trigger: {
        element: "t-button",
        event: "click",
        handler
      },
      capability: {
        kind: "detail_action",
        source: "detail.availableActions",
        key: action
      },
      wrappers: [{ apiFile, name: wrapperName }],
      routePaths: ["/example"]
    });
  const wrapperFor = ({ key, wrapper: wrapperName }) =>
    wrapper({
      name: wrapperName,
      normalizedKey: key,
      productionConsumers: [pageSourceFile]
    });
  const routePairFor = ({ key }, invalidFirst) => {
    const path = key.replace(":param", ":sceneKey");
    const valid = {
      ...route(key),
      path,
      normalizedKey: key
    };
    const invalid = {
      ...valid,
      normalizedKey: key.replace(":param", ":sceneKey")
    };
    return invalidFirst ? [invalid, valid] : [valid, invalid];
  };

  for (const invalidFirst of [true, false]) {
    const root = await fixture({
      actions: [
        registryAction({
          id: "example.submit",
          capability: {
            kind: "detail_action",
            source: "detail.availableActions",
            key: "example.submit"
          }
        }),
        ...businessRoutes.map(actionFor)
      ],
      wrappers: [
        wrapper(),
        capabilityReadWrapper(),
        ...businessRoutes.map(wrapperFor)
      ],
      routes: [
        route(),
        ...businessRoutes.flatMap((businessRoute) =>
          routePairFor(businessRoute, invalidFirst)
        )
      ],
      extraFiles: {
        "apps/web-admin/src/api/example.api.ts": `export async function getExample() {
  return {
    availableActions: [
      { key: "example.submit", enabled: true },
      { key: "business-entry-definition.read", enabled: true },
      { key: "business-entry-definition.create-target", enabled: true },
      { key: "business-entry-definition.validate", enabled: true }
    ]
  };
}
export async function submitExample() { return undefined; }
export async function fetchBusinessEntryDefinition() { return undefined; }
export async function issueBusinessEntryCreateTarget() { return undefined; }
export async function validateBusinessEntryDraft() { return undefined; }
`,
        "apps/web-admin/src/pages/ExamplePage.vue": `<script setup lang="ts">
import {
  getExample,
  submitExample,
  fetchBusinessEntryDefinition,
  issueBusinessEntryCreateTarget,
  validateBusinessEntryDraft
} from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
async function readBusinessEntryDefinition() {
  await fetchBusinessEntryDefinition("business_party");
}
async function createBusinessEntryTarget() {
  await issueBusinessEntryCreateTarget("business_party");
}
async function runValidateBusinessEntryDraft() {
  await validateBusinessEntryDraft("business_party");
}
</script>
<template>
  <t-button v-if="actionEnabled('example.submit')" @click="submit">提交</t-button>
  <t-button v-if="actionEnabled('business-entry-definition.read')" @click="readBusinessEntryDefinition">读取</t-button>
  <t-button v-if="actionEnabled('business-entry-definition.create-target')" @click="createBusinessEntryTarget">创建目标</t-button>
  <t-button v-if="actionEnabled('business-entry-definition.validate')" @click="runValidateBusinessEntryDraft">校验</t-button>
</template>
`
      }
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked");
    assert.ok(
      manifest.blockers.upstreamManifestIssues.some(
        (issue) => issue.code === "UPSTREAM_NEST_ROUTE_IDENTITY_INVALID"
      )
    );
    assert.deepEqual(
      manifest.actions
        .filter((action) => action.id.startsWith("business-entry-definition."))
        .map((action) => ({
          id: action.id,
          nestRoute: action.bindings[0].nestRoute,
          acceptedProductionConsumers:
            action.bindings[0].acceptedProductionConsumers
        })),
      businessRoutes
        .map(({ action }) => action)
        .sort()
        .map((action) => ({
          id: action,
          nestRoute: null,
          acceptedProductionConsumers: []
        }))
    );

    const validAction = manifest.actions.find(
      (action) => action.id === "example.submit"
    );
    assert.deepEqual(
      validAction.bindings[0].acceptedProductionConsumers,
      [pageSourceFile]
    );
  }
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

test("requires server reads to resolve to the imported wrapper binding", async () => {
  const shadowedRoot = await fixture({
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  function getExample() {
    return {
      availableActions: [
        { key: "submit_approval", enabled: true }
      ]
    };
  }
  detail.value = getExample();
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const shadowed =
    await inspectWholeSitePageActionManifest({
      root: shadowedRoot
    });
  assert.equal(shadowed.status, "blocked");
  assert.ok(
    blockerCodes(shadowed).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );

  const importedRoot = await fixture({
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const imported =
    await inspectWholeSitePageActionManifest({
      root: importedRoot
    });
  assert.equal(
    imported.status,
    "ready",
    JSON.stringify(imported.blockers)
  );
});

test("requires a Vue capability gate to be exposed by a script top-level binding", async () => {
  const pages = [
    `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function unrelated() {
  function actionEnabled(key: string) {
    return detail.availableActions.some(
      (action) => action.key === key && action.enabled
    );
  }
  return actionEnabled;
}
void unrelated;
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return hasAction(key);
}
function unrelated() {
  function hasAction(key: string) {
    return detail.availableActions.some(
      (action) => action.key === key && action.enabled
    );
  }
  return hasAction;
}
void unrelated;
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  ];
  for (const page of pages) {
    const root = await fixture({ page });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked");
    assert.equal(
      manifest.actions[0].capability.dominatesTrigger,
      false
    );
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      )
    );
  }
});

test("requires capability evidence to control the gate return with positive polarity", async () => {
  const cases = [
    {
      name: "discarded predicate",
      helper: `function actionEnabled(key: string) {
  detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
  return true;
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "negated predicate",
      helper: `function actionEnabled(key: string) {
  return !detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "forged collection",
      helper: `function actionEnabled(key: string) {
  void detail.availableActions;
  const forged = [{ key, enabled: true }];
  return forged.some(
    (action) => action.key === key && action.enabled
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "sequence forced true",
      helper: "",
      condition:
        "(detail.availableActions.some((action) => action.key === 'submit_approval' && action.enabled), true)"
    },
    {
      name: "predicate forced true",
      helper: `function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => (void key, void action.enabled, true)
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "wrong key polarity",
      helper: `function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key !== key && action.enabled
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "disjunctive predicate",
      helper: `function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key || action.enabled
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "disabled action predicate",
      helper: `function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && !action.enabled
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "wrong collection receiver",
      helper: `function actionEnabled(key: string) {
  const forged = [{ key, enabled: true }];
  return forged.some(
    (action) => (
      void detail.availableActions,
      action.key === key && action.enabled
    )
  );
}`,
      condition: "actionEnabled('submit_approval')"
    },
    {
      name: "wrong outer call",
      helper: `function actionEnabled(key: string) {
  return Math.random(
    detail.availableActions.some(
      (action) => action.key === key && action.enabled
    ),
    0
  );
}`,
      condition: "actionEnabled('submit_approval')"
    }
  ];
  for (const candidate of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
${candidate.helper}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="${candidate.condition}" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(
      manifest.status,
      "blocked",
      candidate.name
    );
    assert.equal(
      manifest.actions[0].capability.dominatesTrigger,
      false,
      candidate.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      candidate.name
    );
  }
});

test("rejects direct server result mutation and escape", async () => {
  const mutations = [
    `detail.availableActions[0].enabled = true;`,
    `mutate(detail.availableActions[0]);`
  ];
  for (const mutation of mutations) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
function mutate(action: { enabled: boolean }) {
  action.enabled = true;
}
${mutation}
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", mutation);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      mutation
    );
  }

});

test("rejects mutation through an upstream server-result alias", async () => {
  const pages = [
    `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const response = await getExample("example-1");
const detail = response;
response.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  const response = await getExample("example-1");
  detail.value = response;
  response.availableActions[0].enabled = true;
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const response = await getExample("example-1");
const detail = response.payload;
response.payload.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  const response = await getExample("example-1");
  detail.value = response.payload;
  response.payload.availableActions[0].enabled = true;
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const response = await getExample("example-1");
const alias = response;
const detail = alias;
response.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  const response = await getExample("example-1");
  const alias = response;
  detail.value = alias;
  response.availableActions[0].enabled = true;
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  ];
  for (const page of pages) {
    const root = await fixture({ page });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked");
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      )
    );
  }
});

test("accepts only the unshadowed structuredClone alias boundary", async () => {
  const safeRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
const editable = structuredClone(detail);
editable.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const safeManifest =
    await inspectWholeSitePageActionManifest({
      root: safeRoot
    });
  assert.equal(
    safeManifest.status,
    "ready",
    JSON.stringify(safeManifest.blockers)
  );

  const overwrittenAliasRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
let localTarget: any = globalThis;
localTarget = {};
localTarget.structuredClone = (value: unknown) => value;
let localSet: any = Reflect.set;
localSet = () => false;
localSet(globalThis, "structuredClone", (value: unknown) => value);
const detail = await getExample("example-1");
const editable = structuredClone(detail);
editable.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const overwrittenAliasManifest =
    await inspectWholeSitePageActionManifest({
      root: overwrittenAliasRoot
    });
  assert.equal(
    overwrittenAliasManifest.status,
    "ready",
    JSON.stringify(overwrittenAliasManifest.blockers)
  );

  const shadowedRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
function structuredClone<T>(value: T): T {
  return value;
}
const detail = await getExample("example-1");
const editable = structuredClone(detail);
editable.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const shadowedManifest =
    await inspectWholeSitePageActionManifest({
      root: shadowedRoot
    });
  assert.equal(shadowedManifest.status, "blocked");
  assert.ok(
    blockerCodes(shadowedManifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
});

test("accepts a runtime-authority alias after an unconditional safe overwrite", async () => {
  for (const [imports, setup, extraFiles] of [
    [
      "",
      `function createRuntimeProxy() {
  return new Proxy(globalThis, {});
}
let proxy: any = createRuntimeProxy();`,
      {}
    ],
    [
      `import { createRuntimeProxy } from "../lib/runtime-proxy";`,
      `let proxy: any = createRuntimeProxy();`,
      {
        "apps/web-admin/src/lib/runtime-proxy.ts": `export function createRuntimeProxy() {
  return new Proxy(globalThis, {});
}
`
      }
    ]
  ]) {
    const root = await fixture({
      extraFiles,
      webManifestOverrides: {
        evidence: {
          productionModuleCount:
            5 + Object.keys(extraFiles).length,
          reachableProductionModuleCount:
            5 + Object.keys(extraFiles).length
        }
      },
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
${imports}
${setup}
proxy = {};
proxy.structuredClone = (value: unknown) => value;
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(
      manifest.status,
      "ready",
      JSON.stringify(manifest.blockers)
    );
  }
});

test("rejects runtime extensions even under a static app-owned key", async () => {
  const safeRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const runtimeExtensionKey = "__JIANGKONG_TEST_REGISTRY__";
function installRuntimeExtension(target: typeof globalThis) {
  Object.defineProperty(target, runtimeExtensionKey, {
    configurable: true,
    value: {}
  });
}
installRuntimeExtension(globalThis);
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const safeManifest =
    await inspectWholeSitePageActionManifest({
      root: safeRoot
    });
  assert.equal(
    safeManifest.status,
    "blocked"
  );
  assert.ok(
    blockerCodes(safeManifest).has(
      "RUNTIME_INTRINSIC_INTEGRITY_UNVERIFIED"
    )
  );

  const dynamicRoot = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const runtimeExtensionKey = Math.random() > 0.5
  ? "__JIANGKONG_TEST_REGISTRY__"
  : "structuredClone";
function installRuntimeExtension(target: typeof globalThis) {
  Object.defineProperty(target, runtimeExtensionKey, {
    configurable: true,
    value: {}
  });
}
installRuntimeExtension(globalThis);
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const dynamicManifest =
    await inspectWholeSitePageActionManifest({
      root: dynamicRoot
    });
  assert.equal(dynamicManifest.status, "blocked");
  assert.ok(
    blockerCodes(dynamicManifest).has(
      "RUNTIME_INTRINSIC_INTEGRITY_UNVERIFIED"
    )
  );
});

test("rejects reachable runtime intrinsic tampering before capability checks or clones", async () => {
  const mutations = [
    `Object.defineProperty(globalThis, "structuredClone", {
  value: (value: unknown) => value,
  configurable: true
});`,
    `function installRuntimeExtension(
  target: typeof globalThis
) {
  Object.defineProperty(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    {
      get() {
        target.structuredClone = (value: unknown) => value;
        return {};
      }
    }
  );
}
installRuntimeExtension(globalThis);
void globalThis.__JIANGKONG_TEST_REGISTRY__;`,
    `function installRuntimeExtension(
  target: typeof globalThis
) {
  Object.defineProperty(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    {
      value: target
    }
  );
}
installRuntimeExtension(globalThis);
globalThis.__JIANGKONG_TEST_REGISTRY__.structuredClone =
  (value: unknown) => value;`,
    `function installRuntimeExtension(
  target: typeof globalThis
) {
  Object.defineProperty(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    {
      value: (() => target)()
    }
  );
}
installRuntimeExtension(globalThis);
globalThis.__JIANGKONG_TEST_REGISTRY__.structuredClone =
  (value: unknown) => value;`,
    `function installRuntimeExtension(
  target: typeof globalThis
) {
  Reflect.set(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    target
  );
}
installRuntimeExtension(globalThis);
globalThis.__JIANGKONG_TEST_REGISTRY__.structuredClone =
  (value: unknown) => value;`,
    `function installRuntimeExtension(
  target: typeof globalThis
) {
  Object.defineProperty(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    {
      value: {}
    }
  );
}
installRuntimeExtension(globalThis);
globalThis.__JIANGKONG_TEST_REGISTRY__.runtime = globalThis;
globalThis.__JIANGKONG_TEST_REGISTRY__.runtime.structuredClone =
  (value: unknown) => value;`,
    `function mutateDescriptorFlag(target: typeof globalThis) {
  target.structuredClone = (value: unknown) => value;
  return true;
}
function installRuntimeExtension(
  target: typeof globalThis
) {
  Object.defineProperty(
    target,
    "__JIANGKONG_TEST_REGISTRY__",
    {
      configurable: mutateDescriptorFlag(target),
      value: {}
    }
  );
}
installRuntimeExtension(globalThis);`,
    `Reflect.set(
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `Object.assign(globalThis, {
  structuredClone: (value: unknown) => value
});`,
    `(0, eval)(
  "globalThis.structuredClone = (value) => value"
);`,
    `const dynamicEval = globalThis["eval"];
dynamicEval(
  "globalThis.structuredClone = (value) => value"
);`,
    `const { eval: dynamicEval } = globalThis;
dynamicEval(
  "globalThis.structuredClone = (value) => value"
);`,
    `const runtime = {
  execute: globalThis.eval
};
runtime.execute(
  "globalThis.structuredClone = (value) => value"
);`,
    `const dynamicEval = Math.random() > 0.5
  ? globalThis.eval
  : () => undefined;
dynamicEval(
  "globalThis.structuredClone = (value) => value"
);`,
    `function resolveDynamicEval() {
  return globalThis.eval;
}
const dynamicEval = resolveDynamicEval();
dynamicEval(
  "globalThis.structuredClone = (value) => value"
);`,
    `Function(
  "globalThis.structuredClone = (value) => value"
)();`,
    `const DynamicFunction = globalThis["Function"];
DynamicFunction(
  "globalThis.structuredClone = (value) => value"
)();`,
    `const DynamicFunction = Function\`
  globalThis.structuredClone = (value) => value
\`;
DynamicFunction();`,
    `const FunctionAlias = globalThis.Function;
const DynamicFunction = FunctionAlias\`
  globalThis.structuredClone = (value) => value
\`;
DynamicFunction();`,
    `const dynamicEval = globalThis.eval.bind(globalThis);
dynamicEval(
  "globalThis.structuredClone = (value) => value"
);`,
    `const DynamicFunction = (() => {}).constructor;
DynamicFunction(
  "globalThis.structuredClone = (value) => value"
)();`,
    `setTimeout(
  "globalThis.structuredClone = (value) => value",
  0
);`,
    `setTimeout(
  String(
    "globalThis.structuredClone = (value) => value"
  ),
  0
);`,
    `window.setInterval(
  "globalThis.structuredClone = (value) => value",
  1
);`,
    `const scheduleCode = globalThis.setTimeout;
scheduleCode(
  "globalThis.structuredClone = (value) => value",
  0
);`,
    `function scheduleCode(code: string) {
  setTimeout(code, 0);
}
scheduleCode(
  "globalThis.structuredClone = (value) => value"
);`,
    `function scheduleCodeA(callback: () => void) {
  scheduleCodeB(callback);
  setTimeout(callback, 0);
}
function scheduleCodeB(callback: () => void) {
  scheduleCodeA(callback);
}
scheduleCodeA(() => undefined);
scheduleCodeB(
  "globalThis.structuredClone = (value) => value" as any
);`,
    `function scheduleCodeB(callback: () => void) {
  scheduleCodeA(callback);
}
function scheduleCodeA(callback: () => void) {
  scheduleCodeB(callback);
  setTimeout(callback, 0);
}
scheduleCodeA(() => undefined);
scheduleCodeB(
  "globalThis.structuredClone = (value) => value" as any
);`,
    `let callback: () => void;
callback =
  "globalThis.structuredClone = (value) => value" as any;
setTimeout(callback, 0);`,
    `function callback() {
  return undefined;
}
callback =
  "globalThis.structuredClone = (value) => value" as any;
setTimeout(callback, 0);`,
    `(Array.prototype as any).some = function () {
  return true;
};`,
    `Object.defineProperty(Array.prototype, "some", {
  value() {
    return true;
  }
});`,
    `const A = Array;
A.prototype.some = () => true;`,
    `globalThis.Array.prototype.some = () => true;`,
    `const set = Reflect.set;
set(globalThis, "structuredClone", (value: unknown) => value);`,
    `const { set } = Reflect;
set(globalThis, "structuredClone", (value: unknown) => value);`,
    `Object.defineProperty.call(
  Object,
  globalThis,
  "structuredClone",
  { value: (value: unknown) => value }
);`,
    `Reflect.set.apply(Reflect, [
  globalThis,
  "structuredClone",
  (value: unknown) => value
]);`,
    `const set = Reflect.set.bind(Reflect);
set(globalThis, "structuredClone", (value: unknown) => value);`,
    `const mutators = {
  set: Reflect.set
};
mutators.set(
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `const mutators = [Reflect.set];
mutators[0](
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `function replaceRuntimeValue(target: object) {
  Reflect.set(
    target,
    "structuredClone",
    (value: unknown) => value
  );
}
replaceRuntimeValue(globalThis);`,
    `Reflect.set(
  (void 0, globalThis),
  "structuredClone",
  (value: unknown) => value
);`,
    `Reflect.set(
  Math.random() > 0.5 ? globalThis : {},
  "structuredClone",
  (value: unknown) => value
);`,
    `const proxiedGlobal = new Proxy(globalThis, {});
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const ProxyAlias = Proxy;
const proxiedGlobal = new ProxyAlias(globalThis, {});
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const proxiedGlobal = Proxy.revocable(
  globalThis,
  {}
).proxy;
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const proxiedGlobal = Reflect.construct(
  Proxy,
  [globalThis, {}]
);
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const ProxyFactory = Proxy.bind(null);
const proxiedGlobal = new ProxyFactory(globalThis, {});
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `function createRuntimeProxy() {
  return new Proxy(globalThis, {});
}
const proxiedGlobal = createRuntimeProxy();
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const key = "proxy";
const { [key]: proxiedGlobal } = Proxy.revocable(
  globalThis,
  {}
);
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `let proxiedGlobal: any;
({ proxy: proxiedGlobal } = Proxy.revocable(
  globalThis,
  {}
));
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const key = "proxy";
const proxiedGlobal = Proxy.revocable(
  globalThis,
  {}
)[key];
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const key = "runtime";
const proxies = {
  runtime: new Proxy(globalThis, {})
};
const proxiedGlobal = proxies[key];
proxiedGlobal.structuredClone = (value: unknown) => value;`,
    `const key = "set";
const setRuntime = Reflect[key];
setRuntime(
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `let setRuntime: any;
({ set: setRuntime } = Reflect);
setRuntime(
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `const runtime = {
  mutators: {
    replace: Reflect.set
  }
};
const replace = runtime.mutators.replace;
replace(globalThis, "structuredClone", (value: unknown) => value);`,
    `const targets = {
  runtime: globalThis
};
function replaceRuntimeValue(target: object) {
  const targetAlias = target;
  Reflect.set(
    targetAlias,
    "structuredClone",
    (value: unknown) => value
  );
}
replaceRuntimeValue(targets.runtime);`,
    `const helpers = {
  replaceRuntimeValue(target: object) {
    Reflect.set(
      target,
      "structuredClone",
      (value: unknown) => value
    );
  }
};
helpers.replaceRuntimeValue(globalThis);`,
    `const [setRuntimeValue] = [Reflect.set];
setRuntimeValue(
  globalThis,
  "structuredClone",
  (value: unknown) => value
);`,
    `let conditionalTarget: any = globalThis;
if (Math.random() > 0.5) {
  conditionalTarget = {};
}
conditionalTarget.structuredClone = (value: unknown) => value;`
  ];
  for (const mutation of mutations) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
${mutation}
const detail = await getExample("example-1");
const editable = structuredClone(detail);
editable.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", mutation);
    assert.ok(
      blockerCodes(manifest).has(
        "RUNTIME_INTRINSIC_INTEGRITY_UNVERIFIED"
      ),
      mutation
    );
  }

  for (const [modulePath, importedName, invocation, moduleSource] of [
    [
      "apps/web-admin/src/lib/mutate-runtime.ts",
      "mutateRuntime",
      "mutateRuntime(globalThis);",
      `export function mutateRuntime(target: typeof globalThis) {
  target.structuredClone = (value: unknown) => value;
}
`
    ],
    [
      "apps/web-admin/src/lib/runtime-factory.ts",
      "createRuntimeProxy",
      `const proxiedGlobal = createRuntimeProxy();
proxiedGlobal.structuredClone = (value: unknown) => value;`,
      `export function createRuntimeProxy() {
  return new Proxy(globalThis, {});
}
`
    ],
    [
      "apps/web-admin/src/lib/dynamic-code.ts",
      "executeDynamicCode",
      `executeDynamicCode(
  "globalThis.structuredClone = (value) => value"
);`,
      `export const executeDynamicCode = globalThis.eval;
`
    ],
    [
      "apps/web-admin/src/lib/string-timer.ts",
      "scheduleCode",
      `scheduleCode(
  "globalThis.structuredClone = (value) => value"
);`,
      `export function scheduleCode(code: string) {
  setTimeout(code, 0);
}
`
    ]
  ]) {
    const importedRuntimeRoot = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
import { ${importedName} } from "../lib/${modulePath
        .split("/")
        .at(-1)
        .replace(/\.ts$/, "")}";
${invocation}
const detail = await getExample("example-1");
const editable = structuredClone(detail);
editable.availableActions[0].enabled = true;
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
      extraFiles: {
        [modulePath]: moduleSource
      },
      webManifestOverrides: {
        evidence: {
          productionModuleCount: 6,
          reachableProductionModuleCount: 6
        }
      }
    });
    const importedRuntime =
      await inspectWholeSitePageActionManifest({
        root: importedRuntimeRoot
      });
    assert.equal(importedRuntime.status, "blocked");
    assert.ok(
      blockerCodes(importedRuntime).has(
        "RUNTIME_INTRINSIC_INTEGRITY_UNVERIFIED"
      )
    );
  }
});

test("keeps harmless mutually recursive callbacks callable", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
function walkBackward(callback: () => void, depth: number) {
  if (depth > 0) walkForward(callback, depth - 1);
}
function walkForward(callback: () => void, depth: number) {
  if (depth > 0) walkBackward(callback, depth - 1);
}
walkBackward(() => undefined, 2);
const detail = await getExample("example-1");
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
});

test("rejects protected capability escapes and writes in Vue templates", async () => {
  const templates = [
    `<rogue-child :value="detail?.availableActions[0]" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<rogue-child :value="helpers.pick()" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<rogue-child :value="selectedAction" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<div v-rogue="detail?.availableActions[0]" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<button
    @click="mutate(detail?.availableActions[0])"
  >
    非法改写
  </button>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<button
    @click="detail!.availableActions[0].enabled = true"
  >
    非法改写
  </button>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<input v-model="detail!.availableActions[0].enabled" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`,
    `<button
    v-for="action in detail?.availableActions"
    :key="action.key"
    @click="action.enabled = true"
  >
    非法改写
  </button>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>`
  ];
  for (const template of templates) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { computed, ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
const helpers = {
  pick: function () {
    return detail.value?.availableActions[0];
  }
};
const selectedAction = computed(
  () => detail.value?.availableActions[0]
);
function mutate(action: { enabled: boolean }) {
  action.enabled = true;
}
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  ${template}
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", template);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      template
    );
  }
});

test("rejects a direct server action alias passed through a Vue prop", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
const selected = detail.availableActions[0];
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <rogue-child :value="selected" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
});

test("resolves Vue template aliases against script top-level bindings", async () => {
  const cases = [
    {
      name: "direct alias",
      setup: `const selected = detail.availableActions[0];
function unrelated() {
  const selected = { enabled: false };
  return selected;
}`,
      value: "selected"
    },
    {
      name: "callable alias",
      setup: `const pick = () => detail.availableActions[0];
function unrelated() {
  const pick = () => null;
  return pick();
}`,
      value: "pick()"
    }
  ];
  for (const candidate of cases) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
${candidate.setup}
function actionEnabled(key: string) {
  return detail.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <rogue-child :value="${candidate.value}" />
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(
      manifest.status,
      "blocked",
      candidate.name
    );
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      candidate.name
    );
  }
});

test("accepts a Vue ref populated only through a server read result", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { computed, ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  const response = await getExample("example-1");
  detail.value = response;
}
void load();
const selectedAction = computed(() =>
  detail.value?.availableActions.find(
    (action) => action.key === "submit_approval"
  )
);
const selectedActionWithBlock = computed(() => {
  return detail.value?.availableActions.find(
    (action) => action.key === "submit_approval"
  );
});
const selectedActionWithOptions = computed({
  get: () =>
    detail.value?.availableActions.find(
      (action) => action.key === "submit_approval"
    ),
  set: () => undefined
});
const namedGetter = () =>
  detail.value?.availableActions.find(
    (action) => action.key === "submit_approval"
  );
const emptyGetter = () => null;
const useNamedGetter = true;
const selectedActionWithConditional = computed(
  useNamedGetter ? namedGetter : emptyGetter
);
void selectedAction.value?.enabled;
void selectedActionWithBlock.value?.enabled;
void selectedActionWithOptions.value?.enabled;
void selectedActionWithConditional.value?.enabled;
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <rogue-child
    :disabled="!detail?.availableActions[0]?.enabled"
  />
  <span
    v-for="action in detail?.availableActions"
    :key="action.key"
  >
    {{ action.key }}
  </span>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify({
      action: manifest.actions[0],
      blockers: manifest.blockers
    })
  );
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(
    manifest.summary.acceptedProductionMutationConsumerCount,
    1
  );
});

test("enforces statically ordered safe callable and computed overrides", async () => {
  const safeBodies = [
    `const protectedHelpers = {
    pick: () => detail.value?.availableActions[0]
  };
  const overriddenHelpers = {
    ...protectedHelpers,
    pick: () => fallbackAction
  };
  overriddenHelpers.pick().enabled = true;`,
    `const assignedHelpers = {
    pick: () => detail.value?.availableActions[0]
  };
  assignedHelpers.pick = () => fallbackAction;
  assignedHelpers.pick().enabled = true;`,
    `const assignedHelpers = {
    pick: () => detail.value?.availableActions[0]
  };
  assignedHelpers["pick"] = () => fallbackAction;
  assignedHelpers.pick().enabled = true;`,
    `const safeHelpers = {
    pick: () => fallbackAction
  };
  const safelySpreadHelpers = {
    pick: () => detail.value?.availableActions[0],
    ...safeHelpers
  };
  safelySpreadHelpers.pick().enabled = true;`,
    `const protectedOptions = {
    get: () => detail.value?.availableActions[0]
  };
  const overriddenOptions = {
    ...protectedOptions,
    get: () => fallbackAction,
    set: () => undefined
  };
  const selected = computed(overriddenOptions);
  selected.value.enabled = true;`,
    `const safeOptions = {
    get: () => fallbackAction,
    set: () => undefined
  };
  const safelySpreadOptions = {
    get: () => detail.value?.availableActions[0],
    ...safeOptions
  };
  const selected = computed(safelySpreadOptions);
  selected.value.enabled = true;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  const alias = source;
  source.pick = () => fallbackAction;
  alias.pick().enabled = true;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  alias = safe;
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  source.pick = () => fallbackAction;
  function mutate(value: typeof source) {
    value.pick().enabled = true;
  }
  mutate(source);`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  source.pick = () => fallbackAction;
  source.valueOf().pick().enabled = true;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  alias = safe;
  function mutate(value: typeof alias) {
    value.pick().enabled = true;
  }
  mutate(alias);`
  ];

  for (const safeBody of safeBodies) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { computed, ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
const fallbackAction = {
  key: "fallback",
  enabled: false
};
${safeBody}
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(
      manifest.status,
      "ready",
      `${safeBody}\n${JSON.stringify(manifest.blockers)}`
    );
  }

  const unsafeBodies = [
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  const alias = source;
  alias.pick().enabled = true;
  source.pick = () => fallbackAction;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  const alias = source;
  source.pick().enabled = true;
  alias.pick = () => fallbackAction;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  alias.pick().enabled = true;
  alias = safe;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  const unknown = Boolean(detail.value);
  if (unknown) {
    alias = safe;
  }
  alias.pick().enabled = true;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  function reset() {
    alias = safe;
  }
  void reset;
  alias.pick().enabled = true;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = safe;
  alias = unsafe;
  alias.pick().enabled = true;`,
    `const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = safe;
  alias.pick().enabled = true;
  alias = unsafe;`,
    `function mutate(value: {
    pick: () => { enabled: boolean }
  }) {
    value.pick().enabled = true;
  }
  const source = {
    pick: () => detail.value?.availableActions[0]
  };
  mutate(source);
  source.pick = () => fallbackAction;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  function expose() {
    return source;
  }
  expose().pick().enabled = true;
  source.pick = () => fallbackAction;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  const alias = Object.create(source);
  alias.pick().enabled = true;
  source.pick = () => fallbackAction;`,
    `function mutate(value: {
    pick: () => { enabled: boolean }
  }) {
    value.pick().enabled = true;
  }
  const unsafe = {
    pick: () => detail.value?.availableActions[0]
  };
  const safe = {
    pick: () => fallbackAction
  };
  let alias = unsafe;
  mutate(alias);
  alias = safe;`,
    `const key: string = "pick";
  const source = {
    pick: () => detail.value?.availableActions[0]
  };
  source[key]().enabled = true;
  source.pick = () => fallbackAction;`,
    `const source = {
    pick: () => detail.value?.availableActions[0]
  };
  source.valueOf().pick().enabled = true;
  source.pick = () => fallbackAction;`,
    `const source = {
    pick: () => detail.value?.availableActions[0],
    get self() {
      return this;
    }
  };
  source.self.pick().enabled = true;
  source.pick = () => fallbackAction;`
  ];

  for (const unsafeBody of unsafeBodies) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
const fallbackAction = {
  key: "fallback",
  enabled: false
};
${unsafeBody}
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest =
      await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", unsafeBody);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      unsafeBody
    );
  }
});

test("accepts a shallow capability ref with null resets and same-GET request aliases", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { shallowRef } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = shallowRef(null);
let selectedId = "";
async function load() {
  const firstRequest = getExample("example-1");
  const firstResponse = await firstRequest;
  detail.value = firstResponse;
  selectedId = detail.value.id;
  detail.value = null;
  const secondRequest = getExample("example-1");
  detail.value = await secondRequest;
}
void load();
void selectedId;
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
});

test("proves server_definition only from the exact definition key and fresh GET", async () => {
  const root = await serverDefinitionFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify({ action: manifest.actions[0], blockers: manifest.blockers })
  );
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);

  const ancestorRoot = await serverDefinitionFixture({
    fixtureOverrides: {
      page: serverDefinitionPage().replace(
        `<t-button v-if="definition?.key" @click="submit">提交</t-button>`,
        `<div v-if="definition?.key"><t-button @click="submit">提交</t-button></div>`
      )
    }
  });
  const ancestorManifest = await inspectWholeSitePageActionManifest({
    root: ancestorRoot
  });
  assert.equal(
    ancestorManifest.status,
    "ready",
    JSON.stringify({
      action: ancestorManifest.actions[0],
      blockers: ancestorManifest.blockers
    })
  );
  assert.equal(ancestorManifest.actions[0].capability.dominatesTrigger, true);

  const rejects = [
    [
      "unknown kind",
      { capability: { kind: "server_unknown", source: "definition.key" } },
      {},
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "arbitrary object key",
      {},
      {
        gate: "other?.key === 'example'",
        extraFiles: {
          "apps/web-admin/src/api/example.api.ts": `export async function fetchBusinessEntryDefinition() {
  return { key: "example", version: 1, fields: [], rules: [] };
}
export async function submitExample() { return undefined; }
export const other = { key: "example" };
`
        }
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "version source",
      { capability: { kind: "server_definition", source: "definition.version" } },
      {},
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "static string gate",
      {},
      { gate: `"example" === "example"` },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "static object ref",
      {},
      {
        readExpression: `{ key: "example", version: 1, fields: [], rules: [] }`
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "different ref",
      {},
      {
        gate: "otherDefinition?.key === 'example'",
        extraFiles: {
          "apps/web-admin/src/api/example.api.ts": `export async function fetchBusinessEntryDefinition() {
  return { key: "example", version: 1, fields: [], rules: [] };
}
export async function submitExample() { return undefined; }
`
        }
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "no v-if",
      {},
      {
        fixtureOverrides: {
          page: serverDefinitionPage().replace(/ v-if="[^"]+"/u, "")
        }
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "disabled only",
      {},
      { gate: "true", fixtureOverrides: { page: serverDefinitionPage({ gate: "true" }).replace(
        `v-if="true"`,
        `:disabled="!definition?.key"`
      ) } },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "client boolean",
      {},
      {
        fixtureOverrides: {
          page: serverDefinitionPage({ gate: "canSubmit" }).replace(
            "</script>",
            "const canSubmit = true;\n</script>"
          )
        }
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "role gate",
      {},
      { gate: `currentRole === "contract_director"` },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "wrong transport",
      {},
      {
        fixtureOverrides: {
          wrappers: [
            wrapper(),
            definitionReadWrapper({ normalizedKey: "POST /examples/:param/definition" })
          ],
          routes: [
            route(),
            route("POST /examples/:param/definition")
          ]
        }
      },
      "WRITE_WITHOUT_SERVER_CAPABILITY"
    ],
    [
      "handler without fresh GET",
      {},
      { handlerRead: false },
      "SERVER_DEFINITION_HANDLER_FRESH_READ_UNVERIFIED"
    ]
  ];

  for (const [label, actionOverrides, pageOptions, expectedCode] of rejects) {
    const fixtureOverrides = pageOptions.fixtureOverrides ?? {};
    const candidateRoot = await fixture({
      actions: [serverDefinitionAction(actionOverrides)],
      wrappers: fixtureOverrides.wrappers ?? [wrapper(), definitionReadWrapper()],
      routes: fixtureOverrides.routes ?? [route()],
      extraFiles: {
        "apps/web-admin/src/api/example.api.ts": `export async function fetchBusinessEntryDefinition() {
  return { key: "example", version: 1, fields: [], rules: [] };
}
export async function submitExample() { return undefined; }
`,
        ...(pageOptions.extraFiles ?? {})
      },
      page: fixtureOverrides.page ?? serverDefinitionPage(pageOptions)
    });
    const candidate = await inspectWholeSitePageActionManifest({
      root: candidateRoot
    });
    assert.equal(candidate.status, "blocked", label);
    assert.ok(
      blockerCodes(candidate).has(expectedCode),
      `${label}: ${JSON.stringify(candidate.blockers)}`
    );
  }
});

test("accepts a handler-local capability source with a guarded independent submission", async () => {
  const root = await serverDefinitionFixture({
    fixtureOverrides: {
      page: `<script setup lang="ts">
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
async function readFreshDefinition() {
  try {
    return await fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );
  } catch (error) {
    throw error;
  }
}
function assertFreshDefinition(
  candidate: { key: string; entityId: string; revision: number },
  entityId: string,
  revision: number
) {
  if (
    candidate.key !== "example" ||
    candidate.entityId !== entityId ||
    candidate.revision !== revision
  ) {
    throw new Error("definition changed");
  }
}
async function submit() {
  const definition = await readFreshDefinition();
  assertFreshDefinition(definition, "example-1", 1);
  await submitExample("example-1");
}
</script>
<template>
  <t-button @click="submit">提交</t-button>
</template>
`
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

test("rejects unsafe handler-local capability source bindings", async () => {
  const safePage = `<script setup lang="ts">
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
async function readFreshDefinition() {
  try {
    return await fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );
  } catch (error) {
    throw error;
  }
}
function assertFreshDefinition(
  candidate: { key: string; entityId: string; revision: number },
  entityId: string,
  revision: number
) {
  if (
    candidate.key !== "example" ||
    candidate.entityId !== entityId ||
    candidate.revision !== revision
  ) {
    throw new Error("definition changed");
  }
}
async function submit() {
  const definition = await readFreshDefinition();
  assertFreshDefinition(definition, "example-1", 1);
  await submitExample("example-1");
}
</script>
<template>
  <t-button @click="submit">提交</t-button>
</template>
`;
  const cases = [
    [
      "multiple bindings",
      safePage.replace(
        `  assertFreshDefinition(definition, "example-1", 1);`,
        `  {
    const definition = await readFreshDefinition();
    assertFreshDefinition(definition, "example-1", 1);
  }
  assertFreshDefinition(definition, "example-1", 1);`
      )
    ],
    [
      "reassigned binding",
      safePage.replace(
        "  const definition = await readFreshDefinition();",
        `  let definition = await readFreshDefinition();
  definition = await readFreshDefinition();`
      )
    ],
    [
      "cross-handler binding",
      safePage.replace(
        `async function submit() {
  const definition = await readFreshDefinition();
  assertFreshDefinition(definition, "example-1", 1);
  await submitExample("example-1");
}`,
        `async function load() {
  const definition = await readFreshDefinition();
  assertFreshDefinition(definition, "example-1", 1);
}
void load();
async function submit() {
  await submitExample("example-1");
}`
      )
    ],
    [
      "guard after write",
      safePage.replace(
        `  assertFreshDefinition(definition, "example-1", 1);
  await submitExample("example-1");`,
        `  await submitExample("example-1");
  assertFreshDefinition(definition, "example-1", 1);`
      )
    ],
    [
      "swallowed error or fallback",
      safePage.replace(
        "    throw error;",
        `    return {
      key: "example",
      entityId: "example-1",
      revision: 1
    };`
      )
    ],
    [
      "dynamic property",
      safePage.replace(
        `  assertFreshDefinition(definition, "example-1", 1);`,
        `  const field = "key";
  if (definition[field] !== "example") {
    throw new Error("definition changed");
  }
  await submitExample("example-1");`
      )
    ],
    [
      "opaque alias",
      safePage.replace(
        `  assertFreshDefinition(definition, "example-1", 1);`,
        `  function passThrough(value: unknown) {
    return value;
  }
  const alias = passThrough(definition);
  assertFreshDefinition(alias, "example-1", 1);
  await submitExample("example-1");`
      )
    ],
    [
      "detached async read",
      safePage.replace(
        `    return await fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );`,
        `    const request = fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );
    return await request;`
      )
    ]
  ];

  for (const [label, page] of cases) {
    const root = await serverDefinitionFixture({
      fixtureOverrides: { page }
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", label);
    assert.ok(
      blockerCodes(manifest).has("WRITE_WITHOUT_SERVER_CAPABILITY") ||
        blockerCodes(manifest).has("FRESH_READ_BINDING_UNVERIFIED") ||
        blockerCodes(manifest).has("SERVER_DEFINITION_HANDLER_FRESH_READ_UNVERIFIED") ||
        blockerCodes(manifest).has("ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"),
      `${label}: ${JSON.stringify(manifest.blockers)}`
    );
  }
});

test("requires an explicit GET-only fresh-read binding separate from submission targets", async () => {
  const root = await serverDefinitionFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.deepEqual(
    manifest.actions[0].capability.freshRead,
    {
      apiFile: "apps/web-admin/src/api/example.api.ts",
      name: "fetchBusinessEntryDefinition",
      method: "GET",
      mode: "read_only_probe",
      binding: {
        actor: "actor",
        company: "company",
        scene: "scene",
        action: "action",
        definitionRevision: "definitionRevision"
      },
      submissionTarget: "independent"
    }
  );

  const rejects = [
    ["probe mutation", { method: "POST" }, "FRESH_READ_BINDING_NOT_GET"],
    [
      "probe shares submission target",
      { submissionTarget: "create_target" },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding missing company",
      {
        binding: {
          actor: "actor",
          scene: "scene",
          action: "action",
          definitionRevision: "definitionRevision"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding missing actor",
      {
        binding: {
          company: "company",
          scene: "scene",
          action: "action",
          definitionRevision: "definitionRevision"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding missing scene",
      {
        binding: {
          actor: "actor",
          company: "company",
          action: "action",
          definitionRevision: "definitionRevision"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding missing action",
      {
        binding: {
          actor: "actor",
          company: "company",
          scene: "scene",
          definitionRevision: "definitionRevision"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding missing revision",
      {
        binding: {
          actor: "actor",
          company: "company",
          scene: "scene",
          action: "action"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe binding accepts no client purpose override",
      {
        binding: {
          actor: "actor",
          company: "company",
          scene: "scene",
          action: "action",
          definitionRevision: "definitionRevision",
          purpose: "client-purpose"
        }
      },
      "REGISTRY_ENTRY_INVALID"
    ],
    [
      "probe wrapper is not the fresh read",
      { name: "otherDefinitionRead" },
      "FRESH_READ_BINDING_UNVERIFIED"
    ]
  ];

  for (const [label, freshReadOverrides, expectedCode] of rejects) {
    const base = serverDefinitionAction().capability.freshRead;
    const candidateRoot = await serverDefinitionFixture({
      fixtureOverrides: {
        actions: [
          serverDefinitionAction({
            capability: {
              ...serverDefinitionAction().capability,
              freshRead: {
                ...base,
                ...freshReadOverrides,
                ...(freshReadOverrides.binding
                  ? { binding: freshReadOverrides.binding }
                  : {})
              }
            }
          })
        ]
      }
    });
    const candidate = await inspectWholeSitePageActionManifest({
      root: candidateRoot
    });
    assert.equal(candidate.status, "blocked", label);
    assert.ok(
      blockerCodes(candidate).has(expectedCode),
      `${label}: ${JSON.stringify(candidate.blockers)}`
    );
  }
});

test("accepts a fresh GET helper with transparent error propagation before a mutation", async () => {
  const root = await serverDefinitionFixture({
    fixtureOverrides: {
      page: `<script setup lang="ts">
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
const definition = await fetchBusinessEntryDefinition(
  "example",
  { scope: "global" },
  { entityType: "example", entityId: "example-1" }
);
async function readFreshDefinition() {
  try {
    return await fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );
  } catch (error) {
    throw error;
  }
}
async function submit() {
  await readFreshDefinition();
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="definition?.key" @click="submit">提交</t-button>
</template>
`
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

test("accepts a controlled fail-closed guard helper before a mutation", async () => {
  const root = await serverDefinitionFixture({
    fixtureOverrides: {
      page: `<script setup lang="ts">
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
const definition = await fetchBusinessEntryDefinition(
  "example",
  { scope: "global" },
  { entityType: "example", entityId: "example-1" }
);
function assertFreshDefinition(
  candidate: { key: string; entityId: string; revision: number },
  entityId: string,
  revision: number
) {
  if (
    candidate.key !== "example" ||
    candidate.entityId !== entityId ||
    candidate.revision !== revision
  ) {
    throw new Error("definition changed");
  }
}
async function submit() {
  const freshDefinition = await fetchBusinessEntryDefinition(
    "example",
    { scope: "global" },
    { entityType: "example", entityId: "example-1" }
  );
  assertFreshDefinition(freshDefinition, "example-1", 1);
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="definition?.key" @click="submit">提交</t-button>
</template>
`
    }
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    manifest.status,
    "ready",
    JSON.stringify(manifest.blockers)
  );
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

test("rejects detached, swallowed, late, and cross-handler fresh-read guards", async () => {
  const safePage = `<script setup lang="ts">
import {
  fetchBusinessEntryDefinition,
  submitExample
} from "../api/example.api";
const definition = await fetchBusinessEntryDefinition(
  "example",
  { scope: "global" },
  { entityType: "example", entityId: "example-1" }
);
async function readFreshDefinition() {
  try {
    return await fetchBusinessEntryDefinition(
      "example",
      { scope: "global" },
      { entityType: "example", entityId: "example-1" }
    );
  } catch (error) {
    throw error;
  }
}
function assertFreshDefinition(
  candidate: { key: string; entityId: string; revision: number },
  entityId: string,
  revision: number
) {
  if (
    candidate.key !== "example" ||
    candidate.entityId !== entityId ||
    candidate.revision !== revision
  ) {
    throw new Error("definition changed");
  }
}
async function submit() {
  const freshDefinition = await readFreshDefinition();
  assertFreshDefinition(freshDefinition, "example-1", 1);
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="definition?.key" @click="submit">提交</t-button>
</template>
`;
  const cases = [
    [
      "swallowed error",
      safePage.replace("throw error;", "return null;")
    ],
    [
      "detached request",
      safePage.replace(
        /async function readFreshDefinition\(\) \{[\s\S]*?\n\}/,
        `async function readFreshDefinition() {
  const request = fetchBusinessEntryDefinition(
    "example",
    { scope: "global" },
    { entityType: "example", entityId: "example-1" }
  );
  return null;
}`
      )
    ],
    [
      "guard after write",
      safePage.replace(
        `  const freshDefinition = await readFreshDefinition();
  assertFreshDefinition(freshDefinition, "example-1", 1);
  await submitExample("example-1");`,
        `  await submitExample("example-1");
  const freshDefinition = await readFreshDefinition();
  assertFreshDefinition(freshDefinition, "example-1", 1);`
      )
    ],
    [
      "guard across a handler",
      safePage.replace(
        `function assertFreshDefinition(`,
        `function applyDefinitionGuard(candidate: { key: string; entityId: string; revision: number }) {
  assertFreshDefinition(candidate, "example-1", 1);
}
function assertFreshDefinition(`
      ).replace(
        `  assertFreshDefinition(freshDefinition, "example-1", 1);`,
        `  applyDefinitionGuard(freshDefinition);`
      )
    ],
    [
      "missing revision guard",
      safePage.replace(
        `    candidate.entityId !== entityId ||
    candidate.revision !== revision`,
        `    candidate.entityId !== entityId`
      )
    ]
  ];

  for (const [label, page] of cases) {
    const root = await serverDefinitionFixture({
      fixtureOverrides: { page }
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", label);
    assert.ok(
      blockerCodes(manifest).has("FRESH_READ_BINDING_UNVERIFIED") ||
        blockerCodes(manifest).has("SERVER_DEFINITION_HANDLER_FRESH_READ_UNVERIFIED") ||
        blockerCodes(manifest).has("ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED"),
      `${label}: ${JSON.stringify(manifest.blockers)}`
    );
  }
});

test("rejects mixed or non-GET sources for a capability ref", async () => {
  const secondRead = wrapper({
    name: "getOtherExample",
    normalizedKey: "GET /other-examples/:param"
  });
  const mixedRoot = await fixture({
    wrappers: [wrapper(), capabilityReadWrapper(), secondRead],
    routes: [route(), route("GET /other-examples/:param")],
    extraFiles: {
      "apps/web-admin/src/api/example.api.ts": `export async function getExample() { return { availableActions: [] }; }
export async function getOtherExample() { return { availableActions: [] }; }
export async function submitExample() { return undefined; }
`
    },
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, getOtherExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load(useOther: boolean) {
  detail.value = await getExample("example-1");
  if (useOther) {
    detail.value = await getOtherExample("other-1");
  }
}
void load(false);
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const mixed = await inspectWholeSitePageActionManifest({
    root: mixedRoot
  });
  assert.equal(mixed.status, "blocked");
  assert.ok(
    blockerCodes(mixed).has("AVAILABLE_ACTION_PROVENANCE_UNVERIFIED")
  );

  const unsafeRead = wrapper({
    name: "loadExampleUnsafe",
    normalizedKey: "POST /examples/:param/load"
  });
  const postRoot = await fixture({
    wrappers: [wrapper(), unsafeRead],
    routes: [route(), route("POST /examples/:param/load")],
    extraFiles: {
      "apps/web-admin/src/api/example.api.ts": `export async function getExample() { return { availableActions: [] }; }
export async function loadExampleUnsafe() { return { availableActions: [] }; }
export async function submitExample() { return undefined; }
`
    },
    page: `<script setup lang="ts">
import { ref } from "vue";
import { loadExampleUnsafe, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await loadExampleUnsafe("example-1");
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
  });
  const post = await inspectWholeSitePageActionManifest({
    root: postRoot
  });
  assert.equal(post.status, "blocked");
  assert.ok(
    blockerCodes(post).has("AVAILABLE_ACTION_PROVENANCE_UNVERIFIED")
  );
});

test("rejects capability-ref mutation aliases, parameter escapes, and discarded-read fakes", async () => {
  const deeplyNestedCallback = Array.from(
    { length: 17 },
    (_, index) => index
  ).reduce((value) => `[${value}]`, "pick");
  const deeplyNestedAccess = Array.from(
    { length: 17 },
    () => "[0]"
  ).join("");
  const unsafeBodies = [
    `const alias = detail;
  alias.value = { availableActions: [{ key: "submit_approval", enabled: true }] };`,
    `const alias = detail.value;
  alias.availableActions = [{ key: "submit_approval", enabled: true }];`,
    `Object.assign(detail.value, {
    availableActions: [{ key: "submit_approval", enabled: true }]
  });`,
    `function escape(value: unknown) { return value; }
  escape(detail);`,
    `function escape(value: unknown) { return value; }
  escape(detail.value);`,
    `function actions() { return detail.value.availableActions; }
  actions().push({ key: "submit_approval", enabled: true });`,
    `function actions() { return detail.value.availableActions; }
  actions().splice(0, actions().length, {
    key: "submit_approval",
    enabled: true
  });`,
    `function actions() { return detail.value.availableActions; }
  Object.assign(actions(), {
    0: { key: "submit_approval", enabled: true },
    length: 1
  });`,
    `function mutate(actions: unknown[]) {
    actions.push({ key: "submit_approval", enabled: true });
  }
  mutate(detail.value.availableActions);`,
    `const escaped: { actions?: unknown[] } = {};
  escaped.actions = detail.value.availableActions;`,
    `const selected = computed(
    () => detail.value.availableActions[0]
  );
  selected.value.enabled = true;`,
    `const selected = computed(
    () => detail.value.availableActions[0]
  ).value;
  selected.enabled = true;`,
    `const getter =
    () => detail.value.availableActions[0];
  const selected = computed(getter);
  selected.value.enabled = true;`,
    `const pick =
    () => detail.value.availableActions[0];
  function mutateWith(callable: () => unknown) {
    const action = callable();
    action.enabled = true;
  }
  mutateWith(pick);`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  function mutateWith(value: typeof helpers) {
    const action = value.pick();
    action.enabled = true;
  }
  mutateWith(helpers);`,
    `const pick =
    () => detail.value.availableActions[0];
  function mutateWith(options: { pick: typeof pick }) {
    options.pick().enabled = true;
  }
  mutateWith({ pick });`,
    `const pick =
    () => detail.value.availableActions[0];
  const callbacks = [pick];
  function mutateWith(values: Array<typeof pick>) {
    values[0]().enabled = true;
  }
  mutateWith(callbacks);`,
    `const pick =
    () => detail.value.availableActions[0];
  const callbacks = ${deeplyNestedCallback};
  function mutateWith(values: unknown) {
    const action = values${deeplyNestedAccess}();
    action.enabled = true;
  }
  mutateWith(callbacks);`,
    `const pick =
    () => detail.value.availableActions[0];
  let holder: { pick: typeof pick };
  holder = { pick };
  holder.pick().enabled = true;`,
    `const fallback = { enabled: false };
  const alias = { pick: () => fallback };
  alias.pick =
    () => detail.value.availableActions[0];
  alias.pick().enabled = true;`,
    `const fallback = { enabled: false };
  const alias = {
    pick: () => detail.value.availableActions[0]
  };
  alias.pick().enabled = true;
  alias.pick = () => fallback;`,
    `const fallback = { enabled: false };
  const alias = {
    pick: () => detail.value.availableActions[0]
  };
  if (false) {
    alias.pick = () => fallback;
  }
  alias.pick().enabled = true;`,
    `const fallback = { enabled: false };
  const alias = {
    pick: () => detail.value.availableActions[0]
  };
  false && (alias.pick = () => fallback);
  alias.pick().enabled = true;`,
    `const fallback = { enabled: false };
  const alias = {
    pick: () => detail.value.availableActions[0]
  };
  function replacePick() {
    alias.pick = () => fallback;
  }
  void replacePick;
  alias.pick().enabled = true;`,
    `const pick =
    () => detail.value.availableActions[0];
  function expose() {
    return { pick };
  }
  expose().pick().enabled = true;`,
    `const pick =
    () => detail.value.availableActions[0];
  const expose = () => pick;
  expose()().enabled = true;`,
    `const selected = computed({
    get: () => detail.value.availableActions[0],
    set: () => undefined
  });
  selected.value.enabled = true;`,
    `const getter =
    () => detail.value.availableActions[0];
  const fallbackGetter = () => null;
  const flag = Boolean(detail.value);
  const selected = computed(
    flag ? getter : fallbackGetter
  );
  selected.value.enabled = true;`,
    `const pick =
    () => detail.value.availableActions[0];
  const selected = computed({
    get: () => null,
    pick
  });
  void selected.value;`,
    `void getExample("discarded-read");
  detail.value = { availableActions: [{ key: "submit_approval", enabled: true }] };`
  ];

  for (const unsafeBody of unsafeBodies) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { computed, ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
  ${unsafeBody}
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked", unsafeBody);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      unsafeBody
    );
  }
});

test("rejects an escape through an ancestor of a nested capability source", async () => {
  const root = await fixture({
    actions: [
      registryAction({
        capability: {
          kind: "detail_action",
          source: "detail.invoice.invoices",
          key: "submit_approval"
        }
      })
    ],
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
  function invoiceState() {
    return detail.value.invoice;
  }
  invoiceState().invoices[0].availableActions.push({
    key: "submit_approval",
    enabled: true
  });
}
void load();
function actionEnabled(key: string) {
  return detail.value?.invoice.invoices[0].availableActions.some(
    (action) => action.key === key && action.enabled
  );
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

test("rejects mutation through elements derived from a protected capability collection", async () => {
  const derivedElements = [
    "detail.value.availableActions[0]",
    "detail.value.availableActions[index]",
    "detail.value.availableActions.at(0)",
    "detail.value.availableActions.find(() => true)",
    "detail.value.availableActions.filter(() => true)[0]",
    "[...detail.value.availableActions][0]"
  ];

  for (const derivedElement of derivedElements) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
const index = 0;
async function load() {
  detail.value = await getExample("example-1");
  const action = ${derivedElement};
  action.key = "submit_approval";
  action.enabled = true;
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked", derivedElement);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      derivedElement
    );
    assert.equal(
      manifest.actions[0].capability.dominatesTrigger,
      false,
      derivedElement
    );
  }
});

test("rejects mutation inside protected collection callbacks and alias methods", async () => {
  const mutations = [
    `detail.value.availableActions.forEach((action) => {
    action.enabled = true;
  });`,
    `detail.value.availableActions.forEach((_action, _index, actions) => {
    actions[0].enabled = true;
  });`,
    `detail.value.availableActions.forEach((...args) => {
    args[0].enabled = true;
  });`,
    `detail.value.availableActions.forEach((
    action = { key: "none", enabled: false }
  ) => {
    action.enabled = true;
  });`,
    `detail.value.availableActions.find((action) => {
    action.key = "submit_approval";
    return true;
  });`,
    `const actions = detail.value.availableActions;
  actions.push({ key: "submit_approval", enabled: true });`
  ];

  for (const mutation of mutations) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
  ${mutation}
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked", mutation);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      mutation
    );
  }
});

test("rejects protected elements hidden by containers, branches, iteration, or reducers", async () => {
  const mutations = [
    `const pick = () => detail.value.availableActions[0];
  const action = pick();
  action.enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  const action = helpers.pick();
  action.enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  const pick = helpers.pick;
  const action = pick();
  action.enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  const { pick } = helpers;
  const action = pick();
  action.enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  const { pick: select } = helpers;
  const action = select();
  action.enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = { ...helpers };
  const action = alias.pick();
  action.enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const holder = { nested: source };
  holder.nested.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = (0, source);
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = source satisfies typeof source;
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  source.pick.call(null).enabled = true;`,
    `const source = {
    pick: <T = void>() => detail.value.availableActions[0]
  };
  const pick = source.pick<void>;
  pick().enabled = true;`,
    `const key: string = "pick";
  const source = {
    [key]: () => detail.value.availableActions[0]
  };
  source[key]().enabled = true;`,
    `const key = Symbol("pick");
  const source = {
    [key]: () => detail.value.availableActions[0]
  };
  source[key]().enabled = true;`,
    `const key: string = "pick";
  const source = {
    pick: () => detail.value.availableActions[0]
  };
  source[key]().enabled = true;`,
    `const source = {
    pick: function () {
      return detail.value.availableActions[0];
    }
  };
  (new source.pick()).enabled = true;`,
    `const source = {
    pick: function () {
      return detail.value.availableActions[0];
    }
  };
  const Pick = source.pick;
  (new Pick()).enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const [alias] = [source];
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = [source][0];
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  [source][0].pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = [source].at(0);
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  [source].pop()!.pick().enabled = true;`,
    `const holder = {
    nested: {
      pick: () => detail.value.availableActions[0]
    }
  };
  holder.nested.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  ({ nested: source }).nested.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const holder = { nested: source };
  const { nested: alias } = holder;
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const getSource = () => source;
  getSource().pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  class Holder {
    nested = source;
  }
  new Holder().nested.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  function mutate(value = source) {
    value.pick().enabled = true;
  }
  mutate();`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  function mutate({ pick } = source) {
    pick().enabled = true;
  }
  mutate();`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  for (const alias of [source]) {
    alias.pick().enabled = true;
  }`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  try {
    throw source;
  } catch (alias) {
    alias.pick().enabled = true;
  }`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  function* expose() {
    yield source;
  }
  expose().next().value.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  function pass(_strings: TemplateStringsArray, value: typeof source) {
    return value;
  }
  pass\`x\${source}\`.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  eval("source.pick().enabled = true");`,
    `detail.value.availableActions.forEach(function () {
    arguments[0].enabled = true;
  });`,
    `detail.value.availableActions.forEach(function () {
    arguments[2].push({ key: "forged", enabled: true });
  });`,
    `detail.value.availableActions
    .toSpliced()[0].enabled = true;`,
    `detail.value.availableActions[
    Symbol.iterator
  ]().next().value.enabled = true;`,
    `const iterator =
    detail.value.availableActions[Symbol.iterator]();
  iterator.next().value.enabled = true;`,
    `const Symbol = { iterator: "forged" };
  detail.value.availableActions[
    Symbol.iterator
  ]().next().value.enabled = true;`,
    `detail.value.availableActions
    .valueOf()[0].enabled = true;`,
    `detail.value.availableActions[0]
    .valueOf().enabled = true;`,
    `detail.value.availableActions[0]
    .__defineGetter__("enabled", () => true);`,
    `detail.value.availableActions
    .__defineGetter__("0", () => ({
      key: "forged",
      enabled: true
    }));`,
    `const pick = () => detail.value.availableActions[0];
  pick.call(null).enabled = true;`,
    `const pick = () => detail.value.availableActions[0];
  pick.apply(null, []).enabled = true;`,
    `const pick = () => detail.value.availableActions[0];
  const boundPick = pick.bind(null);
  boundPick().enabled = true;`,
    `const Base = function () {
    return detail.value.availableActions[0];
  } as unknown as new () => any;
  class Derived extends Base {}
  new Derived().enabled = true;`,
    `const Base = function () {
    return detail.value.availableActions[0];
  } as unknown as new () => any;
  const Derived = class extends Base {};
  new Derived().enabled = true;`,
    `class Holder {
    action = detail.value.availableActions[0];
  }
  new Holder().action.enabled = true;`,
    `class Holder {
    #action = detail.value.availableActions[0];
    mutate() {
      this.#action.enabled = true;
    }
  }
  new Holder().mutate();`,
    `class Holder {
    static action = detail.value.availableActions[0];
  }
  Holder.action.enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  const alias = source.valueOf();
  alias.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0],
    self() {
      return this;
    }
  };
  source.self().pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0],
    get self() {
      return this;
    }
  };
  source.self.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0],
    self() {
      const me = this;
      return me;
    }
  };
  source.self().pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0],
    get self() {
      const me = this;
      return me;
    }
  };
  source.self.pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0],
    self() {
      return (() => this)();
    }
  };
  source.self().pick().enabled = true;`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  ({ enabled: source.pick().enabled } = { enabled: true });`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  [source.pick().enabled] = [true];`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  ({ nested: { enabled: source.pick().enabled } } = {
    nested: { enabled: true }
  });`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  for (source.pick().enabled of [true]) {}`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  for (source.pick().enabled in { x: 1 }) {}`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  for ({ enabled: source.pick().enabled } of [{ enabled: true }]) {}`,
    `const source = {
    pick: () => detail.value.availableActions[0]
  };
  let holder = {
    direct: () => detail.value.availableActions[0]
  };
  holder = (0, { nested: source });
  holder.nested.pick().enabled = true;`,
    `const helpers = {
    pick: () => detail.value.availableActions[0]
  };
  let alias;
  alias = helpers;
  const action = alias.pick();
  action.enabled = true;`,
    `const box = {
    action: detail.value.availableActions[0]
  };
  box.action.enabled = true;`,
    `const box = {
    ...{ action: detail.value.availableActions[0] }
  };
  box.action.enabled = true;`,
    `const action = flag
    ? detail.value.availableActions[0]
    : fallback;
  action.enabled = true;`,
    `const action =
    detail.value.availableActions[0] || fallback;
  action.enabled = true;`,
    `const action = (
    fallback,
    detail.value.availableActions[0]
  );
  action.enabled = true;`,
    `for (const action of detail.value.availableActions) {
    action.enabled = true;
  }`,
    `detail.value.availableActions.reduce((accumulator) => {
    accumulator.enabled = true;
    return accumulator;
  });`
  ];

  for (const mutation of mutations) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
const flag = true;
const fallback = { key: "none", enabled: false };
async function load() {
  detail.value = await getExample("example-1");
  ${mutation}
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() { await submitExample("example-1"); }
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">提交审批</t-button>
</template>
`
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });

    assert.equal(manifest.status, "blocked", mutation);
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      mutation
    );
  }
});

test("rejects exporting a protected getter across a reachable module edge", async () => {
  const root = await fixture({
    main: `import { createApp } from "vue";
import { router } from "./routes";
import "./mutate-leaked-action";
const app = createApp({});
app.use(router);
`,
    page: `<script lang="ts">
import { defineComponent, ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
export const leakAction = () =>
  detail.value?.availableActions[0];
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
export default defineComponent({
  setup() {
    return { actionEnabled, submit };
  }
});
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`,
    extraFiles: {
      "apps/web-admin/src/mutate-leaked-action.ts": `import { leakAction } from "./pages/ExamplePage.vue";
leakAction()!.enabled = true;
`
    },
    webManifestOverrides: {
      evidence: {
        productionModuleCount: 6,
        reachableProductionModuleCount: 6
      }
    }
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
});

test("rejects a GET wrapper not attributed to the current production consumer", async () => {
  const foreignRead = wrapper({
    name: "getExample",
    normalizedKey: "GET /examples/:param",
    productionConsumers: [
      "apps/web-admin/src/pages/RoguePage.vue"
    ]
  });
  const root = await fixture({
    wrappers: [wrapper(), foreignRead],
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
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
    blockerCodes(manifest).has("AVAILABLE_ACTION_PROVENANCE_UNVERIFIED")
  );
});

test("rejects a server-read ref with a forged capability assignment or deeper mutation", async () => {
  for (const forgedWrite of [
    `detail.value = { availableActions: [{ key: "submit_approval", enabled: true }] };`,
    `detail.value.availableActions = [{ key: "submit_approval", enabled: true }];`
  ]) {
    const root = await fixture({
      page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  detail.value = await getExample("example-1");
  ${forgedWrite}
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some((action) => action.key === key && action.enabled);
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
  }
});

test("rejects capability reads whose GET wrapper lacks transparent return provenance", async () => {
  for (const returnProvenance of [
    "unverified",
    "forged",
    undefined
  ]) {
    const root = await fixture({
      wrappers: [
        wrapper(),
        wrapper({
          name: "getExample",
          normalizedKey: "GET /examples/:param",
          returnProvenance
        })
      ]
    });
    const manifest = await inspectWholeSitePageActionManifest({
      root
    });

    assert.equal(
      manifest.status,
      "blocked",
      `${returnProvenance ?? "missing"}: ${JSON.stringify(manifest.blockers)}`
    );
    assert.ok(
      blockerCodes(manifest).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      returnProvenance ?? "missing"
    );
    assert.equal(
      manifest.actions[0].capability.serverDerived,
      false
    );
    if (returnProvenance === "forged") {
      assert.ok(
        manifest.blockers.upstreamManifestIssues.some(
          (issue) =>
            issue.code ===
            "UPSTREAM_WEB_WRAPPER_RETURN_PROVENANCE_INVALID"
        )
      );
    }
  }
});

test("does not let a local alias named like an import break reverse provenance", async () => {
  const root = await fixture({
    page: `<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const detail = ref(null);
async function load() {
  const response = await getExample("example-1");
  const submitExample = response;
  detail.value = submitExample;
  response.availableActions[0].enabled = true;
}
void load();
function actionEnabled(key: string) {
  return detail.value?.availableActions.some(
    (action) => action.key === key && action.enabled
  );
}
async function submit() {
  await submitExample("example-1");
}
</script>
<template>
  <t-button v-if="actionEnabled('submit_approval')" @click="submit">
    提交审批
  </t-button>
</template>
`
  });
  const manifest =
    await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked");
  assert.ok(
    blockerCodes(manifest).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );
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

test("trusts BusinessDraftAction only when every execute path is the guarded action", async () => {
  const component = ({
    unsafeScript = "",
    unsafeTemplate = ""
  } = {}) => `<script setup lang="ts">
import { computed, ref } from "vue";
const props = defineProps<{
  actions: Array<{ key: string; enabled: boolean }>;
  execute: (request: {
    action: string;
    reason: string;
    password: string;
  }) => Promise<void>;
}>();
const actionItems = computed(() => props.actions);
const enabledActionItems = computed(() =>
  actionItems.value.filter((action) => action.enabled)
);
const selectedAction = ref<{
  key: string;
  enabled: boolean;
} | null>(null);
function selectAction(action: {
  key: string;
  enabled: boolean;
}) {
  if (!action.enabled) return;
  selectedAction.value = action;
}
async function executeAction() {
  const action = selectedAction.value;
  if (!action) return;
  await props.execute({
    action: action.key,
    reason: "",
    password: ""
  });
  selectedAction.value = null;
}
${unsafeScript}
</script>
<template>
  <button
    v-for="action in enabledActionItems"
    :key="action.key"
    :disabled="!action.enabled"
    @click="selectAction(action)"
  >
    {{ action.key }}
  </button>
  <div @confirm="executeAction" />
  ${unsafeTemplate}
</template>
`;
  const action = registryAction({
    trigger: {
      element: "business-draft-action",
      event: "execute",
      handler: "submit",
      variant: "submit_approval"
    }
  });
  const page = `<script setup lang="ts">
import BusinessDraftAction from "../components/BusinessDraftAction.vue";
import { getExample, submitExample } from "../api/example.api";
const detail = await getExample("example-1");
async function submit(request: { action: string }) {
  await submitExample(request.action);
}
</script>
<template>
  <BusinessDraftAction
    :actions="detail.availableActions.filter(
      (action) =>
        action.key === 'submit_approval' && action.enabled
    )"
    :execute="submit"
  />
</template>
`;
  const inspect = async (source) => {
    const root = await fixture({
      actions: [action],
      page,
      extraFiles: {
        "apps/web-admin/src/components/BusinessDraftAction.vue":
          source
      },
      webManifestOverrides: {
        evidence: {
          productionModuleCount: 6,
          reachableProductionModuleCount: 6
        }
      }
    });
    return inspectWholeSitePageActionManifest({ root });
  };
  const safe = await inspect(component());
  assert.equal(
    safe.status,
    "ready",
    JSON.stringify(safe.blockers)
  );

  for (const [name, guardedSelection] of [
    [
      "guard nested in a dead branch",
      `if (false) {
    if (!action.enabled) return;
  }
  selectedAction.value = action;`
    ],
    [
      "guard nested in a conditional branch",
      `if (action.key === "other") {
    if (!action.enabled) return;
  }
  selectedAction.value = action;`
    ],
    [
      "guard nested in a loop",
      `while (false) {
    if (!action.enabled) return;
  }
  selectedAction.value = action;`
    ]
  ]) {
    const nonDominatingGuard = await inspect(
      component().replace(
        `if (!action.enabled) return;
  selectedAction.value = action;`,
        guardedSelection
      )
    );
    assert.equal(
      nonDominatingGuard.status,
      "blocked",
      `${name}: ${JSON.stringify(nonDominatingGuard.blockers)}`
    );
    assert.ok(
      blockerCodes(nonDominatingGuard).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      name
    );
  }

  for (const [name, source] of [
    [
      "selection parameter member mutation",
      component().replace(
        `if (!action.enabled) return;
  selectedAction.value = action;`,
        `if (!action.enabled) return;
  action.key = "forged_action";
  selectedAction.value = action;`
      )
    ],
    [
      "selection parameter escape",
      component({
        unsafeScript: `let leakedAction: {
  key: string;
  enabled: boolean;
} | null = null;
function mutateLeakedAction() {
  if (leakedAction) {
    leakedAction.key = "forged_action";
  }
}`,
        unsafeTemplate:
          `<button @click="mutateLeakedAction">unsafe mutation</button>`
      }).replace(
        `if (!action.enabled) return;
  selectedAction.value = action;`,
        `if (!action.enabled) return;
  leakedAction = action;
  selectedAction.value = action;`
      )
    ]
  ]) {
    const unsafeSelectionParameter = await inspect(source);
    assert.equal(
      unsafeSelectionParameter.status,
      "blocked",
      `${name}: ${JSON.stringify(unsafeSelectionParameter.blockers)}`
    );
    assert.ok(
      blockerCodes(unsafeSelectionParameter).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      name
    );
  }

  const forgedSelectCaller = await inspect(
    component({
      unsafeTemplate: `<button
    @click="selectAction({
      key: 'forged_action',
      enabled: true
    })"
  >
    unsafe selection
  </button>`
    })
  );
  assert.equal(
    forgedSelectCaller.status,
    "blocked",
    JSON.stringify(forgedSelectCaller.blockers)
  );
  assert.ok(
    blockerCodes(forgedSelectCaller).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );

  for (const [name, unsafeScript, unsafeTemplate] of [
    [
      "indirect script caller",
      `function forceUnsafe() {
  selectAction({
    key: "forged_action",
    enabled: true
  });
}`,
      `<button @click="forceUnsafe">unsafe selection</button>`
    ],
    [
      "selector function escape",
      "",
      `<rogue-child :on-select="selectAction" />`
    ]
  ]) {
    const escapedSelector = await inspect(
      component({ unsafeScript, unsafeTemplate })
    );
    assert.equal(
      escapedSelector.status,
      "blocked",
      `${name}: ${JSON.stringify(escapedSelector.blockers)}`
    );
    assert.ok(
      blockerCodes(escapedSelector).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      name
    );
  }

  const unsafe = await inspect(
    component({ unsafeTemplate: `<button
    @click="props.execute({
      action: 'submit_approval',
      reason: '',
      password: ''
    })"
  >
    unsafe
  </button>` })
  );
  assert.equal(unsafe.status, "blocked");
  assert.ok(
    blockerCodes(unsafe).has(
      "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
    )
  );

  const forged = `{
    key: "submit_approval",
    enabled: true
  } as any`;
  for (const [name, unsafeScript] of [
    [
      "logical assignment",
      `function forceUnsafe() {
  selectedAction.value ||= ${forged};
}`
    ],
    [
      "object assign",
      `function forceUnsafe() {
  Object.assign(selectedAction, { value: ${forged} });
}`
    ],
    [
      "reflect set",
      `function forceUnsafe() {
  Reflect.set(selectedAction, "value", ${forged});
}`
    ],
    [
      "ref alias",
      `const selectedAlias = selectedAction;
function forceUnsafe() {
  selectedAlias.value = ${forged};
}`
    ],
    [
      "selected action mutation",
      `function forceUnsafe() {
  if (selectedAction.value) {
    selectedAction.value.key = "forged";
  }
}`
    ],
    [
      "enabled collection mutation",
      `function forceUnsafe() {
  enabledActionItems.value.push(${forged});
}`
    ],
    [
      "computed collection mutation",
      `function forceUnsafe() {
  actionItems.value.push(${forged});
}`
    ],
    [
      "props collection mutation",
      `function forceUnsafe() {
  props.actions.push(${forged});
}`
    ],
    [
      "dynamic props collection mutation",
      `const actionsKey = "actions";
function forceUnsafe() {
  props[actionsKey].push(${forged});
}`
    ],
    [
      "destructured props collection mutation",
      `const { actions: mutableActions } = props;
function forceUnsafe() {
  mutableActions.push(${forged});
}`
    ],
    [
      "object-contained props collection mutation",
      `const actionBox = { actions: props.actions };
function forceUnsafe() {
  actionBox.actions.push(${forged});
}`
    ],
    [
      "array-contained props collection mutation",
      `const actionBox = [props.actions];
function forceUnsafe() {
  actionBox[0].push(${forged});
}`
    ],
    [
      "conditional props collection mutation",
      `const mutableActions = Math.random() > 0.5
  ? props.actions
  : [];
function forceUnsafe() {
  mutableActions.push(${forged});
}`
    ],
    [
      "whole props alias mutation",
      `const mutableProps = props;
function forceUnsafe() {
  mutableProps.actions.push(${forged});
}`
    ],
    [
      "whole props container mutation",
      `const propsBox = { mutableProps: props };
function forceUnsafe() {
  propsBox.mutableProps.actions.push(${forged});
}`
    ]
  ]) {
    const unsafePopulation = await inspect(
      component({
        unsafeScript,
        unsafeTemplate:
          `<button @click="forceUnsafe">unsafe population</button>`
      })
    );
    assert.equal(
      unsafePopulation.status,
      "blocked",
      `${name}: ${JSON.stringify(unsafePopulation.blockers)}`
    );
    assert.ok(
      blockerCodes(unsafePopulation).has(
        "AVAILABLE_ACTION_PROVENANCE_UNVERIFIED"
      ),
      name
    );
  }
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


async function frozenServerGrantFixture(change = source => source, options = {}) {
  return fixture({
    extraFiles: options.extraFiles ?? {},
    webManifestOverrides: options.webManifestOverrides ?? {},
    actions: [registryAction({ capability: { kind: "available_action_string", source: "generationGrant.value.actions", key: "submit_approval" } })],
    page: change(`<script setup lang="ts">
import { ref } from "vue";
import { getExample, submitExample } from "../api/example.api";
const generationGrant = ref(null);
const reader = ref(Object.freeze({ ownerKey: 'owner', generation: 1, context: Object.freeze({ contractVersionId: 'version', draftRevision: 1 }) }));
const busy = ref(false);
function permits(owner, grant) {
  return Boolean(grant && grant.ownerKey === owner.ownerKey && grant.readGeneration === owner.generation &&
    grant.sourceRevision === owner.context.draftRevision && grant.actions.includes("submit_approval"));
}
async function refresh(owner) {
  const current = await getExample(owner.context.contractVersionId);
  if (current.version.id !== owner.context.contractVersionId || current.version.draftRevision !== owner.context.draftRevision) throw new Error("changed");
  generationGrant.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation,
    sourceRevision: current.version.draftRevision, fingerprint: current.version.documentContentFingerprint,
    actions: Object.freeze([...current.draftOperationAvailableActions]) });
}
async function submit() {
  const owner = reader.value;
  if (!owner) return;
  busy.value = true;
  try {
    await refresh(owner);
    const granted = generationGrant.value;
    if (!permits(owner, granted)) return;
    await submitExample(owner.context.contractVersionId, granted.sourceRevision);
  } catch (error) {
    await getExample(owner.context.contractVersionId);
  } finally {
    busy.value = false;
  }
}
</script>
<template><t-button @click="submit">提交审批</t-button></template>`)
  });
}

test("accepts a frozen server grant with a bound pure predicate and read-only recovery", async () => {
  const root = await frozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


test("frozen server grant rejects a reassigned local alias even when cleared", async () => {
  const root = await frozenServerGrantFixture(source => source
    .replace("const granted = generationGrant.value;", "let granted = generationGrant.value;")
    .replace("await submitExample(owner.context.contractVersionId, granted.sourceRevision);", "granted = null; await submitExample(owner.context.contractVersionId, granted.sourceRevision);"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("frozen server grant accepts renamed helpers through lexical bindings", async () => {
  const root = await frozenServerGrantFixture(source => source.replaceAll("permits", "checkedProjection").replaceAll("refresh", "readProjection"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});

for (const [label, change] of [
  ["forged action collection", source => source.replace("Object.freeze([...current.draftOperationAvailableActions])", 'Object.freeze(["submit_approval"])')],
  ["mutable inner action collection", source => source.replace("Object.freeze([...current.draftOperationAvailableActions])", "[...current.draftOperationAvailableActions]")],
  ["forged owner", source => source.replace("ownerKey: owner.ownerKey", 'ownerKey: "forged-owner"')],
  ["foreign read coordinate", source => source.replace("getExample(owner.context.contractVersionId)", 'getExample("foreign-version")')],
  ["missing read identity guard", source => source.replace("current.version.id !== owner.context.contractVersionId", "false")],
  ["missing action includes", source => source.replace('grant.actions.includes("submit_approval")', "true")],
  ["reversed action includes", source => source.replace('grant.actions.includes("submit_approval")', '!grant.actions.includes("submit_approval")')],
  ["action includes bypass", source => source.replace('grant.actions.includes("submit_approval")', '(grant.actions.includes("submit_approval") || true)')],
  ["same-name Boolean shadow", source => source.replace("const generationGrant", "const Boolean = value => value;\nconst generationGrant")],
  ["same-name Object shadow", source => source.replace("const generationGrant", "const Object = { freeze: value => value };\nconst generationGrant")],
  ["same-name predicate shadow", source => source.replace("async function submit() {", "async function submit() { const permits = () => true;")],
  ["local fake GET-like helper", source => source.replace("import { getExample, submitExample }", "import { submitExample }").replace("const generationGrant", 'async function getExample() { return { version: {}, draftOperationAvailableActions: ["submit_approval"] }; }\nconst generationGrant')],
  ["action alias escape", source => source.replace("async function submit() {", "function leak(value) { return value; }\nasync function submit() {").replace("await submitExample(owner.context.contractVersionId, granted.sourceRevision);", "leak(granted.actions); await submitExample(owner.context.contractVersionId, granted.sourceRevision);")],
  ["deep action mutation", source => source.replace("await submitExample(owner.context.contractVersionId, granted.sourceRevision);", 'granted.actions.push("forged"); await submitExample(owner.context.contractVersionId, granted.sourceRevision);')],
  ["catch direct resend", source => source.replace("} catch (error) {\n    await getExample(owner.context.contractVersionId);", "} catch (error) {\n    await submitExample(owner.context.contractVersionId, 1);")],
  ["catch hidden helper resend", source => source.replace("async function submit() {", "async function recover(owner) { await submitExample(owner.context.contractVersionId, 1); }\nasync function submit() {").replace("} catch (error) {\n    await getExample(owner.context.contractVersionId);", "} catch (error) {\n    await recover(owner);")],
  ["finally hidden helper resend", source => source.replace("async function submit() {", "async function cleanup() { await submitExample('foreign', 1); }\nasync function submit() {").replace("busy.value = false;", "void cleanup(); busy.value = false;")],
  ["finally forged owner write", source => source.replace("busy.value = false;", 'reader.value = { ownerKey: "forged" }; busy.value = false;')],
  ["unbound revision", source => source.replace("sourceRevision: current.version.draftRevision", "sourceRevision: 999")]
]) {
  test(`frozen server grant rejects ${label}`, async () => {
    const root = await frozenServerGrantFixture(source => {
      const changed = change(source);
      assert.notEqual(changed, source, "the negative fixture must actually alter the public input");
      return changed;
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
    assert.equal(manifest.actions[0].bindings[0].causalVerified, false, label);
  });
}

test("frozen server grant rejects a snapshot guarded before its fresh read", async () => {
  const root = await frozenServerGrantFixture(source => source
    .replace("await refresh(owner);\n    const granted = generationGrant.value;", "const granted = generationGrant.value;")
    .replace("if (!permits(owner, granted)) return;", "if (!permits(owner, granted)) return; await refresh(owner);"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, change] of [
  ["raw capability ref escape through a GET argument", source => source.replace("const reader = ref(Object.freeze({ ownerKey: 'owner', generation: 1, context: Object.freeze({ contractVersionId: 'version', draftRevision: 1 }) }));", "void getExample(generationGrant);\nconst reader = ref(Object.freeze({ ownerKey: 'owner', generation: 1, context: Object.freeze({ contractVersionId: 'version', draftRevision: 1 }) }));")],
  ["finally clearing the bound owner", source => source.replace("busy.value = false;", "reader.value = null; busy.value = false;")]
]) {
  test(`frozen server grant rejects ${label}`, async () => {
    const root = await frozenServerGrantFixture(source => {
      const changed = change(source); assert.notEqual(changed, source, label); return changed;
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
    assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
  });
}

test("frozen server grant rejects a GET hidden inside a purported pure predicate", async () => {
  const root = await frozenServerGrantFixture(source => source
    .replace("function permits(owner, grant) {", "function leak(value) { return getExample(value); }\nfunction permits(owner, grant) {")
    .replace('grant.actions.includes("submit_approval"));', 'grant.actions.includes("submit_approval") && Boolean(leak(grant)));'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

async function projectedFrozenServerGrantFixture(change = source => source) {
  const root = await frozenServerGrantFixture();
  const pagePath = "apps/web-admin/src/pages/ExamplePage.vue";
  let source = await readFile(join(root, pagePath), "utf8");
  const start = source.indexOf("async function refresh(owner) {");
  const end = source.indexOf("\nasync function submit() {", start);
  assert.ok(start > 0 && end > start);
  source = source.slice(0, start) + `async function readState(owner) {
  const current = await getExample(owner.context.contractVersionId);
  if (current.version.id !== owner.context.contractVersionId || current.version.draftRevision !== owner.context.draftRevision) throw new Error("changed");
  return Object.freeze({ fingerprint: current.version.documentContentFingerprint,
    actions: Object.freeze([...current.draftOperationAvailableActions]) });
}
async function refresh(owner, state) {
  const body = await getBody(owner.context.contractVersionId);
  if (body.contractVersionId !== owner.context.contractVersionId || body.draftRevision !== owner.context.draftRevision) throw new Error("changed source");
  generationGrant.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation,
    sourceRevision: body.draftRevision, fingerprint: state.fingerprint, actions: Object.freeze([...state.actions]) });
}` + source.slice(end);
  source = source.replace("import { getExample, submitExample }", "import { getExample, getBody, submitExample }")
    .replace("await refresh(owner);", "const state = await readState(owner); await refresh(owner, state);");
  await write(root, pagePath, change(source));
  const webPath = "docs/product/manifests/web-api-wrappers.json";
  const web = JSON.parse(await readFile(join(root, webPath), "utf8"));
  web.wrappers.push(wrapper({ name: "getBody", normalizedKey: "GET /examples/:param/body", returnProvenance: "transparent_main_response" }));
  await write(root, webPath, JSON.stringify(web, null, 2));
  const nestPath = "docs/product/manifests/nest-business-routes.json";
  const nest = JSON.parse(await readFile(join(root, nestPath), "utf8"));
  nest.routes.push(route("GET /examples/:param/body"));
  await write(root, nestPath, JSON.stringify(nest, null, 2));
  const apiPath = "apps/web-admin/src/api/example.api.ts";
  await write(root, apiPath, (await readFile(join(root, apiPath), "utf8")) + "\nexport async function getBody() { return {}; }\n");
  return root;
}

test("accepts a projected frozen server grant from bound state and body GETs", async () => {
  const root = await projectedFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

test("frozen server grant rejects a refresh mismatch that merely returns with old state", async () => {
  const root = await frozenServerGrantFixture(source => source.replace('throw new Error("changed");', "return;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, change] of [
  ["literal state actions", source => source.replace("Object.freeze([...current.draftOperationAvailableActions])", 'Object.freeze(["submit_approval"])')],
  ["state with a mutable inner array", source => source.replace("Object.freeze([...current.draftOperationAvailableActions])", "[...current.draftOperationAvailableActions]")],
  ["a foreign body read", source => source.replace("getBody(owner.context.contractVersionId)", 'getBody("foreign-version")')],
  ["a body mismatch that only returns", source => source.replace('throw new Error("changed source");', "return;")],
  ["a forged fingerprint", source => source.replace("fingerprint: state.fingerprint", 'fingerprint: "forged"')],
  ["a forged projected argument", source => source.replace("refresh(owner, state);", 'refresh(owner, Object.freeze({ fingerprint: "forged", actions: Object.freeze(["submit_approval"]) }));')],
  ["cached state captured outside the handler", source => source
    .replace("async function submit() {", "const state = await readState(reader.value);\nasync function submit() {")
    .replace("const state = await readState(owner); await refresh(owner, state);", "await refresh(owner, state);")],
  ["a cached raw GET used by the projection", source => source
    .replace("async function readState(owner) {\n  const current = await getExample(owner.context.contractVersionId);", "const current = await getExample(reader.value.context.contractVersionId);\nasync function readState(owner) {")],
  ["an escaped writer alias called with a fake state", source => source.replace("async function submit() {", 'const borrowed = refresh; void borrowed(reader.value, Object.freeze({ fingerprint: "forged", actions: Object.freeze(["submit_approval"]) }));\nasync function submit() {')]
]) {
  test(`projected frozen server grant rejects ${label}`, async () => {
    const root = await projectedFrozenServerGrantFixture(source => {
      const changed = change(source);
      assert.notEqual(changed, source);
      return changed;
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
    assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
  });
}

async function actualPaperActionFixture(operation, change = source => source, bodyApiSource = null) {
  const pagePath = "apps/web-admin/src/pages/contracts/workbench/ContractBodyPaperPreview.vue";
  const source = await readFile(new URL("../" + pagePath, import.meta.url), "utf8");
  const apiFile = "apps/web-admin/src/api/contract-workbench.api.ts";
  const filesApi = "apps/web-admin/src/api/core-flow-read.api.ts";
  const reads = [
    [apiFile, "fetchContractDraftWorkbench", "GET /contract-drafts/:param/workbench"],
    [apiFile, "fetchContractDraftBody", "GET /contract-drafts/:param/document-body"],
    [apiFile, "listContractDocuments", "GET /contract-workbench/:param/documents"],
    [filesApi, "getPrivateFileDownloadTicketCapability", "GET /files/:param/download-ticket-capability"]
  ];
  const target = operation === "generation"
    ? [apiFile, "queueContractDraftPreview", "POST /contract-drafts/:param/preview-generation", "generateCurrentDraft", "generationGrant.value.actions", "queue_contract_draft_preview"]
    : [filesApi, "downloadPrivateFileByTicket", "POST /files/:param/download-ticket", "confirmPreview", "previewGrant.value.serverAvailableActions", "create_private_file_download_ticket"];
  const [targetApi, name, normalizedKey, handler, capabilitySource, key] = target;
  return fixture({
    pagePath, page: change(source),
    // The default five fixture modules plus two API files, formatter, auth and
    // lazy PDF view total ten; the default example API and retained formatter
    // fixture are unreachable after the real paper catch uses fixed fallbacks.
    webManifestOverrides: { evidence: { productionModuleCount: 10, reachableProductionModuleCount: 8 } },
    routeRecords: 'export const webAdminRoutes = [{ path: "/example", component: () => import("../pages/contracts/workbench/ContractBodyPaperPreview.vue") }];\n',
    actions: [registryAction({ id: "example.paper-" + operation, sourceFile: pagePath,
      trigger: { element: "t-button", event: "click", handler },
      capability: { kind: "available_action_string", source: capabilitySource, key },
      wrappers: [{ apiFile: targetApi, name }] })],
    wrappers: [
      ...reads.map(([apiFile, name, normalizedKey]) => wrapper({ apiFile, name, normalizedKey, productionConsumers: [pagePath], returnProvenance: name === "fetchContractDraftBody" && bodyApiSource ? "unverified" : "transparent_main_response" })),
      wrapper({ apiFile: targetApi, name, normalizedKey, productionConsumers: [pagePath] })
    ],
    routes: [...reads.map(([, , normalizedKey]) => route(normalizedKey)), route(normalizedKey)],
    extraFiles: {
      [apiFile]: bodyApiSource ?? "export async function fetchContractDraftWorkbench() { return {}; }\nexport async function fetchContractDraftBody() { return {}; }\nexport async function listContractDocuments() { return []; }\nexport async function queueContractDraftPreview() { return {}; }\n",
      [filesApi]: "export async function getPrivateFileDownloadTicketCapability() { return {}; }\nexport async function downloadPrivateFileByTicket() { return {}; }\n",
      "apps/web-admin/src/api/error-message.ts": await readFile(new URL("../apps/web-admin/src/api/error-message.ts", import.meta.url), "utf8"),
      "apps/web-admin/src/auth/auth.store.ts": "export function useAuthStore() { return { user: null }; }\n",
      "apps/web-admin/src/components/files/LayoutPdfPreview.vue": "<template><div /></template>"
    }
  });
}

test("recognizes the actual paper generation handler through the public generator", async () => {
  const root = await actualPaperActionFixture("generation");
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});

async function typedFrozenServerGrantFixture(change = source => source) {
  return projectedFrozenServerGrantFixture(source => change(source
    .replace("return Object.freeze({ fingerprint: current.version.documentContentFingerprint,", "const actions = current.draftOperationAvailableActions;\n  return Object.freeze({ fingerprint: current.version.documentContentFingerprint,")
    .replace("actions: Object.freeze([...current.draftOperationAvailableActions])", 'actions: Object.freeze(Array.isArray(actions) && actions.every(action => typeof action === "string") ? [...actions] : [])')));
}

test("accepts a typed frozen server grant array copied with an empty fail-closed fallback", async () => {
  const root = await typedFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, change] of [
  ["a positive fallback", source => source.replace("? [...actions] : []", '? [...actions] : ["submit_approval"]')],
  ["an async type predicate", source => source.replace("actions.every(action =>", "actions.every(async action =>")],
  ["a predicate over a different lexical binding", source => source.replace('action => typeof action === "string"', 'other => typeof actions === "string"')],
  ["a different copied array", source => source.replace("? [...actions] : []", "? [...current.otherActions] : []")],
  ["a shadowed Array intrinsic", source => source.replace("const generationGrant", "const Array = { isArray: () => true };\nconst generationGrant")],
  ["a type predicate hiding a POST", source => source.replace('action => typeof action === "string"', 'action => (submitExample(owner.context.contractVersionId, 1), typeof action === "string")')],
  ["a permissive some check", source => source.replace("actions.every(", "actions.some(")]
]) {
  test(`typed frozen server grant rejects ${label}`, async () => {
    const root = await typedFrozenServerGrantFixture(source => {
      const changed = change(source); assert.notEqual(changed, source); return changed;
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
    assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
  });
}

async function separatelyBoundRecoveryFixture(change = source => source) {
  return typedFrozenServerGrantFixture(source => change(source
    .replace("async function submit() {", "async function restore(owner, state) { await refresh(owner, state); }\nasync function submit() {")
    .replace("} catch (error) {\n    await getExample(owner.context.contractVersionId);", "} catch (error) {\n    const recovered = await readState(owner); await restore(owner, recovered);")));
}

test("accepts a projected frozen server grant with a separately bound read-only recovery caller", async () => {
  const root = await separatelyBoundRecoveryFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, change] of [
  ["an unknown module-level writer call", source => source.replace("async function submit() {", 'void refresh(reader.value, Object.freeze({ fingerprint: "forged", actions: Object.freeze(["submit_approval"]) }));\nasync function submit() {')],
  ["a forged recovery state", source => source.replace("const recovered = await readState(owner);", 'const recovered = Object.freeze({ fingerprint: "forged", actions: Object.freeze(["submit_approval"]) });')],
  ["a recovery state read for a different owner", source => source.replace("const recovered = await readState(owner);", "const recovered = await readState(reader.value.otherOwner);")],
  ["an escaping forwarding helper", source => source.replace("async function submit() {", "const borrowed = restore; void borrowed;\nasync function submit() {")],
  ["mutation in the forwarding helper", source => source.replace("async function restore(owner, state) {", 'async function restore(owner, state) { state.actions.push("forged");')]
]) {
  test(`projected frozen server grant rejects ${label}`, async () => {
    const root = await separatelyBoundRecoveryFixture(source => {
      const changed = change(source); assert.notEqual(changed, source); return changed;
    });
    const manifest = await inspectWholeSitePageActionManifest({ root });
    assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
    assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
  });
}


test("frozen server grant accepts the paper handler's disjunctive fail-closed guard", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("if (!permits(owner, granted)) return;", "if (!permits(owner, granted) || !granted || !owner) return;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, guard] of [
  ["AND failures", "!permits(owner, granted) && !granted"],
  ["reversed predicate", "permits(owner, granted) || !granted"],
  ["bypassed predicate", "(!permits(owner, granted) && false) || !granted"],
  ["hidden read", "!permits(owner, granted) || getExample(granted)"],
  ["hidden resend", "!permits(owner, granted) || submitExample(owner.context.contractVersionId, granted.sourceRevision)"]
]) test(`frozen server grant rejects disjunctive guard ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("if (!permits(owner, granted)) return;", `if (${guard}) return;`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


async function getterFrozenServerGrantFixture(change = source => source) {
  return frozenServerGrantFixture(source => change(source.replace("function permits(owner, grant) {", `const HASH = /^[a-f0-9]{64}$/u;
const props = Object.freeze({ blocked: false, context: Object.freeze({ contractVersionId: "version" }) });
function ownerKey() {
  const actor = "actor", contract = "contract", version = props.context.contractVersionId;
  if (!actor || typeof contract !== "string" || !contract) return "";
  return JSON.stringify([actor, contract, version]);
}
function isCurrent(value) {
  return !props.blocked && value.ownerKey === ownerKey();
}
function permits(owner, grant) {`).replace("return Boolean(grant &&", "return Boolean(isCurrent(owner) && grant &&").replace('grant.actions.includes("submit_approval")', 'HASH.test(grant.fingerprint) && grant.actions.includes("submit_approval")')));
}

test("frozen server grant accepts the paper predicate's lexical read-only getter and const regexp", async () => {
  const root = await getterFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, change] of [
  ["global regexp flag", source => source.replace("{64}$/u", "{64}$/gu")],
  ["sticky regexp flag", source => source.replace("{64}$/u", "{64}$/yu")],
  ["forged test method", source => source.replace("/^[a-f0-9]{64}$/u", "{ test() { submitExample(); return true; } }")],
  ["dynamic regexp", source => source.replace("/^[a-f0-9]{64}$/u", 'new RegExp("hash")')],
  ["mutable regexp binding", source => source.replace("const HASH =", "let HASH =")],
  ["regexp reassignment", source => source.replace("function ownerKey() {", "HASH = /^[a-z]+$/u; function ownerKey() {")],
  ["regexp method replacement", source => source.replace("function ownerKey() {", "HASH.test = () => true; function ownerKey() {")],
  ["regexp escape", source => source.replace("function ownerKey() {", "getExample(HASH); function ownerKey() {")],
  ["JSON shadow", source => source.replace("function ownerKey() {", "const JSON = { stringify() { submitExample(); return ''; } }; function ownerKey() {")],
  ["getter hidden resend", source => source.replace('return JSON.stringify(', 'submitExample(); return JSON.stringify(')],
  ["getter mutation", source => source.replace('return JSON.stringify(', 'reader.value = null; return JSON.stringify(')],
  ["mutable getter local", source => source.replace('const actor =', 'let actor =')],
  ["implicit toJSON resend", source => source.replace('const actor = "actor"', 'const actor = { toJSON() { submitExample(); return "actor"; } }')]
]) test(`frozen server grant rejects paper pure getter ${label}`, async () => {
  const root = await getterFrozenServerGrantFixture(source => {
    const changed = change(source); assert.notEqual(changed, source, label); return changed;
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


async function pollingFrozenServerGrantFixture(change = source => source) {
  return frozenServerGrantFixture(source => change(source.replace("function permits(owner, grant) {", `let pollTimer = null;
function stopPolling() {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}
function scheduleQuery(owner) {
  stopPolling();
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void getExample(owner.context.contractVersionId);
  }, 1000);
}
function permits(owner, grant) {`).replace("busy.value = true;", "stopPolling(); busy.value = true;").replace("} catch (error) {", "} catch (error) { scheduleQuery(owner);")));
}

test("frozen server grant accepts private polling cleanup and a read-only timer callback", async () => {
  const root = await pollingFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, change] of [
  ["callback resend", source => source.replace("void getExample(owner.context.contractVersionId);", "void submitExample(owner.context.contractVersionId, 1);")],
  ["callback hidden helper resend", source => source.replace("function stopPolling() {", "function hidden() { submitExample(); } function stopPolling() {").replace("void getExample(owner.context.contractVersionId);", "hidden();")],
  ["async callback", source => source.replace("setTimeout(() =>", "setTimeout(async () =>")],
  ["handle escape", source => source.replace("function permits(owner, grant) {", "getExample(pollTimer); function permits(owner, grant) {")],
  ["handle alias", source => source.replace("function permits(owner, grant) {", "const leaked = pollTimer; function permits(owner, grant) {")],
  ["setTimeout shadow", source => source.replace("let pollTimer = null;", "const setTimeout = () => { submitExample(); return null; }; let pollTimer = null;")],
  ["clearTimeout shadow", source => source.replace("let pollTimer = null;", "const clearTimeout = () => submitExample(); let pollTimer = null;")],
  ["dynamic callback", source => source.replace("setTimeout(() => {", "setTimeout(makeCallback(), () => {")],
  ["finally timer scheduling", source => source.replace("} finally {", "} finally { scheduleQuery(owner);")]
]) test(`frozen server grant rejects private polling ${label}`, async () => {
  const root = await pollingFrozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


async function uiStateFrozenServerGrantFixture(change = source => source) {
  return frozenServerGrantFixture(source => change(source.replace("function permits(owner, grant) {", `let automaticQueries = 0;
const pending = ref(null);
function permits(owner, grant) {`).replace("busy.value = true;", "automaticQueries = 0; busy.value = true;").replace("} catch (error) {", `} catch (error) {
    automaticQueries += 1;
    const current = await getExample(owner.context.contractVersionId);
    pending.value = Object.freeze({ count: automaticQueries, data: current });`)));
}

test("frozen server grant accepts component-private scalar bookkeeping and frozen UI data", async () => {
  const root = await uiStateFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, change] of [
  ["state hidden resend", source => source.replace("data: current", "data: submitExample()")],
  ["scalar hidden coercion", source => source.replace("automaticQueries += 1;", "automaticQueries += { valueOf() { submitExample(); return 1; } };")],
  ["deep state mutation", source => source.replace("pending.value = Object.freeze", "reader.value.generation = 2; pending.value = Object.freeze")],
  ["fake UI ref", source => source.replace("const pending = ref(null);", "const pending = { set value(v) { submitExample(); } };")],
  ["finally data replacement", source => source.replace("} finally {", "} finally { pending.value = Object.freeze({});")],
  ["finally scalar mutation", source => source.replace("} finally {", "} finally { automaticQueries += 1;")]
]) test(`frozen server grant rejects UI state ${label}`, async () => {
  const root = await uiStateFrozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant accepts static regexp and array probes in its read-only recovery", async () => {
  const root = await getterFrozenServerGrantFixture(source => source.replace("} catch (error) {", "} catch (error) { if (HASH.test('abc') && Array.isArray([])) busy.value = false;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


test("frozen server grant rejects a shadowed array type probe in recovery", async () => {
  const root = await getterFrozenServerGrantFixture(source => source.replace("} catch (error) {", "} catch (error) { const Array = { isArray() { submitExample(); return true; } }; if (Array.isArray([])) busy.value = false;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


async function collectionFrozenServerGrantFixture(change = source => source) {
  return frozenServerGrantFixture(source => change(source.replace("function permits(owner, grant) {", `const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
function matching(state) { return state.documents.filter(item => isRecord(item) && item.status === "success"); }
function permits(owner, grant) {`).replace("} catch (error) {", `} catch (error) {
    const current = await getExample(owner.context.contractVersionId);
    const state = Object.freeze({ documents: current.documents });
    const records = matching(state);
    if (records.some(item => item.id === "x") || records.find(item => item.status === "success")) busy.value = false;`)));
}

test("frozen server grant accepts read-derived matching collections with pure inline callbacks", async () => {
  const root = await collectionFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, change] of [
  ["callback resend", source => source.replace('item.id === "x"', 'submitExample()')],
  ["callback hidden read", source => source.replace('item.id === "x"', 'getExample(item)')],
  ["callback hidden helper resend", source => source.replace("function matching(state)", "function hidden() { submitExample(); return true; } function matching(state)").replace('item.id === "x"', 'hidden()')],
  ["callback parameter mutation", source => source.replace('item.id === "x"', '(item.id = "x")')],
  ["async callback", source => source.replace("records.some(item =>", "records.some(async item =>")],
  ["aliased callback", source => source.replace('const records = matching(state);', 'const predicate = item => true; const records = matching(state);').replace('records.some(item => item.id === "x")', 'records.some(predicate)')],
  ["forged receiver", source => source.replace('const records = matching(state);', 'const records = { some() { submitExample(); return true; }, find() { return null; } };')],
  ["mutated read receiver", source => source.replace('const state = Object.freeze', 'current.documents.filter = () => submitExample(); const state = Object.freeze')]
]) test(`frozen server grant rejects read collection ${label}`, async () => {
  const root = await collectionFrozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant accepts includes on a read-derived collection or literal strings", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'if (current.actions.includes("view") && ["queued", "success"].includes(current.status)) busy.value = false; const records = matching(state);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


test("frozen server grant rejects a forged read-like includes receiver", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'const forged = { includes() { submitExample(); return true; } }; if (forged.includes("view")) busy.value = false; const records = matching(state);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts a private ref's unique frozen read-array projection for display recovery", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("const busy = ref(false);", "const busy = ref(false); const display = ref(null);").replace("} catch (error) {", `} catch (error) {
    const result = await getExample(owner.context.contractVersionId);
    display.value = Object.freeze({ actions: Object.freeze([...result.availableActions]) });
    if (display.value.actions.includes("view")) busy.value = false;`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, change] of [
  ["forged frozen display array", source => source.replace("[...result.availableActions]", '["view"]')],
  ["mutable display array", source => source.replace("Object.freeze([...result.availableActions])", "[...result.availableActions]")],
  ["display array mutation", source => source.replace('if (display.value.actions.includes', 'display.value.actions.push("view"); if (display.value.actions.includes')],
  ["display getter", source => source.replace("actions: Object.freeze", "get actions() { submitExample(); return []; }, unrelated: Object.freeze")]
]) test(`frozen server grant rejects display recovery ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => change(source.replace("const busy = ref(false);", "const busy = ref(false); const display = ref(null);").replace("} catch (error) {", `} catch (error) {
    const result = await getExample(owner.context.contractVersionId);
    display.value = Object.freeze({ actions: Object.freeze([...result.availableActions]) });
    if (display.value.actions.includes("view")) busy.value = false;`)));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts literal-only conditional UI notices", async () => {
  const root = await uiStateFrozenServerGrantFixture(source => source.replace("const pending = ref(null);", 'const pending = ref(null); const notice = ref("");').replace("automaticQueries += 1;", 'automaticQueries += 1; notice.value = automaticQueries > 1 ? "处理中" : "待确认";'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, expression] of [["effectful condition", 'submitExample() ? "处理中" : "待确认"'], ["effectful branch", 'automaticQueries > 1 ? submitExample() : "待确认"']]) test(`frozen server grant rejects conditional notice ${label}`, async () => {
  const root = await uiStateFrozenServerGrantFixture(source => source.replace("const pending = ref(null);", 'const pending = ref(null); const notice = ref("");').replace("automaticQueries += 1;", `automaticQueries += 1; notice.value = ${expression};`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts String conversion only for read-derived matching data", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'const records = matching(state); const target = records.find(item => item.status === "success"); const text = String(target.id);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, statement] of [
  ["forged coercion", 'const target = { id: { toString() { submitExample(); return "x"; } } }; String(target.id);'],
  ["shadowed String", 'const String = value => { submitExample(); return value; }; String(current.id);'],
  ["effectful lookup", 'const target = records.find(item => submitExample()); String(target.id);']
]) test(`frozen server grant rejects read String ${label}`, async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', `const records = matching(state); ${statement}`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


async function formattedFrozenServerGrantFixture(change = source => source, changeModule = source => source) {
  const formatter = changeModule(await readFile(new URL("../apps/web-admin/src/api/error-message.ts", import.meta.url), "utf8"));
  return frozenServerGrantFixture(source => change(source.replace('import { ref } from "vue";', 'import { ref } from "vue"; import { formatUnknownApiError } from "../api/error-message";').replace('const busy = ref(false);', 'const busy = ref(false); const notice = ref("");').replace('} catch (error) {', '} catch (error) { notice.value = formatUnknownApiError(error, "查询失败");')), {
    extraFiles: { "apps/web-admin/src/api/error-message.ts": formatter },
    webManifestOverrides: { evidence: { productionModuleCount: 6, reachableProductionModuleCount: 6 } }
  });
}

test("frozen server grant rejects the actual imported formatter when an unknown error message is not proven data", async () => {
  const root = await formattedFrozenServerGrantFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("frozen server grant accepts the actual imported formatter with proven scalar arguments", async () => {
  const root = await formattedFrozenServerGrantFixture(source => {
    const changed = source.replace('import { formatUnknownApiError }', 'import { formatApiErrorMessage }').replace('formatUnknownApiError(error, "查询失败")', 'formatApiErrorMessage("读取失败", 0, "查询失败")');
    assert.notEqual(changed, source);
    assert.equal(changed.includes('formatUnknownApiError(error, "查询失败")'), false);
    return changed;
  });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, changeModule] of [
  ["hidden local request", source => source.replace("const text = message.trim();", "const text = message.trim(); hidden();") + '\nfunction hidden() { fetch("/write", { method: "POST" }); return ""; }\n'],
  ["module top-level request", source => source + '\nfetch("/write", { method: "POST" });\n'],
  ["imported helper", source => 'import { hidden } from "./example.api";\n' + source.replace("const text = message.trim();", "const text = message.trim(); hidden();")],
  ["mutable local", source => source.replace("const text =", "let text =")],
  ["global regexp", source => source.replace("ECONNREFUSED/i", "ECONNREFUSED/gi")],
  ["sticky regexp", source => source.replace("ECONNREFUSED/i", "ECONNREFUSED/yi")],
  ["dynamic regexp", source => source.replace("/Invalid phone or password/i", 'new RegExp("Invalid phone")')],
  ["helper write", source => source.replace("function statusText(status: number, fallback: string): string {", "function statusText(status: number, fallback: string): string { globalThis.lastError = fallback;")],
  ["hidden finally request", source => source.replace("const text = message.trim();", 'const text = message.trim(); try {} finally { fetch("/write"); }')]
]) test(`frozen server grant rejects imported formatter ${label}`, async () => {
  const root = await formattedFrozenServerGrantFixture(source => source, changeModule);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("frozen server grant rejects a lexically shadowed imported formatter", async () => {
  const root = await formattedFrozenServerGrantFixture(source => source.replace('} catch (error) {', '} catch (error) { const formatUnknownApiError = () => { submitExample(); return ""; };'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts a trim dominated by the same field's short-circuit string check", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("} catch (error) {", '} catch (error) { const current = await getExample(owner.context.contractVersionId); if (typeof current.id !== "string" || !current.id.trim()) return;'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, guard] of [
  ["wrong field", 'typeof current.other !== "string" || !current.id.trim()'],
  ["wrong polarity", 'typeof current.id === "string" || !current.id.trim()'],
  ["AND non-string", 'typeof current.id !== "string" && !current.id.trim()'],
  ["bypassed type failure", '(typeof current.id !== "string" && false) || !current.id.trim()']
]) test(`frozen server grant rejects guarded trim ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("} catch (error) {", `} catch (error) { const current = await getExample(owner.context.contractVersionId); if (${guard}) return;`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant rejects a second helper invocation with a forged collection argument", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'const records = matching(state); const forged = { documents: { filter() { submitExample(); return []; } } }; matching(forged);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects a second helper frame hiding a detached resend method", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('function matching(state)', 'function forgedFilter() { submitExample(); return []; } function makeForged() { return { documents: { filter: forgedFilter } }; } function matching(state)').replace('const records = matching(state);', 'const records = matching(state); const forged = makeForged(); matching(forged);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rechecks a second legitimate read-derived helper frame", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'const records = matching(state); const next = await getExample(owner.context.contractVersionId); const second = Object.freeze({ documents: next.documents }); matching(second);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});

for (const [label, invoke] of [
  ["detached first", 'const forged = makeForged(); matching(forged); const records = matching(state);'],
  ["forwarded sibling", 'const records = matching(state); revisit(state); const forged = makeForged(); revisit(forged);']
]) test(`frozen server grant rejects differing effect frames ${label}`, async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('function matching(state)', 'function forgedFilter() { submitExample(); return []; } function makeForged() { return { documents: { filter: forgedFilter } }; } function revisit(state) { matching(state); } function matching(state)').replace('const records = matching(state);', invoke));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects regexp argument coercion hiding a detached resend", async () => {
  const root = await getterFrozenServerGrantFixture(source => source.replace('function ownerKey() {', 'function hidden() { submitExample(); return "x"; } function ownerKey() {').replace('} catch (error) {', '} catch (error) { const forged = { toString: hidden }; HASH.test(forged);'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


for (const [label, extra, statement] of [
  ["nested object field", '', 'const forged = { value: { toString: hidden } }; HASH.test(forged.value);'],
  ["bound helper parameter", 'function testValue(value) { return HASH.test(value); }', 'const forged = { toString: hidden }; testValue(forged);']
]) test(`frozen server grant rejects detached regexp coercion ${label}`, async () => {
  const root = await getterFrozenServerGrantFixture(source => source.replace('function ownerKey() {', `function hidden() { submitExample(); return "x"; } ${extra} function ownerKey() {`).replace('} catch (error) {', `} catch (error) { ${statement}`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


for (const [label, setup, statement] of [
  ["delete mutation", '', 'delete globalThis.lastError;'],
  ["dynamic import", '', 'void import("../api/example.api");'],
  ["spread getter resend", 'function hidden() { submitExample(); return "x"; } function opaque() { return { get id() { return hidden(); } }; }', 'const foreign = opaque(); const view = Object.freeze({ ...foreign });']
]) test(`frozen server grant rejects opaque recovery effect ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace('function permits(owner, grant) {', `${setup} function permits(owner, grant) {`).replace('} catch (error) {', `} catch (error) { ${statement}`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects an auxiliary predicate call bound to forged external actions", async () => {
  const root = await frozenServerGrantFixture(source => source.replace('function permits(owner, grant) {', `function hidden() { submitExample(); return true; }
const foreignActions = { includes: hidden };
function forged(owner) { return Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation, sourceRevision: owner.context.draftRevision, actions: foreignActions }); }
function permits(owner, grant) {`).replace('} catch (error) {', '} catch (error) { permits(owner, forged(owner));'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("recognizes the actual paper private-file handler through the public generator", async () => {
  const root = await actualPaperActionFixture("preview");
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].capability.dominatesTrigger, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
});


for (const [label, replacement] of [["unawaited writer", "refresh(owner);"], ["unreachable writer", "if (false) await refresh(owner);"], ["conditionally skipped writer", "if (busy.value) await refresh(owner);"]]) test(`frozen server grant rejects a non-fresh primary ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("await refresh(owner);", replacement));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects a boxed raw ref whose value accessor forges server actions", async () => {
  const root = await frozenServerGrantFixture(source => source.replace('function permits(owner, grant) {', `const box = { grant: generationGrant };
Object.defineProperty(box.grant, "value", { get() {
  const owner = reader.value;
  return { ownerKey: owner.ownerKey, readGeneration: owner.generation, sourceRevision: owner.context.draftRevision, fingerprint: "x", actions: ["submit_approval"] };
}, set(value) {} });
function permits(owner, grant) {`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


for (const [label, change] of [
  ["conditional replacement", source => source.replace("generationGrant.value = Object.freeze", "if (!generationGrant.value) generationGrant.value = Object.freeze")],
  ["old-state early return", source => source.replace("async function refresh(owner) {", "async function refresh(owner) { if (generationGrant.value) return;")]
]) test(`frozen server grant rejects a stale producer ${label}`, async () => {
  const root = await frozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


for (const [label, change] of [
  ["unawaited projected state", source => source.replace("const state = await readState(owner);", "const state = readState(owner);")],
  ["unawaited workbench read", source => source.replace("const current = await getExample(owner.context.contractVersionId);", "const current = getExample(owner.context.contractVersionId);")],
  ["unawaited body read", source => source.replace("const body = await getBody(owner.context.contractVersionId);", "const body = getBody(owner.context.contractVersionId);")]
]) test(`frozen server grant rejects freshness dependency ${label}`, async () => {
  const root = await projectedFrozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});

test("frozen server grant rejects an unawaited secondary constructor invocation", async () => {
  const root = await separatelyBoundRecoveryFixture(source => source.replace("async function restore(owner, state) { await refresh(owner, state); }", "async function restore(owner, state) { refresh(owner, state); }"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});

for (const [label, statement] of [["array", "const escaped = [generationGrant];"], ["frozen container", "const escaped = Object.freeze({ grant: generationGrant });"], ["returned ref", "function escaped() { return generationGrant; }"]]) test(`frozen server grant rejects raw ref escape through ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", `${statement} function permits(owner, grant) {`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});

test("frozen server grant rejects a producer reporting success before replacement", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("async function refresh(owner) {", "async function refresh(owner) { if (generationGrant.value) return true;").replace("await refresh(owner);", "if (!await refresh(owner)) return;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


for (const [label, branch] of [["success before false", "return true; return false;"], ["nested success before false", "if (reader.value) return true; return false;"]]) test(`frozen server grant rejects disguised producer failure ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("async function refresh(owner) {", `async function refresh(owner) { if (generationGrant.value) { ${branch} }`).replace("await refresh(owner);", "if (!await refresh(owner)) return;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant rejects a module-reassigned predicate binding", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("async function refresh(owner) {", "permits = () => true; async function refresh(owner) {"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects a module-reassigned projected state reader", async () => {
  const root = await projectedFrozenServerGrantFixture(source => source.replace("async function submit() {", 'readState = async () => Object.freeze({ fingerprint: "forged", actions: Object.freeze(["submit_approval"]) }); async function submit() {'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});

test("frozen server grant rejects a module-reassigned nested current-owner predicate", async () => {
  const root = await actualPaperActionFixture("generation", source => source.replace("async function generateCurrentDraft() {", "isCurrent = () => true; async function generateCurrentDraft() {"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts trim on a private string Vue ref", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("const busy = ref(false);", 'const busy = ref(false); const password = ref("");').replace("if (!owner) return;", "if (!owner || !password.value.trim()) return;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, change] of [
  ["fake ref", source => source.replace('const password = ref("");', 'const password = { value: "" };')],
  ["non-string value", source => source.replace('const password = ref("");', 'const password = ref(""); password.value = { trim: () => true };')],
  ["boxed ref escape", source => source.replace('const password = ref("");', 'const password = ref(""); const box = { password }; Object.defineProperty(box.password, "value", { get() { return { trim() { return true; } }; } });')]
]) test(`frozen server grant rejects private string trim ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => change(source.replace("const busy = ref(false);", 'const busy = ref(false); const password = ref("");').replace("if (!owner) return;", "if (!owner || !password.value.trim()) return;")));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


test("frozen server grant accepts every on read-derived display data with a pure callback", async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', 'const records = matching(state); if (current.actions.every(item => typeof item === "string")) busy.value = false;'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});


for (const [label, expression] of [["callback resend", 'current.actions.every(item => submitExample())'], ["async callback", 'current.actions.every(async item => true)'], ["forged receiver", '({ every() { submitExample(); return true; } }).every(item => true)']]) test(`frozen server grant rejects readonly every ${label}`, async () => {
  const root = await collectionFrozenServerGrantFixture(source => source.replace('const records = matching(state);', `const records = matching(state); if (${expression}) busy.value = false;`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


const paperFileMutations = [
  ["foreign file partner", source => source.replace("Object.freeze({ fileId: pdf.fileId, documentId: pdf.documentId, ownerKey:", 'Object.freeze({ fileId: "foreign", documentId: pdf.documentId, ownerKey:')],
  ["foreign document partner", source => source.replace("Object.freeze({ fileId: pdf.fileId, documentId: pdf.documentId, ownerKey:", 'Object.freeze({ fileId: pdf.fileId, documentId: "foreign", ownerKey:')],
  ["foreign grant owner", source => source.replace("ownerKey: owner.ownerKey, readGeneration: owner.generation,\n    serverAction:", 'ownerKey: "foreign", readGeneration: owner.generation,\n    serverAction:')],
  ["forged generation", source => source.replace("ownerKey: owner.ownerKey, readGeneration: owner.generation,\n    serverAction:", 'ownerKey: owner.ownerKey, readGeneration: 999,\n    serverAction:')],
  ["foreign capability coordinate", source => source.replace("getPrivateFileDownloadTicketCapability(pdf.fileId)", "getPrivateFileDownloadTicketCapability(owner.context.contractVersionId)")],
  ["forged enabled projection", source => source.replace("Object.freeze({ ...result.action })", "Object.freeze({ ...result.action, enabled: true })")],
  ["literal capability actions", source => source.replace("Object.freeze([...result.availableActions])", 'Object.freeze(["create_private_file_download_ticket"])')],
  ["mutable capability actions", source => source.replace("Object.freeze([...result.availableActions])", "[...result.availableActions]")],
  ["mutable server action", source => source.replace("Object.freeze({ ...result.action })", "{ ...result.action }")],
  ["unawaited producer", source => source.replaceAll("if (!await refreshCapability(owner, pdf))", "if (!refreshCapability(owner, pdf))")],
  ["conditional producer replacement", source => source.replace("previewGrant.value = Object.freeze", "if (!previewGrant.value) previewGrant.value = Object.freeze")],
  ["foreign owner argument", source => source.replaceAll("refreshCapability(owner, pdf)", "refreshCapability(reader.value.otherOwner, pdf)")],
  ["foreign PDF argument", source => source.replaceAll("refreshCapability(owner, pdf)", "refreshCapability(owner, readyPdf.value.otherPdf)")],
  ["missing action key", source => source.replace('grant.serverAction.key === "create_private_file_download_ticket"', "true")],
  ["missing enabled guard", source => source.replace("grant.serverAction.enabled === true", "true")],
  ["bypassed includes", source => source.replace('grant.serverAvailableActions.includes("create_private_file_download_ticket")', "true")],
  ["reversed includes", source => source.replace('grant.serverAvailableActions.includes("create_private_file_download_ticket")', '!grant.serverAvailableActions.includes("create_private_file_download_ticket")')],
  ["foreign workbench read", source => source.replace("fetchContractDraftWorkbench(owner.context.contractVersionId)", 'fetchContractDraftWorkbench("foreign-version")')],
  ["foreign document-list read", source => source.replace("listContractDocuments(owner.context.contractVersionId)", 'listContractDocuments("foreign-version")')],
  ["wrong document purpose", source => source.replace('item.purpose === "draft"', 'item.purpose === "final"')],
  ["missing layout filter", source => source.replace("item.layoutTemplateVersionId === owner.context.layoutTemplateVersionId", "true")],
  ["missing revision filter", source => source.replace("item.documentContentRevision === owner.context.documentContentRevision", "true")],
  ["missing fingerprint filter", source => source.replace("item.documentContentFingerprint === state.fingerprint", "true")],
  ["missing source filter", source => source.replace("item.inputSnapshot.bodyDocument.sourceSha256 === owner.context.sourceSha256", "true")],
  ["wrong ready file projection", source => source.replace("fileId: item.pdfFileId", "fileId: item.id")],
  ["missing success status", source => source.replace('item.status !== "success" || ', "")],
  ["missing expected document", source => source.replace("pdf.documentId === expected.documentId", "true")],
  ["missing expected file", source => source.replace("pdf.fileId === expected.fileId", "true")],
  ["missing expected fingerprint", source => source.replace("pdf.fingerprint === expected.fingerprint", "true")],
  ["bypassed current-document check", source => source.replaceAll("if (!await findCurrentPdf(owner, pdf))", "if (false)")],
  ["search returns stale expected on empty read", source => source.replace("if (!state) return null;", "if (!state) return expected;")],
  ["search returns expected object", source => source.replace("pdf.fingerprint === expected.fingerprint))) return pdf;", "pdf.fingerprint === expected.fingerprint))) return expected;")],
  ["non-const document iteration", source => source.replace("for (const item of matchingDocuments", "for (let item of matchingDocuments")],
  ["wrong blob object URL", source => source.replace("URL.createObjectURL(result.blob)", "URL.createObjectURL(readyPdf.value)")],
  ["shadowed browser URL", source => source.replace("async function confirmPreview() {", 'const URL = { revokeObjectURL() {}, createObjectURL() { return "blob:forged"; } }; async function confirmPreview() {')],
  ["reassigned search helper", source => source.replace("async function confirmPreview() {", "findCurrentPdf = async (owner, expected) => expected; async function confirmPreview() {")],
  ["cached capability response", source => source.replace("async function refreshCapability(owner: Reader, pdf: ReadyPdf) {", 'const cachedCapability = await getPrivateFileDownloadTicketCapability("cached-file");\nasync function refreshCapability(owner: Reader, pdf: ReadyPdf) {').replace("const result = await getPrivateFileDownloadTicketCapability(pdf.fileId);", "const result = cachedCapability;")],
  ["captured old grant", source => source.replace("const granted = previewGrant.value;", "").replace("try {\n    if (!await findCurrentPdf(owner, pdf))", "try {\n    const granted = previewGrant.value;\n    if (!await findCurrentPdf(owner, pdf))")],
  ["catch hidden resend", source => source.replace("async function confirmPreview() {", 'function retry() { return downloadPrivateFileByTicket("other", {}, "pdf-blob"); }\nasync function confirmPreview() {').replace('if (isCurrent(owner)) error.value = "读取合同草稿 PDF 失败，请保留编辑内容后重试";', 'retry(); if (isCurrent(owner)) error.value = "读取合同草稿 PDF 失败，请保留编辑内容后重试";')],
  ["finally hidden resend", source => source.replace("async function confirmPreview() {", 'function retry() { return downloadPrivateFileByTicket("other", {}, "pdf-blob"); }\nasync function confirmPreview() {').replace('} finally { if (isCurrent(owner)) busy.value = false; }\n}\nwatch(', '} finally { retry(); if (isCurrent(owner)) busy.value = false; }\n}\nwatch(')]
];
for (const [label, change] of paperFileMutations) test(`paper private-file proof rejects ${label}`, async () => {
  const root = await actualPaperActionFixture("preview", source => { const changed = change(source); assert.notEqual(changed, source, label); return changed; });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


for (const [label, statement] of [["relational coercion", 'if (opaque < 1) busy.value = false;'], ["template coercion", 'const text = `${opaque}`;'], ["Error argument coercion", 'throw new Error(opaque);']]) test(`frozen server grant rejects implicit opaque effect ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'function hidden() { submitExample(); return "1"; } const opaque = { valueOf: hidden, toString: hidden }; function permits(owner, grant) {').replace("} catch (error) {", `} catch (error) { ${statement}`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});

test("frozen server grant rejects an imported formatter coercing its unknown error parameter", async () => {
  const root = await formattedFrozenServerGrantFixture(source => source, source => source.replace("export function formatUnknownApiError(error: unknown, fallback: string): string {", 'export function formatUnknownApiError(error: unknown, fallback: string): string { const opaque = `${error}`;'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
});


async function actualBodyWarningProjectionApi(change = source => source) {
  const source = await readFile(new URL("../apps/web-admin/src/api/contract-workbench.api.ts", import.meta.url), "utf8");
  const part = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, start);
    return source.slice(first, last);
  };
  return change(part("async function readJson<T>(", "\nasync function postJson<") + "\n" +
    part("export function fetchContractDraftWorkbench(", "\nexport interface ContractBodyEditPlan") + "\n" +
    part("const approvedBodyWarnings =", "\nexport function fetchContractDraftOperationCapabilities(") +
    "\nexport async function listContractDocuments() { return []; }\nexport async function queueContractDraftPreview() { return {}; }\n");
}

test("recognizes the actual body warning projection without claiming its wrapper transparent", async () => {
  const root = await actualPaperActionFixture("generation", source => source, await actualBodyWarningProjectionApi());
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, true);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
  const web = JSON.parse(await readFile(join(root, "docs/product/manifests/web-api-wrappers.json"), "utf8"));
  assert.equal(web.wrappers.find(value => value.name === "fetchContractDraftBody").returnProvenance, "unverified");
});


test("recognizes the actual body warning projection after lexical helper renaming", async () => {
  const api = await actualBodyWarningProjectionApi(source => source.replaceAll("normalizeBodyWarnings", "cleanMessages").replaceAll("readJson", "readResource").replace("const body = await", "const responseBody = await").replace("...body, warnings: cleanMessages(body.warnings)", "...responseBody, warnings: cleanMessages(responseBody.warnings)"));
  const root = await actualPaperActionFixture("generation", source => source, api);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
});

for (const field of ["contractVersionId", "draftRevision", "documentContentRevision", "layoutTemplateVersionId", "sourceSha256"]) test(`body coordinate projection rejects protected ${field} override`, async () => {
  const api = await actualBodyWarningProjectionApi(source => source.replace("warnings: normalizeBodyWarnings(body.warnings)", `${field}: normalizeBodyWarnings(body.warnings)`));
  const root = await actualPaperActionFixture("generation", source => source, api);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, change] of [
  ["extra spread", source => source.replace("{ ...body, warnings:", "{ ...body, ...{}, warnings:")],
  ["computed override", source => source.replace("warnings: normalizeBodyWarnings(body.warnings)", '["warnings"]: normalizeBodyWarnings(body.warnings)')],
  ["raw body helper argument", source => source.replace("normalizeBodyWarnings(body.warnings)", "normalizeBodyWarnings(body)")],
  ["raw body alias escape", source => source.replace("  return { ...body, warnings:", "  const escaped = body; void escaped; return { ...body, warnings:")],
  ["multiple returns", source => source.replace("  return { ...body, warnings:", "  if (body.draftRevision < 0) return body; return { ...body, warnings:")],
  ["protected mutation", source => source.replace("  return { ...body, warnings:", "  body.draftRevision = 999; return { ...body, warnings:")],
  ["unknown normalization call", source => source.replace("return [incompleteBodyWarning];", "return [unknownWrite()];")],
  ["normalizer mutation", source => source.replace("if (value === undefined) return [];", 'if (value === undefined) { approvedBodyWarnings.add("forged"); return []; }')],
  ["escaped validation set", source => source.replace("const incompleteBodyWarning =", "const escapedSet = approvedBodyWarnings; const incompleteBodyWarning =")],
  ["shadowed Array", source => 'const Array = { isArray() { return true; } };\n' + source],
  ["shadowed Set", source => 'const Set = class {};\n' + source],
  ["reassigned transport", source => source.replace("const approvedBodyWarnings =", "readJson = async () => ({}); const approvedBodyWarnings =")],
  ["reassigned normalizer", source => source.replace("export async function fetchContractDraftBody", "normalizeBodyWarnings = () => []; export async function fetchContractDraftBody")]
]) test(`body coordinate projection rejects ${label}`, async () => {
  const api = await actualBodyWarningProjectionApi(source => { const changed = change(source); assert.notEqual(changed, source, label); return changed; });
  const root = await actualPaperActionFixture("generation", source => source, api);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const field of ["warnings", "draftOperationAvailableActions"]) test(`body coordinate projection does not grant authority to ${field}`, async () => {
  const root = await actualPaperActionFixture("generation", source => source.replace("const actions = current.draftOperationAvailableActions;", `const actions = (await fetchContractDraftBody(owner.context.contractVersionId)).${field};`), await actualBodyWarningProjectionApi());
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].capability.serverDerived, false);
});


for (const [label, declaration] of [["async", "async function permits(owner, grant)"], ["generator", "function* permits(owner, grant)"]]) test(`review regression rejects ${label} capability predicates`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant)", declaration));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, expression] of [["direct", "opaque.id"], ["aliased", "alias.id"]]) test(`review regression rejects ${label} bare getter recovery reads`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const opaque = { get id() { submitExample("foreign", 1); return "x"; } }; const alias = opaque; function permits(owner, grant) {').replace("} catch (error) {", `} catch (error) { const observed = ${expression};`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects a pure regexp call reused with an imported resend coercion frame", async () => {
  const root = await actualPaperActionFixture("generation", source => source.replace("function generationPermits(owner: Reader, grant: GenerationGrant | null) {", "function hashOK(value) { return HASH.test(value); } function generationPermits(owner: Reader, grant: GenerationGrant | null) {").replace("HASH.test(grant.fingerprint)", "hashOK(grant.fingerprint)").replace('error.value = "生成请求的结果尚未确认，请先查询生成结果";', 'hashOK({ toString: queueContractDraftPreview }); error.value = "生成请求的结果尚未确认，请先查询生成结果";'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects a bare member from an opaque imported factory", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("import { getExample, submitExample }", "import { getExample, submitExample, opaqueFactory }").replace("function permits(owner, grant) {", "const opaque = opaqueFactory(); function permits(owner, grant) {").replace("} catch (error) {", "} catch (error) { const observed = opaque.id;"));
  const api = "apps/web-admin/src/api/example.api.ts";
  await write(root, api, (await readFile(join(root, api), "utf8")) + '\nexport function opaqueFactory() { return { get id() { submitExample("foreign", 1); return "x"; } }; }\n');
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects a data alias redefined as an accessor", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const opaque = { id: "x" }; const box = opaque; Object.defineProperty(box, "id", { get() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = opaque.id;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, change] of [
  ["unknown caught value", source => source.replace("} catch (error) {", "} catch (error) { const observed = error.id;")],
  ["getter held in another ref", source => source.replace("function permits(owner, grant) {", 'const opaque = ref({ get id() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = opaque.value.id;")]
]) test(`review regression rejects a bare member from ${label}`, async () => {
  const root = await frozenServerGrantFixture(change);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

async function actualTargetJsonFixture(change = source => source) {
  const source = await readFile(new URL("../apps/web-admin/src/api/contract-workbench.api.ts", import.meta.url), "utf8");
  const part = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, start);
    return source.slice(first, last);
  };
  const api = (await actualBodyWarningProjectionApi()).replace("export async function queueContractDraftPreview() { return {}; }", part("export function queueContractDraftPreview(", "\nexport interface ContractDraftSubmissionResult")) +
    '\nimport { apiFetch } from "./transport";\nimport { formatApiErrorMessage } from "./error-message";\n' +
    part("async function ensureOk(", "\nasync function readJson<") + part("async function postJson<", "\nasync function postForm<");
  const changed = change(api);
  const root = await actualPaperActionFixture("generation", value => value, changed);
  await write(root, "apps/web-admin/src/api/transport.ts", "export async function apiFetch() { return new Response(); }\n");
  const path = "docs/product/manifests/web-api-wrappers.json", manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  manifest.evidence.productionModuleCount += 1;
  // The real API snippet reaches both transport and the otherwise-unused error-message module.
  manifest.evidence.reachableProductionModuleCount += 2;
  await write(root, path, JSON.stringify(manifest));
  return root;
}

test("review regression recognizes selected awaited target JSON as data without authority", async () => {
  const root = await actualTargetJsonFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, true);
  assert.equal(manifest.actions[0].capability.serverDerived, true);
});

for (const [label, change] of [
  ["custom response", source => source.replace('const response = await apiFetch(path, {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(body ?? {})\n  });', 'const response = await fakeResponse();')],
  ["overwritten json method", source => source.replace('await ensureOk(response, "提交失败");', 'await ensureOk(response, "提交失败"); response.json = () => ({ get generationId() { unknownWrite(); return "x"; } });')],
  ["multiple returns", source => source.replace('await ensureOk(response, "提交失败");', 'await ensureOk(response, "提交失败"); if (body) return body;')],
  ["response reassignment", source => source.replace('await ensureOk(response, "提交失败");', 'await ensureOk(response, "提交失败"); response = body;')],
  ["validator early success", source => source.replace('if (response.ok) {', 'if (response.ok) { return; } if (response) {')]
]) test(`review regression rejects selected target JSON ${label}`, async () => {
  const root = await actualTargetJsonFixture(source => { const changed = change(source); assert.notEqual(changed, source, label); return changed; });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects an accessor added through a plain factory result alias", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("import { getExample, submitExample }", "import { getExample, submitExample, plainFactory }").replace("function permits(owner, grant) {", 'const opaque = plainFactory(); const alias = opaque; Object.defineProperty(alias, "id", { get() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = opaque.id;"));
  const api = "apps/web-admin/src/api/example.api.ts";
  await write(root, api, (await readFile(join(root, api), "utf8")) + '\nexport function plainFactory() { return { id: "x" }; }\n');
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

async function actualNativeBlobFixture(change = source => source) {
  const root = await actualPaperActionFixture("file");
  const source = await readFile(new URL("../apps/web-admin/src/api/core-flow-read.api.ts", import.meta.url), "utf8");
  const part = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, start);
    return source.slice(first, last);
  };
  const api = 'import { apiFetch } from "./transport";\nimport { formatApiErrorMessage } from "./error-message";\n' +
    part("export class CoreFlowApiError", "\nasync function patchJson<") +
    part("export function getPrivateFileDownloadTicketCapability(", "\nexport function listContractTakeovers(");
  await write(root, "apps/web-admin/src/api/core-flow-read.api.ts", change(api));
  await write(root, "apps/web-admin/src/api/transport.ts", "export async function apiFetch() { return new Response(); }\n");
  const path = "docs/product/manifests/web-api-wrappers.json", manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  manifest.evidence.productionModuleCount += 1; // The real API snippet reaches both transport and the otherwise-unused error-message module.
  manifest.evidence.reachableProductionModuleCount += 2;
  const target = manifest.wrappers.find(item => item.name === "downloadPrivateFileByTicket");
  target.returnProvenance = "unverified";
  target.requests.unshift({ kind: "main", sourceLine: 79, method: "GET", path: "/files/:param/download-ticket-capability", normalizedPath: "/files/:param/download-ticket-capability", normalizedKey: "GET /files/:param/download-ticket-capability", bodyKind: "none" });
  target.requests.push({ kind: "ticket_followup", sourceLine: 5465, method: "GET", ticketField: "downloadUrl", bodyKind: "none" });
  await write(root, path, JSON.stringify(manifest));
  return root;
}

test("review regression recognizes the actual awaited private PDF native Blob fields", async () => {
  const root = await actualNativeBlobFixture();
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "ready", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings.length, 2);
  assert.equal(manifest.actions[0].bindings.every(binding => binding.causalVerified), true);
  const web = JSON.parse(await readFile(join(root, "docs/product/manifests/web-api-wrappers.json"), "utf8"));
  assert.equal(web.wrappers.find(value => value.name === "downloadPrivateFileByTicket").returnProvenance, "unverified");
});

for (const [label, change] of [
  ["custom response", source => source.replace("await apiFetch(ticket.downloadUrl)", "await fakeResponse(ticket.downloadUrl)")],
  ["wrong Blob partner", source => source.replace("await response.blob()", "await other.blob()")],
  ["opaque Blob factory", source => source.replace("await response.blob()", "await makeBlob()")],
  ["wrong MIME header", source => source.replace('response.headers.get("content-type")', 'response.headers.get("x-opaque")')],
  ["weakened token URL check", source => source.replace("ticket.downloadUrl.includes", "ticket.downloadUrl.startsWith")],
  ["accessor return field", source => source.replace("return { blob, fileName: ticket.fileName };", "return { get blob() { return blob; }, fileName: ticket.fileName };")]
]) test(`review regression rejects actual native Blob ${label}`, async () => {
  const root = await actualNativeBlobFixture(source => { const changed = change(source); assert.notEqual(changed, source, label); return changed; });
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", `${label}: ${JSON.stringify(manifest.blockers)}`);
  assert.equal(manifest.actions[0].bindings.every(binding => binding.causalVerified === false), true);
});

test("review regression rejects regexp coercion of an unknown caught value", async () => {
  const root = await actualPaperActionFixture("generation", source => source.replace("function generationPermits(owner: Reader, grant: GenerationGrant | null) {", "function hashOK(value) { return HASH.test(value); } function generationPermits(owner: Reader, grant: GenerationGrant | null) {").replace("HASH.test(grant.fingerprint)", "hashOK(grant.fingerprint)").replace('error.value = "生成请求的结果尚未确认，请先查询生成结果";', 'hashOK(cause); error.value = "生成请求的结果尚未确认，请先查询生成结果";'));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, expression] of [["nested path", "opaque.child.id"], ["projected alias", "alias.id"]]) test(`review regression rejects accessor mutation through ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const opaque = { child: { id: "x" } }; const alias = opaque.child; Object.defineProperty(alias, "id", { get() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", `} catch (error) { const observed = ${expression};`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, expression] of [["ref value path", "opaque.value.id"], ["ref projected alias", "alias.id"]]) test(`review regression rejects accessor mutation through ${label}`, async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const opaque = ref({ id: "x" }); const alias = opaque.value; Object.defineProperty(alias, "id", { get() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", `} catch (error) { const observed = ${expression};`));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects unknown factory replacement of a scalar-initialized ref", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const opaque = ref(null); function makeOpaque() { return { valueOf() { submitExample("foreign", 1); return 1; } }; } opaque.value = makeOpaque(); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = opaque.value > 0;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects an unknown caught replacement through a ref value alias", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", "const opaque = ref(null); function permits(owner, grant) {").replace("} catch (error) {", "} catch (error) { opaque.value = error; const alias = opaque.value; const observed = alias.id;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects coercion hooks reached through a frozen ref container", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'function hiddenCoercion() { submitExample("foreign", 1); return 1; } const opaque = ref(Object.freeze({ valueOf: hiddenCoercion })); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = opaque.value > 0;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

test("review regression rejects an escaped child identifier through a frozen ref alias", async () => {
  const root = await frozenServerGrantFixture(source => source.replace("function permits(owner, grant) {", 'const child = { id: "x" }; const opaque = ref(Object.freeze({ child })); const alias = opaque.value; Object.defineProperty(child, "id", { get() { submitExample("foreign", 1); return "x"; } }); function permits(owner, grant) {').replace("} catch (error) {", "} catch (error) { const observed = alias.child.id;"));
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});


test("frozen server grant rejects imported formatter typed local passthrough of an unknown coercible error", async () => {
  const root = await formattedFrozenServerGrantFixture(source => source, () => 'function passthrough(text: string): string { return `${text}`; }\nexport function formatUnknownApiError(error: unknown, fallback: string): string { return passthrough(error as string); }\n');
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

for (const [label, expression] of [["bare member", "error.message"], ["unary coercion", "+error"], ["binary coercion", 'error + ""']]) test(`imported formatter rejects an unused unknown ${label} effect`, async () => {
  const root = await formattedFrozenServerGrantFixture(source => source, () => `export function formatUnknownApiError(error: unknown, fallback: string): string { const ignored = ${expression}; return fallback; }\n`);
  const manifest = await inspectWholeSitePageActionManifest({ root });
  assert.equal(manifest.status, "blocked", JSON.stringify(manifest.blockers));
  assert.equal(manifest.actions[0].bindings[0].causalVerified, false);
});

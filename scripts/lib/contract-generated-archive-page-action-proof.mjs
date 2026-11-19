import {
  importedBinding, localDeclarator, namedBinding, namedDefinition,
  proveContractSigningParent, proveReferences, vueBinding, wrapperHasOneRequest
} from "./contract-seal-page-action-proof.mjs";

// Pin only the guarded archive witnesses and bind their identifiers at the actual callsites.
const statements = {
  object: `function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }`,
  sameStrings: `function sameStrings(a: unknown, b: readonly string[]) { return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]); }`,
  validCoordinates: `function validCoordinates(body: unknown): body is ContractSealConfirmationV2Payload {
  return object(body) && typeof body.expectedApprovalInstanceId === "string" && uuid.test(body.expectedApprovalInstanceId) &&
    typeof body.expectedSealTaskId === "string" && uuid.test(body.expectedSealTaskId) && Number.isInteger(body.documentContentRevision) && Number(body.documentContentRevision) > 0 &&
    typeof body.documentContentFingerprint === "string" && fingerprint.test(body.documentContentFingerprint);
}`,
  validArchiveBody: `function validArchiveBody(body: unknown): body is ContractSignedArchiveV2Payload {
  return validCoordinates(body) && object(body) && Object.keys(body).length === 9 && body.archiveProtocolVersion === 2 && body.archiveSource === "generated_approval" &&
    typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey) && body.confirmedMatchingSignedDocument === true &&
    Array.isArray(body.fileIds) && body.fileIds.length >= 1 && body.fileIds.length <= 20 && new Set(body.fileIds).size === body.fileIds.length && body.fileIds.every(id => typeof id === "string" && uuid.test(id));
}`,
  sameCoordinates: `function sameCoordinates(value: Ready | null, body: ContractSealConfirmationV2Payload | ContractSignedArchiveV2Payload) {
  return !!value && value.approvalInstanceId === body.expectedApprovalInstanceId && value.sealTaskId === body.expectedSealTaskId &&
    value.documentContentRevision === body.documentContentRevision && value.documentContentFingerprint === body.documentContentFingerprint;
}`,
  sameArchiveBody: `function sameArchiveBody(a: unknown, b: ContractSignedArchiveV2Payload) {
  return validArchiveBody(a) && a.archiveProtocolVersion === b.archiveProtocolVersion && a.archiveSource === b.archiveSource && a.idempotencyKey === b.idempotencyKey &&
    a.expectedApprovalInstanceId === b.expectedApprovalInstanceId && a.expectedSealTaskId === b.expectedSealTaskId &&
    a.documentContentRevision === b.documentContentRevision && a.documentContentFingerprint === b.documentContentFingerprint &&
    a.confirmedMatchingSignedDocument === b.confirmedMatchingSignedDocument && sameStrings(a.fileIds, b.fileIds);
}`,
  readyContext: `function readyContext(detail: ContractDetailReadModel | null, actor: string | undefined): Ready | null {
  const value = detail?.v2Lifecycle;
  return value?.status === "ready" && value.protocolVersion === 2 && value.source === "generated_approval" &&
    (value.scope === "inside_original" || value.scope === "outside_original" || value.scope === "upward_original") &&
    !detail?.historyReadOnly && !!actor && value.actorUserId === actor && value.contractVersionId === detail?.contractVersionId &&
    uuid.test(value.contractVersionId) && uuid.test(value.approvalInstanceId) && uuid.test(value.sealTaskId) &&
    Number.isInteger(value.documentContentRevision) && value.documentContentRevision > 0 && fingerprint.test(value.documentContentFingerprint) &&
    value.approvalSource?.status === "references_ready" ? value : null;
}`,
  coordinates: `function coordinates(value: Ready): ContractSealConfirmationV2Payload {
  return { expectedApprovalInstanceId: value.approvalInstanceId, expectedSealTaskId: value.sealTaskId,
    documentContentRevision: value.documentContentRevision, documentContentFingerprint: value.documentContentFingerprint, confirmed: true };
}`,
  sha256: `async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}`,
  archiveRequestSha: `async function archiveRequestSha(intent: Pick<ArchiveIntent, "actor" | "versionId" | "body">) {
  const body = intent.body;
  return sha256(new TextEncoder().encode(JSON.stringify({ versionId: intent.versionId, actor: intent.actor,
    archiveProtocolVersion: body.archiveProtocolVersion, archiveSource: body.archiveSource, idempotencyKey: body.idempotencyKey,
    expectedApprovalInstanceId: body.expectedApprovalInstanceId, expectedSealTaskId: body.expectedSealTaskId,
    documentContentRevision: body.documentContentRevision, documentContentFingerprint: body.documentContentFingerprint,
    fileIds: body.fileIds, confirmedMatchingSignedDocument: body.confirmedMatchingSignedDocument })));
}`,
  archiveEligible: `function archiveEligible(value: Ready | null) {
  return value?.state === "pending_archive" && value.webWriteReleased === true && value.archiveAction?.key === "archive_signed_v2" &&
    value.archiveAction.eligible === true && value.archiveAction.enabled === true && value.signedFilePolicy?.mimeType === "application/pdf" &&
    value.signedFilePolicy.minCount === 1 && value.signedFilePolicy.maxCount === 20 && value.signedFilePolicy.ordered === true;
}`,
  persist: `function persist(kind: "seal" | "archive", value: SealIntent | ArchiveIntent) {
    if (localStorage.getItem(storageKey(kind))) { storageBlocked.value = true; throw new Error(); }
    localStorage.setItem(storageKey(kind), JSON.stringify(value));
  }`,
  removeSaved: `function removeSaved(kind: "seal" | "archive", intent: SealIntent | ArchiveIntent) {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return;
    const saved = JSON.parse(raw) as SealIntent | ArchiveIntent;
    const matches = kind === "archive" ? "requestSha256" in saved && "requestSha256" in intent && saved.requestSha256 === intent.requestSha256 &&
      "idempotencyKey" in saved.body && "idempotencyKey" in intent.body && saved.body.idempotencyKey === intent.body.idempotencyKey :
      saved.actor === intent.actor && saved.versionId === intent.versionId && JSON.stringify(saved.body) === JSON.stringify(intent.body);
    if (!matches) { storageBlocked.value = true; throw new Error(); }
    localStorage.removeItem(storageKey(kind));
  }`,
  readArchive: `async function readArchive(intent: ArchiveIntent, started: OperationScope) {
    const result = await fetchSignedContractArchiveV2Result(intent.versionId, intent.body.idempotencyKey);
    if (!current(started)) return "stale";
    if (result?.status === "unknown") { message.value = "归档结果待核对，请保留原请求；可查询或按原请求继续"; return "unknown"; }
    if (result?.status !== "archived" || result.requestSha256 !== intent.requestSha256 || !sameArchiveBody(result.intent, intent.body) ||
      !object(result.result) || !uuid.test(result.result.archiveId) || result.result.contractVersionId !== intent.versionId || result.result.status !== "effective" || !sameStrings(result.result.fileIds, intent.body.fileIds)) {
      message.value = "返回结果与原归档请求尚未核对一致，请保留原请求并查询"; return "mismatch";
    }
    removeSaved("archive", intent); archiveIntent.value = null; files.value = [];
    message.value = "双方签章原件已归档，合同已生效"; input.refresh({ actor: intent.actor, versionId: intent.versionId, kind: "archive" }); return "archived";
  }`,
  sendArchive: `async function sendArchive(intent: ArchiveIntent, started: OperationScope) {
    if (!current(started)) return;
    try { await archiveSignedContractV2(intent.versionId, intent.body, () => current(started)); } catch { /* Recovery reads the original request. */ }
    if (current(started)) await readArchive(intent, started);
  }`,
  confirmArchive: `async function confirmArchive() {
    if (!canArchive.value || !context.value) return;
    const started = captureScope(), captured = coordinates(context.value), versionId = context.value.contractVersionId, actor = input.actor.value!;
    busy.value = true;
    try {
      const beforeUpload = await fetchContractDetail(input.routeContractId.value, { versionId });
      if (!current(started)) return;
      const uploadContext = readyContext(beforeUpload, actor);
      if (!archiveEligible(uploadContext) || !sameCoordinates(uploadContext, captured)) { message.value = "当前合同或权限已变化，已保留当前原件，请核对当前轮次"; return; }
      for (const item of files.value) {
        if (item.fileId) continue;
        if (!item.file) { message.value = "请重新选择尚未上传的PDF文件"; return; }
        try {
          const uploaded = await uploadPrivateFile(item.file, item.name, item.localId, () => current(started));
          if (!current(started)) return;
          if (!uploaded || !uuid.test(uploaded.id)) throw new Error();
          item.fileId = uploaded.id; item.error = "";
        } catch { if (current(started)) { item.error = "上传未完成，重试将保留已成功的原件"; message.value = item.error; } return; }
      }
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, actor);
      if (!archiveEligible(value) || !sameCoordinates(value, captured)) { message.value = "当前合同或权限已变化，已保留当前原件，请核对当前轮次"; return; }
      const fileIds = files.value.map(item => item.fileId!);
      if (new Set(fileIds).size !== fileIds.length) { message.value = "原件引用重复，已停止归档，请核对上传文件"; return; }
      const body: ContractSignedArchiveV2Payload = { archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: crypto.randomUUID(),
        expectedApprovalInstanceId: captured.expectedApprovalInstanceId, expectedSealTaskId: captured.expectedSealTaskId,
        documentContentRevision: captured.documentContentRevision, documentContentFingerprint: captured.documentContentFingerprint,
        fileIds, confirmedMatchingSignedDocument: true };
      const intent: ArchiveIntent = { schemaVersion: 1, actor, versionId, body, requestSha256: "", files: files.value.map(item => ({ fileId: item.fileId!, name: item.name })) };
      intent.requestSha256 = await archiveRequestSha(intent);
      if (!current(started)) return;
      persist("archive", intent); archiveIntent.value = intent;
      await sendArchive(intent, started);
    } catch (error) { if (current(started)) message.value = archiveIntent.value
      ? error instanceof CoreFlowApiError && error.status === 403 ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "归档结果待核对，请保留原请求后再次查询"
      : "未能完成归档前核对，已保留当前原件"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  continueArchive: `async function continueArchive() {
    if (!canContinueArchive.value || !archiveIntent.value) return;
    const started = captureScope(), intent = JSON.parse(JSON.stringify(archiveIntent.value)) as ArchiveIntent; busy.value = true;
    try {
      if (await readArchive(intent, started) !== "unknown" || !current(started)) return;
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!archiveEligible(value) || !sameCoordinates(value, intent.body)) { message.value = "当前合同或权限已变化，请继续核对原归档结果"; return; }
      await sendArchive(intent, started);
    } catch (error) { if (current(started)) message.value = error instanceof CoreFlowApiError && error.status === 403
      ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "暂时无法继续核对原请求，已保留原请求和原件"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  queryArchive: `async function queryArchive() {
    if (busy.value || !archiveIntent.value) return;
    const started = captureScope(); busy.value = true;
    try { await readArchive(archiveIntent.value, started); }
    catch (error) { if (current(started)) message.value = error instanceof CoreFlowApiError && error.status === 403
      ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "暂时无法查询归档结果，已保留原请求和原件"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  fetchContractDetail: `function fetchContractDetail(contractId: string, options?: { versionId?: string }) {
  const query = options?.versionId
    ? \`?versionId=\${encodeURIComponent(options.versionId)}\`
    : "";
  return readJson<ContractDetailReadModel>(
    \`/contracts/\${encodeURIComponent(contractId)}\${query}\`,
    { "x-contract-numeric-protocol": "2" }
  );
}`,
  fetchSignedContractArchiveV2Result: `function fetchSignedContractArchiveV2Result(versionId: string, key: string) {
  return readJson<ContractSignedArchiveV2Lookup>(\`/contracts/\${encodeURIComponent(versionId)}/archive-requests/\${encodeURIComponent(key)}\`);
}`,
  archiveSignedContractV2: `function archiveSignedContractV2(
  versionId: string,
  body: ContractSignedArchiveV2Payload | ContractDirectRegistrationPayload,
  responseIsCurrent: () => boolean
) {
  const options = { retryUnauthorized: false, responseIsCurrent };
  return postJson<ContractSignedArchiveV2Result>(\`/contracts/\${encodeURIComponent(versionId)}/signed-archive\`, body, options);
}`,
  uploadPrivateFile: `function uploadPrivateFile(
  file: Blob,
  fileName: string,
  idempotencyKey?: string,
  responseIsCurrent?: () => boolean
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  const options = responseIsCurrent ? { retryUnauthorized: false, responseIsCurrent } : undefined;
  return postForm<PrivateFileReadModel>("/files", form, options);
}`,
  readJson: `async function readJson<T>(path: string, headers?: Record<string, string>, options?: Pick<ApiFetchInit, "retryUnauthorized" | "responseIsCurrent">): Promise<T> {
  const response = await apiFetch(path, headers || options ? { headers, ...options } : undefined);
  await ensureOk(response, "读取失败");
  return response.json() as Promise<T>;
}`,
  postJson: `async function postJson<TResponse>(path: string, body?: unknown, options?: Pick<ApiFetchInit, "retryUnauthorized" | "responseIsCurrent">): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ...options
  });
  await ensureOk(response, "提交失败");
  return response.json() as Promise<TResponse>;
}`,
  postForm: `async function postForm<TResponse>(path: string, body: FormData, options?: Pick<ApiFetchInit, "retryUnauthorized" | "responseIsCurrent">): Promise<TResponse> {
  const response = await apiFetch(path, { method: "POST", body, ...options });
  await ensureOk(response, "上传失败");
  return response.json() as Promise<TResponse>;
}`,
};

const web = "apps/web-admin/src";
const page = `${web}/pages/contracts/ContractSignedArchiveSection.vue`;
export const GENERATED_ARCHIVE_CONSUMER = `${web}/pages/contracts/use-contract-signed-archive.ts`;
export const GENERATED_ARCHIVE_API = `${web}/api/core-flow-read.api.ts`;
export const GENERATED_ARCHIVE_WRITE = "archiveSignedContractV2";
export const GENERATED_ARCHIVE_UPLOAD = "uploadPrivateFile";
export const GENERATED_ARCHIVE_CONFIRM = "contract-generated-archive.confirm";
export const GENERATED_ARCHIVE_RESUME = "contract-generated-archive.resume-original";
export const GENERATED_ARCHIVE_ACTIONS = new Set([GENERATED_ARCHIVE_CONFIRM, GENERATED_ARCHIVE_RESUME]);
const read = "fetchContractDetail";
const result = "fetchSignedContractArchiveV2Result";
const apiRequests = {
  [read]: "GET /contracts/:param",
  [result]: "GET /contracts/:param/archive-requests/:param",
  [GENERATED_ARCHIVE_WRITE]: "POST /contracts/:param/signed-archive",
  [GENERATED_ARCHIVE_UPLOAD]: "POST /files"
};

function exactDefinitions(symbols, names, syntax) {
  const bindings = new Map();
  for (const name of names) {
    const value = namedDefinition(symbols, name, syntax);
    if (!value || !syntax.matches(value.definition, statements[name])) return null;
    bindings.set(name, value);
  }
  return bindings;
}

function provesSection({ symbols, candidate }, first, syntax) {
  const handler = first ? "submitArchive" : "submitContinue";
  const method = first ? "confirmArchive" : "continueArchive";
  const dialog = first ? "archiveDialog" : "continueDialog";
  if (candidate?.kind !== "event" || candidate.element !== "t-dialog" || candidate.event !== "confirm" ||
      candidate.handler !== handler || !syntax.sameExpression(candidate.expression, handler) ||
      candidate.elementNode.variables?.length ||
      syntax.astAncestorChain(symbols.ast.templateBody, candidate.elementNode)?.some(node => node.variables?.length) ||
      !syntax.sameExpression(syntax.elementDirective(candidate.elementNode, "model", "visible")?.value?.expression, dialog)) return false;
  const callbacks = symbols.ast.body.filter(node => node.type === "VariableDeclaration" && node.kind === "const")
    .flatMap(node => node.declarations)
    .filter(node => node.id.type === "ObjectPattern" && syntax.callExpressionMatchesWrapper(
      node.init, { apiFile: GENERATED_ARCHIVE_CONSUMER, name: "useContractSignedArchive" }, symbols));
  const [callback] = callbacks;
  if (callbacks.length !== 1 || callback.init.arguments.length !== 1 ||
      !syntax.sameExpression(callback.init.arguments[0], `{
        detail: computed(() => props.detail), actor: computed(() => props.actorUserId), routeContractId: computed(() => props.routeContractId),
        externalBusy: computed(() => props.externalBusy), refresh: completion => emit("completed", completion)
      }`)) return false;

  const binding = namedBinding(symbols, method, syntax);
  const fields = callback.id.properties.filter(property => property.type === "Property" && !property.computed && property.key.name === method);
  const implementation = namedDefinition(symbols, handler, syntax);
  if (fields.length !== 1 || !binding || symbols.scopeBindings.get(fields[0].value) !== binding ||
      !implementation || binding.references.some(ref => !ref.init && !inside(implementation.definition, ref.identifier)) ||
      !syntax.matches(implementation.definition, `async function ${handler}() {
        ${first ? "if (!matching.value) return;" : ""}
        ${dialog}.value = false; await ${method}();
      }`)) return false;

  const props = namedBinding(symbols, "props", syntax);
  const emit = namedBinding(symbols, "emit", syntax);
  for (const [value, macro] of [[props, "defineProps"], [emit, "defineEmits"]]) {
    const initializer = value && syntax.uniqueIndexedNode(symbols.declarationsByBinding, value);
    if (initializer?.type !== "CallExpression" || initializer.arguments.length !== 0 ||
        !syntax.unshadowedRuntimeGlobal(initializer.callee, new Set([macro]), symbols.scopeBindings)) return false;
  }
  return proveReferences([callback.init.arguments[0], implementation.definition], symbols,
    new Map([["computed", vueBinding(symbols, "computed", syntax)], ["props", props], ["emit", emit],
      [dialog, namedBinding(symbols, dialog, syntax)], [method, binding],
      ["matching", namedBinding(symbols, "matching", syntax)]]), new Set(), syntax) &&
    provesArchiveDialogOpening(symbols, candidate, first, syntax);
}

function provesArchiveDialogOpening(symbols, candidate, first, syntax) {
  const buttons = [];
  const opening = first ? "openArchiveDialog" : "continueDialog = true";
  const guard = first ? "canArchive" : "canContinueArchive";
  syntax.walkEstree(symbols.ast.templateBody, node => {
    if (node.type !== "VElement" || node.name !== "t-button" ||
        !syntax.sameExpression(syntax.elementDirective(node, "if")?.value?.expression, guard)) return;
    buttons.push(node);
  });
  if (buttons.length !== 1 || buttons[0].variables?.length ||
      syntax.astAncestorChain(symbols.ast.templateBody, buttons[0])?.some(node => node.variables?.length)) return false;
  const event = syntax.elementDirective(buttons[0], "on", "click")?.value?.expression;
  const click = event?.type === "VOnExpression" && event.body.length === 1 ? event.body[0].expression : event;
  if (!syntax.sameExpression(click, opening)) return false;
  if (!first) return true;
  const open = namedDefinition(symbols, opening, syntax);
  const checkboxes = [];
  syntax.walkEstree(candidate.elementNode, node => {
    if (node.type === "VElement" && node.name === "t-checkbox") checkboxes.push(node);
  });
  return Boolean(open && syntax.matches(open.definition,
    "function openArchiveDialog() { matching.value = false; archiveDialog.value = true; }") &&
    checkboxes.length === 1 &&
    syntax.sameExpression(syntax.elementDirective(checkboxes[0], "model")?.value?.expression, "matching"));
}

const stateInitializers = {
  busy: "ref(false)", hydrating: "ref(false)", storageBlocked: "ref(false)", message: 'ref("")',
  sealIntent: "ref<SealIntent | null>(null)", archiveIntent: "ref<ArchiveIntent | null>(null)", files: "ref<SignedFile[]>([])",
  scope: 'computed(() => `${input.actor.value ?? ""}:${input.detail.value?.contractVersionId ?? ""}`)',
  context: "computed(() => readyContext(input.detail.value, input.actor.value))",
  disposed: "false", hydrateSequence: "0", scopeEpoch: "0",
  captureScope: "(): OperationScope => ({ key: scope.value, epoch: scopeEpoch })",
  current: "(started: OperationScope) => !disposed && scope.value === started.key && scopeEpoch === started.epoch",
  storageKey: '(kind: "seal" | "archive") => `jg:contract-${kind}-intent:v1:${encodeURIComponent(input.actor.value ?? "")}:${encodeURIComponent(input.detail.value?.contractVersionId ?? "")}`',
  locked: "computed(() => busy.value || hydrating.value || storageBlocked.value || !!sealIntent.value || !!archiveIntent.value)",
  canSelectFiles: "computed(() => archiveEligible(context.value) && !locked.value && !input.externalBusy.value)",
  canArchive: "computed(() => canSelectFiles.value && files.value.length >= 1 && files.value.length <= 20)",
  canContinueArchive: "computed(() => !!archiveIntent.value && !sealIntent.value && !busy.value && !hydrating.value && !storageBlocked.value && !input.externalBusy.value && archiveEligible(context.value))"
};

const hydration = `watch(scope, async () => {
    scopeEpoch++;
    const sequence = ++hydrateSequence, started = captureScope();
    busy.value = false;
    sealIntent.value = null; archiveIntent.value = null; files.value = []; message.value = ""; storageBlocked.value = false; hydrating.value = true;
    try {
      if (!input.actor.value || !input.detail.value) return;
      const sealRaw = localStorage.getItem(storageKey("seal")), archiveRaw = localStorage.getItem(storageKey("archive"));
      if (sealRaw) {
        const saved = JSON.parse(sealRaw) as SealIntent;
        if (saved.schemaVersion !== 1 || saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId || !validCoordinates(saved.body) ||
          Object.keys(saved.body).length !== 5 || saved.body.confirmed !== true) throw new Error();
        sealIntent.value = saved; message.value = "盖章结果待核对，请查询本次办理结果";
      }
      if (archiveRaw) {
        if (archiveRaw.length > 32_768) throw new Error();
        const saved = JSON.parse(archiveRaw) as ArchiveIntent;
        if (saved.schemaVersion !== 1 || saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId || !validArchiveBody(saved.body) ||
          !fingerprint.test(saved.requestSha256) || !Array.isArray(saved.files) || saved.files.length !== saved.body.fileIds.length || saved.files.some((file, index) => !object(file) || file.fileId !== saved.body.fileIds[index] || typeof file.name !== "string" || !file.name || file.name.length > 1024)) throw new Error();
        const expected = await archiveRequestSha(saved);
        if (!current(started) || sequence !== hydrateSequence) return;
        if (saved.requestSha256 !== expected) throw new Error();
        archiveIntent.value = saved;
        files.value = saved.files.map(file => ({ localId: file.fileId, name: file.name, fileId: file.fileId, contentSha256: "", error: "" }));
        message.value = "归档结果待核对，请保留本次原请求并查询结果";
      }
    } catch { if (current(started) && sequence === hydrateSequence) { storageBlocked.value = true; message.value = "本机办理记录无法核对，已停止发起新操作"; } }
    finally { if (current(started) && sequence === hydrateSequence) hydrating.value = false; }
  }, { immediate: true, flush: "sync" });`;

function provesState(factory, symbols, syntax) {
  const values = new Map();
  for (const [name, expression] of Object.entries(stateInitializers)) {
    const value = localDeclarator(factory, name, symbols);
    if (!value || !syntax.sameExpression(value.declaration.init, expression)) return null;
    values.set(name, value);
  }
  const events = name => factory.body.body.filter(node =>
    node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee?.name === name);
  const unmount = events("onBeforeUnmount");
  const watches = events("watch");
  if (unmount.length !== 1 || watches.length !== 1 ||
      !syntax.matches(unmount[0], "onBeforeUnmount(() => { disposed = true; hydrateSequence++; scopeEpoch++; });") ||
      !syntax.matches(watches[0], hydration)) return null;
  const assignments = new Set();
  for (const hook of [...unmount, ...watches]) {
    syntax.walkEstree(hook, node => {
      if (node.type === "UpdateExpression" || node.type === "AssignmentExpression") assignments.add(node.argument ?? node.left);
    });
  }
  if ([...values.values()].some(({ binding }) => binding.references.some(ref =>
    ref.isWrite() && !ref.init && !assignments.has(ref.identifier)))) return null;
  return { values, witnesses: [...values.values()].map(({ declaration }) => declaration.init).concat(unmount, watches), watch: watches[0] };
}

function inside(container, node) {
  return container?.range && node?.range && container.range[0] <= node.range[0] && node.range[1] <= container.range[1];
}

function provesOriginalIntent(symbols, archive, scope, methods, syntax) {
  const allowed = [scope.watch, methods.get("confirmArchive").definition, methods.get("readArchive").definition];
  let intact = true;
  syntax.walkEstree(symbols.ast, node => {
    if (!["AssignmentExpression", "UpdateExpression", "UnaryExpression"].includes(node.type) ||
        (node.type === "UnaryExpression" && node.operator !== "delete")) return;
    if (symbols.scopeBindings.get(syntax.referenceRootIdentifier(node.left ?? node.argument)) !== archive) return;
    if (node.type !== "AssignmentExpression" || !allowed.some(writer => inside(writer, node)) ||
        !["archiveIntent.value = null", "archiveIntent.value = saved", "archiveIntent.value = intent"]
          .some(expected => syntax.sameExpression(node, expected))) intact = false;
  });
  return intact;
}

function provesComposable(context, first, syntax) {
  const ast = context.asts.get(GENERATED_ARCHIVE_CONSUMER);
  if (!ast) return false;
  const symbols = syntax.buildSymbolContext(ast, GENERATED_ARCHIVE_CONSUMER, context.sourceFileSet);
  const factory = namedDefinition(symbols, "useContractSignedArchive", syntax)?.definition;
  const input = factory?.params.length === 1 && symbols.scopeBindings.get(factory.params[0]);
  if (factory?.type !== "FunctionDeclaration" || !input || factory.params[0].name !== "input" ||
      input.references.some(ref => ref.isWrite() && !ref.init) ||
      !ast.body.some(node => node.type === "ExportNamedDeclaration" && node.declaration === factory)) return false;
  const methods = new Map();
  const exposed = ["confirmArchive", "continueArchive", "queryArchive"];
  for (const name of [...exposed, "readArchive", "sendArchive", "persist", "removeSaved"]) {
    const method = syntax.localCallable(factory, name, symbols, exposed.includes(name));
    if (!method) return false;
    methods.set(name, method);
  }
  const selected = first ? "confirmArchive" : "continueArchive";
  const checked = [selected, "queryArchive", "readArchive", "sendArchive", "removeSaved", ...(first ? ["persist"] : [])];
  if (checked.some(name => !syntax.matches(methods.get(name).definition, statements[name]))) return false;
  const scope = provesState(factory, symbols, syntax);
  const helpers = exactDefinitions(symbols, ["object", "sameStrings", "validCoordinates", "validArchiveBody",
    "sameCoordinates", "sameArchiveBody", "readyContext", "coordinates", "archiveRequestSha", "sha256", "archiveEligible"], syntax);
  if (!scope || !helpers || !provesOriginalIntent(symbols, scope.values.get("archiveIntent").binding, scope, methods, syntax)) return false;
  const bound = new Map([...scope.values, ...helpers, ...methods].map(([name, value]) => [name, value.binding]));
  bound.set("input", input);
  for (const name of ["computed", "ref", "watch", "onBeforeUnmount"]) {
    const binding = vueBinding(symbols, name, syntax);
    if (!binding) return false;
    bound.set(name, binding);
  }
  for (const [name, expected] of [
    ["uuid", "/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu"],
    ["fingerprint", "/^[0-9a-f]{64}$/u"]
  ]) {
    const binding = namedBinding(symbols, name, syntax);
    if (!binding || !syntax.sameExpression(syntax.uniqueIndexedNode(symbols.declarationsByBinding, binding), expected)) return false;
    bound.set(name, binding);
  }
  const error = importedBinding(symbols, "CoreFlowApiError", GENERATED_ARCHIVE_API, syntax);
  if (!error) return false;
  bound.set("CoreFlowApiError", error);
  for (const name of Object.keys(apiRequests)) {
    const binding = importedBinding(symbols, name, GENERATED_ARCHIVE_API, syntax);
    if (!binding) return false;
    bound.set(name, binding);
  }
  for (const [name, permitted] of [
    [GENERATED_ARCHIVE_WRITE, ["sendArchive"]], [GENERATED_ARCHIVE_UPLOAD, ["confirmArchive"]],
    [result, ["readArchive"]], ["sendArchive", ["confirmArchive", "continueArchive"]]
  ]) {
    if (bound.get(name).references.some(ref => !permitted.some(method => inside(methods.get(method).definition, ref.identifier)))) return false;
  }
  const witnesses = scope.witnesses.concat([...helpers.values()].map(value => value.definition),
    checked.map(name => methods.get(name).definition));
  return proveReferences(witnesses, symbols, bound,
    new Set(["Array", "Error", "JSON", "Number", "Object", "Set", "TextEncoder", "Uint8Array",
      "crypto", "encodeURIComponent", "localStorage"]), syntax);
}

function provesApi(context, syntax, first) {
  const ast = context.asts.get(GENERATED_ARCHIVE_API);
  if (!ast) return false;
  const symbols = syntax.buildSymbolContext(ast, GENERATED_ARCHIVE_API, context.sourceFileSet);
  const names = [read, result, GENERATED_ARCHIVE_WRITE, "readJson", "postJson",
    ...(first ? [GENERATED_ARCHIVE_UPLOAD, "postForm"] : [])];
  const definitions = exactDefinitions(symbols, names, syntax);
  const transport = importedBinding(symbols, "apiFetch", `${web}/api/api-fetch.ts`, syntax);
  const ensureOk = namedBinding(symbols, "ensureOk", syntax);
  if (!definitions || !transport || !ensureOk) return false;
  const bound = new Map([...definitions].map(([name, value]) => [name, value.binding]));
  bound.set("apiFetch", transport);
  bound.set("ensureOk", ensureOk);
  return proveReferences([...definitions.values()].map(value => value.definition), symbols, bound,
    new Set(["encodeURIComponent", "JSON", "FormData", "undefined"]), syntax);
}

export function proveGeneratedArchivePageAction({ action, wrapper, context, syntax }) {
  const first = action.id === GENERATED_ARCHIVE_CONFIRM;
  const wrappers = first ? [GENERATED_ARCHIVE_WRITE, GENERATED_ARCHIVE_UPLOAD] : [GENERATED_ARCHIVE_WRITE];
  if (!GENERATED_ARCHIVE_ACTIONS.has(action.id) || action.sourceFile !== page ||
      action.routePaths.length !== 1 || action.routePaths[0] !== "/合同管理/:contractId" ||
      action.semantic !== "business_write" || action.capability.kind !== "server_boolean" ||
      action.capability.source !== "v2Lifecycle.archiveAction.eligible" ||
      action.wrappers.length !== wrappers.length || wrappers.some(name => !action.wrappers.some(entry =>
        entry.apiFile === GENERATED_ARCHIVE_API && entry.name === name && entry.variant === undefined)) ||
      wrapper.apiFile !== GENERATED_ARCHIVE_API || !wrappers.includes(wrapper.name)) return null;
  const upstream = first ? Object.keys(apiRequests) : [read, result, GENERATED_ARCHIVE_WRITE];
  if (upstream.some(name => {
    const proof = context.wrapperIndex.get(syntax.wrapperIdentity(GENERATED_ARCHIVE_API, name));
    const route = context.nestRouteIndex.get(apiRequests[name]);
    return !wrapperHasOneRequest(proof, apiRequests[name], syntax) || route?.authentication !== "authenticated" ||
      route.isPublic !== false || ([read, result].includes(name) && proof.returnProvenance !== "transparent_main_response");
  }) || !provesSection(context, first, syntax) || !provesComposable(context, first, syntax) ||
      !provesApi(context, syntax, first) || !proveContractSigningParent(context, syntax)) return null;
  return {
    kind: first ? "generated_archive_first" : "generated_archive_resume",
    verified: true,
    capabilityWitness: true,
    capabilitySourceFile: GENERATED_ARCHIVE_CONSUMER,
    capabilitySources: new Set([syntax.wrapperIdentity(GENERATED_ARCHIVE_API, read)])
  };
}

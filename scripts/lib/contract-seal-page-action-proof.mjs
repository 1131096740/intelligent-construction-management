// These syntax witnesses pin the current guarded chains. Whitespace and
// comments do not affect the AST comparison. The proof below also resolves
// the guarded read, write and dispatch callables at their lexical bindings.
const statements = {
  object: `function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }`,
  validCoordinates: `function validCoordinates(body: unknown): body is ContractSealConfirmationV2Payload {
  return object(body) && typeof body.expectedApprovalInstanceId === "string" && uuid.test(body.expectedApprovalInstanceId) &&
    typeof body.expectedSealTaskId === "string" && uuid.test(body.expectedSealTaskId) && Number.isInteger(body.documentContentRevision) && Number(body.documentContentRevision) > 0 &&
    typeof body.documentContentFingerprint === "string" && fingerprint.test(body.documentContentFingerprint);
}`,
  sameCoordinates: `function sameCoordinates(value: Ready | null, body: ContractSealConfirmationV2Payload | ContractSignedArchiveV2Payload) {
  return !!value && value.approvalInstanceId === body.expectedApprovalInstanceId && value.sealTaskId === body.expectedSealTaskId &&
    value.documentContentRevision === body.documentContentRevision && value.documentContentFingerprint === body.documentContentFingerprint;
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
  sealEligible: `function sealEligible(value: Ready | null) {
  return value?.state === "pending_seal" && value.webWriteReleased === true && value.sealAction?.key === "confirm_seal_v2" &&
    value.sealAction.eligible === true && value.sealAction.enabled === true;
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
  readSeal: `async function readSeal(intent: SealIntent, started: OperationScope) {
    const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
    if (!current(started)) return false;
    const value = readyContext(fresh, input.actor.value);
    if (!sameCoordinates(value, intent.body) || value?.sealOutcome.status !== "completed" || !value.sealOutcome.completedAt || !value.sealOutcome.completedByUserId) {
      message.value = "盖章结果待核对，请保留本次办理记录后再次查询"; return false;
    }
    removeSaved("seal", intent); sealIntent.value = null;
    message.value = value.sealOutcome.completedByUserId === intent.actor ? "已核对盖章完成结果" : "已由其他经办人确认盖章，请核对当前合同";
    input.refresh({ actor: intent.actor, versionId: intent.versionId, kind: value.sealOutcome.completedByUserId === intent.actor ? "seal" : "seal_by_other" }); return true;
  }`,
  confirmSeal: `async function confirmSeal() {
    if (!canSeal.value || !context.value) return;
    const started = captureScope();
    const intent: SealIntent = { schemaVersion: 1, actor: input.actor.value!, versionId: context.value.contractVersionId, body: coordinates(context.value) };
    busy.value = true;
    try {
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!sameCoordinates(value, intent.body) || !sealEligible(value)) { message.value = "当前合同办理资料或权限已变化，请刷新后核对"; return; }
      persist("seal", intent); sealIntent.value = intent;
      try { await confirmContractSealV2(intent.versionId, intent.body, () => current(started)); } catch { /* Recovery only reads the original task. */ }
      if (current(started)) await readSeal(intent, started);
    } catch { if (current(started)) message.value = sealIntent.value ? "盖章结果待核对，请保留本次办理记录后再次查询" : "未能核对当前办理资料，本次未发起新操作"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  querySeal: `async function querySeal() {
    if (busy.value || !sealIntent.value) return;
    const started = captureScope(); busy.value = true;
    try { await readSeal(sealIntent.value, started); }
    catch { if (current(started)) message.value = "暂时无法读取盖章结果，请保留本次办理记录后重试查询"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  continueSeal: `async function continueSeal() {
    if (!canContinueSeal.value || !sealIntent.value) return;
    const started = captureScope(), intent = JSON.parse(JSON.stringify(sealIntent.value)) as SealIntent;
    busy.value = true;
    try {
      if (await readSeal(intent, started) || !current(started)) return;
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!sameCoordinates(value, intent.body) || !sealEligible(value)) { message.value = "当前盖章资料或权限已变化，请继续查询原办理结果"; return; }
      try { await confirmContractSealV2(intent.versionId, intent.body, () => current(started)); } catch { /* An explicit same-tuple continuation still recovers by reading. */ }
      if (current(started)) await readSeal(intent, started);
    } catch { if (current(started)) message.value = "暂时无法继续核对盖章结果，请保留本次办理记录"; }
    finally { if (current(started)) busy.value = false; }
  }`,
  confirmContractSealV2: `function confirmContractSealV2(versionId: string, body: ContractSealConfirmationV2Payload, responseIsCurrent: () => boolean) {
  return postJson<{ contractVersionId: string; approvalInstanceId: string; sealTaskId: string; status: "seal_approved_pending_archive" }>(
    \`/contracts/\${encodeURIComponent(versionId)}/seal-confirmation\`, body, { retryUnauthorized: false, responseIsCurrent }
  );
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
  ensureOk: `async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = \`\${fallback}：\${response.status}\`;
  let code: string | null = null;
  try {
    const data = (await response.clone().json()) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof data.code === "string") {
      code = data.code;
    }
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
    message = formatApiErrorMessage(message, response.status, fallback);
  }

  throw new CoreFlowApiError(
    message,
    response.status,
    code
  );
}`,
  readJson: `async function readJson<T>(path: string, headers?: Record<string, string>, options?: Pick<ApiFetchInit, "retryUnauthorized" | "responseIsCurrent">): Promise<T> {
  const response = await apiFetch(path, headers || options ? { headers, ...options } : undefined);
  await ensureOk(response, "读取失败");
  return response.json() as Promise<T>;
}`,
  onV2SigningCompleted: `function onV2SigningCompleted(completion: ContractSigningCompletion) {
  if (completion.actor !== auth.user?.id || completion.versionId !== contractDetail.value?.contractVersionId) return;
  v2ConfirmedReceipt.value = { ...completion, routeContractId: routeContractId() };
  void reloadContractDetail();
}`,
  routeContractId: `function routeContractId() {
  const value = route.params.contractId;
  return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
}`,
  routeVersionId: `function routeVersionId() {
  const value = route.query?.versionId;
  return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
}`,
  reloadContractDetail: `async function reloadContractDetail() {
  const requestId = ++detailRequestId;
  contractArchiveForm.ownerContractRiskConfirmed = false;
  const contractId = routeContractId();
  if (!contractId) {
    contractDetail.value = null;
    contractDetailError.value = "缺少合同编号，无法定位单据。请返回合同台账重新进入。";
    return false;
  }

  contractDetailError.value = "";
  contractReviewCapability.value = null;
  contractLifecycleAvailableActions.value = null;
  contractLifecycleAvailableActionKeys.value = null;
  contractChangeAvailableActions.value = null;
  contractReviewResultUnknown = false;
  contractWithdrawalResultUnknown = false;
  detailLoading.value = true;
  try {
    const serverDetail = await fetchContractDetail(contractId, {
      versionId: routeVersionId() || undefined
    });
    if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
    const detail = structuredClone(serverDetail);
    const versions = normalizeContractChangeVersions(
      (detail as unknown as { changeVersions?: unknown }).changeVersions
    );
    if (!versions) throw new Error("合同版本历史数据异常，已停止展示");
    contractLifecycleAvailableActions.value = serverDetail.availableActions;
    contractLifecycleAvailableActionKeys.value = serverDetail.availableActionKeys;
    contractReviewCapability.value = structuredClone(serverDetail);
    contractDetail.value = detail;
    normalizedChangeVersions.value = versions;
    changeEligibility.value = null;
    if (
      !serverDetail.historyReadOnly &&
      canRequestContractChangeEligibility(auth.user?.roleKeys ?? [])
    ) {
      changeEligibilityLoading.value = true;
      const eligibilityPayload = await fetchContractChangeEligibility(detail.contractVersionId).catch(() => null);
      if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
      contractChangeAvailableActions.value = eligibilityPayload?.availableActions ?? null;
      changeEligibility.value = eligibilityPayload === null
        ? null
        : normalizeChangeEligibility(structuredClone(eligibilityPayload), detail.contractVersionId);
      changeEligibilityLoading.value = false;
    } else {
      changeEligibilityLoading.value = false;
    }
    const archiveFileIds = detail.archiveFiles
      .filter((file) => file.canDownload)
      .map((file) => file.fileId);
    const archiveRecordIds = detail.archiveFiles.map((file) => file.archiveRecordId);
    if (!archiveRecordIds.includes(contractArchiveForm.archiveFileId)) {
      contractArchiveForm.archiveFileId = archiveRecordIds[0] ?? "";
    }
    if (!archiveFileIds.includes(contractArchiveForm.downloadFileId)) {
      contractArchiveForm.downloadFileId = archiveFileIds[0] ?? "";
    }
    return true;
  } catch (error) {
    if (requestId !== detailRequestId) return false;
    contractReviewCapability.value = null;
    contractLifecycleAvailableActions.value = null;
    contractLifecycleAvailableActionKeys.value = null;
    contractChangeAvailableActions.value = null;
    contractDetail.value = null;
    normalizedChangeVersions.value = [];
    changeEligibility.value = null;
    changeEligibilityLoading.value = false;
    const reason = formatUnknownApiError(error, "未知错误");
    contractDetailError.value = \`未能读取合同详情：\${reason}。当前页面数据不能用于审批、归档、结算或付款判断，请确认账号权限和网络状态后重试。\`;
    return false;
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}`,
};

const web = "apps/web-admin/src";
export const SEAL_PAGE = `${web}/pages/contracts/ContractSignedArchiveSection.vue`;
export const SEAL_COMPOSABLE = `${web}/pages/contracts/use-contract-signed-archive.ts`;
export const SEAL_API = `${web}/api/core-flow-read.api.ts`;
export const SEAL_WRITE = "confirmContractSealV2";
const detailPage = `${web}/pages/contracts/ContractDetailPage.vue`;
const capabilityRead = "fetchContractDetail";
const sealActions = {
  "contract-seal-v2.confirm": ["t-dialog", "confirm", "submitSeal", "confirmSeal"],
  "contract-seal-v2.resume-original": ["t-dialog", "confirm", "submitSealContinue", "continueSeal"],
  "contract-seal-v2.lookup-original": ["t-button", "click", "querySeal", "querySeal"]
};
export const SEAL_ACTION_IDS = new Set(Object.keys(sealActions));
export const SEAL_WRITE_ACTION_IDS = new Set([
  "contract-seal-v2.confirm", "contract-seal-v2.resume-original"
]);

const trustedDetailImports = {
  fetchContractDetail: SEAL_API,
  fetchContractChangeEligibility: SEAL_API,
  canRequestContractChangeEligibility: `${web}/pages/contracts/contract-detail.config.ts`,
  normalizeContractChangeVersions: `${web}/pages/contracts/contract-change.state.ts`,
  normalizeChangeEligibility: `${web}/pages/contracts/contract-change.state.ts`,
  formatUnknownApiError: `${web}/api/error-message.ts`
};

function namedBinding(symbols, name, syntax) {
  const bindings = syntax.topLevelScopeVariables(symbols.scopeManager, name);
  return bindings.length === 1 && !bindings[0].references.some(ref => ref.isWrite() && !ref.init)
    ? bindings[0] : null;
}

function namedDefinition(symbols, name, syntax) {
  const binding = namedBinding(symbols, name, syntax);
  const definition = binding && syntax.uniqueIndexedNode(symbols.definitionsByBinding, binding);
  return definition ? { definition, binding } : null;
}

function importedBinding(symbols, name, path, syntax) {
  const binding = namedBinding(symbols, name, syntax);
  const imported = symbols.importsByBinding.get(binding);
  return imported?.sourceFile === path && imported.importedName === name ? binding : null;
}

function externalBinding(symbols, name, source, syntax) {
  const binding = namedBinding(symbols, name, syntax);
  const [definition] = binding?.defs ?? [];
  return definition?.type === "ImportBinding" && definition.parent?.source?.value === source &&
    definition.node?.imported?.name === name ? binding : null;
}

function vueBinding(symbols, name, syntax) {
  return externalBinding(symbols, name, "vue", syntax);
}

function proveReferences(nodes, symbols, bound, globals, syntax) {
  let valid = true;
  for (const node of nodes) {
    syntax.walkEstree(node, candidate => {
      if (candidate.type !== "Identifier" || !symbols.scopeReferenceIdentifiers.has(candidate)) return;
      if (bound.has(candidate.name)) {
        const expected = bound.get(candidate.name);
        if (!expected || symbols.scopeBindings.get(candidate) !== expected) valid = false;
      } else if (globals.has(candidate.name) &&
          !syntax.unshadowedRuntimeGlobal(candidate, globals, symbols.scopeBindings)) {
        valid = false;
      }
    });
  }
  return valid;
}

function exactDefinitions(symbols, names, syntax) {
  const found = new Map();
  for (const name of names) {
    const value = namedDefinition(symbols, name, syntax);
    if (!value || !syntax.matches(value.definition, statements[name])) return null;
    found.set(name, value);
  }
  return found;
}

function localDeclarator(factory, name, symbols) {
  const matches = factory.body.body
    .filter(node => node.type === "VariableDeclaration")
    .flatMap(node => node.declarations)
    .filter(node => node.id.type === "Identifier" && node.id.name === name);
  const binding = matches.length === 1 && symbols.scopeBindings.get(matches[0].id);
  return binding ? { declaration: matches[0], binding } : null;
}

const stateInitializers = {
  busy: "ref(false)",
  hydrating: "ref(false)",
  storageBlocked: "ref(false)",
  sealIntent: "ref<SealIntent | null>(null)",
  scope: 'computed(() => `${input.actor.value ?? ""}:${input.detail.value?.contractVersionId ?? ""}`)',
  context: "computed(() => readyContext(input.detail.value, input.actor.value))",
  disposed: "false",
  scopeEpoch: "0",
  captureScope: "(): OperationScope => ({ key: scope.value, epoch: scopeEpoch })",
  current: "(started: OperationScope) => !disposed && scope.value === started.key && scopeEpoch === started.epoch",
  storageKey: '(kind: "seal" | "archive") => `jg:contract-${kind}-intent:v1:${encodeURIComponent(input.actor.value ?? "")}:${encodeURIComponent(input.detail.value?.contractVersionId ?? "")}`',
  locked: "computed(() => busy.value || hydrating.value || storageBlocked.value || !!sealIntent.value || !!archiveIntent.value)",
  canSeal: "computed(() => sealEligible(context.value) && !locked.value && !input.externalBusy.value)",
  canContinueSeal: "computed(() => !!sealIntent.value && !archiveIntent.value && !busy.value && !hydrating.value && !storageBlocked.value && !input.externalBusy.value && sealEligible(context.value))"
};

function sealFactoryState(factory, symbols, syntax) {
  const state = new Map();
  for (const [name, expression] of Object.entries(stateInitializers)) {
    const value = localDeclarator(factory, name, symbols);
    if (!value || !syntax.sameExpression(value.declaration.init, expression)) return null;
    state.set(name, value);
  }
  const body = factory.body.body;
  const unmount = body.filter(node => node.type === "ExpressionStatement" && node.expression.callee?.name === "onBeforeUnmount");
  const watches = body.filter(node => node.type === "ExpressionStatement" && node.expression.callee?.name === "watch");
  if (unmount.length !== 1 || watches.length !== 1 || !syntax.matches(unmount[0],
    "onBeforeUnmount(() => { disposed = true; hydrateSequence++; scopeEpoch++; });")) return null;

  const watch = watches[0].expression;
  const callback = watch.arguments?.[1];
  const watched = callback?.body?.body ?? [];
  const [epoch, sequence, resetBusy, resetSeal] = watched;
  const attempt = watched.at(-1);
  const [requireCurrent, stored, hydrate] = attempt?.block?.body ?? [];
  if (
    watch.arguments?.length !== 3 ||
    !syntax.sameExpression(watch.arguments[0], "scope") ||
    callback?.type !== "ArrowFunctionExpression" || !callback.async || callback.params.length !== 0 ||
    !syntax.sameExpression(watch.arguments[2], '{ immediate: true, flush: "sync" }') ||
    watched.length !== 10 ||
    !syntax.matches(epoch, "scopeEpoch++;") ||
    !syntax.matches(sequence, "const sequence = ++hydrateSequence, started = captureScope();") ||
    !syntax.matches(resetBusy, "busy.value = false;") ||
    !syntax.matches(resetSeal, "sealIntent.value = null;") ||
    !syntax.matches(requireCurrent, "if (!input.actor.value || !input.detail.value) return;") ||
    !syntax.matches(stored, 'const sealRaw = localStorage.getItem(storageKey("seal")), archiveRaw = localStorage.getItem(storageKey("archive"));') ||
    !syntax.matches(hydrate, `if (sealRaw) {
      const saved = JSON.parse(sealRaw) as SealIntent;
      if (saved.schemaVersion !== 1 || saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId ||
        !validCoordinates(saved.body) || Object.keys(saved.body).length !== 5 || saved.body.confirmed !== true) throw new Error();
      sealIntent.value = saved; message.value = "盖章结果待核对，请查询本次办理结果";
    }`)
  ) return null;

  const mutableNames = new Set(["scopeEpoch", "disposed"]);
  const permittedUpdates = new Set([
    epoch.expression.argument,
    ...unmount[0].expression.arguments[0].body.body.map(node => node.expression.argument ?? node.expression.left)
  ]);
  for (const [name, { binding }] of state) {
    if (binding.references.some(ref => ref.isWrite() && !ref.init &&
      (!mutableNames.has(name) || !permittedUpdates.has(ref.identifier)))) return null;
  }
  return { state, factory, witnesses: [...state.values()].map(value => value.declaration.init).concat(
    unmount, [watch.callee, watch.arguments[0], epoch, sequence, resetBusy, resetSeal, requireCurrent, stored, hydrate]
  ), resetSeal, hydrate };
}

function proveSection(sectionSymbols, expected, candidate, syntax) {
  const [element, event, handler, method] = expected;
  if (candidate?.kind !== "event" || candidate.element !== element || candidate.event !== event ||
      candidate.handler !== handler || candidate.expression?.type !== "Identifier" ||
      candidate.expression.name !== handler ||
      syntax.astAncestorChain(sectionSymbols.ast.templateBody, candidate.elementNode)?.some(node => node.variables?.length)) return false;
  const declarations = sectionSymbols.ast.body
    .filter(node => node.type === "VariableDeclaration" && node.kind === "const")
    .flatMap(node => node.declarations)
    .filter(node => node.id.type === "ObjectPattern" &&
      syntax.callExpressionMatchesWrapper(node.init, { apiFile: SEAL_COMPOSABLE, name: "useContractSignedArchive" }, sectionSymbols));
  const [declaration] = declarations;
  if (declarations.length !== 1 || declaration.init.arguments.length !== 1 ||
      declaration.id.properties.some(property => property.type !== "Property" || property.computed) ||
      !syntax.sameExpression(declaration.init.arguments[0], `{
        detail: computed(() => props.detail), actor: computed(() => props.actorUserId), routeContractId: computed(() => props.routeContractId),
        externalBusy: computed(() => props.externalBusy), refresh: completion => emit("completed", completion)
      }`)) return false;
  const methodBinding = namedBinding(sectionSymbols, method, syntax);
  const destructured = declaration.id.properties.filter(property => property.key.name === method);
  if (destructured.length !== 1 || !methodBinding ||
      sectionSymbols.scopeBindings.get(destructured[0].value) !== methodBinding) return false;
  const computed = vueBinding(sectionSymbols, "computed", syntax);
  const props = namedBinding(sectionSymbols, "props", syntax);
  const emit = namedBinding(sectionSymbols, "emit", syntax);
  for (const [binding, macro] of [[props, "defineProps"], [emit, "defineEmits"]]) {
    const initializer = binding && syntax.uniqueIndexedNode(sectionSymbols.declarationsByBinding, binding);
    if (initializer?.type !== "CallExpression" || initializer.arguments.length !== 0 ||
        !syntax.unshadowedRuntimeGlobal(initializer.callee, new Set([macro]), sectionSymbols.scopeBindings)) return false;
  }
  if (!computed || !proveReferences([declaration.init.arguments[0]], sectionSymbols,
    new Map([["computed", computed], ["props", props], ["emit", emit]]), new Set(), syntax)) return false;

  if (method === handler) {
    return syntax.sameExpression(syntax.elementDirective(candidate.elementNode, "if")?.value?.expression, "sealIntent");
  }
  const implementation = namedDefinition(sectionSymbols, handler, syntax);
  const dialog = handler === "submitSeal" ? "sealDialog" : "sealContinueDialog";
  const model = syntax.elementDirective(candidate.elementNode, "model", "visible")?.value?.expression;
  return model?.type === "Identifier" && model.name === dialog &&
    implementation && syntax.matches(implementation.definition,
      `async function ${handler}() { ${dialog}.value = false; await ${method}(); }`) &&
    proveReferences([implementation.definition], sectionSymbols,
      new Map([[method, methodBinding], [dialog, namedBinding(sectionSymbols, dialog, syntax)]]), new Set(), syntax);
}

export function proveContractSigningParent(context, syntax) {
  const ast = context.asts.get(detailPage);
  if (!ast) return false;
  const symbols = syntax.buildSymbolContext(ast, detailPage, context.sourceFileSet);
  const section = namedBinding(symbols, "ContractSignedArchiveSection", syntax);
  if (symbols.importsByBinding.get(section)?.sourceFile !== SEAL_PAGE) return false;

  const sections = [];
  syntax.walkEstree(ast.templateBody, node => {
    if (node.type === "VElement" && node.rawName === "ContractSignedArchiveSection") sections.push(node);
  });
  if (sections.length !== 1) return false;
  const parent = sections[0];
  if (syntax.astAncestorChain(ast.templateBody, parent)?.some(node => node.variables?.length)) return false;
  for (const [directive, argument, expected] of [
    ["bind", "detail", "contractDetail"],
    ["bind", "actor-user-id", "auth.user?.id"],
    ["bind", "route-contract-id", "routeContractId()"],
    ["on", "completed", "onV2SigningCompleted"]
  ]) {
    const attribute = syntax.elementDirective(parent, directive, argument);
    if (!syntax.sameExpression(attribute?.value?.expression, expected)) return false;
  }

  const definitions = exactDefinitions(symbols,
    ["onV2SigningCompleted", "reloadContractDetail", "routeContractId", "routeVersionId"], syntax);
  if (!definitions) return false;
  const bound = new Map([...definitions].map(([name, value]) => [name, value.binding]));
  for (const [name, path] of Object.entries(trustedDetailImports)) {
    const imported = importedBinding(symbols, name, path, syntax);
    if (!imported) return false;
    bound.set(name, imported);
  }
  const auth = namedBinding(symbols, "auth", syntax);
  const route = namedBinding(symbols, "route", syntax);
  const authStore = importedBinding(symbols, "useAuthStore", `${web}/auth/auth.store.ts`, syntax);
  const useRoute = externalBinding(symbols, "useRoute", "vue-router", syntax);
  for (const [binding, factory] of [[auth, authStore], [route, useRoute]]) {
    const initializer = binding && syntax.uniqueIndexedNode(symbols.declarationsByBinding, binding);
    if (!factory || initializer?.type !== "CallExpression" || initializer.optional ||
        initializer.arguments.length !== 0 || symbols.scopeBindings.get(initializer.callee) !== factory) return false;
  }
  const detail = namedBinding(symbols, "contractDetail", syntax);
  if (!detail) return false;
  bound.set("auth", auth);
  bound.set("route", route);
  bound.set("contractDetail", detail);
  const reads = [
    [capabilityRead, "GET /contracts/:param"],
    ["fetchContractChangeEligibility", "GET /contracts/:param/change-eligibility"]
  ];
  if (reads.some(([name, key]) => !wrapperHasOneRequest(
    context.wrapperIndex.get(syntax.wrapperIdentity(SEAL_API, name)), key, syntax
  ))) return false;
  return proveReferences([...definitions.values()].map(value => value.definition), symbols,
    bound, new Set(["Error", "String", "Array", "structuredClone", "undefined"]), syntax);
}

function wrapperHasOneRequest(wrapper, key, syntax) {
  if (wrapper?.kind !== "transport") return false;
  const requests = syntax.normalizedMainRequests(wrapper);
  return requests.length === 1 && requests[0].normalizedKey === key;
}

function proveApi(context, syntax, readOnly) {
  const ast = context.asts.get(SEAL_API);
  if (!ast) return false;
  const symbols = syntax.buildSymbolContext(ast, SEAL_API, context.sourceFileSet);
  const names = [capabilityRead, "readJson", "ensureOk"];
  if (!readOnly) names.push(SEAL_WRITE, "postJson");
  const definitions = exactDefinitions(symbols, names, syntax);
  const transport = importedBinding(symbols, "apiFetch", `${web}/api/api-fetch.ts`, syntax);
  const formatError = importedBinding(symbols, "formatApiErrorMessage", `${web}/api/error-message.ts`, syntax);
  const error = namedBinding(symbols, "CoreFlowApiError", syntax);
  if (!definitions || !transport || !formatError || !error) return false;
  const bound = new Map([...definitions].map(([name, value]) => [name, value.binding]));
  bound.set("apiFetch", transport);
  bound.set("formatApiErrorMessage", formatError);
  bound.set("CoreFlowApiError", error);
  return proveReferences([...definitions.values()].map(value => value.definition), symbols, bound,
    new Set(["Array", "encodeURIComponent", "JSON", "undefined"]), syntax);
}

function encloses(root, node) {
  return root?.range && node?.range && root.range[0] <= node.range[0] && root.range[1] >= node.range[1];
}

function proveIntentIntegrity(symbols, state, methods, syntax) {
  const seal = state.state.get("sealIntent").binding;
  const first = methods.get("confirmSeal").definition;
  if (!syntax.matches(first.body.body[2],
    "const intent: SealIntent = { schemaVersion: 1, actor: input.actor.value!, versionId: context.value.contractVersionId, body: coordinates(context.value) };"
  )) return false;
  const writers = [state.resetSeal, state.hydrate, methods.get("readSeal").definition, first];
  const factory = state.factory;
  const archiveGate = localDeclarator(factory, "canContinueArchive", symbols)?.declaration.init;
  const archiveReads = [];
  syntax.walkEstree(archiveGate, node => {
    if (node.type === "UnaryExpression" && node.operator === "!" &&
        syntax.sameExpression(node.argument, "sealIntent.value")) archiveReads.push(node.argument);
  });
  const returned = factory.body.body.at(-1)?.argument?.properties?.filter(property =>
    property.type === "Property" && !property.computed && property.shorthand && property.key?.name === "sealIntent"
  ) ?? [];
  if (archiveReads.length !== 1 || returned.length !== 1) return false;
  const allowedReferences = [
    ...writers,
    methods.get("querySeal").definition,
    methods.get("continueSeal").definition,
    state.state.get("locked").declaration.init,
    state.state.get("canContinueSeal").declaration.init,
    archiveReads[0],
    returned[0]
  ];
  if (seal.references.some(ref => !ref.init &&
      !allowedReferences.some(location => encloses(location, ref.identifier)))) return false;

  const valid = ["sealIntent.value = null", "sealIntent.value = saved", "sealIntent.value = intent"];
  let intact = true;
  syntax.walkEstree(symbols.ast, node => {
    if (!["AssignmentExpression", "UpdateExpression", "UnaryExpression"].includes(node.type)) return;
    const target = node.left ?? node.argument;
    if (node.type === "UnaryExpression" && node.operator !== "delete") return;
    const root = syntax.referenceRootIdentifier(target);
    if (symbols.scopeBindings.get(root) !== seal) return;
    if (node.type !== "AssignmentExpression" || !writers.some(writer => encloses(writer, node)) ||
        !valid.some(expected => syntax.sameExpression(node, expected))) intact = false;
  });
  return intact;
}

function proveComposable(context, selected, syntax) {
  const ast = context.asts.get(SEAL_COMPOSABLE);
  if (!ast) return false;
  const symbols = syntax.buildSymbolContext(ast, SEAL_COMPOSABLE, context.sourceFileSet);
  const factory = namedDefinition(symbols, "useContractSignedArchive", syntax)?.definition;
  if (factory?.type !== "FunctionDeclaration" || factory.params.length !== 1 ||
      factory.params[0]?.type !== "Identifier" || factory.params[0].name !== "input" ||
      !ast.body.some(node => node.type === "ExportNamedDeclaration" && node.declaration === factory)) return false;
  const all = ["confirmSeal", "continueSeal", "querySeal", "readSeal", "persist", "removeSaved"];
  const methods = new Map();
  for (const name of all) {
    const value = syntax.localCallable(factory, name, symbols, ["confirmSeal", "continueSeal", "querySeal"].includes(name));
    if (!value) return false;
    methods.set(name, value);
  }
  const checked = [selected, "readSeal", "removeSaved", ...(selected === "confirmSeal" ? ["persist"] : [])];
  if (checked.some(name => !syntax.matches(methods.get(name).definition, statements[name]))) return false;
  const helpers = exactDefinitions(symbols, ["readyContext", "sameCoordinates", "sealEligible", "coordinates",
    "object", "validCoordinates"], syntax);
  const state = sealFactoryState(factory, symbols, syntax);
  if (!helpers || !state || !proveIntentIntegrity(symbols, state, methods, syntax)) return false;

  const bound = new Map([...methods, ...helpers, ...state.state].map(([name, value]) => [name, value.binding]));
  for (const name of ["ref", "computed", "watch", "onBeforeUnmount"]) {
    const binding = vueBinding(symbols, name, syntax);
    if (!binding) return false;
    bound.set(name, binding);
  }
  const input = symbols.scopeBindings.get(factory.params[0]);
  if (!input || input.references.some(ref => ref.isWrite() && !ref.init)) return false;
  bound.set("input", input);
  for (const name of ["archiveIntent", "hydrateSequence", "message"]) {
    bound.set(name, localDeclarator(factory, name, symbols)?.binding);
  }
  for (const [name, expression] of [
    ["uuid", "/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu"],
    ["fingerprint", "/^[0-9a-f]{64}$/u"]
  ]) {
    const binding = namedBinding(symbols, name, syntax);
    const initializer = binding && syntax.uniqueIndexedNode(symbols.declarationsByBinding, binding);
    if (!syntax.sameExpression(initializer, expression)) return false;
    bound.set(name, binding);
  }
  const read = importedBinding(symbols, capabilityRead, SEAL_API, syntax);
  const write = importedBinding(symbols, SEAL_WRITE, SEAL_API, syntax);
  if (!read || !write || write.references.some(ref => !encloses(methods.get("confirmSeal").definition, ref.identifier) &&
      !encloses(methods.get("continueSeal").definition, ref.identifier))) return false;
  bound.set(capabilityRead, read);
  bound.set(SEAL_WRITE, write);
  const witnessNodes = [
    ...state.witnesses,
    ...checked.map(name => methods.get(name).definition),
    ...[...helpers.values()].map(value => value.definition)
  ];
  return proveReferences(witnessNodes, symbols, bound,
    new Set(["JSON", "Object", "Number", "Array", "Error", "localStorage", "encodeURIComponent"]), syntax);
}

export function proveContractSealPageAction({ action, wrapper, context, syntax }) {
  const expected = sealActions[action.id];
  const readOnly = !SEAL_WRITE_ACTION_IDS.has(action.id);
  const wrapperName = readOnly ? capabilityRead : SEAL_WRITE;
  const expectedKey = readOnly ? "GET /contracts/:param" : "POST /contracts/:param/seal-confirmation";
  const route = context.nestRouteIndex.get(expectedKey);
  if (route?.authentication !== "authenticated" || route.isPublic ||
      (!readOnly && (route.guardAuthorization !== "project_action" || route.requiredProjectAction !== "contract.seal"))) return null;
  if (!expected || action.sourceFile !== SEAL_PAGE ||
      action.semantic !== (readOnly ? "read_only" : "business_write") ||
      action.capability.kind !== (readOnly ? "none" : "server_boolean") ||
      action.capability.source !== (readOnly ? "localStorage.sealIntent" : "v2Lifecycle.sealAction.eligible") ||
      action.wrappers.length !== 1 || wrapper.name !== wrapperName || wrapper.apiFile !== SEAL_API ||
      !wrapperHasOneRequest(wrapper, expectedKey, syntax) ||
      !proveSection(context.symbols, expected, context.candidate, syntax) ||
      !proveComposable(context, expected[3], syntax) ||
      !proveApi(context, syntax, readOnly) || !proveContractSigningParent(context, syntax)) return null;

  return readOnly ? {
    kind: "seal_task_lookup", verified: true, readOnlyWitness: true
  } : {
    kind: "seal_task_write", verified: true, capabilityWitness: true,
    capabilitySources: new Set([syntax.wrapperIdentity(SEAL_API, capabilityRead)]),
    capabilitySourceFile: SEAL_COMPOSABLE
  };
}

// Shared by the neighboring generated archive proof.
export { namedBinding, namedDefinition, importedBinding, vueBinding, proveReferences, localDeclarator, wrapperHasOneRequest };

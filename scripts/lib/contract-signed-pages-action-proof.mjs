// Explicit AST witnesses for the five pages added by #395/#396/#415.
//
// Each witness pins, for one registered page action:
//   1. the exact trigger element/event/handler and the server capability gate
//      on the trigger (own or ancestor `v-if`) or on the handler's own guard;
//   2. the exact local write call that carries the wrapper (including the
//      shared `run()` callback, which is itself pinned);
//   3. the exact read that assigns the capability and the single GET wrapper
//      whose `transparent_main_response` payload carries it.
// Nothing here accepts an action unless every pin matches, the wrapper is
// imported from the expected API module and is called exactly once, and the
// capability read is a trusted single-GET route.

const WEB = "apps/web-admin/src";
const CORE = `${WEB}/api/core-flow-read.api.ts`;
const SETTLEMENT = `${WEB}/api/signed-contract-settlement.api.ts`;
const WORK_COMPLETION_PAGE = `${WEB}/pages/contracts/ContractWorkCompletionSection.vue`;
const TAX_FACTS_PAGE = `${WEB}/pages/contracts/EffectiveContractTaxFacts.vue`;
const SIGNED_CHANGES_PAGE = `${WEB}/pages/contracts/SignedContractChanges.vue`;
const SIGNED_SETTLEMENT_PAGE = `${WEB}/pages/settlements/SignedContractSettlementPage.vue`;
const PAYMENT_BASIS_PAGE = `${WEB}/pages/payments/SignedSettlementPaymentBasisPanel.vue`;

const CONTRACT_ROUTE = "/合同管理/:contractId";
const SETTLEMENT_ROUTE = "/结算工作台/已签登记";
const PAYMENT_BASIS_ROUTE = "/付款工作台";

const READS = {
  workCompletions: { apiFile: CORE, name: "fetchWorkCompletions" },
  taxRevisions: { apiFile: CORE, name: "fetchContractTaxRevisions" },
  signedChanges: { apiFile: CORE, name: "fetchSignedContractChanges" },
  signedSettlements: { apiFile: SETTLEMENT, name: "fetchSignedSettlements" },
  settlementOverview: { apiFile: SETTLEMENT, name: "fetchSignedSettlementOverview" },
  paymentBasis: { apiFile: SETTLEMENT, name: "fetchSignedSettlementPaymentBasis" }
};

const RUN_WORK_COMPLETION = `async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
    await reload().catch(() => { error.value = "履约操作已完成，记录刷新失败，请刷新合同详情"; });
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "履约操作未完成，请刷新后重试");
  } finally {
    busy.value = false;
  }
}`;

const RUN_TAX_FACTS = `async function run(action: () => Promise<void>, fallback: string) {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : fallback;
  } finally {
    busy.value = false;
  }
}`;

const RUN_SIGNED_SETTLEMENT = `async function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { await operation(); }
  catch (failure) { error.value = formatUnknownApiError(failure, "办理结算失败"); }
  finally { busy.value = false; }
}`;

const LOAD_WORK_COMPLETION = {
  name: "reload",
  pins: [
    "const result = await fetchWorkCompletions(versionId);",
    "if (versionId !== props.versionId) return;",
    "entries.value = result.entries;",
    "canRegister.value = result.canRegister;"
  ]
};

const LOAD_TAX_FACTS = {
  name: "open",
  pins: [
    "detail.value = undefined;",
    "visible.value = true;",
    "detail.value = await fetchContractTaxRevisions(props.versionId);"
  ]
};

const LOAD_SIGNED_CHANGES = {
  name: "reload",
  pins: [
    "const data = await fetchSignedContractChanges(versionId);",
    "if (generation === token) detail.value = data;"
  ]
};

const LOAD_SETTLEMENT_ROWS = {
  name: "readProject",
  pins: [
    "[contracts.value, rows.value] = await Promise.all([\n    fetchSignedSettlementContracts(projectId.value), fetchSignedSettlements(projectId.value)\n  ]);"
  ]
};

const LOAD_SETTLEMENT_OVERVIEW = {
  name: "readOverview",
  pins: [
    "const option = contracts.value.find(item => key(item) === contractKey.value);",
    "overview.value = option ? await fetchSignedSettlementOverview(projectId.value, option) : undefined;"
  ]
};

const LOAD_PAYMENT_BASIS = {
  name: "load",
  pins: [
    "const result = await fetchSignedSettlementPaymentBasis(props.projectId, props.contractId);",
    "if (request === generation) basis.value = result;"
  ]
};

const ACTIONS = {
  "contract-work-completion.save-draft": {
    page: WORK_COMPLETION_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "save",
    capability: "canRegister",
    read: READS.workCompletions,
    gate: "canRegister && showDraft",
    guard: "if (!canRegister.value) return;",
    call: `await run(async () => {
    const saved = await saveWorkCompletionDraft(props.versionId, body);
    notice.value = saved.exceedsContractAmount ? "草稿已保存。金额超过合同上限，请核对后再提交。" : "履约草稿已保存";
    work.value = "";
    amount.value = "";
    attempt = null;
    showDraft.value = false;
  });`,
    helper: { name: "run", source: RUN_WORK_COMPLETION },
    loader: LOAD_WORK_COMPLETION,
    wrappers: [{ apiFile: CORE, name: "saveWorkCompletionDraft" }]
  },
  "contract-work-completion.revise-draft": {
    page: WORK_COMPLETION_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "saveRevision",
    capability: "reviseTarget.canRevise",
    read: READS.workCompletions,
    gate: "reviseTarget && reviseTarget.canRevise",
    guard: "if (!target || !target.canRevise) return;",
    call: `await run(async () => {
    const saved = await reviseWorkCompletionDraft(props.versionId, target.id, { work: trimmedWork, amountYuan });
    reviseVisible.value = false;
    notice.value = saved.exceedsContractAmount ? "草稿已修订。金额超过合同上限，请核对后再提交。" : "履约草稿已修订";
  });`,
    helper: { name: "run", source: RUN_WORK_COMPLETION },
    loader: LOAD_WORK_COMPLETION,
    wrappers: [{ apiFile: CORE, name: "reviseWorkCompletionDraft" }]
  },
  "contract-work-completion.submit": {
    page: WORK_COMPLETION_PAGE,
    route: CONTRACT_ROUTE,
    element: "t-button",
    event: "click",
    handler: "submit",
    capability: "entry.canSubmit",
    read: READS.workCompletions,
    gate: "entry.canSubmit",
    guard: "if (!entries.value.find(entry => entry.id === id)?.canSubmit) return;",
    call: `await run(async () => {
    await submitWorkCompletion(props.versionId, id);
    notice.value = "已提交合同、项目和财务职责确认";
  });`,
    helper: { name: "run", source: RUN_WORK_COMPLETION },
    loader: LOAD_WORK_COMPLETION,
    wrappers: [{ apiFile: CORE, name: "submitWorkCompletion" }]
  },
  "contract-work-completion.review": {
    page: WORK_COMPLETION_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "review",
    capability: "reviewTarget.duty.canReview",
    read: READS.workCompletions,
    gate: "reviewTarget && reviewTarget.duty.canReview",
    guard: "if (!target?.duty.canReview || !target.entry.approvalInstanceId) return;",
    call: `await run(async () => {
    const result = await reviewWorkCompletion(props.versionId, target.entry.id, {
      approvalInstanceId, dutyIndex: target.duty.index, decision, comment: comment.value.trim() || undefined,
      ...(target.duty.selfReview ? { selfReviewReason: selfReviewReason.value, confirmationPassword: password.value } : {})
    });
    password.value = "";
    reviewVisible.value = false;
    notice.value = decision === "reject" ? "已驳回并退回原草稿" :
      result.status === "confirmed" ? "三个职责已全部确认" : "本职责已确认，等待其他职责";
  });`,
    helper: { name: "run", source: RUN_WORK_COMPLETION },
    loader: LOAD_WORK_COMPLETION,
    wrappers: [{ apiFile: CORE, name: "reviewWorkCompletion" }]
  },
  "contract-tax-facts.submit": {
    page: TAX_FACTS_PAGE,
    route: CONTRACT_ROUTE,
    element: "t-form",
    event: "submit",
    handler: "submit",
    capability: "detail.canSubmit",
    read: READS.taxRevisions,
    gate: "detail?.canSubmit && !pending",
    guard: "if (!versionId || !detail.value?.canSubmit) return;",
    call: `return run(async () => {
    await submitContractTaxRevision(versionId, {
      ...(invoiceType.value ? { invoiceType: invoiceType.value } : {}),
      ...(taxRate.value.trim() ? { taxRate: taxRate.value.trim() } : {}),
      explanation: explanation.value.trim()
    });
    invoiceType.value = "";
    taxRate.value = "";
    explanation.value = "";
    detail.value = await fetchContractTaxRevisions(props.versionId);
  }, "保存合同税务资料失败");`,
    helper: { name: "run", source: RUN_TAX_FACTS },
    loader: LOAD_TAX_FACTS,
    wrappers: [{ apiFile: CORE, name: "submitContractTaxRevision" }]
  },
  "contract-tax-facts.review": {
    page: TAX_FACTS_PAGE,
    route: CONTRACT_ROUTE,
    element: "t-button",
    event: "click",
    handler: "review",
    capability: "detail.canReview",
    read: READS.taxRevisions,
    gate: "pending && detail?.canReview",
    guard: "if (!revision || !versionId || !detail.value?.canReview) return;",
    call: `return run(async () => {
    await reviewContractTaxRevision(versionId, revision.id, {
      decision, reason: reason.value.trim() || undefined,
      selfReviewReason: selfReviewReason.value.trim() || undefined,
      confirmationPassword: confirmationPassword.value || undefined
    });
    reason.value = "";
    selfReviewReason.value = "";
    confirmationPassword.value = "";
    detail.value = await fetchContractTaxRevisions(props.versionId);
  }, "复核合同税务更正失败");`,
    helper: { name: "run", source: RUN_TAX_FACTS },
    loader: LOAD_TAX_FACTS,
    wrappers: [{ apiFile: CORE, name: "reviewContractTaxRevision" }]
  },
  "contract-signed-change.submit": {
    page: SIGNED_CHANGES_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "submit",
    capability: "detail.canSubmit",
    read: READS.signedChanges,
    gate: "detail.canSubmit && !detail.changes.some(row => row.status === 'pending_review')",
    guard: `if (!details?.canSubmit || !source || !changeSummary) {
    error.value = "请上传双方已签补充协议并填写变更说明";
    return;
  }`,
    call: `const id = uploadedFile.value?.source === source
      ? uploadedFile.value.id
      : (await uploadPrivateFile(source, source.name)).id;`,
    secondCall: `await submitSignedContractChange(details.baseVersionId, {
      fileId: id,
      summary: changeSummary,
      amountDeltaYuan,
      ...(paymentAgreementText ? { paymentAgreementText } : {})
    });`,
    loader: LOAD_SIGNED_CHANGES,
    wrappers: [{ apiFile: CORE, name: "uploadPrivateFile" }, { apiFile: CORE, name: "submitSignedContractChange" }]
  },
  "contract-signed-change.review": {
    page: SIGNED_CHANGES_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "review",
    capability: "detail.canReview",
    read: READS.signedChanges,
    gate: "reviewTarget && detail.canReview",
    guard: "if (busy.value || !row || !detail.value?.canReview) return;",
    call: `await reviewSignedContractChange(row.baseVersionId, row.id, {
      decision: decision.value,
      ...(decision.value === "reject" ? { reason: reviewReason.value } : {}),
      ...(row.requiresSelfReview ? { selfReviewReason: reviewReasonSelf.value, confirmationPassword: password.value } : {})
    });`,
    loader: LOAD_SIGNED_CHANGES,
    wrappers: [{ apiFile: CORE, name: "reviewSignedContractChange" }]
  },
  "contract-signed-change.download-original": {
    page: SIGNED_CHANGES_PAGE,
    route: CONTRACT_ROUTE,
    element: "form",
    event: "submit",
    handler: "download",
    capability: "detail.canDownloadOriginals",
    read: READS.signedChanges,
    gate: "downloadTarget && detail.canDownloadOriginals",
    guard: "if (busy.value || !row || !detail.value?.canDownloadOriginals) return;",
    call: `await downloadPrivateFileByTicket(row.appendixFileId, {
      downloadReason: downloadReason.value,
      confirmationPassword: password.value
    });`,
    loader: LOAD_SIGNED_CHANGES,
    wrappers: [{ apiFile: CORE, name: "downloadPrivateFileByTicket" }]
  },
  "signed-settlement.save": {
    page: SIGNED_SETTLEMENT_PAGE,
    route: SETTLEMENT_ROUTE,
    element: "t-button",
    event: "click",
    handler: "save",
    capability: "overview.canRegister",
    read: READS.settlementOverview,
    gate: "overview?.canRegister",
    guard: "if (!overview.value?.canRegister) return;",
    call: `const saved = await saveSignedSettlement(projectId.value, {
      contractKind: option.kind, contractId: option.id,
      number: number.value, amountYuan: amount.value, fileIds: attachments.value.map(file => file.fileId)
    }, selected.value);`,
    secondCall: "if (submit) selected.value = await submitSignedSettlement(projectId.value, saved);",
    helper: { name: "run", source: RUN_SIGNED_SETTLEMENT },
    loader: LOAD_SETTLEMENT_OVERVIEW,
    wrappers: [{ apiFile: SETTLEMENT, name: "saveSignedSettlement" }, { apiFile: SETTLEMENT, name: "submitSignedSettlement" }]
  },
  "signed-settlement.review": {
    page: SIGNED_SETTLEMENT_PAGE,
    route: SETTLEMENT_ROUTE,
    element: "t-button",
    event: "click",
    handler: "review",
    capability: "selected.canReview",
    read: READS.signedSettlements,
    gate: "selected?.canReview",
    guard: "if (!selected.value?.canReview) return;",
    call: "selected.value = await reviewSignedSettlement(projectId.value, selected.value, decision, reason.value, password.value);",
    helper: { name: "run", source: RUN_SIGNED_SETTLEMENT },
    loader: LOAD_SETTLEMENT_ROWS,
    wrappers: [{ apiFile: SETTLEMENT, name: "reviewSignedSettlement" }]
  },
  "signed-settlement.upload-file": {
    page: SIGNED_SETTLEMENT_PAGE,
    route: SETTLEMENT_ROUTE,
    element: "input",
    event: "change",
    handler: "addFiles",
    capability: "overview.canRegister",
    read: READS.settlementOverview,
    gate: "overview?.canRegister",
    guard: "if (!overview.value?.canRegister) return;",
    call: "const uploaded = await uploadSignedSettlementFile(projectId.value, file);",
    helper: { name: "run", source: RUN_SIGNED_SETTLEMENT },
    loader: LOAD_SETTLEMENT_OVERVIEW,
    wrappers: [{ apiFile: SETTLEMENT, name: "uploadSignedSettlementFile" }]
  },
  "signed-settlement.attachment-access": {
    page: SIGNED_SETTLEMENT_PAGE,
    route: SETTLEMENT_ROUTE,
    element: "sensitive-action-dialog",
    event: "confirm",
    handler: "confirmAttachmentAccess",
    capability: "selected.canReadAttachments",
    read: READS.signedSettlements,
    guard: "if (!settlement || !settlement.canReadAttachments || !file || !isSavedAttachment(file.fileId)) return;",
    call: `const { blob, fileName, mimeType } = await readSignedSettlementAttachment(projectId.value, settlement.id, file.fileId, {
      confirmationPassword: values.password, downloadReason: values.reason, accessMode: fileAccessMode.value
    });`,
    helper: { name: "run", source: RUN_SIGNED_SETTLEMENT },
    loader: LOAD_SETTLEMENT_ROWS,
    wrappers: [{ apiFile: SETTLEMENT, name: "readSignedSettlementAttachment" }]
  },
  "payment-basis.download-signed-attachment": {
    page: PAYMENT_BASIS_PAGE,
    route: PAYMENT_BASIS_ROUTE,
    element: "sensitive-action-dialog",
    event: "confirm",
    handler: "download",
    capability: "basis.canReadSignedAttachments",
    read: READS.paymentBasis,
    guard: "if (busy.value || !target || !basis.value?.canReadSignedAttachments) return;",
    call: 'const { blob, fileName } = await readSignedSettlementAttachment(props.projectId, target.settlementId, target.fileId, { ...input, accessMode: "download" });',
    secondCall: "await downloadPrivateFileByTicket(target.fileId, input);",
    loader: LOAD_PAYMENT_BASIS,
    wrappers: [{ apiFile: SETTLEMENT, name: "readSignedSettlementAttachment" }, { apiFile: CORE, name: "downloadPrivateFileByTicket" }]
  }
};

export const SIGNED_PAGE_ACTION_IDS = new Set(Object.keys(ACTIONS));

function identity(syntax, wrapper) {
  return syntax.wrapperIdentity(wrapper.apiFile, wrapper.name);
}

function localDefinition(context, name, syntax) {
  const bindings = syntax.topLevelScopeVariables(context.symbols.scopeManager, name);
  if (bindings.length !== 1) return null;
  return syntax.uniqueIndexedNode(context.symbols.definitionsByBinding, bindings[0]) ?? null;
}

function containsPin(definition, source, syntax) {
  let found = false;
  syntax.walkEstree(definition, (node) => {
    if (found || !node) return;
    if (syntax.matches(node, source)) found = true;
  });
  return found;
}

function gateMatches(candidate, expected, syntax) {
  let current = candidate?.elementNode ?? null;
  while (current?.type === "VElement") {
    const own = syntax.elementDirective(current, "if") ?? syntax.elementDirective(current, "else-if");
    const expression = own?.value?.expression;
    if (expression && syntax.sameExpression(expression, expected)) return true;
    current = current.parent?.type === "VElement" ? current.parent : null;
  }
  return false;
}

function readIsTrusted(context, read, syntax) {
  const wrapper = context.wrapperIndex.get(identity(syntax, read));
  if (!wrapper || wrapper.returnProvenance !== "transparent_main_response") return null;
  const requests = syntax.normalizedMainRequests(wrapper);
  if (requests.length !== 1 || requests[0].method?.toUpperCase() !== "GET") return null;
  const route = context.nestRouteIndex.get(requests[0].normalizedKey);
  if (!route || route.authentication !== "authenticated" || route.isPublic !== false) return null;
  return wrapper;
}

function wrapperListMatches(action, expected, syntax) {
  if (!Array.isArray(action.wrappers) || action.wrappers.length !== expected.length) return false;
  const declared = new Set(action.wrappers.map(wrapper =>
    `${identity(syntax, wrapper)}\u0000${wrapper.variant ?? ""}`));
  return expected.every(wrapper =>
    declared.has(`${identity(syntax, wrapper)}\u0000`)) && action.wrappers.length === declared.size;
}

export function proveSignedPageAction({ action, wrapper, context, syntax }) {
  const spec = ACTIONS[action.id];
  if (!spec || !context?.candidate) return null;
  const { candidate, symbols } = context;
  if (action.sourceFile !== spec.page ||
      action.usage !== "page_action" ||
      action.semantic !== "business_write" ||
      action.routePaths.length !== 1 || action.routePaths[0] !== spec.route ||
      candidate.element !== spec.element || candidate.event !== spec.event ||
      candidate.handler !== spec.handler ||
      action.trigger.element !== spec.element || action.trigger.event !== spec.event ||
      action.trigger.handler !== spec.handler ||
      action.capability.kind !== "server_boolean" ||
      action.capability.source !== spec.capability ||
      !wrapperListMatches(action, spec.wrappers, syntax)) return null;
  if (!spec.wrappers.some(expected => identity(syntax, expected) === identity(syntax, wrapper))) return null;

  if (spec.gate && !gateMatches(candidate, spec.gate, syntax)) return null;
  if (!spec.gate && !spec.guard) return null;

  const handler = localDefinition(context, spec.handler, syntax);
  if (!handler || (handler.type !== "FunctionDeclaration" && handler.type !== "ArrowFunctionExpression")) return null;
  if (spec.guard && !containsPin(handler, spec.guard, syntax)) return null;
  if (!containsPin(handler, spec.call, syntax)) return null;
  if (spec.secondCall && !containsPin(handler, spec.secondCall, syntax)) return null;
  if (syntax.importedWrapperCalls([handler], wrapper, context).length !== 1) return null;

  if (spec.helper) {
    const helper = localDefinition(context, spec.helper.name, syntax);
    if (!helper || !syntax.matches(helper, spec.helper.source)) return null;
  }

  const readWrapper = readIsTrusted(context, spec.read, syntax);
  if (!readWrapper) return null;
  const loader = localDefinition(context, spec.loader.name, syntax);
  if (!loader) return null;
  if (spec.loader.pins.some(pin => !containsPin(loader, pin, syntax))) return null;
  if (syntax.importedWrapperCalls([loader], spec.read, context).length !== 1) return null;

  return {
    kind: "signed_page_action",
    verified: true,
    capabilityWitness: true,
    capabilitySources: new Set([identity(syntax, spec.read)]),
    capabilitySourceFile: spec.page
  };
}

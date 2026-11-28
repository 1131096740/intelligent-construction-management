// Explicit AST witnesses for the five actual-purchase batch writes introduced by
// #403 and left unregistered by its rework.
//
// Each witness pins, for one registered page action:
//   1. the page element that opens the write dialog and its `v-if` gate (the
//      gate is a server-issued capability prop or a server read-model field);
//   2. the dialog confirm trigger and the exact handler statement that carries
//      the wrapper, including the shared `run()` callback which is itself pinned;
//   3. the trusted single GET that loads the batch read model and the exact
//      parent-page binding that derives the capability prop;
//   4. the backend service role/precondition guard that enforces the same gate.
//
// The role visibility (`isFinance`, `isFinanceDirector`) is not treated as a
// server capability: it is pinned together with the backend `requireAnyRole`
// guard so the manifest records the server authority, not the client shortcut.
// Nothing here accepts an action unless every pin matches, the wrapper is
// imported from the expected API module and is called exactly once, and the
// capability read is a trusted single-GET route.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = "apps/web-admin/src";
const PANEL = `${WEB}/components/ActualPurchaseBatchPanel.vue`;
const API = `${WEB}/api/actual-purchase-batch.api.ts`;
const GENERAL_PAGE = `${WEB}/pages/general-procurement/GeneralProcurementDetailPage.vue`;
const SPOT_PAGE = `${WEB}/pages/spot-procurement/SpotProcurementDetailPage.vue`;
const SERVICE = "services/api/src/actual-purchase/actual-purchase-batch.service.ts";

const GENERAL_ROUTE = "/综合采购申请/:procurementId";
const SPOT_ROUTE = "/零星采购/:procurementId";

const READ = { apiFile: API, name: "listActualPurchaseBatches" };

const RUN = `async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "实际操作采购操作未完成，请核对后重试");
  } finally {
    busy.value = false;
  }
}`;

const LOAD = {
  name: "load",
  pins: [
    "const result = await listActualPurchaseBatches(props.procurementId);",
    "batches.value = result.items.filter(batch => batch.kind === props.kind);"
  ]
};

const FINANCE_ROLES_GUARD = `await this.requireAnyRole(tx, actorUserId, batch.projectId, FINANCE_ROLES, "只有财务人员或综合部主管可以发起实际采购批次更正");`;
const REFUND_ROLES_GUARD = `await this.requireAnyRole(tx, actorUserId, batch.projectId, FINANCE_ROLES, "只有财务人员或综合部主管可以登记实际收到的退款");`;
const CONFIRM_GUARD = `await this.requireAnyRole(tx, actorUserId, batch.projectId, ["finance_director"], "只有财务主管可以确认实际采购批次更正");`;
const SPOT_CREATE_GUARD = `await this.requireAnyRole(tx, actorUserId, procurement.projectId, ["material_staff", "material_director"], "只有项目物资员或物资部主管可以记录实际采购批次");`;
const GENERAL_CREATE_GUARD = `await this.requireAnyRole(tx, actorUserId, null, ["comprehensive_director"], "只有综合部主管可以记录综合采购实际批次");`;
const SPOT_PAYMENT_GUARD = `await this.requireAnyRole(tx, actorUserId, procurement.projectId, ["material_staff", "material_director"], "只有项目物资员或物资部主管可以发起采购付款");`;

const ACTIONS = {
  "actual-purchase-batch.create": {
    page: PANEL,
    routes: [GENERAL_ROUTE, SPOT_ROUTE],
    element: "t-dialog",
    event: "confirm",
    handler: "createBatch",
    capability: "canCreate",
    opener: {
      gate: "canCreate",
      handler: "openCreate",
      handlerName: "openCreate",
      visiblePin: "createVisible.value = true;"
    },
    read: READ,
    loader: LOAD,
    helper: { name: "run", source: RUN },
    call: `await createActualPurchaseBatch({
      kind: props.kind,
      procurementId: props.procurementId,
      ...(props.kind === "general" ? { companyEntityId: props.companyEntityId ?? null } : {}),
      supplierName: createForm.supplierName.trim(),
      totalAmountCents: createForm.totalAmountCents,
      note: createForm.note.trim() || null,
      idempotencyKey: newKey(),
      lines
    });`,
    capabilityPins: [
      [PANEL, "canCreate?: boolean;"],
      [GENERAL_PAGE, ':can-create="Boolean(detail.canProcure)"'],
      [SPOT_PAGE, ':can-create="detail.procurement.status === \'approved_in_progress\'"']
    ],
    serverPins: [SPOT_CREATE_GUARD, GENERAL_CREATE_GUARD],
    wrappers: [{ apiFile: API, name: "createActualPurchaseBatch" }]
  },
  "actual-purchase-batch.spot-payment": {
    page: PANEL,
    routes: [GENERAL_ROUTE, SPOT_ROUTE],
    element: "t-dialog",
    event: "confirm",
    handler: "createPayment",
    capability: "canPay",
    opener: {
      gate: "kind === 'spot_material' && canPay && !batch.capacity.suspended",
      handler: "openPayment(batch)",
      handlerName: "openPayment",
      visiblePin: "paymentVisible.value = true;"
    },
    read: READ,
    loader: LOAD,
    helper: { name: "run", source: RUN },
    call: `await createActualPurchaseBatchSpotPayment(batch.id, {
      requestedAmountCents: paymentForm.requestedAmountCents,
      paymentType: paymentForm.paymentType,
      payeeName: paymentForm.payeeName.trim(),
      payeeAccountName: paymentForm.accountName.trim(),
      payeeBankName: paymentForm.bankName.trim(),
      payeeBankAccount: paymentForm.accountNumber.trim(),
      paymentMethods: ["bank_transfer"],
      channels: [{ channelType: "bank_transfer", accountName: paymentForm.accountName.trim(), accountNumber: paymentForm.accountNumber.trim(), bankName: paymentForm.bankName.trim(), isPrimary: true }],
      idempotencyKey: newKey()
    });`,
    capabilityPins: [
      [PANEL, "canPay?: boolean;"],
      [PANEL, "!batch.capacity.suspended"],
      [SPOT_PAGE, ':can-pay="detail.procurement.status === \'approved_in_progress\'"'],
      [GENERAL_PAGE, ':can-pay="false"']
    ],
    serverPins: [SPOT_PAYMENT_GUARD, "if (batch.kind !== \"spot_material\") throw new ConflictException(\"综合采购批次请从报销/付款入口发起\");"],
    wrappers: [{ apiFile: API, name: "createActualPurchaseBatchSpotPayment" }]
  },
  "actual-purchase-batch.correction-request": {
    page: PANEL,
    routes: [GENERAL_ROUTE, SPOT_ROUTE],
    element: "t-dialog",
    event: "confirm",
    handler: "requestCorrection",
    capability: "batch.costVersion > 0",
    opener: {
      gate: "isFinance && batch.costVersion > 0",
      handler: "openCorrection(batch)",
      handlerName: "openCorrection",
      visiblePin: "correctionVisible.value = true;"
    },
    read: READ,
    loader: LOAD,
    helper: { name: "run", source: RUN },
    call: `await requestActualPurchaseBatchCorrection(batch.id, {
      correctedTotalAmountCents: correctionForm.correctedTotalAmountCents,
      reason: correctionForm.reason.trim(),
      idempotencyKey: newKey()
    });`,
    capabilityPins: [
      [PANEL, "isFinance && batch.costVersion > 0"],
      [PANEL, "const isFinance = computed(() => Boolean(auth.user?.globalRoleKeys?.some(role => [\"finance_staff\", \"finance_director\", \"comprehensive_director\"].includes(role))));"]
    ],
    serverPins: [FINANCE_ROLES_GUARD, "if (batch.costVersion <= 0) throw new ConflictException(\"实际采购批次成本尚未确认，请先按首批付款确认成本\");"],
    wrappers: [{ apiFile: API, name: "requestActualPurchaseBatchCorrection" }]
  },
  "actual-purchase-batch.correction-confirm": {
    page: PANEL,
    routes: [GENERAL_ROUTE, SPOT_ROUTE],
    element: "t-dialog",
    event: "confirm",
    handler: "confirmCorrection",
    capability: "correction.status === 'pending_confirm'",
    opener: {
      gate: "correction.status === 'pending_confirm' && isFinanceDirector",
      handler: "openConfirm(batch, correction.id)",
      handlerName: "openConfirm",
      visiblePin: "confirmVisible.value = true;"
    },
    read: READ,
    loader: LOAD,
    helper: { name: "run", source: RUN },
    call: `await confirmActualPurchaseBatchCorrection(batch.id, confirmCorrectionId.value, {
      confirmationKey: newKey(),
      reviewNote: confirmForm.reviewNote.trim() || null,
      ...(auth.user?.id && batch.corrections.find(row => row.id === confirmCorrectionId.value)?.requestedByUserId === auth.user.id
        ? { selfReviewReason: confirmForm.selfReviewReason.trim(), confirmationPassword: confirmForm.confirmationPassword }
        : {})
    });`,
    capabilityPins: [
      [PANEL, "correction.status === 'pending_confirm' && isFinanceDirector"],
      [PANEL, "const isFinanceDirector = computed(() => Boolean(auth.user?.globalRoleKeys?.includes(\"finance_director\")));"]
    ],
    serverPins: [CONFIRM_GUARD],
    wrappers: [{ apiFile: API, name: "confirmActualPurchaseBatchCorrection" }]
  },
  "actual-purchase-batch.refund-record": {
    page: PANEL,
    routes: [GENERAL_ROUTE, SPOT_ROUTE],
    element: "t-dialog",
    event: "confirm",
    handler: "recordRefund",
    capability: "Number(batch.capacity.paidAmountCents) > 0",
    opener: {
      gate: "isFinance && Number(batch.capacity.paidAmountCents) > 0",
      handler: "openRefund(batch)",
      handlerName: "openRefund",
      visiblePin: "refundVisible.value = true;"
    },
    read: READ,
    loader: LOAD,
    helper: { name: "run", source: RUN },
    call: `await recordActualPurchaseBatchRefund(batch.id, {
      executionType: selectedRefundExecution.value.executionType,
      executionId: refundForm.executionId,
      amountCents: refundForm.amountCents,
      receivedAt: refundForm.receivedAt,
      reason: refundForm.reason.trim(),
      accountId: refundForm.accountId.trim(),
      idempotencyKey: newKey()
    });`,
    capabilityPins: [
      [PANEL, "isFinance && Number(batch.capacity.paidAmountCents) > 0"],
      [PANEL, "const isFinance = computed(() => Boolean(auth.user?.globalRoleKeys?.some(role => [\"finance_staff\", \"finance_director\", \"comprehensive_director\"].includes(role))));"]
    ],
    serverPins: [REFUND_ROLES_GUARD],
    wrappers: [{ apiFile: API, name: "recordActualPurchaseBatchRefund" }]
  }
};

export const ACTUAL_PURCHASE_BATCH_PAGE_ACTION_IDS = new Set(Object.keys(ACTIONS));

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

function normalizedSource(source) {
  return typeof source === "string" ? source.replace(/\s+/g, " ").trim() : "";
}

function sourceHasPin(source, pin) {
  return normalizedSource(source).includes(normalizedSource(pin));
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

function routesMatch(action, routes) {
  return action.routePaths.length === routes.length &&
    routes.every((route) => action.routePaths.includes(route));
}

function dialogTriggerMatches(candidate, spec) {
  return candidate.element === spec.element &&
    candidate.event === spec.event &&
    candidate.handler === spec.handler;
}

function expressionMatches(node, expected, syntax) {
  const expression = node?.type === "VOnExpression"
    ? node.body?.length === 1 && node.body[0]?.type === "ExpressionStatement"
      ? node.body[0].expression
      : null
    : node;
  return Boolean(expression) && syntax.sameExpression(expression, expected);
}

function openerMatches({ action, context, spec, syntax }) {
  const ast = context.asts?.get(action.sourceFile);
  if (!ast) return false;
  let opener = null;
  syntax.walkEstree(ast, (node) => {
    if (opener || node?.type !== "VElement") return;
    const name = node.rawName ?? node.name;
    if (name !== "t-button") return;
    const clickDirective = syntax.elementDirective(node, "on", "click");
    if (!clickDirective?.value?.expression) return;
    if (expressionMatches(clickDirective.value.expression, spec.opener.handler, syntax)) opener = node;
  });
  if (!opener) return false;
  const ifDirective = syntax.elementDirective(opener, "if");
  if (!ifDirective?.value?.expression) return false;
  if (!expressionMatches(ifDirective.value.expression, spec.opener.gate, syntax)) return false;
  const openerHandler = localDefinition(context, spec.opener.handlerName, syntax);
  if (!openerHandler) return false;
  if (!containsPin(openerHandler, spec.opener.visiblePin, syntax)) return false;
  return true;
}

function capabilityPinsAreProven({ context, spec }) {
  for (const [file, pin] of spec.capabilityPins ?? []) {
    const source = context.sources?.get(file);
    if (!source || !sourceHasPin(source, pin)) return false;
  }
  return true;
}

function serverPinsAreProven(spec) {
  let service;
  try {
    service = readFileSync(join(REPO_ROOT, SERVICE), "utf8");
  } catch {
    return false;
  }
  return (spec.serverPins ?? []).every((pin) => sourceHasPin(service, pin));
}

export function proveActualPurchaseBatchPageAction({ action, wrapper, context, syntax }) {
  const spec = ACTIONS[action.id];
  if (!spec || !context?.candidate) return null;
  const { candidate } = context;

  if (action.sourceFile !== spec.page ||
      action.usage !== "page_action" ||
      action.semantic !== "business_write" ||
      !routesMatch(action, spec.routes) ||
      !dialogTriggerMatches(candidate, spec) ||
      action.trigger.element !== spec.element ||
      action.trigger.event !== spec.event ||
      action.trigger.handler !== spec.handler ||
      action.capability.kind !== "server_boolean" ||
      action.capability.source !== spec.capability ||
      !wrapperListMatches(action, spec.wrappers, syntax)) return null;
  if (!spec.wrappers.some(expected => identity(syntax, expected) === identity(syntax, wrapper))) return null;

  const handler = localDefinition(context, spec.handler, syntax);
  if (!handler || (handler.type !== "FunctionDeclaration" && handler.type !== "ArrowFunctionExpression")) return null;
  if (!containsPin(handler, spec.call, syntax)) return null;
  if (spec.helper && !containsPin(localDefinition(context, spec.helper.name, syntax) ?? {}, spec.helper.source, syntax)) return null;

  if (syntax.importedWrapperCalls([handler], wrapper, context).length !== 1) return null;

  const readWrapper = readIsTrusted(context, spec.read, syntax);
  if (!readWrapper) return null;
  const loader = localDefinition(context, spec.loader.name, syntax);
  if (!loader) return null;
  if (spec.loader.pins.some(pin => !containsPin(loader, pin, syntax))) return null;
  if (syntax.importedWrapperCalls([loader], spec.read, context).length !== 1) return null;

  if (!openerMatches({ action, context, spec, syntax })) return null;
  if (!capabilityPinsAreProven({ context, spec })) return null;
  if (!serverPinsAreProven(spec)) return null;

  return {
    kind: "actual_purchase_batch_page_action",
    verified: true,
    capabilityWitness: true,
    capabilitySources: new Set([identity(syntax, spec.read)]),
    capabilitySourceFile: spec.page
  };
}

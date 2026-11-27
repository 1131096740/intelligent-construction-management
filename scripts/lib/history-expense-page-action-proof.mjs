// Explicit AST witnesses for the #417 and #436 history-expense actions.
//
// Each witness pins:
//   1. the trigger element and the server capability gate on it or on its
//      opener (project capability `actions.*` / batch detail `can*`);
//   2. the handler's own capability guard and the exact wrapper call;
//   3. the trusted single GET that returns the capability read model;
//   4. the backend `@RequireProjectRole` guard for the same business action.
// Nothing here accepts an action unless every pin matches, the wrapper is
// imported from the expected API module and is called exactly once.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = "apps/web-admin/src";
const PAGE = `${WEB}/pages/projects/HistoryExpensePage.vue`;
const API = `${WEB}/api/history-expense.api.ts`;
const CONTROLLER = "services/api/src/history-expense/history-expense.controller.ts";
const ROUTE = "/历史费用核实入账";

const READ = { apiFile: API, name: "fetchHistoryExpenseCapability" };

const LOAD = {
  name: "loadProject",
  pins: ["capability.value = cap;"]
};

const MANAGE_GATE = "selectedProjectId && capability?.actions.manage";

const ACTIONS = {
  "history-expense.precheck": {
    page: PAGE,
    route: ROUTE,
    element: "t-button",
    event: "click",
    handler: "runPrecheck",
    capability: "capability.actions.manage",
    triggerGate: MANAGE_GATE,
    guard: "const operationAllowed = currentCapability?.actions.manage;",
    call: "precheck.value = await precheckHistoryExpenses(selectedProjectId.value, rows);",
    capabilityPins: [
      [PAGE, "capability?.actions.manage"],
      [API, "manage: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.manage")'],
    wrappers: [{ apiFile: API, name: "precheckHistoryExpenses" }]
  },
  "history-expense.excel-precheck": {
    page: PAGE,
    route: ROUTE,
    element: "t-button",
    event: "click",
    handler: "runExcelPrecheck",
    capability: "capability.actions.manage",
    triggerGate: MANAGE_GATE,
    guard: "const operationAllowed = currentCapability?.actions.manage;",
    call: "const imported = await precheckHistoryExpenseExcel(selectedProjectId.value, file);",
    capabilityPins: [[PAGE, "capability?.actions.manage"], [API, "manage: boolean;"]],
    serverPins: ['@Post("excel-precheck") @RequireProjectRole("history_expense.manage")'],
    wrappers: [{ apiFile: API, name: "precheckHistoryExpenseExcel" }]
  },
  "history-expense.create-batch": {
    page: PAGE,
    route: ROUTE,
    element: "t-button",
    event: "click",
    handler: "createBatch",
    capability: "capability.actions.manage",
    triggerGate: MANAGE_GATE,
    guard: "const operationAllowed = currentCapability?.actions.manage;",
    call: "const created = await createHistoryExpenseBatch(selectedProjectId.value, rows);",
    capabilityPins: [
      [PAGE, "capability?.actions.manage"],
      [API, "manage: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.manage")'],
    wrappers: [{ apiFile: API, name: "createHistoryExpenseBatch" }]
  },
  "history-expense.verify-row": {
    page: PAGE,
    route: ROUTE,
    element: "t-dialog",
    event: "confirm",
    handler: "submitVerify",
    capability: "capability.actions.verify",
    opener: {
      gate: "detail.canVerify && !row.generatedFactId",
      handler: "openVerify(row)",
      handlerName: "openVerify",
      visiblePin: "verifyDialog.value = true;"
    },
    guard: "const operationAllowed = currentCapability?.actions.verify;",
    call: `detail.value = await verifyHistoryExpenseRow(
      selectedProjectId.value,
      detail.value!.id,
      target.id,
      {
        expectedRevision: target.revision,
        reviewOutcome: verifyOutcome.value,
        note: verifyNote.value.trim() || undefined,
        ...(verifyOutcome.value === "not_occurred"
          ? { values: { ...target.values, amountYuan: "0", paidAmountYuan: null } }
          : {})
      }
    );`,
    capabilityPins: [
      [PAGE, "currentCapability?.actions.verify"],
      [API, "verify: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.verify")'],
    wrappers: [{ apiFile: API, name: "verifyHistoryExpenseRow" }]
  },
  "history-expense.correct-row": {
    page: PAGE,
    route: ROUTE,
    element: "t-dialog",
    event: "confirm",
    handler: "submitCorrection",
    capability: "capability.actions.correct",
    opener: {
      gate: "detail.canCorrect && row.generatedFactId",
      handler: "openCorrection(row)",
      handlerName: "openCorrection",
      visiblePin: "correctionDialog.value = true;"
    },
    guard: "const operationAllowed = currentCapability?.actions.correct;",
    call: `detail.value = await correctHistoryExpenseRow(
      selectedProjectId.value,
      detail.value.id,
      correctionTarget.value.id,
      {
        expectedRevision: correctionTarget.value.revision,
        reason: correctionReason.value.trim(),
        values: {
          amountYuan: correctionAmount.value,
          paymentStatus: correctionPaymentStatus.value,
          paidAmountYuan: correctionPaidAmount.value || null,
          payerCompanyName: correctionPayer.value || null,
          costBearingCompanyName: correctionCompany.value || null,
          payeeName: correctionPayee.value || null,
          sourceDescription: correctionSource.value
        }
      }
    );`,
    capabilityPins: [
      [PAGE, "currentCapability?.actions.correct"],
      [API, "correct: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.correct")'],
    wrappers: [{ apiFile: API, name: "correctHistoryExpenseRow" }]
  },
  "history-expense.confirm-batch": {
    page: PAGE,
    route: ROUTE,
    element: "t-button",
    event: "click",
    handler: "submitConfirm",
    capability: "capability.actions.confirm",
    triggerGate: "detail.canConfirm",
    guard: "const operationAllowed = currentCapability?.actions.confirm;",
    call: `await confirmHistoryExpenseBatch(selectedProjectId.value, detail.value.id, {
      expectedRevision: detail.value.revision,
      idempotencyKey: crypto.randomUUID(),
      note: "主管复核历史费用行"
    });`,
    capabilityPins: [
      [PAGE, "currentCapability?.actions.confirm"],
      [API, "confirm: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.confirm")'],
    wrappers: [{ apiFile: API, name: "confirmHistoryExpenseBatch" }]
  },
  "history-expense.activate-batch": {
    page: PAGE,
    route: ROUTE,
    element: "t-button",
    event: "click",
    handler: "submitActivate",
    capability: "capability.actions.activate",
    triggerGate: "detail.canActivate",
    guard: "const operationAllowed = currentCapability?.actions.activate;",
    call: `detail.value = await activateHistoryExpenseBatch(
      selectedProjectId.value,
      detail.value.id,
      { expectedRevision: detail.value.revision }
    );`,
    capabilityPins: [
      [PAGE, "currentCapability?.actions.activate"],
      [API, "activate: boolean;"]
    ],
    serverPins: ['@RequireProjectRole("history_expense.activate")'],
    wrappers: [{ apiFile: API, name: "activateHistoryExpenseBatch" }]
  }
};

export const HISTORY_EXPENSE_PAGE_ACTION_IDS = new Set(Object.keys(ACTIONS));

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

function expressionMatches(node, expected, syntax) {
  const expression = node?.type === "VOnExpression"
    ? node.body?.length === 1 && node.body[0]?.type === "ExpressionStatement"
      ? node.body[0].expression
      : null
    : node;
  return Boolean(expression) && syntax.sameExpression(expression, expected);
}

function ancestorGateMatches(candidate, expected, syntax) {
  let current = candidate?.elementNode ?? null;
  while (current?.type === "VElement") {
    const directive = syntax.elementDirective(current, "if") ?? syntax.elementDirective(current, "else-if");
    const expression = directive?.value?.expression;
    if (expression && expressionMatches(expression, expected, syntax)) return true;
    current = current.parent?.type === "VElement" ? current.parent : null;
  }
  return false;
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
  return Boolean(openerHandler) && containsPin(openerHandler, spec.opener.visiblePin, syntax);
}

function capabilityPinsAreProven({ context, spec }) {
  for (const [file, pin] of spec.capabilityPins ?? []) {
    const source = context.sources?.get(file);
    if (!source || !sourceHasPin(source, pin)) return false;
  }
  return true;
}

function serverPinsAreProven(spec) {
  let controller;
  try {
    controller = readFileSync(join(REPO_ROOT, CONTROLLER), "utf8");
  } catch {
    return false;
  }
  return (spec.serverPins ?? []).every((pin) => sourceHasPin(controller, pin));
}

function debugFail(action, reason) {
  if (process.env.HE_DEBUG) process.stderr.write(`HE_FAIL ${action.id}: ${reason}\n`);
  return null;
}

export function proveHistoryExpensePageAction({ action, wrapper, context, syntax }) {
  const spec = ACTIONS[action.id];
  if (!spec || !context?.candidate) return debugFail(action, "spec/candidate");
  const { candidate } = context;

  if (action.sourceFile !== spec.page) return debugFail(action, "page");
  if (action.usage !== "page_action") return debugFail(action, "usage");
  if (action.semantic !== "business_write") return debugFail(action, "semantic");
  if (action.routePaths.length !== 1 || action.routePaths[0] !== spec.route) return debugFail(action, "route");
  if (candidate.element !== spec.element || candidate.event !== spec.event || candidate.handler !== spec.handler) return debugFail(action, "candidate " + JSON.stringify({e:candidate.element,ev:candidate.event,h:candidate.handler}));
  if (action.trigger.element !== spec.element || action.trigger.event !== spec.event || action.trigger.handler !== spec.handler) return debugFail(action, "trigger");
  if (action.capability.kind !== "server_boolean" || action.capability.source !== spec.capability) return debugFail(action, "capability");
  if (!wrapperListMatches(action, spec.wrappers, syntax)) return debugFail(action, "wrapper list");
  if (!spec.wrappers.some(expected => identity(syntax, expected) === identity(syntax, wrapper))) return debugFail(action, "wrapper identity");

  const handler = localDefinition(context, spec.handler, syntax);
  if (!handler || handler.type !== "FunctionDeclaration") return debugFail(action, "handler");
  if (!containsPin(handler, spec.guard, syntax)) return debugFail(action, "guard pin");
  if (!containsPin(handler, spec.call, syntax)) return debugFail(action, "call pin");
  if (syntax.importedWrapperCalls([handler], wrapper, context).length !== 1) return debugFail(action, "wrapper calls " + syntax.importedWrapperCalls([handler], wrapper, context).length);

  const readWrapper = readIsTrusted(context, READ, syntax);
  if (!readWrapper) return debugFail(action, "read trust");
  const loader = localDefinition(context, LOAD.name, syntax);
  if (!loader) return debugFail(action, "loader");
  if (LOAD.pins.some(pin => !containsPin(loader, pin, syntax))) return debugFail(action, "loader pin");
  if (syntax.importedWrapperCalls([loader], READ, context).length !== 1) return debugFail(action, "read calls");

  if (spec.opener) {
    if (!openerMatches({ action, context, spec, syntax })) return debugFail(action, "opener");
  } else if (!ancestorGateMatches(candidate, spec.triggerGate, syntax)) {
    return debugFail(action, "trigger gate");
  }

  if (!capabilityPinsAreProven({ context, spec })) return debugFail(action, "capability pins");
  if (!serverPinsAreProven(spec)) return debugFail(action, "server pins");

  return {
    kind: "history_expense_page_action",
    verified: true,
    capabilityWitness: true,
    capabilitySources: new Set([identity(syntax, READ)]),
    capabilitySourceFile: spec.page
  };
}

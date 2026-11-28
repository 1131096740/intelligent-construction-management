// Explicit witnesses for the #418 public-cash cost-attribution writes.
//
// The create/review dialog uses a conditional @confirm expression, which the
// generic template-root extractor does not model. Each action is therefore
// registered as a background handler and this witness pins the full chain:
//   1. the page button that opens the dialog and its role/precondition gate;
//   2. the dialog's conditional confirm routing to the exact write handler;
//   3. the handler's wrapper call and the shared loader's trusted single GET;
//   4. the backend position guard and the permission-policy action roles.
// The client `canRequestCostAttribution`/`canReviewCostAttribution` computed
// visibility is pinned together with the backend authority, so the manifest
// records the server position policy rather than treating the client role as a
// capability on its own.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = "apps/web-admin/src";
const PAGE = `${WEB}/pages/projects/ProjectOperatingOverviewPage.vue`;
const API = `${WEB}/api/cost-attribution.api.ts`;
const CONTROLLER = "services/api/src/operating-ledger/operating-cost-attribution.controller.ts";
const SERVICE = "services/api/src/operating-ledger/operating-cost-attribution.service.ts";
const EVIDENCE = "services/api/src/operating-ledger/expense-cash-cost-attribution.ts";
const PERMISSIONS = "packages/shared-domain/src/permissions.ts";
const ROUTE = "/项目经营";

const READ = { apiFile: API, name: "fetchCostAttributions" };

const LOAD = {
  name: "loadCostAttributions",
  pins: ["costAttribution.value = await fetchCostAttributions(projectId);"]
};

const DIALOG_CONFIRM = 'costAttributionReview ? submitCostAttributionReview() : submitCostAttribution()';

const CONTROLLER_POSITIONS = '@RequirePositions( "comprehensive_director", "finance_staff", "finance_director" )';
const CANDIDATE_REVIEW_GATE = "candidate.activeStatus === 'pending_review' && canReviewCostAttribution";
const CANDIDATE_REVIEW_ROW =
  "(costAttribution?.confirmations ?? []).find((row) => row.id === candidate.activeConfirmationId)!";
const VISIBLE_PIN = "costAttributionDialogVisible.value = true;";

const ACTIONS = {
  "cost-attribution.request": {
    page: PAGE,
    route: ROUTE,
    handler: "submitCostAttribution",
    capability: "canRequestCostAttribution",
    opener: {
      handlerName: "openCostAttributionDialog",
      pins: ["costAttributionCandidate.value = candidate;"],
      buttons: [{
        call: "openCostAttributionDialog(candidate)",
        gates: ["!candidate.activeConfirmationId && canRequestCostAttribution"]
      }]
    },
    call: `await requestCostAttribution(projectId, candidate.factId, {
      companyEntityId: costAttributionCompanyId.value,
      reason: costAttributionReason.value.trim(),
      idempotencyKey: crypto.randomUUID(),
      ...(candidate.expenseCashCostLinkId ? { expenseCashCostLinkId: candidate.expenseCashCostLinkId } : {})
    });`,
    capabilityPins: [
      [PAGE, "canRequestCostAttribution = computed("],
      [PAGE, '["comprehensive_director", "finance_staff", "finance_director"].includes(role)'],
      [PAGE, "!candidate.activeConfirmationId && canRequestCostAttribution"]
    ],
    serverPins: [
      [CONTROLLER, CONTROLLER_POSITIONS],
      [CONTROLLER, "return this.attributions.request(projectId, factId, body, user.id);"],
      [SERVICE, "const roles = await this.requireProject(tx, projectId, actor);"],
      [SERVICE, "canPerform(ROLE_KEYS.request, roles)"],
      [SERVICE, "await lockExpenseCashCostEvidence(tx, projectId, factId, input.expenseCashCostLinkId)"],
      [SERVICE, 'expenseCashCostLinkId: evidence.id, attributedAmountCents: amount, status: "pending_review"'],
      [EVIDENCE, 'WHERE link.id = ${linkId} AND claim."projectId" = ${projectId} FOR UPDATE OF claim'],
      [EVIDENCE, "costImpact: { ...expenseCashCostImpactEligibility(projectId), factId }"],
      [PERMISSIONS, '"operating_cost_attribution.request": ["comprehensive_director", "finance_staff", "finance_director"]']
    ],
    wrappers: [{ apiFile: API, name: "requestCostAttribution" }]
  },
  "cost-attribution.review": {
    page: PAGE,
    route: ROUTE,
    handler: "submitCostAttributionReview",
    capability: "canReviewCostAttribution",
    opener: {
      handlerName: "openCostAttributionReview",
      pins: [
        "costAttributionReview.value = row;",
        "costAttributionReviewDecision.value = decision;"
      ],
      buttons: [
        {
          call: `openCostAttributionReview(${CANDIDATE_REVIEW_ROW}, 'confirm')`,
          gates: ["!candidate.cashEvidenceChanged", CANDIDATE_REVIEW_GATE]
        },
        {
          call: `openCostAttributionReview(${CANDIDATE_REVIEW_ROW}, 'return')`,
          gates: [CANDIDATE_REVIEW_GATE]
        },
        {
          call: "openCostAttributionReview(row, 'return')",
          gates: [`row.expenseCashCostLinkId && row.status === 'pending_review' && canReviewCostAttribution &&
            !costAttribution?.candidates.some(candidate => candidate.activeConfirmationId === row.id)`]
        }
      ]
    },
    call: `await reviewCostAttribution(projectId, row.id, {
      decision: costAttributionReviewDecision.value,
      revision: row.revision,
      ...(costAttributionReviewReason.value.trim()
        ? { reason: costAttributionReviewReason.value.trim() }
        : {}),
      ...(costAttributionReviewPassword.value
        ? { password: costAttributionReviewPassword.value }
        : {})
    });`,
    capabilityPins: [
      [PAGE, "canReviewCostAttribution = computed("],
      [PAGE, 'auth.user?.roleKeys.includes("finance_director")'],
      [PAGE, "candidate.activeStatus === 'pending_review' && canReviewCostAttribution"]
    ],
    serverPins: [
      [CONTROLLER, CONTROLLER_POSITIONS],
      [CONTROLLER, "return this.attributions.review(projectId, id, body, user.id);"],
      [SERVICE, "const roles = await this.requireProject(tx, projectId, actor);"],
      [SERVICE, "canPerform(ROLE_KEYS.review, roles)"],
      [SERVICE, 'where: { id: confirmationId, projectId }'],
      [SERVICE, 'if (input.decision === "return")'],
      [SERVICE, 'status: "returned", activeKey: null,'],
      [SERVICE, 'action: "operating_cost_attribution.returned"'],
      [PERMISSIONS, '"operating_cost_attribution.review": ["finance_director"]']
    ],
    wrappers: [{ apiFile: API, name: "reviewCostAttribution" }]
  }
};

export const COST_ATTRIBUTION_PAGE_ACTION_IDS = new Set(Object.keys(ACTIONS));

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

function expressionRootName(node) {
  const expression = node?.type === "VOnExpression"
    ? node.body?.length === 1 && node.body[0]?.type === "ExpressionStatement"
      ? node.body[0].expression
      : null
    : node;
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type === "CallExpression" && expression.callee?.type === "Identifier") {
    return expression.callee.name;
  }
  return null;
}

function openerMatches({ action, context, spec, syntax }) {
  const ast = context.asts?.get(action.sourceFile);
  if (!ast) return false;
  const matched = new Set();
  let invalid = false;
  syntax.walkEstree(ast, (node) => {
    if (invalid || node?.type !== "VElement") return;
    const name = node.rawName ?? node.name;
    if (!["button", "t-button"].includes(name)) return;
    const expression = syntax.elementDirective(node, "on", "click")?.value?.expression;
    if (expressionRootName(expression) !== spec.opener.handlerName) return;
    const button = spec.opener.buttons.find(item => expressionMatches(expression, item.call, syntax));
    if (!button || matched.has(button)) {
      invalid = true;
      return;
    }
    const gates = [];
    for (let current = node; current?.type === "VElement"; current = current.parent) {
      const directive = syntax.elementDirective(current, "if") ?? syntax.elementDirective(current, "else-if");
      if (directive?.value?.expression) gates.push(directive.value.expression);
    }
    if (button.gates.every(gate => gates.some(node => expressionMatches(node, gate, syntax)))) {
      matched.add(button);
    } else {
      invalid = true;
    }
  });
  if (invalid || matched.size !== spec.opener.buttons.length) return false;
  const openerHandler = localDefinition(context, spec.opener.handlerName, syntax);
  return Boolean(openerHandler) && [VISIBLE_PIN, ...spec.opener.pins]
    .every(pin => containsPin(openerHandler, pin, syntax));
}

function capabilityPinsAreProven({ context, spec }) {
  for (const [file, pin] of spec.capabilityPins ?? []) {
    const source = context.sources?.get(file);
    if (!source || !sourceHasPin(source, pin)) return false;
  }
  return true;
}

function serverPinsAreProven(spec) {
  for (const [file, pin] of spec.serverPins ?? []) {
    let source;
    try {
      source = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      return false;
    }
    if (!sourceHasPin(source, pin)) return false;
  }
  return true;
}

export function proveCostAttributionPageAction({ action, wrapper, context, syntax }) {
  const spec = ACTIONS[action.id];
  if (!spec || !context?.candidate) return null;
  const { candidate } = context;

  if (action.sourceFile !== spec.page ||
      action.usage !== "background" ||
      action.semantic !== "business_write" ||
      action.routePaths.length !== 1 ||
      action.routePaths[0] !== spec.route ||
      action.trigger.element !== "module" ||
      action.trigger.event !== "call" ||
      action.trigger.handler !== spec.handler ||
      action.capability.kind !== "server_boolean" ||
      action.capability.source !== spec.capability ||
      !wrapperListMatches(action, spec.wrappers, syntax)) return null;
  if (!spec.wrappers.some(expected => identity(syntax, expected) === identity(syntax, wrapper))) return null;

  const handler = localDefinition(context, spec.handler, syntax);
  if (!handler || handler.type !== "FunctionDeclaration") return null;
  if (!containsPin(handler, spec.call, syntax)) return null;
  if (syntax.importedWrapperCalls([handler], wrapper, context).length !== 1) return null;

  const readWrapper = readIsTrusted(context, READ, syntax);
  if (!readWrapper) return null;
  const loader = localDefinition(context, LOAD.name, syntax);
  if (!loader) return null;
  if (LOAD.pins.some(pin => !containsPin(loader, pin, syntax))) return null;
  if (syntax.importedWrapperCalls([loader], READ, context).length !== 1) return null;

  if (!openerMatches({ action, context, spec, syntax })) return null;
  const pageSource = context.sources?.get(PAGE);
  if (!pageSource || !sourceHasPin(pageSource, DIALOG_CONFIRM)) return null;
  if (!capabilityPinsAreProven({ context, spec })) return null;
  if (!serverPinsAreProven(spec)) return null;

  return {
    kind: "cost_attribution_page_action",
    verified: true,
    capabilityWitness: true,
    capabilitySources: new Set([identity(syntax, READ)]),
    capabilitySourceFile: spec.page
  };
}

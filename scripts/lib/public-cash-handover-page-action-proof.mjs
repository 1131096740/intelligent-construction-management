const PAGE = "apps/web-admin/src/pages/funds/PublicCashHandoverPanel.vue";
const API = "apps/web-admin/src/api/public-cash-handover.api.ts";
const AUTH = "apps/web-admin/src/auth/auth.store.ts";
const routes = {
  claimInitialPublicCashCustody: "POST /public-cash-handovers/initial-custodian",
  startPublicCashHandover: "POST /public-cash-handovers",
  confirmPublicCashHandover: "POST /public-cash-handovers/:param/confirmation"
};
const rules = {
  "public-cash-handover.claim": ["claim", "claimAllowed", ["claimInitialPublicCashCustody"]],
  "public-cash-handover.start": ["start", "startAllowed", ["startPublicCashHandover"]],
  "public-cash-handover.confirm": ["confirm", "confirmAllowed", ["confirmPublicCashHandover"]],
  "public-cash-handover.recover-original": ["retryPending", "recoveryAllowed", Object.keys(routes)]
};
export const PUBLIC_CASH_HANDOVER_ACTIONS = new Set(Object.keys(rules));

const capabilities = {
  claimAllowed: "computed(() => model.value?.canClaimInitial === true && !pending.value)",
  startAllowed: "computed(() => model.value?.canStart === true && !pending.value)",
  confirmAllowed: "computed(() => !pending.value && model.value?.handovers.some(row => row.id === selected.value?.id && row.canConfirm) === true)",
  recoveryAllowed: `computed(() => {
    const command = pending.value;
    if (!command || !model.value) return false;
    if (command.type === "claim") return model.value.canRecoverInitial;
    if (command.type === "start") return model.value.canStart || model.value.handovers.some(row => row.canRecoverStart);
    return model.value.handovers.some(row => row.id === command.handoverId && row.canRecoverConfirmation);
  })`
};
const handlers = {
  claim: `function claim() {
    if (!claimAllowed.value || model.value?.revision == null) return;
    void run({ type: "claim", input: { idempotencyKey: crypto.randomUUID(), expectedRevision: model.value.revision } });
  }`,
  start: `function start() {
    if (!startAllowed.value || model.value?.revision == null || !toCustodianId.value || !deliveredYuan.value.trim() || !evidence.value.trim()) return;
    void run({ type: "start", input: { idempotencyKey: crypto.randomUUID(), expectedRevision: model.value.revision,
      toCustodianId: toCustodianId.value, deliveredYuan: deliveredYuan.value.trim(), evidenceReference: evidence.value.trim() } });
  }`,
  confirm: `function confirm() {
    if (!confirmAllowed.value || !selected.value || !receivedYuan.value.trim()) return;
    void run({ type: "confirm", handoverId: selected.value.id,
      input: { idempotencyKey: crypto.randomUUID(), receivedYuan: receivedYuan.value.trim() } });
  }`,
  retryPending: "function retryPending() { if (recoveryAllowed.value) void run(); }"
};

const readPending = `function readPending(actorId: string) {
  const saved = localStorage.getItem(storageKey(actorId));
  if (!saved) return null;
  const command = JSON.parse(saved) as PublicCashHandoverCommand;
  if ((command.type !== "claim" && command.type !== "start" && command.type !== "confirm") || typeof command.input?.idempotencyKey !== "string") {
    throw new Error("原交接凭据无法读取，请保留浏览器记录");
  }
  return command;
}`;
const load = `async function load() {
  const owner = actor.value;
  if (!owner) return;
  loading.value = true;
  try {
    const next = await fetchPublicCashHandovers();
    if (actor.value === owner) model.value = next;
  } catch (failure) {
    if (actor.value === owner) error.value = formatUnknownApiError(failure, "现金交接资料读取失败");
  } finally {
    if (actor.value === owner) loading.value = false;
  }
}`;
const dispatch = `const result = command.type === "claim" ? await claimInitialPublicCashCustody(command.input)
  : command.type === "start" ? await startPublicCashHandover(command.input)
    : await confirmPublicCashHandover(command.handoverId, command.input);`;

export function provePublicCashHandoverPageAction({ action, wrapper, context, syntax }) {
  const [handler, capability, allowed] = rules[action.id] ?? [];
  const request = syntax.normalizedMainRequests(wrapper);
  if (action.sourceFile !== PAGE || wrapper.apiFile !== API || !allowed?.includes(wrapper.name) ||
      request.length !== 1 || request[0].normalizedKey !== routes[wrapper.name] ||
      action.trigger.handler !== handler || action.capability.kind !== "server_boolean" ||
      action.capability.source !== capability) return null;

  const symbols = context.symbols;
  const binding = name => syntax.topLevelScopeVariables(symbols.scopeManager, name)[0];
  const definition = name => {
    const refs = syntax.topLevelScopeVariables(symbols.scopeManager, name);
    return refs.length === 1 && !refs[0].references.some(ref => ref.isWrite() && !ref.init)
      ? syntax.uniqueIndexedNode(symbols.declarationsByBinding, refs[0]) : null;
  };
  const isImport = (name, file) => {
    const item = symbols.importsByBinding.get(binding(name));
    return item?.sourceFile === file && item.importedName === name;
  };
  const readIdentity = syntax.wrapperIdentity(API, "fetchPublicCashHandovers");
  const read = context.wrapperIndex.get(readIdentity);
  if (!read || read.returnProvenance !== "transparent_main_response" ||
      syntax.normalizedMainRequests(read).length !== 1 ||
      syntax.normalizedMainRequests(read)[0].normalizedKey !== "GET /public-cash-handovers" ||
      !isImport("fetchPublicCashHandovers", API) || !isImport("useAuthStore", AUTH) ||
      !Object.keys(routes).every(name => isImport(name, API)) ||
      !symbols.vueRefImportBindings.has(binding("ref")) || !symbols.vueComputedImportBindings.has(binding("computed")) ||
      !syntax.sameExpression(definition("auth"), "useAuthStore()") ||
      !syntax.sameExpression(definition("actor"), 'computed(() => auth.user?.id ?? "")') ||
      !syntax.sameExpression(definition("model"), "ref<PublicCashHandoverReadModel>()") ||
      !syntax.sameExpression(definition(capability), capabilities[capability]) ||
      !syntax.sameExpression(definition("storageKey"), '(actorId: string) => `jg:public-cash-handover:${actorId}`') ||
      !syntax.matches(definition(handler), handlers[handler]) ||
      !syntax.matches(definition("readPending"), readPending) ||
      !syntax.matches(definition("load"), load)) return null;

  const model = binding("model");
  let loads = 0;
  let checked = true;
  const loadNode = definition("load");
  syntax.walkEstree(context.asts.get(PAGE), node => {
    if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" &&
        symbols.scopeBindings.get(node.left.object) === model &&
        !syntax.matches({ type: "ExpressionStatement", expression: node }, "model.value = undefined;")) {
      loads++;
      if (node.range[0] <= loadNode.range[0] || node.range[1] >= loadNode.range[1] ||
          !syntax.matches({ type: "ExpressionStatement", expression: node }, "model.value = next;")) checked = false;
    }
  });
  if (!checked || loads !== 1) return null;

  const run = definition("run");
  const statements = run?.body?.body ?? [];
  const prefix = [
    "const owner = actor.value;", "if (saving.value || !owner) return;",
    "saving.value = true;", 'error.value = "";', 'success.value = "";',
    "const key = storageKey(owner);", "const expectedPending = proposal ? null : pending.value;"
  ];
  if (statements.length !== prefix.length + 1 ||
      !prefix.every((item, index) => syntax.matches(statements[index], item))) return null;
  const tryBody = statements.at(-1)?.block?.body;
  const lock = tryBody?.[1]?.expression?.argument;
  if (tryBody?.length !== 2 ||
      !syntax.matches(tryBody[0], 'if (!navigator.locks) throw new Error("当前浏览器无法安全保存交接凭据");') ||
      lock?.callee?.object?.object?.name !== "navigator" || lock?.callee?.object?.property?.name !== "locks" ||
      lock?.callee?.property?.name !== "request" || lock.arguments?.length !== 3 ||
      !syntax.sameExpression(lock.arguments[0], "key") ||
      !syntax.sameExpression(lock.arguments[1], '({mode: "exclusive"})')) return null;
  const callback = lock.arguments[2];
  const safePrelude = [
    "if (actor.value !== owner) return;", "const existing = readPending(owner);",
    "if (existing && (proposal || JSON.stringify(existing) !== JSON.stringify(expectedPending))) { pending.value = existing; return; }",
    "const command = existing ?? proposal;",
    "if (!command) { pending.value = null; return; }",
    "if (!existing) localStorage.setItem(key, JSON.stringify(command));",
    "pending.value = command;"
  ];
  const callbackBody = callback?.body?.body ?? [];
  const transaction = callbackBody.at(-1);
  if (callback?.type !== "ArrowFunctionExpression" || !callback.async || callback.params.length !== 0 ||
      callbackBody.length !== safePrelude.length + 1 ||
      !safePrelude.every((item, index) => syntax.matches(callbackBody[index], item)) ||
      transaction?.type !== "TryStatement" || !syntax.matches(transaction.block.body[0], dispatch) ||
      !syntax.matches(transaction.block.body[1], "assertPublicCashHandoverReceipt(command, result);") ||
      !isImport("assertPublicCashHandoverReceipt", API) ||
      !syntax.matches(transaction.block.body[2], "localStorage.removeItem(key);")) return null;
  if (Object.keys(routes).some(name => syntax.importedWrapperCalls([run], { name, apiFile: API }, context).length !== 1)) return null;
  const onFailure = transaction.handler?.body?.body;
  if (!syntax.matches(onFailure?.[0], "const rejected = failure instanceof PublicCashHandoverError && (failure.superseded || (!existing && failure.definitive));") ||
      !syntax.matches(onFailure?.[1], "if (rejected) localStorage.removeItem(key);") ||
      !isImport("PublicCashHandoverError", API)) return null;
  const globals = new Set(["crypto", "navigator", "localStorage", "JSON", "Error"]);
  for (const node of [definition(handler), run, definition("readPending")]) {
    syntax.walkEstree(node, item => {
      if (item.type === "Identifier" && globals.has(item.name) &&
          !syntax.unshadowedRuntimeGlobal(item, globals, symbols.scopeBindings)) checked = false;
    });
  }
  return checked ? { verified: true, capabilityWitness: true,
    capabilitySources: new Set([readIdentity]), capabilitySourceFile: PAGE } : null;
}

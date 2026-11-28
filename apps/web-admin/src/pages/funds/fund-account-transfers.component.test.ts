import { effectScope, nextTick, type Ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FundAccount } from "../../api/fund-account.api";
import type { FundTransfer } from "../../api/fund-account-transfer.api";
import FundAccountTransfers from "./FundAccountTransfers.vue";
import type { FundTransferCommand } from "./fund-transfer-command";

const mock = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), actor: { id: "actor" } }));
vi.mock("vue", async original => ({
  ...await original<typeof import("vue")>(), onBeforeUnmount: () => undefined, useSSRContext: () => ({ modules: new Set<string>() })
}));
vi.mock("../../auth/auth.store", () => ({ useAuthStore: () => ({ user: mock.actor }) }));
vi.mock("../../api/fund-account-transfer.api", () => ({ fetchFundAccountTransfers: mock.load }));
vi.mock("./fund-transfer-command", () => ({ readFundTransferCommand: () => null, submitFundTransferCommand: mock.submit }));

const cash = {
  scopeKey: "public_cash", name: "公共现金", kind: "public_cash", active: true, currentRegistrationId: "cash-registration",
  balanceYuan: "60.0000", sources: [{ id: "cash-source", amountYuan: "60.0000", sourceStatus: "known",
    sourceName: "原出资方", projectStatus: "pending", projectId: null }]
} as FundAccount;
const company = {
  ...cash, scopeKey: "company:a", name: "甲公司", kind: "company", currentRegistrationId: "company-registration",
  sources: [{ ...cash.sources[0], id: "company-source" }]
} as FundAccount;
type Bindings = {
  reference: Ref<string>;
  selectedCompany: Ref<string>;
  allocations: Ref<Record<string, string>>;
  selectedAction: Ref<unknown>;
  openRegistration: (direction: "cash" | "company") => void;
  openAction: (transfer: FundTransfer, action: "confirm" | "return") => void;
  submitRegistration: () => void;
  submitAction: () => void;
};

let scope: ReturnType<typeof effectScope>;
beforeEach(() => {
  vi.stubGlobal("navigator", { locks: {} });
  vi.stubGlobal("crypto", { randomUUID: () => "one-generated-key" });
  mock.load.mockResolvedValue({ canRegisterCash: true, canRegisterCompany: true, transfers: [] });
  mock.submit.mockResolvedValue({ kind: "saved", receipt: { status: "received" } });
  scope = effectScope();
});
afterEach(() => {
  scope.stop();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function openPage() {
  const props = { accounts: [cash, company], projects: [], accountLoading: false };
  const component = FundAccountTransfers as unknown as {
    setup: (input: typeof props, context: { expose: () => void; emit: () => void }) => Bindings;
  };
  const page = scope.run(() => component.setup(props, { expose() {}, emit() {} }))!;
  await new Promise(resolve => setTimeout(resolve, 0));
  return page;
}

it.each([
  ["cash", "cash-source", "cash-registration", "public_cash", "company:a"],
  ["company", "company-source", "company-registration", "company:a", "public_cash"]
] as const)("freezes the selected source and account version for %s transfer", async (direction, source, registration, from, to) => {
  const page = await openPage();
  page.openRegistration(direction);
  page.selectedCompany.value = "company:a";
  await nextTick();
  page.allocations.value[source] = "12.3400";
  page.reference.value = "凭据原文";
  page.submitRegistration();
  page.submitRegistration();
  expect(mock.submit).toHaveBeenCalledTimes(1);
  expect(mock.submit.mock.calls[0][1] as FundTransferCommand).toMatchObject({ type: "register", input: {
    sourceScopeKey: from, destinationScopeKey: to, expectedRegistrationId: registration,
    idempotencyKey: "one-generated-key", lines: [{ sourceBatchId: source, amountYuan: "12.3400" }]
  } });
});

it("rejects confirmation from an unauthorized reader and submits a real return against the held revision", async () => {
  const held: FundTransfer = {
    id: "transfer", revision: 2, status: "rejected_held", sourceScopeKey: "public_cash", destinationScopeKey: "company:a",
    amountYuan: "10.0000", transferredOn: "2026-11-18", evidenceReference: "原凭据", actions: [],
    canReceive: false, canResolveRejection: true
  };
  mock.load.mockResolvedValue({ canRegisterCash: true, canRegisterCompany: true, transfers: [held] });
  const page = await openPage();
  page.openAction(held, "confirm");
  expect(page.selectedAction.value).toBeNull();
  page.openAction(held, "return");
  page.submitAction();
  expect(mock.submit).not.toHaveBeenCalled();
  page.reference.value = "现金已实际退回凭据";
  page.submitAction();
  expect(mock.submit.mock.calls[0][1]).toEqual({ type: "action", transferId: "transfer", input: {
    idempotencyKey: "one-generated-key", expectedRevision: 2, action: "return", evidenceReference: "现金已实际退回凭据"
  } });
});

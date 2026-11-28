import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

interface CashCustodian { id: string; name: string }
export interface PublicCashHandoverReadModel {
  revision: number | null;
  currentCustodian: (CashCustodian & { isActive: boolean }) | null;
  candidates: CashCustodian[];
  canStart: boolean;
  canClaimInitial: boolean;
  canRecoverInitial: boolean;
  handovers: PublicCashHandover[];
}
export interface PublicCashHandover {
  id: string;
  fromName: string;
  toName: string;
  startedByName: string;
  deliveredYuan: string;
  expectedBalanceYuan: string | null;
  evidenceReference: string;
  createdAt: string;
  status: "pending" | "superseded" | "confirmed" | "awaiting_reconciliation";
  confirmation: PublicCashHandoverConfirmation | null;
  canConfirm: boolean;
  canRecoverStart: boolean;
  canRecoverConfirmation: boolean;
}
interface PublicCashHandoverConfirmation {
  id: string;
  amountReceivedYuan: string;
  discrepancyYuan: string | null;
  handoverDifferenceYuan: string;
}
export type PublicCashHandoverCommand =
  | { type: "claim"; input: { idempotencyKey: string; expectedRevision: number } }
  | { type: "start"; input: { idempotencyKey: string; toCustodianId: string; expectedRevision: number; deliveredYuan: string; evidenceReference: string } }
  | { type: "confirm"; handoverId: string; input: { idempotencyKey: string; receivedYuan: string } };

export class PublicCashHandoverError extends Error {
  constructor(message: string, readonly superseded: boolean, readonly definitive: boolean) { super(message); }
}

async function result(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  const data: unknown = await response.json().catch(() => null);
  const body = data && typeof data === "object" ? data as { message?: unknown; code?: unknown; statusCode?: unknown } : {};
  throw new PublicCashHandoverError(formatApiErrorMessage(typeof body.message === "string" ? body.message : "",
    response.status, "现金交接办理失败，请核对原记录"),
  response.status === 409 && body.statusCode === 409 && body.code === "PUBLIC_CASH_HANDOVER_SUPERSEDED",
  [400, 401, 403, 404].includes(response.status));
}

export async function fetchPublicCashHandovers() {
  return result(await apiFetch("/public-cash-handovers")) as Promise<PublicCashHandoverReadModel>;
}

type ClaimInput = Extract<PublicCashHandoverCommand, { type: "claim" }>["input"];
type StartInput = Extract<PublicCashHandoverCommand, { type: "start" }>["input"];
type ConfirmInput = Extract<PublicCashHandoverCommand, { type: "confirm" }>["input"];

function jsonPost(input: ClaimInput | StartInput | ConfirmInput) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) };
}
export async function claimInitialPublicCashCustody(input: ClaimInput) {
  return result(await apiFetch("/public-cash-handovers/initial-custodian", jsonPost(input)));
}
export async function startPublicCashHandover(input: StartInput) {
  return result(await apiFetch("/public-cash-handovers", jsonPost(input)));
}
export async function confirmPublicCashHandover(handoverId: string, input: ConfirmInput) {
  return result(await apiFetch(`/public-cash-handovers/${encodeURIComponent(handoverId)}/confirmation`, jsonPost(input)));
}
export function assertPublicCashHandoverReceipt(command: PublicCashHandoverCommand, reply: unknown) {
  const receipt = reply as { id?: unknown; amountReceivedYuan?: unknown; startedRevision?: unknown } | null;
  if (typeof receipt?.id !== "string" || (command.type === "confirm"
    ? receipt.id !== command.handoverId || typeof receipt.amountReceivedYuan !== "string"
    : receipt.startedRevision !== command.input.expectedRevision + 1)) {
    throw new Error("现金交接回执尚未确认");
  }
  return receipt;
}

import type { RegisteredPaymentCommand } from "../../api/registered-payment-execution.api";

export type PendingPaymentCommand = Omit<RegisteredPaymentCommand, "confirmationPassword">;
export interface PendingPaymentDraft { amountYuan:string;paidAt:string;scopeKey:string;treatment:string;reason:string;evidence:string;accountName:string;allocations:Array<{sourceBatchId:string;amountYuan:string}> }
export interface PendingPaymentAttempt { version:1;userId:string;paymentId:string;command:PendingPaymentCommand;draft:PendingPaymentDraft }
type StorageAccess = () => Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type PendingAttemptRead = {kind:"missing"}|{kind:"restored";attempt:PendingPaymentAttempt}|{kind:"unreadable";notice:string;blocksNewAttempt:boolean};

function storageKey(userId: string) { return `jiangkong-payment-pending:v1:${userId}`; }
// Only unfinished transport input is recoverable. No credentials, files,
// permissions or successful funds facts cross this explicit whitelist.
export function transportCommand(command: PendingPaymentCommand): PendingPaymentCommand {
 const history = command.contractHistoryConfirmation;
 return {...(history ? {contractHistoryConfirmation:{treatment:history.treatment,expectedFingerprint:history.expectedFingerprint,reason:history.reason,evidence:history.evidence}} : {}),idempotencyKey:command.idempotencyKey,expectedPaymentUpdatedAt:command.expectedPaymentUpdatedAt,amountCents:command.amountCents,paidAt:command.paidAt,scopeKey:command.scopeKey,expectedRegistrationId:command.expectedRegistrationId,openingTreatment:command.openingTreatment,openingReason:command.openingReason,openingEvidence:command.openingEvidence,sourceAllocations:command.sourceAllocations.map(line=>({sourceBatchId:line.sourceBatchId,amountCents:line.amountCents}))};
}
export function makePendingPaymentAttempt(userId:string,paymentId:string,command:PendingPaymentCommand,draft:PendingPaymentDraft): PendingPaymentAttempt {
 return {version:1,userId,paymentId,command:transportCommand(command),draft:{amountYuan:draft.amountYuan,paidAt:draft.paidAt,scopeKey:draft.scopeKey,treatment:draft.treatment,reason:draft.reason,evidence:draft.evidence,accountName:draft.accountName,allocations:draft.allocations.map(line=>({sourceBatchId:line.sourceBatchId,amountYuan:line.amountYuan}))}};
}
export function writePendingPaymentAttempt(attempt:PendingPaymentAttempt,storage:StorageAccess,previousNotice:string):string {
 try { storage().setItem(storageKey(attempt.userId),JSON.stringify(makePendingPaymentAttempt(attempt.userId,attempt.paymentId,attempt.command,attempt.draft))); return previousNotice; }
 catch { return "浏览器暂时无法保存恢复信息，本页已保留原请求；请勿刷新或离开，先查询本次登记结果。"; }
}
export function clearPendingPaymentAttemptIfSameKey(attempt:PendingPaymentAttempt|null,storage:StorageAccess,previousNotice:string):string {
 if (!attempt) return previousNotice;
 try {
  const target = storage();
  const saved = target.getItem(storageKey(attempt.userId));
  if (saved && (JSON.parse(saved) as PendingPaymentAttempt).command?.idempotencyKey === attempt.command.idempotencyKey) target.removeItem(storageKey(attempt.userId));
  return "";
 } catch { return "本次结果已由服务器确认，浏览器恢复信息暂未清除；再次进入仍会查询原请求，不会自动重新登记。"; }
}
export function readPendingPaymentAttempt(userId:string,storage:StorageAccess):PendingAttemptRead {
 let saved:string|null;
 try { saved = storage().getItem(storageKey(userId)); }
 catch { return {kind:"unreadable",notice:"浏览器暂时无法读取恢复信息，新登记将在本页保留原请求；提交后请先查询结果再离开。",blocksNewAttempt:false}; }
 if (!saved) return {kind:"missing"};
 try {
  const pointer = JSON.parse(saved) as PendingPaymentAttempt;
  const command = pointer.command;
  const fields = ["idempotencyKey","expectedPaymentUpdatedAt","amountCents","paidAt","scopeKey","expectedRegistrationId","openingReason","openingEvidence"] as const;
  if (pointer.version !== 1 || pointer.userId !== userId || typeof pointer.paymentId !== "string" || !command || fields.some(field=>typeof command[field] !== "string") || !["included","not_included"].includes(command.openingTreatment) || !Array.isArray(command.sourceAllocations) || command.sourceAllocations.some(line=>!line || typeof line.sourceBatchId !== "string" || typeof line.amountCents !== "string") || !pointer.draft || typeof pointer.draft.amountYuan !== "string" || typeof pointer.draft.accountName !== "string" || !Array.isArray(pointer.draft.allocations)) throw new Error("Invalid transport pointer");
  const history = command.contractHistoryConfirmation;
  if (history && (history.treatment !== "not_included" || [history.expectedFingerprint,history.reason,history.evidence].some(value=>typeof value !== "string"))) throw new Error("Invalid history transport confirmation");
  const stored = transportCommand(command);
  const draft: PendingPaymentDraft = {amountYuan:pointer.draft.amountYuan,paidAt:stored.paidAt,scopeKey:stored.scopeKey,treatment:stored.openingTreatment,reason:stored.openingReason,evidence:stored.openingEvidence,accountName:pointer.draft.accountName,allocations:pointer.draft.allocations.filter(line=>line && typeof line.sourceBatchId === "string" && typeof line.amountYuan === "string").map(line=>({sourceBatchId:line.sourceBatchId,amountYuan:line.amountYuan}))};
  return {kind:"restored",attempt:{version:1,userId,paymentId:pointer.paymentId,command:stored,draft}};
 } catch { return {kind:"unreadable",notice:"浏览器保存的待确认信息暂时无法读取，请由有权财务或综合部主管核查原申请，暂勿重复登记。",blocksNewAttempt:true}; }
}

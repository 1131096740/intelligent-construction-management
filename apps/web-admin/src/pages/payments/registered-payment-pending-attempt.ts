import type { RegisteredPaymentCommand, RegisteredProjectAdvanceConfirmation } from "../../api/registered-payment-execution.api";

export type PendingPaymentCommand = Omit<RegisteredPaymentCommand, "confirmationPassword">;
export interface PendingPaymentDraft { amountYuan:string;paidAt:string;scopeKey:string;treatment:string;reason:string;evidence:string;accountName:string;historyTreatment?:string;historyReason?:string;historyEvidence?:string;advance?:{confirmed:boolean;reason:string;evidence:string};allocations:Array<{sourceBatchId:string;amountYuan:string}> }
export interface PendingPaymentAttempt { version:1;phase:"prepared"|"sending";userId:string;paymentId:string;command:PendingPaymentCommand;draft:PendingPaymentDraft }
type StorageAccess = () => Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type PendingAttemptRead = {kind:"missing"}|{kind:"restored";attempt:PendingPaymentAttempt}|{kind:"unreadable";notice:string;blocksNewAttempt:boolean};

function storageKey(userId: string) { return `jiangkong-payment-pending:v1:${userId}`; }
// Only unfinished transport input is recoverable. No credentials, files,
// permissions or successful funds facts cross this explicit whitelist.
export function transportCommand(command: PendingPaymentCommand): PendingPaymentCommand {
 const history = command.contractHistoryConfirmation;
 const advance = command.confirmedProjectAdvance;
 return {...(advance ? { confirmedProjectAdvance: storedProjectAdvance(advance) } : {}),...(history ? {contractHistoryConfirmation:{treatment:history.treatment,expectedFingerprint:history.expectedFingerprint,reason:history.reason,evidence:history.evidence}} : {}),idempotencyKey:command.idempotencyKey,expectedPaymentUpdatedAt:command.expectedPaymentUpdatedAt,amountCents:command.amountCents,paidAt:command.paidAt,scopeKey:command.scopeKey,expectedRegistrationId:command.expectedRegistrationId,openingTreatment:command.openingTreatment,openingReason:command.openingReason,openingEvidence:command.openingEvidence,sourceAllocations:command.sourceAllocations.map(line=>({sourceBatchId:line.sourceBatchId,amountCents:line.amountCents}))};
}
function storedProjectAdvance(advance: RegisteredProjectAdvanceConfirmation): RegisteredProjectAdvanceConfirmation {
 return {
  amountCents: advance.amountCents, reason: advance.reason, evidence: advance.evidence,
  sourceAllocations: advance.sourceAllocations.map(line => ({ sourceBatchId: line.sourceBatchId, amountCents: line.amountCents }))
 };
}
export function makePendingPaymentAttempt(userId:string,paymentId:string,command:PendingPaymentCommand,draft:PendingPaymentDraft): PendingPaymentAttempt {
 return {version:1,phase:"prepared",userId,paymentId,command:transportCommand(command),draft:{amountYuan:draft.amountYuan,paidAt:draft.paidAt,scopeKey:draft.scopeKey,treatment:draft.treatment,reason:draft.reason,evidence:draft.evidence,accountName:draft.accountName,...(draft.historyTreatment!==undefined?{historyTreatment:draft.historyTreatment}:{}),...(draft.historyReason!==undefined?{historyReason:draft.historyReason}:{}),...(draft.historyEvidence!==undefined?{historyEvidence:draft.historyEvidence}:{}),...(draft.advance?{advance:{confirmed:draft.advance.confirmed,reason:draft.advance.reason,evidence:draft.advance.evidence}}:{}),allocations:draft.allocations.map(line=>({sourceBatchId:line.sourceBatchId,amountYuan:line.amountYuan}))}};
}
export function writePendingPaymentAttempt(attempt:PendingPaymentAttempt,storage:StorageAccess,expectedPrepared?:PendingPaymentAttempt):{saved:boolean;conflict:boolean;notice:string;prepared?:boolean} {
 const prepared=JSON.stringify(makePendingPaymentAttempt(attempt.userId,attempt.paymentId,attempt.command,attempt.draft));
 const sending=JSON.stringify({...JSON.parse(prepared),phase:"sending"});
 let target:ReturnType<StorageAccess>|undefined, sendingAttempted=false, priorAccepted=false;
 const key=storageKey(attempt.userId);
 // This runs synchronously before the payment API is invoked. Only the exact
 // marker just attempted may be restored; an unprovable result stays unknown.
 const restoreUnsent=()=>{
  try {
   if(!sendingAttempted||!target) return false;
   const current=target.getItem(key);
   if(current===prepared) return true;
   if(current!==sending) return false;
   target.setItem(key,prepared);
   return target.getItem(key)===prepared;
  } catch { return false; }
 };
 try {
  target=storage();
  const previous=target.getItem(key);
  const expected=expectedPrepared?.phase === "prepared" && expectedPrepared.userId===attempt.userId && expectedPrepared.paymentId===attempt.paymentId && expectedPrepared.command.idempotencyKey===attempt.command.idempotencyKey ? JSON.stringify(makePendingPaymentAttempt(expectedPrepared.userId,expectedPrepared.paymentId,expectedPrepared.command,expectedPrepared.draft)) : undefined;
  if(expectedPrepared && (!expected || previous!==expected)) return {saved:false,conflict:true,notice:"此前的未发送填写已变化，请重新检查恢复信息。"};
  if(previous!==null&&previous!==prepared&&previous!==expected) return {saved:false,conflict:true,notice:"浏览器中已有待确认登记，请先查询原请求。"};
  priorAccepted=true;
  target.setItem(key,prepared);
  if(target.getItem(key)!==prepared) return {saved:false,conflict:false,notice:"无法确认恢复信息已保存，本次未发送；请恢复浏览器存储后重试。"};
  sendingAttempted=true;
  target.setItem(key,sending);
  if(target.getItem(key)!==sending) {
   const restored=restoreUnsent();
   return {saved:false,conflict:!restored,prepared:restored,notice:restored?"本次未发送，恢复信息已保留，请重新核对后办理。":"恢复信息状态暂未确认，本次未发送；请重新检查原请求。"};
  }
  return {saved:true,conflict:false,notice:""};
 } catch {
  const restored=restoreUnsent();
  return {saved:false,conflict:!restored && !(priorAccepted && !sendingAttempted),prepared:restored,notice:restored?"本次未发送，恢复信息已保留，请重新核对后办理。":"浏览器暂时无法核验恢复信息，本次未发送；请恢复存储并重新检查。"};
 }
}
export function updatePreparedPaymentAttempt(expected:PendingPaymentAttempt,next:PendingPaymentAttempt,storage:StorageAccess):boolean {
 if(expected.phase!=="prepared"||next.phase!=="prepared"||expected.userId!==next.userId||expected.paymentId!==next.paymentId||expected.command.idempotencyKey!==next.command.idempotencyKey) return false;
 try {
  const target=storage(),key=storageKey(expected.userId);
  const oldValue=JSON.stringify(makePendingPaymentAttempt(expected.userId,expected.paymentId,expected.command,expected.draft));
  const newValue=JSON.stringify(makePendingPaymentAttempt(next.userId,next.paymentId,next.command,next.draft));
  const current=target.getItem(key);
  if(current===newValue) return true;
  if(current!==oldValue) return false;
  target.setItem(key,newValue);
  return target.getItem(key)===newValue;
 } catch { return false; }
}
export function discardPreparedPaymentAttempt(attempt:PendingPaymentAttempt,storage:StorageAccess):{cleared:boolean;removalCompleted:boolean;readbackUnavailable:boolean} {
 if(attempt.phase!=="prepared") return {cleared:false,removalCompleted:false,readbackUnavailable:false};
 let removalCompleted=false;
 try {
  const target=storage(),key=storageKey(attempt.userId),current=target.getItem(key);
  const expected=JSON.stringify(makePendingPaymentAttempt(attempt.userId,attempt.paymentId,attempt.command,attempt.draft));
  if(current!==expected) return {cleared:false,removalCompleted:false,readbackUnavailable:false};
  target.removeItem(key);removalCompleted=true;
  return {cleared:target.getItem(key)===null,removalCompleted:true,readbackUnavailable:false};
 } catch { return {cleared:false,removalCompleted,readbackUnavailable:removalCompleted}; }
}
export function clearPreparedPaymentAttempt(attempt:PendingPaymentAttempt,storage:StorageAccess):boolean {
 return discardPreparedPaymentAttempt(attempt,storage).cleared;
}
export function inspectPendingPaymentStorage(userId:string,storage:StorageAccess):"missing"|"present"|"unavailable" {
 try { return storage().getItem(storageKey(userId))===null ? "missing" : "present"; }
 catch { return "unavailable"; }
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
 catch { return {kind:"unreadable",notice:"浏览器暂时无法读取恢复信息，请恢复浏览器存储后重新检查，再办理付款。",blocksNewAttempt:true}; }
 if (saved === null) return {kind:"missing"};
 try {
  const pointer = JSON.parse(saved) as PendingPaymentAttempt;
  const command = pointer.command;
  const phase = pointer.phase === undefined ? "sending" : pointer.phase;
  if (phase !== "prepared" && phase !== "sending") throw new Error("Invalid transport phase");
  const fields = ["idempotencyKey","expectedPaymentUpdatedAt","amountCents","paidAt","scopeKey","expectedRegistrationId","openingReason","openingEvidence"] as const;
  if (pointer.version !== 1 || pointer.userId !== userId || typeof pointer.paymentId !== "string" || !command || fields.some(field=>typeof command[field] !== "string") || !["included","not_included"].includes(command.openingTreatment) || !Array.isArray(command.sourceAllocations) || command.sourceAllocations.some(line=>!line || typeof line.sourceBatchId !== "string" || typeof line.amountCents !== "string") || !pointer.draft || ["amountYuan","paidAt","scopeKey","treatment","reason","evidence","accountName"].some(field=>typeof (pointer.draft as unknown as Record<string,unknown>)[field] !== "string") || !Array.isArray(pointer.draft.allocations) || pointer.draft.allocations.some(line=>!line || typeof line.sourceBatchId !== "string" || typeof line.amountYuan !== "string")) throw new Error("Invalid transport pointer");
  const history = command.contractHistoryConfirmation;
  if (history && (history.treatment !== "not_included" || [history.expectedFingerprint,history.reason,history.evidence].some(value=>typeof value !== "string"))) throw new Error("Invalid history transport confirmation");
  const advance = command.confirmedProjectAdvance;
  if (advance !== undefined && (!advance || [advance.amountCents, advance.reason, advance.evidence].some(value => typeof value !== "string") ||
      !Array.isArray(advance.sourceAllocations) || advance.sourceAllocations.some(line => !line ||
        typeof line.sourceBatchId !== "string" || typeof line.amountCents !== "string"))) throw new Error("Invalid advance transport confirmation");
  const advanceDraft = pointer.draft.advance;
  if (advanceDraft !== undefined && (!advanceDraft || typeof advanceDraft.confirmed !== "boolean" || typeof advanceDraft.reason !== "string" ||
      typeof advanceDraft.evidence !== "string")) throw new Error("Invalid advance draft confirmation");
  const stored = transportCommand(command);
  if ([pointer.draft.historyTreatment,pointer.draft.historyReason,pointer.draft.historyEvidence].some(value=>value!==undefined && typeof value!=="string")) throw new Error("Invalid draft history");
  const draft: PendingPaymentDraft = {amountYuan:pointer.draft.amountYuan,paidAt:pointer.draft.paidAt,scopeKey:pointer.draft.scopeKey,treatment:pointer.draft.treatment,reason:pointer.draft.reason,evidence:pointer.draft.evidence,accountName:pointer.draft.accountName,...(pointer.draft.historyTreatment!==undefined?{historyTreatment:pointer.draft.historyTreatment}:{}),...(pointer.draft.historyReason!==undefined?{historyReason:pointer.draft.historyReason}:{}),...(pointer.draft.historyEvidence!==undefined?{historyEvidence:pointer.draft.historyEvidence}:{}),...(pointer.draft.advance?{advance:{confirmed:pointer.draft.advance.confirmed,reason:pointer.draft.advance.reason,evidence:pointer.draft.advance.evidence}}:{}),allocations:pointer.draft.allocations.map(line=>({sourceBatchId:line.sourceBatchId,amountYuan:line.amountYuan}))};
  return {kind:"restored",attempt:{version:1,phase,userId,paymentId:pointer.paymentId,command:stored,draft}};
 } catch { return {kind:"unreadable",notice:"浏览器保存的待确认信息暂时无法读取，请由有权财务或综合部主管核查原申请，暂勿重复登记。",blocksNewAttempt:true}; }
}

import {effectScope,reactive} from "vue";
import {beforeEach,describe,expect,it,vi} from "vitest";
import Panel from "./RegisteredPaymentExecutionPanel.vue";
import {RegisteredPaymentApiError} from "../../api/registered-payment-execution.api";
const runtime=vi.hoisted(()=>({record:vi.fn(),fetch:vi.fn(),query:vi.fn(),proof:vi.fn(),options:vi.fn(),funds:vi.fn(),user:{id:"user",globalRoleKeys:["finance_staff"]},mounted:[] as Array<()=>unknown>}));
vi.mock("vue",async original=>({...await original<typeof import("vue")>(),onMounted:(fn:()=>unknown)=>runtime.mounted.push(fn),onBeforeUnmount:()=>undefined,useSSRContext:()=>({modules:new Set<string>()})}));
vi.mock("vue-router",async original=>({...await original<typeof import("vue-router")>(),useRoute:()=>({fullPath:"/payments"})}));
vi.mock("../../auth/auth.store",()=>({useAuthStore:()=>({user:runtime.user})}));
vi.mock("../../api/api-fetch",()=>({apiFetch:runtime.fetch}));
vi.mock("../../api/registered-payment-execution.api",async original=>({...await original<typeof import("../../api/registered-payment-execution.api")>(),recordRegisteredPayment:runtime.record,fetchRegisteredPaymentResult:runtime.query,verifyRegisteredPaymentRecovery:runtime.proof,fetchRegisteredPaymentOptions:runtime.options}));
vi.mock("../../api/fund-account.api",async original=>({...await original<typeof import("../../api/fund-account.api")>(),fetchFundAccounts:runtime.funds}));
type Ref<T>={value:T};
type Bindings={startDiscardPrepared:()=>void;cancelDiscardPrepared:()=>void;confirmDiscardPrepared:()=>Promise<void>;discardPreparedVisible:Ref<boolean>;open:(item:unknown)=>Promise<void>;prepare:()=>void;form:{amountYuan:string;reason:string;evidence:string;treatment:string;password:string};submit:()=>Promise<void>;restorePendingAttempt:()=>Promise<boolean>;queryOriginal:()=>Promise<void>;retryStorageRecovery:()=>Promise<void>;uncertain:Ref<boolean>;storageReadBlocked:Ref<boolean>;storageNotice:Ref<string>;saving:Ref<boolean>;pendingAttempt:Ref<unknown>;selected:Ref<unknown>;registrationPermission:Ref<unknown>;registrationPermissionOwner:Ref<string>;registrationPermissionRoute:Ref<string>;frozenCommand:Ref<unknown>;preparedDraft:Ref<unknown>;commandUserId:Ref<string>;commandPaymentId:Ref<string>};
const command={idempotencyKey:"key",expectedPaymentUpdatedAt:"t",amountCents:"3000",paidAt:"2026-11-01",scopeKey:"company:a",expectedRegistrationId:"reg",openingTreatment:"not_included",openingReason:"reason",openingEvidence:"evidence",sourceAllocations:[],confirmationPassword:"private"};
const draft={amountYuan:"30",paidAt:command.paidAt,scopeKey:command.scopeKey,treatment:command.openingTreatment,reason:"reason",evidence:"evidence",accountName:"A",allocations:[]};
function setup(){const scope=effectScope();const result=scope.run(()=>(Panel as unknown as {setup:(p:object,c:{expose:()=>void;emit:()=>void})=>Bindings}).setup({},{expose(){},emit(){}}));if(!result)throw Error("setup");return {result,scope};}
function stubPaymentStorage(shared:Pick<Storage,"getItem"|"setItem"|"removeItem">){const legacy=new Map<string,string>();vi.stubGlobal("localStorage",shared);vi.stubGlobal("sessionStorage",{getItem:(k:string)=>legacy.get(k)??null,setItem:(k:string,v:string)=>legacy.set(k,v),removeItem:(k:string)=>legacy.delete(k)});vi.stubGlobal("navigator",{locks:{request:async (_name:string,_options:unknown,callback:()=>unknown)=>callback()}});}
runtime.user=reactive(runtime.user);
const flushStorage=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe("payment storage failure in panel",()=>{
 beforeEach(()=>{runtime.user.id="user";runtime.record.mockReset();runtime.query.mockReset();runtime.proof.mockReset();runtime.options.mockReset();runtime.funds.mockReset();runtime.mounted.length=0;});
 it("blocks payment with a clear notice when browser locking is unavailable",async()=>{
  stubPaymentStorage({getItem:()=>null,setItem(){},removeItem(){}});vi.stubGlobal("navigator",{});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(b.uncertain.value).toBe(true);expect(b.storageNotice.value).toContain("无法安全协调");scope.stop();vi.unstubAllGlobals();
 });
 it("serializes simultaneous independent panels for one account",async()=>{
  const values=new Map<string,string>();const shared={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};stubPaymentStorage(shared);
  let tail:Promise<unknown>=Promise.resolve();vi.stubGlobal("navigator",{locks:{request:(_name:string,_options:unknown,callback:()=>unknown)=>{const next=tail.then(callback);tail=next.catch(()=>{});return next;}}});
  let finish!:(value:never)=>void;runtime.record.mockImplementation(()=>new Promise((_resolve,reject)=>{finish=reject;}));const first=setup(),second=setup();
  for(const [b,key] of [[first.result,"key-a"],[second.result,"key-b"]] as const){const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value={...command,idempotencyKey:key};b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";}
  const a=first.result.submit(),b=second.result.submit();await flushStorage();expect(runtime.record).toHaveBeenCalledTimes(1);expect(second.result.uncertain.value).toBe(true);expect(JSON.parse(values.get("jiangkong-payment-pending:v1:user")!).command.idempotencyKey).toBe("key-a");finish(new Error("unknown") as never);await Promise.all([a,b]);first.scope.stop();second.scope.stop();vi.unstubAllGlobals();
 });
 it("does not migrate the former account while waiting for its lock",async()=>{
  const oldKey="jiangkong-payment-pending:v1:user", raw=JSON.stringify({userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft,phase:"sending"});
  const legacy=new Map([[oldKey,raw]]), shared=new Map<string,string>();
  vi.stubGlobal("sessionStorage",{getItem:(k:string)=>legacy.get(k)??null,setItem:(k:string,v:string)=>legacy.set(k,v),removeItem:(k:string)=>legacy.delete(k)});
  vi.stubGlobal("localStorage",{getItem:(k:string)=>shared.get(k)??null,setItem:(k:string,v:string)=>shared.set(k,v),removeItem:(k:string)=>shared.delete(k)});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  vi.stubGlobal("navigator",{locks:{request:async(name:string,_options:unknown,callback:()=>unknown)=>{if(name.endsWith(":user"))await held;return callback();}}});
  const {result:b,scope}=setup();const waiting=b.restorePendingAttempt();runtime.user.id="other-user";await flushStorage();release();await waiting;
  expect(legacy.get(oldKey)).toBe(raw);expect(shared.has(oldKey)).toBe(false);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("does not replace an unresolved request with another stored request",async()=>{
  const first=JSON.stringify({version:1,userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft,phase:"sending"});let stored=first;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored="";}});
  const {result:b,scope}=setup();await b.restorePendingAttempt();const original=b.pendingAttempt.value;stored=JSON.stringify({...JSON.parse(first),command:{...JSON.parse(first).command,idempotencyKey:"other"}});
  expect(await b.restorePendingAttempt()).toBe(false);expect(b.pendingAttempt.value).toBe(original);expect(b.uncertain.value).toBe(true);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("does not apply an earlier actor result after account switch",async()=>{
  const values=new Map<string,string>();stubPaymentStorage({getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}});
  let finish!:(value:unknown)=>void;runtime.record.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  const request=b.submit();await flushStorage();expect(runtime.record).toHaveBeenCalledTimes(1);runtime.user.id="other-user";await flushStorage();finish({id:"synthetic",amountCents:"3000"});await request;expect(b.pendingAttempt.value).toBeNull();expect(values.has("jiangkong-payment-pending:v1:user")).toBe(true);expect(values.has("jiangkong-payment-pending:v1:other-user")).toBe(false);scope.stop();vi.unstubAllGlobals();
 });
 it.each(["body unreadable", "original key conflict"])("preserves sending and queries original after %s",async kind=>{
  let stored:string|null=null;stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  const error=Object.assign(new RegisteredPaymentApiError(kind,409),{definitiveFailure:false});runtime.record.mockRejectedValue(error);runtime.query.mockResolvedValue({status:"unconfirmed"});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(b.uncertain.value).toBe(true);expect(JSON.parse(stored!).phase).toBe("sending");expect(runtime.record).toHaveBeenCalledTimes(1);await b.queryOriginal();expect(runtime.query).toHaveBeenCalledWith("key");expect(JSON.parse(stored!).phase).toBe("sending");scope.stop();vi.unstubAllGlobals();
 });
 it.each([{}, {id:"e",idempotencyKey:"other",paymentRequestId:"payment",amountCents:"3000",paidAt:"2026-10-31T16:00:00.000Z"}])("keeps original sending and enables query after an invalid success response %o",async response=>{
  let stored:string|null=null;stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  runtime.fetch.mockResolvedValue({ok:true,status:201,json:async()=>response});runtime.record.mockImplementation(async(...args)=>{const actual=await vi.importActual<typeof import("../../api/registered-payment-execution.api")>("../../api/registered-payment-execution.api");return actual.recordRegisteredPayment(...args as Parameters<typeof actual.recordRegisteredPayment>);});runtime.query.mockResolvedValue({status:"unconfirmed"});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(b.uncertain.value).toBe(true);expect(JSON.parse(stored!).phase).toBe("sending");await b.queryOriginal();expect(runtime.query).toHaveBeenCalledWith("key");expect(JSON.parse(stored!).phase).toBe("sending");scope.stop();vi.unstubAllGlobals();
 });
 it("clears the original pointer after a matching backend success",async()=>{
  let stored:string|null=null;stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});runtime.fetch.mockImplementation(async(path:string)=>({ok:true,status:201,json:async()=>path.endsWith("/registrations")?({id:"execution",idempotencyKey:"key",paymentRequestId:"payment",amountCents:"3000",paidAt:"2026-10-31T16:00:00.000Z"}):({items:[],total:0})}));runtime.record.mockImplementation(async(...args)=>{const actual=await vi.importActual<typeof import("../../api/registered-payment-execution.api")>("../../api/registered-payment-execution.api");return actual.recordRegisteredPayment(...args as Parameters<typeof actual.recordRegisteredPayment>);});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(stored).toBeNull();expect(b.uncertain.value).toBe(false);scope.stop();vi.unstubAllGlobals();
 });
 it.each(["different actor or funding", "missing execution ID"])("keeps recovery key when proof fails: %s",async scenario=>{
  const pointer={version:1,phase:"sending",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored=JSON.stringify(pointer);stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored="";}});
  runtime.query.mockResolvedValue({status:"recorded",execution:{...(scenario==="missing execution ID"?{}:{executionId:"exec"}),paymentId:"payment",amountCents:"3000",paidAt:"2026-11-01"}});runtime.proof.mockResolvedValue({status:"unconfirmed"});
  const {result:b,scope}=setup();await b.restorePendingAttempt();await b.queryOriginal();expect(stored).toBeTruthy();expect(b.uncertain.value).toBe(true);scope.stop();vi.unstubAllGlobals();
 });
 it.each([{status:"matched",executionId:"different"},{status:"matched",executionId:"exec"}])("uses authoritative proof and execution identity %o",async proof=>{
  const pointer={version:1,phase:"sending",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer);stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});runtime.query.mockResolvedValue({status:"recorded",execution:{executionId:"exec",paymentId:"payment",amountCents:"3000",paidAt:"2026-11-01"}});runtime.proof.mockResolvedValue(proof);runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});runtime.fetch.mockResolvedValue({ok:true,json:async()=>({items:[],total:0})});
  const {result:b,scope}=setup();await b.restorePendingAttempt();await b.queryOriginal();expect(runtime.proof).toHaveBeenCalledWith("payment",expect.objectContaining({idempotencyKey:"key",scopeKey:"company:a"}));expect(runtime.proof.mock.calls[0]![1]).not.toHaveProperty("confirmationPassword");if(proof.executionId==="exec"){expect(stored).toBeNull();expect(b.uncertain.value).toBe(false);}else{expect(stored).not.toBeNull();expect(b.uncertain.value).toBe(true);}scope.stop();vi.unstubAllGlobals();
 });
 it("releases a confirmed validation failure while retaining the editable draft",async()=>{
  let stored:string|null=null;stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});runtime.record.mockRejectedValue(new RegisteredPaymentApiError("金额不正确",400,undefined,undefined,true));
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(b.uncertain.value).toBe(false);expect(stored).toBeNull();expect(b.preparedDraft.value).toEqual(draft);expect(runtime.query).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("does not send and retains the draft when writing the recovery key fails",async()=>{
  let stored:string|null=null,available=false;stubPaymentStorage({getItem:()=>stored,setItem:(_key:string,value:string)=>{if(!available)throw Error("quota");stored=value;},removeItem(){stored=null;}});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t"};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(b.preparedDraft.value).toEqual(draft);expect(b.frozenCommand.value).toEqual(command);expect(b.saving.value).toBe(false);expect(b.storageNotice.value).toContain("本次未发送");
  available=true;runtime.record.mockRejectedValue(new Error("unconfirmed"));await b.submit();expect(runtime.record).toHaveBeenCalledTimes(1);expect(b.uncertain.value).toBe(true);expect(stored).toContain("key");scope.stop();vi.unstubAllGlobals();
 });
 it("recovers the unsent draft after a sending readback failure and refresh",async()=>{
  let stored:string|null=null,reads=0;stubPaymentStorage({getItem:()=>{reads++;if(reads===4)throw Error("temporary");return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}});
  const first=setup(),b=first.result;const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t"};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(JSON.parse(stored!).phase).toBe("prepared");first.scope.stop();
  const refreshed=setup();expect(await refreshed.result.restorePendingAttempt()).toBe(false);expect(refreshed.result.uncertain.value).toBe(false);expect(refreshed.result.pendingAttempt.value).not.toBeNull();refreshed.scope.stop();vi.unstubAllGlobals();
 });
 it("retains an in-memory prepared pointer after sending-marker compensation",async()=>{
  let stored:string|null=null,reads=0;stubPaymentStorage({getItem:()=>{reads++;if(reads===4)throw Error("temporary");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(JSON.parse(stored!).phase).toBe("prepared");expect(b.pendingAttempt.value).not.toBeNull();b.form.reason="补偿后的修改";await flushStorage();expect(JSON.parse(stored!).draft.reason).toBe("补偿后的修改");scope.stop();vi.unstubAllGlobals();
 });
 it("keeps the current draft when submit finds a different unknown request",async()=>{
  const old={version:1,phase:"sending",userId:"user",paymentId:"other",command:{...command,idempotencyKey:"old-key",confirmationPassword:undefined},draft:{...draft,reason:"旧记录"}};let stored:string|null=JSON.stringify(old);
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value={...draft,reason:"本页新填写"};b.commandUserId.value="user";b.commandPaymentId.value="payment";b.form.reason="本页新填写";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(b.form.reason).toBe("本页新填写");expect(stored).toBe(JSON.stringify(old));expect(b.uncertain.value).toBe(true);
  await b.retryStorageRecovery();expect(b.form.reason).toBe("本页新填写");expect(stored).toBe(JSON.stringify(old));expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("queries only the same conflicting sending request after explicit recheck",async()=>{
  const old={version:1,phase:"sending",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(old);
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});runtime.query.mockResolvedValue({status:"unconfirmed"});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",accounts:[]};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();await b.retryStorageRecovery();expect(runtime.query).toHaveBeenCalledWith("key");expect(runtime.record).not.toHaveBeenCalled();expect(b.uncertain.value).toBe(true);expect(stored).toBe(JSON.stringify(old));scope.stop();vi.unstubAllGlobals();
 });
 it("does not send when the saved pointer cannot be read back",async()=>{
  let reads=0;stubPaymentStorage({getItem:()=>{if(++reads===3)throw Error("readback denied");return null;},setItem(){},removeItem(){}});
  const {result:b,scope}=setup();const options={paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t"};b.selected.value=options;b.registrationPermission.value=options;b.registrationPermissionOwner.value="user";b.registrationPermissionRoute.value="/payments";b.frozenCommand.value=command;b.preparedDraft.value=draft;b.commandUserId.value="user";b.commandPaymentId.value="payment";
  await b.submit();expect(runtime.record).not.toHaveBeenCalled();expect(b.preparedDraft.value).toEqual(draft);expect(b.storageNotice.value).toContain("本次未发送");scope.stop();vi.unstubAllGlobals();
 });
 it("recovers an existing unknown key and queries it after storage returns",async()=>{
  let available=false;const pointer={version:1,userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};
  stubPaymentStorage({getItem:()=>{if(!available)throw Error("denied");return JSON.stringify(pointer);},setItem(){},removeItem(){}});
  runtime.query.mockResolvedValue({status:"unconfirmed"});const {result:b,scope}=setup();await b.restorePendingAttempt();available=true;await b.retryStorageRecovery();
  expect(runtime.query).toHaveBeenCalledWith("key");expect(runtime.record).not.toHaveBeenCalled();expect(b.uncertain.value).toBe(true);expect(b.pendingAttempt.value).not.toBeNull();scope.stop();vi.unstubAllGlobals();
 });
 it("restores a prepared draft only on its original payment after refresh",async()=>{
  let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft});
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});
  const {result:b,scope}=setup();expect(await b.restorePendingAttempt()).toBe(false);expect(b.uncertain.value).toBe(false);
  await b.open({paymentId:"other"});expect(runtime.options).not.toHaveBeenCalled();expect(stored).not.toBeNull();
  await b.open({paymentId:"payment"});expect(runtime.options).toHaveBeenCalledWith("payment");expect(stored).not.toBeNull();expect(b.form.amountYuan).toBe("30");b.form.reason="  修改后原因  ";await flushStorage();expect(JSON.parse(stored!).draft.reason).toBe("  修改后原因  ");expect(runtime.record).not.toHaveBeenCalled();scope.stop();const refreshed=setup();await refreshed.result.restorePendingAttempt();await refreshed.result.open({paymentId:"payment"});expect(refreshed.result.form.reason).toBe("  修改后原因  ");expect(stored).not.toBeNull();refreshed.scope.stop();vi.unstubAllGlobals();
 });
 it("restores a prepared draft with exact surrounding spaces",async()=>{
  const rawDraft={...draft,reason:"  原因  ",evidence:"  凭据  "};let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft:rawDraft});
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});const {result:b,scope}=setup();
  await b.restorePendingAttempt();await b.open({paymentId:"payment"});expect(stored).not.toBeNull();expect(b.form.reason).toBe(rawDraft.reason);expect(b.form.evidence).toBe(rawDraft.evidence);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("submits the edited prepared draft only after revalidation and keeps its original key",async()=>{
  let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft});
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,expectedPaymentUpdatedAt:"t",remainingAmountCents:"4000",contractHistoryBasis:{required:false},accounts:[{scopeKey:"company:a",name:"A",eligible:true,currentRegistrationId:"reg"}]});
  runtime.funds.mockResolvedValue({accounts:[{scopeKey:"company:a",currentRegistrationId:"reg",sources:[],balanceYuan:"100",asOfDate:"2026-11-01"}],projects:[],notice:""});runtime.record.mockRejectedValue(new Error("unknown"));
  const {result:b,scope}=setup();await b.restorePendingAttempt();await b.open({paymentId:"payment"});b.form.reason="  新原因  ";b.form.treatment="included";b.form.password="private";b.prepare();await b.submit();
  expect(runtime.record).toHaveBeenCalledTimes(1);expect(runtime.record.mock.calls[0][1]).toMatchObject({idempotencyKey:"key",openingReason:"新原因",openingTreatment:"included"});expect(JSON.parse(stored!).phase).toBe("sending");expect(b.uncertain.value).toBe(true);scope.stop();vi.unstubAllGlobals();
 });
 it("does not overwrite recovered storage while restoring into an existing panel",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft:{...draft,reason:"恢复原文"}};let stored:string|null=JSON.stringify(pointer),writes=0;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{writes++;stored=v;},removeItem:()=>{stored=null;}});
  const {result:b,scope}=setup();b.selected.value={paymentId:"payment",accounts:[]};b.form.reason="旧表单";await b.restorePendingAttempt();expect(b.form.reason).toBe("恢复原文");expect(stored).toBe(JSON.stringify(pointer));expect(writes).toBe(0);scope.stop();vi.unstubAllGlobals();
 });
 it("retries an unsaved edit without replacing the current form",async()=>{
  let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft}),fail=false;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{if(fail)throw Error("quota");stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});const {result:b,scope}=setup();await b.restorePendingAttempt();await b.open({paymentId:"payment"});fail=true;b.form.reason="未保存的新原因";await flushStorage();expect(b.uncertain.value).toBe(true);fail=false;await b.retryStorageRecovery();
  expect(b.form.reason).toBe("未保存的新原因");expect(JSON.parse(stored!).draft.reason).toBe("未保存的新原因");expect(b.uncertain.value).toBe(false);scope.stop();vi.unstubAllGlobals();
 });
 it("retains an unsaved edit when another record replaced its prepared preimage",async()=>{
  let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft}),fail=false;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{if(fail)throw Error("quota");stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});const {result:b,scope}=setup();await b.restorePendingAttempt();await b.open({paymentId:"payment"});fail=true;b.form.reason="本地未保存";await flushStorage();const changed=JSON.stringify({...JSON.parse(stored!),phase:"sending"});stored=changed;fail=false;await b.retryStorageRecovery();
  expect(b.form.reason).toBe("本地未保存");expect(stored).toBe(changed);expect(b.uncertain.value).toBe(true);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("never overwrites a sending record when the restored draft is edited",async()=>{
  let stored:string|null=JSON.stringify({version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft});let writes=0;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{writes++;stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});const {result:b,scope}=setup();await b.restorePendingAttempt();await b.open({paymentId:"payment"});
  const sending=JSON.stringify({...JSON.parse(stored!),phase:"sending"});stored=sending;const previousWrites=writes;b.form.reason="新输入";await flushStorage();
  expect(stored).toBe(sending);expect(writes).toBe(previousWrites);expect(b.uncertain.value).toBe(true);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it.each(["sending","other"] as const)("never clears a changed %s record while opening a prepared draft",async changed=>{
  const initial={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};
  let stored:string|null=JSON.stringify(initial);const replacement=changed==="sending"?{...initial,phase:"sending"}:{...initial,paymentId:"other",command:{...initial.command,idempotencyKey:"other-key"}};
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});
  runtime.options.mockResolvedValue({paymentId:"payment",canRegisterPayment:true,accounts:[]});runtime.funds.mockResolvedValue({accounts:[],projects:[],notice:""});const {result:b,scope}=setup();await b.restorePendingAttempt();stored=JSON.stringify(replacement);
  await b.open({paymentId:"payment"});expect(stored).toBe(JSON.stringify(replacement));expect(b.uncertain.value).toBe(true);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("requires explicit confirmation before discarding an unsent draft",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft:{...draft,reason:"原始填写"}};let stored:string|null=JSON.stringify(pointer);
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();expect(b.discardPreparedVisible.value).toBe(true);expect(stored).toBe(JSON.stringify(pointer));b.cancelDiscardPrepared();expect(stored).toBe(JSON.stringify(pointer));b.startDiscardPrepared();await b.confirmDiscardPrepared();expect(stored).toBeNull();expect(b.pendingAttempt.value).toBeNull();expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it.each(["sending","other","read-failure","delete-failure"] as const)("preserves the original draft when discard encounters %s",async changed=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),failRead=false,failDelete=false;
  stubPaymentStorage({getItem:()=>{if(failRead)throw Error("read");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{if(failDelete)throw Error("delete");stored=null;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();
  if(changed==="sending")stored=JSON.stringify({...pointer,phase:"sending"});if(changed==="other")stored=JSON.stringify({...pointer,paymentId:"other",command:{...pointer.command,idempotencyKey:"other-key"}});if(changed==="read-failure")failRead=true;if(changed==="delete-failure")failDelete=true;
  const before=stored;await b.confirmDiscardPrepared();expect(stored).toBe(before);expect(b.pendingAttempt.value).not.toBeNull();expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it.each(["sending","legacy"] as const)("never offers discard for a %s record",async phase=>{
  const pointer={version:1,...(phase==="sending"?{phase}:{}),userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),removals=0;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{removals++;stored=null;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();await b.confirmDiscardPrepared();expect(b.discardPreparedVisible.value).toBe(false);expect(removals).toBe(0);expect(stored).toBe(JSON.stringify(pointer));scope.stop();vi.unstubAllGlobals();
 });
 it("keeps the page locked and original text when deletion readback cannot be confirmed",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),removed=false;
  stubPaymentStorage({getItem:()=>{if(removed)throw Error("readback");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;removed=true;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();await b.confirmDiscardPrepared();
  expect(b.uncertain.value).toBe(true);expect(b.pendingAttempt.value).not.toBeNull();expect(b.form.reason).toBe(draft.reason);expect(b.storageNotice.value).toContain("无法确认");expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("finishes an explicitly confirmed discard after an uncertain delete reads back missing",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),readFailure=false,removals=0;
  stubPaymentStorage({getItem:()=>{if(readFailure)throw Error("readback");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;removals++;readFailure=true;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();await b.confirmDiscardPrepared();expect(b.uncertain.value).toBe(true);expect(b.pendingAttempt.value).not.toBeNull();readFailure=false;await b.retryStorageRecovery();expect(b.uncertain.value).toBe(false);expect(b.pendingAttempt.value).toBeNull();expect(removals).toBe(1);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("never finishes uncertain discard if any other record appears",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),readFailure=false,removals=0;
  stubPaymentStorage({getItem:()=>{if(readFailure)throw Error("readback");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;removals++;readFailure=true;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();await b.confirmDiscardPrepared();readFailure=false;const replacement=JSON.stringify({...pointer,phase:"sending"});stored=replacement;await b.retryStorageRecovery();expect(b.uncertain.value).toBe(true);expect(stored).toBe(replacement);expect(removals).toBe(1);stored=null;await b.retryStorageRecovery();expect(b.uncertain.value).toBe(true);expect(removals).toBe(1);expect(runtime.record).not.toHaveBeenCalled();scope.stop();vi.unstubAllGlobals();
 });
 it("does not report success when a completed removal reads back a record",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),removals=0;
  stubPaymentStorage({getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{removals++;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();await b.confirmDiscardPrepared();expect(b.uncertain.value).toBe(true);expect(stored).toBe(JSON.stringify(pointer));stored=null;await b.retryStorageRecovery();expect(b.uncertain.value).toBe(true);expect(removals).toBe(1);scope.stop();vi.unstubAllGlobals();
 });
 it("does not mark discard successful when deletion never executed",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),failed=false,removals=0;
  stubPaymentStorage({getItem:()=>{if(failed)throw Error("read");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{removals++;stored=null;}});const {result:b,scope}=setup();await b.restorePendingAttempt();b.startDiscardPrepared();failed=true;await b.confirmDiscardPrepared();stored=null;failed=false;await b.retryStorageRecovery();expect(removals).toBe(0);expect(b.uncertain.value).toBe(true);expect(b.pendingAttempt.value).not.toBeNull();scope.stop();vi.unstubAllGlobals();
 });
 it("cannot reconstruct an unconfirmed discard context after the component is destroyed",async()=>{
  const pointer={version:1,phase:"prepared",userId:"user",paymentId:"payment",command:{...command,confirmationPassword:undefined},draft};let stored:string|null=JSON.stringify(pointer),fail=false;
  stubPaymentStorage({getItem:()=>{if(fail)throw Error("readback");return stored;},setItem:(_k:string,v:string)=>{stored=v;},removeItem:()=>{stored=null;fail=true;}});const first=setup();await first.result.restorePendingAttempt();first.result.startDiscardPrepared();await first.result.confirmDiscardPrepared();expect(first.result.uncertain.value).toBe(true);first.scope.stop();fail=false;const refreshed=setup();expect(await refreshed.result.restorePendingAttempt()).toBe(false);expect(refreshed.result.pendingAttempt.value).toBeNull();refreshed.scope.stop();vi.unstubAllGlobals();
 });
 it("blocks an unreadable pointer and permits work after storage is readable and empty",async()=>{
  let available=false;stubPaymentStorage({getItem:()=>{if(!available)throw Error("denied");return null;},setItem(){},removeItem(){}});
  const {result:b,scope}=setup();expect(await b.restorePendingAttempt()).toBe(false);expect(b.uncertain.value).toBe(true);expect(b.storageReadBlocked.value).toBe(true);available=true;await b.retryStorageRecovery();expect(b.uncertain.value).toBe(false);expect(b.storageReadBlocked.value).toBe(false);scope.stop();vi.unstubAllGlobals();
 });
});

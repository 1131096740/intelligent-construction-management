'use strict';
// Fixed diagnostic data only. These projections never confer run authority.
const {types}=require('node:util');
const caseFailureCodes=new Set(['PAYMENT_INSTALL_ONCE_BUSINESS_AUTHORITY','PAYMENT_INSTALL_ONCE_BUSINESS_CONTINUITY',
 'PAYMENT_INSTALL_ONCE_ATTEMPT_CHANGED','PAYMENT_BUSINESS_PLAN_FILE','PAYMENT_INSTALL_PLAN_FILE',
 'CURRENT259_RESOURCE_CLOSED','CURRENT259_LOADER_CHANGED','CURRENT259_BUILD_CHANGED','CURRENT259_LIVE_SESSIONS_VERIFICATION',
 'CURRENT259_LIVE_SESSIONS_CONTINUITY','TASK16_APP_HANDLE','TASK16_APP_FAILED_CLOSED','TASK16_CURRENT259_CATALOG',
 'TASK16_FIXTURE_FAILED_CLOSED','P1001','P1002','P1008','P1010','P1011','P1017','P2002','P2003','P2010','P2024','P2025','P2028','P2034',
 'PG_CASE_ATTRIBUTION_GAP_BEFORE','PG_CASE_ATTRIBUTION_GAP_DISTINCT_SOURCES','PG_CASE_ATTRIBUTION_GAP_EXPECTED_CONFLICT',
 'PG_CASE_ATTRIBUTION_GAP_LEDGER_CHANGED','PG_CASE_ATTRIBUTION_GAP_OPTIONS','PG_CASE_ATTRIBUTION_GAP_ORIGINAL_RESULT',
 'PG_CASE_ATTRIBUTION_GAP_PUBLIC_BALANCES','PG_CASE_BEFORE_STATE','PG_CASE_CANCEL_BEFORE_STATE',
 'PG_CASE_CANCEL_DUPLICATE_POST','PG_CASE_CANCEL_HTTP_STATUS','PG_CASE_CANCEL_LEDGER_CHANGED',
 'PG_CASE_CANCEL_ORIGINAL_RESULT','PG_CASE_CANCEL_OWNER_CHANGED','PG_CASE_CANCEL_OWNER_PROOF',
 'PG_CASE_COMMITTED_AUDIT_ACTOR','PG_CASE_COMMITTED_AUDIT_FACTS','PG_CASE_COMMITTED_A_OWES_B_ROOT',
 'PG_CASE_COMMITTED_CAPACITY_BALANCE','PG_CASE_COMMITTED_EXECUTION_SCOPE','PG_CASE_COMMITTED_GRAPH_COUNTS',
 'PG_CASE_DISCONNECT_ATTEMPT','PG_CASE_DISCONNECT_ATTEMPT_USED','PG_CASE_DISCONNECT_DUPLICATE_POST',
 'PG_CASE_DISCONNECT_FAULT_OUTCOME','PG_CASE_DISCONNECT_HTTP_STATUS','PG_CASE_DISCONNECT_KEY_ALREADY_RESOLVED',
 'PG_CASE_DISCONNECT_LEDGER_CHANGED','PG_CASE_DISCONNECT_ORIGINAL_SCOPE','PG_CASE_DISCONNECT_RECOVERY_HTTP',
 'PG_CASE_DISCONNECT_REPLACEMENT_IDENTITY','PG_CASE_DISCONNECT_REPLACEMENT_SCOPE','PG_CASE_DISCONNECT_REQUIRES_OWNED_TRANSPORT',
 'PG_CASE_DISCONNECT_ROLLBACK_PROOF','PG_CASE_INITIAL_BALANCE_MUST_BE_KNOWN','PG_CASE_ORIGINAL_KEY_REPLAY_HTTP',
 'PG_CASE_POSTING_DIRECTION','PG_CASE_PUBLIC_OPTIONS','PG_CASE_PUBLIC_ORIGINAL_RESULT',
 'PG_CASE_REGISTRATION_HTTP_STATUS','PG_CASE_REPLAY_CANONICAL_SCOPE','PG_CASE_REPLAY_NO_SECOND_FINANCIAL_EFFECT',
 'PG_CASE_RESPONSE_LOSS_BOUNDARY','PG_CASE_RESPONSE_LOSS_REQUIRES_OWNED_TRANSPORT',
 'PG_COMPETITION_ACTORS','PG_COMPETITION_BEFORE','PG_COMPETITION_CAPACITY_BALANCES',
 'PG_COMPETITION_CLIENTS','PG_COMPETITION_COMMIT_GRAPH','PG_COMPETITION_FIXTURE',
 'PG_COMPETITION_FOLLOW_UP_ACTOR','PG_COMPETITION_FOLLOW_UP_EXECUTION','PG_COMPETITION_FOLLOW_UP_FIXTURE',
 'PG_COMPETITION_FOLLOW_UP_GRAPH','PG_COMPETITION_FOLLOW_UP_HTTP','PG_COMPETITION_FOLLOW_UP_INTENT',
 'PG_COMPETITION_FOLLOW_UP_LEDGER','PG_COMPETITION_FOLLOW_UP_OPTIONS','PG_COMPETITION_FOLLOW_UP_ORIGINAL_FACTS',
 'PG_COMPETITION_FOLLOW_UP_ORIGINAL_RESULT','PG_COMPETITION_FOLLOW_UP_RECORDED_ITEMS','PG_COMPETITION_FOLLOW_UP_REJECTED_RESULT',
 'PG_COMPETITION_FOLLOW_UP_REPLAY','PG_COMPETITION_FOLLOW_UP_REPLAY_LEDGER','PG_COMPETITION_FOLLOW_UP_RESULT',
 'PG_COMPETITION_FOLLOW_UP_SHARED_DONE','PG_COMPETITION_ONE_COMMIT','PG_COMPETITION_ONE_HTTP_WINNER',
 'PG_COMPETITION_OPTIONS','PG_COMPETITION_ORIGINAL_KEY_RESULT','PG_COMPETITION_PASSWORDS',
 'PG_COMPETITION_PID_BINDING','PG_COMPETITION_REAL_HTTP_LOGIN','PG_COMPETITION_SAME_INITIAL_VERSION',
 'PG_COMPETITION_SHARED_AFTER_COMMIT','PG_COMPETITION_SHARED_WORK','PG_FIXTURE_ATTRIBUTION_GAP',
 'PG_FIXTURE_ATTRIBUTION_GAP_SOURCES','PG_FIXTURE_CONSTRUCTION_ASSIGNMENT','PG_FIXTURE_CONSTRUCTION_PARTY',
 'PG_FIXTURE_IDENTITIES','PG_FIXTURE_INPUT','PG_FIXTURE_SEED_PROFILE',
 'PG_PREPARATION_DATE','PG_PREPARATION_DATE_ORDER','PG_PREPARATION_RUN_ID',
 'PG_RESOURCE_APPLICATION_PROOF','PG_RESOURCE_AUTHORIZATION_REQUIRED','PG_RESOURCE_DATABASE',
 'PG_RESOURCE_ENDPOINT','PG_RESOURCE_EXPECTED_IDENTITY','PG_RESOURCE_HTTP_ORIGIN',
 'PG_RESOURCE_INDEPENDENT_CLIENTS','PG_RESOURCE_INSTALLED_SQL_PROOF','PG_RESOURCE_ROLE_SEPARATION',
 'PG_RESOURCE_RUN_ID','PG_RESOURCE_SOURCE_SEAL','PG_RESOURCE_TRANSPORT',
 'PG_RESOURCE_IDENTITY','PG_RESOURCE_DATABASE_VERSION','PG_RESOURCE_ROLE_PID_BINDING','PG_RESOURCE_OBSERVER_READ_ONLY',
 'PG_RESOURCE_RUNTIME_PRIVILEGES','PG_RESOURCE_OBSERVER_PRIVILEGES','PG_RESOURCE_PREPARED_FUNCTIONS',
 'PG_RESOURCE_PREPARED_PROJECTION_TRIGGERS','PG_FIXTURE_REAL_HTTP_LOGIN','PG_FIXTURE_REAL_HTTP_OPENING',
 'PG_FIXTURE_AUTOMATIC_HISTORY_MARKER_REQUIRED','TIMEOUT','CURRENT259_PAYMENT_CASE_FAILED_CLOSED','CURRENT261_SEED_JSON_FAILED_CLOSED',
 'CURRENT259_BUSINESS_CONTINUITY','CURRENT259_LIVE_SESSIONS_FAILED_CLOSED','CURRENT259_OWNED_METHOD','CURRENT259_LOADER_HOOKS','CURRENT259_BUILD_ENVIRONMENT','TASK16_APP_RUNTIME_PROVIDER','TASK16_APP_IMPACT_READER_PROOF','TASK16_APP_ADDRESS','TASK16_APP_PRIOR_CHANGED','TASK16_APP_METHOD_CHANGED','TASK16_APP_ENVIRONMENT_CHANGED','TASK16_APP_STORAGE_CHANGED','PAYMENT_INSTALL_ONCE_IMPORT_CHANGED',
 'PG_RESOURCE_HTTP_ROUTE','PG_RESOURCE_HTTP_BUDGET','PG_RESOURCE_HTTP_TARGET_ORIGIN','PG_RESOURCE_SEED_HTTP_ROUTE','PG_RESOURCE_HTTP_TRANSPORT','PG_RESOURCE_HTTP_RESPONSE','PG_RESOURCE_HTTP_RESPONSE_ORIGIN',
 'HTTP_CONNECTION_REFUSED','HTTP_CONNECTION_RESET','HTTP_CONNECT_TIMEOUT','HTTP_RESPONSE_TIMEOUT','HTTP_SOCKET_CLOSED','HTTP_ABORTED']);
const phases=new Set(['ADMISSION_LOOKUP','APPLICATION_STATE','PROFILE_BINDING','SESSION_CONTINUITY','RESOURCE_LIFETIME',
 'RESOURCE_VIEW_SOURCE_METHODS','APP_METHOD_IDENTITY','APP_INSPECTION','LIVE_SESSION_LIGHT','LIVE_SESSION_CONTINUITY']);
const remembered=new WeakMap();
const caseGates=new Set(['COMPILED_CASE','PREPARED_CONTINUITY','PREPARED_SNAPSHOT','COMPILED_EXPORTS','HTTP_REQUEST_AUTHORITY','CASE_GATE_PROTOCOL',
 'CONNECTED_ROLES','OBSERVER_BEFORE','BEFORE_STATE','OPTIONS_REQUEST','OPTIONS_ASSERTION','REGISTRATION_REQUEST',
 'OBSERVER_AFTER','COMMITTED_ASSERTION','RESULT_REQUEST','RESULT_ASSERTION','REPLAY_REQUEST','OBSERVER_REPLAY','REPLAY_ASSERTION']);
const nativeKinds=new Map([[Error.prototype,'ERROR'],[TypeError.prototype,'TYPE_ERROR'],[RangeError.prototype,'RANGE_ERROR'],
 [ReferenceError.prototype,'REFERENCE_ERROR'],[SyntaxError.prototype,'SYNTAX_ERROR'],[URIError.prototype,'URI_ERROR'],
 [EvalError.prototype,'EVAL_ERROR'],[AggregateError.prototype,'AGGREGATE_ERROR']]);
const seedGates=new Set(['OPENING_A_REQUEST','OPENING_A_ASSERTION','OPENING_B_REQUEST','OPENING_B_ASSERTION']);
const errorKinds=new Set([...nativeKinds.values(),'OTHER_NATIVE_ERROR','NON_NATIVE_THROWN','UNINSPECTED']);
const isPaymentCaseGate=gate=>typeof gate==='string'&&caseGates.has(gate);
function paymentErrorKind(error){
 if(error&&typeof error==='object'&&types.isProxy(error))return 'UNINSPECTED';
 if(!types.isNativeError(error))return 'NON_NATIVE_THROWN';
 return nativeKinds.get(Object.getPrototypeOf(error))??'OTHER_NATIVE_ERROR';
}
function own(value,key){
 if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
}
const isPaymentFailureCode=code=>typeof code==='string'&&caseFailureCodes.has(code);
const observerPhases=new Set(['TX_START','SET_READ_ONLY','SNAPSHOT_ENTER','PAYMENT_REQUEST','SETTLEMENT','EXECUTIONS','FUNDING','ALLOCATIONS','EVENTS','ROOTS','FACTS','IMPACTS','AUDITS','OPENINGS','ACCOUNT_POSTINGS','TX_RETURN']);
const prismaClasses=new Map([['PrismaClientKnownRequestError','KNOWN_REQUEST_ERROR'],['PrismaClientUnknownRequestError','UNKNOWN_REQUEST_ERROR'],['PrismaClientValidationError','VALIDATION_ERROR'],['PrismaClientInitializationError','INITIALIZATION_ERROR']]);
const prismaCodes=new Set(['P1000','P1001','P1002','P1003','P1008','P1010','P1011','P1017','P2000','P2002','P2003','P2004','P2010','P2011','P2021','P2022','P2024','P2025','P2028','P2034']);
const registrationStatuses=new Set([200,201,400,401,403,404,409,422,429,500,503]);
const serverKinds=new Set([...errorKinds,'KNOWN_REQUEST_ERROR','UNKNOWN_REQUEST_ERROR','VALIDATION_ERROR','INITIALIZATION_ERROR']);
const sqlStates=new Set(['23502','23503','23505','42501','25006','25P02','40001','40P01','42P01','42703','57014']);
function filterPaymentDiagnostic(value){
 const guardPhase=own(value,'guardPhase'),originCode=own(value,'originCode'),caseGate=own(value,'caseGate'),errorKind=own(value,'errorKind'),seedGate=own(value,'seedGate');
 const observerPhase=own(value,'observerPhase'),prismaErrorClass=own(value,'prismaErrorClass'),prismaCode=own(value,'prismaCode'),sqlState=own(value,'sqlState');
 const status=own(value,'httpStatus'),expected=own(value,'expectedHttpStatus'),business=own(value,'businessErrorCode');
 const http=registrationStatuses.has(status)&&expected===201?{httpStatus:status,expectedHttpStatus:201,...(status===409&&business==='PAYMENT_RESULT_UNCONFIRMED'?{businessErrorCode:business}:{})}:{};
 const serverKind=own(value,'serverErrorKind'),serverCode=own(value,'serverPrismaCode'),serverState=own(value,'serverSqlState');
 const server=status===500&&expected===201&&serverKinds.has(serverKind)?{serverErrorKind:serverKind,
  ...((serverKind==='KNOWN_REQUEST_ERROR'||serverKind==='INITIALIZATION_ERROR')&&prismaCodes.has(serverCode)?{serverPrismaCode:serverCode}:{}),
  ...(serverKind==='KNOWN_REQUEST_ERROR'&&sqlStates.has(serverState)?{serverSqlState:serverState}:{})}:{};
 const timings={};if(observerPhases.has(observerPhase))for(const key of ['observerElapsedMs','txElapsedMs','lightCalls','lightElapsedMs','queryElapsedMs']){const n=own(value,key);if(Number.isInteger(n)&&n>=0&&n<=(key==='lightCalls'?128:3600000))timings[key]=n;}
 return Object.freeze({...http,...server,...((typeof guardPhase==='string'&&phases.has(guardPhase))?{guardPhase}:{}),
  ...(isPaymentFailureCode(originCode)?{originCode}:{}),...(isPaymentCaseGate(caseGate)?{caseGate}:{}),
  ...(typeof errorKind==='string'&&errorKinds.has(errorKind)?{errorKind}:{}),
  ...(typeof seedGate==='string'&&seedGates.has(seedGate)?{seedGate}:{}),
  ...(observerPhases.has(observerPhase)?{observerPhase,...timings}:{}),
  ...([...prismaClasses.values()].includes(prismaErrorClass)?{prismaErrorClass}:{}),
  ...(prismaCodes.has(prismaCode)?{prismaCode}:{}),...(sqlStates.has(sqlState)?{sqlState}:{})});
}
function describePaymentDiagnostic(error){
 if(!error||typeof error!=='object'||types.isProxy(error))return undefined;
 const prior=remembered.get(error);if(!types.isNativeError(error))return prior;
 if(own(error,'code')==='PG_CASE_REGISTRATION_HTTP_STATUS')return filterPaymentDiagnostic({...prior,httpStatus:own(error,'httpStatus'),expectedHttpStatus:own(error,'expectedHttpStatus'),businessErrorCode:own(error,'businessErrorCode')});
 const prismaErrorClass=prismaClasses.get(own(error,'name'));
 if(!prismaErrorClass)return prior;
 return filterPaymentDiagnostic({...prior,prismaErrorClass,prismaCode:own(error,'code'),sqlState:own(own(error,'meta'),'code')});
}
function carryPaymentDiagnostic(target,source,guardPhase){
 if(!target||typeof target!=='object'||types.isProxy(target)||remembered.has(target))return target;
 const prior=describePaymentDiagnostic(source),originCode=own(source,'code');
 const detail=filterPaymentDiagnostic(prior??{guardPhase,...(isPaymentFailureCode(originCode)?{originCode}:{})});
 if(Object.keys(detail).length)remembered.set(target,detail);
 return target;
}
module.exports=Object.freeze({isPaymentFailureCode,isPaymentCaseGate,paymentErrorKind,filterPaymentDiagnostic,describePaymentDiagnostic,carryPaymentDiagnostic});

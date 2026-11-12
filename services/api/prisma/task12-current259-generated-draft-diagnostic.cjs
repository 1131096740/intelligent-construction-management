'use strict';

const {types}=require('node:util');
const steps=Object.freeze(['LOGIN','CAPABILITY','CREATE','LEASE','WORKBENCH']);
const statuses=new Set([200,201,400,401,403,404,405,409,413,415,422,429,500,502,503,504]);
const admissionStages=new Set(['LOGIN_BEFORE','SEED_FIXTURE','SEED_BEFORE','SEED_WRITE','SEED_COMMITTED','SEED_CONTINUITY',
  'ROLE_WRITE','ROLE_COMMITTED','HBA_APPLY','HBA_COMMITTED','TLS_CA_FILES','TLS_ENDPOINT','TLS_CERTIFICATE',
  'TLS_PLAINTEXT_WINDOW','TLS_PLAINTEXT_EVIDENCE','TLS_COMMITTED','CONSUMER','FINAL_CONTINUITY',
  'APP_IMPORT','APP_MODULES','APP_PREPARE','APP_CONSTRUCT','APP_COMPILE','APP_CREATE','APP_SECURITY','APP_INIT',
  'APP_PROVIDER_TLS','APP_PROVIDER_CONNECT','APP_PROVIDER_IDENTITY','APP_LISTEN','APP_ADDRESS','APP_GENERATED_HTTP',
  'APP_CLOSE','APP_CLOSE_READBACK','APP_ENV_RESTORE',
  ...['WRONG_CA','WRONG_PASSWORD','PLAINTEXT','POSITIVE'].flatMap(kind=>
    ['CONSTRUCT','CONNECT','IDENTITY','DISCONNECT',...(kind==='POSITIVE'?[]:['DRAIN','CONTINUITY'])]
      .map(step=>'TLS_'+kind+'_'+step))]);
const admissionReasons=new Set(['ACL_PROFILE','ADDRESS','APP_CLIENTS','APP_CONSTRUCT','APP_CONTINUITY','APP_ENV','APP_IMPORT',
  'CA','CERTIFICATE','CLIENT','CLIENT_CHANGED','CLOSE','COMMITTED','CONNECT_TIMEOUT','CONSTRUCT_UNKNOWN','DESCRIPTOR',
  'DISCONNECT_UNKNOWN','ENVIRONMENT','GENERATED_HTTP','HANDLE','HBA','METHOD','MODULE','OUTPUT','PHYSICAL_ENDPOINT',
  'PROVIDERS','QUERY_TIMEOUT','SECRETS','SEED_COMMITTED','SEED_CONTINUITY','STORAGE','TIMEOUT','TLS_CONNECT',
  'TLS_IDENTITY','TLS_LIVE','TLS_NEGATIVE','TLS_PLAINTEXT_HBA','TLS_SESSION_CHANGED']);
const operationCodes=new Set(['CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','CURRENT259_LOOPBACK_FORWARD_CHILD',
  'CURRENT259_LOOPBACK_FORWARD_STREAM','CURRENT259_LOOPBACK_FORWARD_FRAME','CURRENT259_LOOPBACK_FORWARD_CLOSED',
  'CURRENT259_FRAMEWORK_CREATION_FAILED','CURRENT259_FRAMEWORK_CHANGED','CURRENT259_LOADER_CHANGED','CURRENT259_BUILD_CHANGED',
  'CURRENT259_CONTRACT_LOGIN_CA','CURRENT259_RESOURCE_CHANGED','CURRENT259_RESOURCE_TOOL_CHANGED',
  'CURRENT259_RESOURCE_IDENTITY','CURRENT259_RESOURCE_TLS','CURRENT259_RESOURCE_CLOSED','CURRENT259_RESOURCE_ABORTED',
  'TASK01_RESOURCE_COMMAND_FAILED','TASK01_RESOURCE_COMMAND_TIMEOUT','TASK01_RESOURCE_ABORTED_OR_TIMEOUT',
  'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED','TASK01_RESOURCE_OPERATION_FAILED',
  'TASK01_RESOURCE_CERTIFICATE_NOT_OBSERVED','TASK01_RESOURCE_CERTIFICATE_OBSERVATION_TIMEOUT',
  'TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED','TASK01_RESOURCE_CERTIFICATE_MODE_INVALID',
  'P1000','P1001','P1002','P1008','P1010','P1011','P1017','P2010','P2024']);
const relayCodes=new Set(['CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT',
  'CURRENT259_LOOPBACK_FORWARD_CHILD','CURRENT259_LOOPBACK_FORWARD_STREAM','CURRENT259_LOOPBACK_FORWARD_FRAME',
  'CURRENT259_LOOPBACK_FORWARD_CLOSED','CURRENT259_LOOPBACK_FORWARD_CONFIG','CURRENT259_LOOPBACK_FORWARD_LIMIT',
  'CURRENT259_LOOPBACK_FORWARD_ABORTED']);
const own=(value,key)=>value&&typeof value==='object'&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;

function projectGeneratedDraftHttpFailure(value){
  if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
  const step=Object.getOwnPropertyDescriptor(value,'step')?.value;
  if(!steps.includes(step))return undefined;
  const httpStatus=Object.getOwnPropertyDescriptor(value,'httpStatus')?.value;
  return Object.freeze({step,...(statuses.has(httpStatus)?{httpStatus}:{})});
}

function projectGeneratedDraftAdmissionFailure(value){
  const stage=own(value,'stage'),reason=own(value,'reason'),operationCode=own(value,'operationCode');
  const relayCode=own(value,'relayCode'),roleIndex=own(value,'roleIndex');
  if(!admissionStages.has(stage))return undefined;
  return Object.freeze({stage,...(admissionReasons.has(reason)?{reason}:{}),
    ...(operationCodes.has(operationCode)?{operationCode}:{}),
    ...(relayCodes.has(relayCode)?{relayCode}:{}),
    ...(Number.isInteger(roleIndex)&&roleIndex>=0&&roleIndex<5?{roleIndex}:{})});
}

function createGeneratedDraftAdmissionDiagnostic(){
  let stage='LOGIN_BEFORE',roleIndex,first;
  return Object.freeze({
    enter(next,index){stage=next;roleIndex=index;},
    capture(error,reason,operationError=error){
      const primary=own(error,'errorCode')??own(error,'code');
      return first??=projectGeneratedDraftAdmissionFailure({stage,reason,roleIndex,
        operationCode:operationCodes.has(primary)?primary:own(operationError,'errorCode')??own(operationError,'code'),
        relayCode:own(error,'relayCode')??own(operationError,'relayCode')});
    },
  });
}

module.exports=Object.freeze({generatedDraftHttpSteps:steps,projectGeneratedDraftHttpFailure,
  createGeneratedDraftAdmissionDiagnostic,projectGeneratedDraftAdmissionFailure});

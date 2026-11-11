'use strict';

const {types}=require('node:util');
const steps=Object.freeze(['LOGIN','CAPABILITY','CREATE','LEASE','WORKBENCH']);
const statuses=new Set([200,201,400,401,403,404,405,409,413,415,422,429,500,502,503,504]);

function projectGeneratedDraftHttpFailure(value){
  if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
  const step=Object.getOwnPropertyDescriptor(value,'step')?.value;
  if(!steps.includes(step))return undefined;
  const httpStatus=Object.getOwnPropertyDescriptor(value,'httpStatus')?.value;
  return Object.freeze({step,...(statuses.has(httpStatus)?{httpStatus}:{})});
}

module.exports=Object.freeze({generatedDraftHttpSteps:steps,projectGeneratedDraftHttpFailure});

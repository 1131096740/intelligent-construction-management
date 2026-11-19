'use strict';
const {types}=require('node:util');
const allowed=new Set(['INHERITED_UNKNOWN','CLOSE_HANDLE_MISSING','SERVER_LISTENING','CLOSE_FAILED','QUEUE_RESTORE_FAILED','ORDINARY_RESTORE_FAILED','BOUNDED_TIMEOUT_OBSERVED']);
const own=(object,key)=>Object.getOwnPropertyDescriptor(object,key)?.value;
function projectCleanupDiagnostics(error){
 try{
  for(let n=0; n<8&&error&&typeof error==='object'&&!types.isProxy(error); n++,error=own(error,'cause')){
   const values=own(error,'appCleanupDiagnostics');
   if(values===undefined)continue;
   if(!Array.isArray(values)||types.isProxy(values)||values.length<1||values.length>7)return undefined;
   const result=[];
   for(let i=0;i<values.length;i++){const value=own(values,String(i));if(!allowed.has(value)||result.includes(value))return undefined;result.push(value);}
   return result;
  }
 }catch{/* Diagnostic inspection must never replace the original failure. */}
 return undefined;
}
module.exports={projectCleanupDiagnostics};

'use strict';
const {types}=require('node:util');
const rosterColumns=Object.freeze(['id','projectId','userId','createdAt']);
const wageColumns=Object.freeze(['id','evidenceFileId']);
const archiveColumns=Object.freeze(['id','archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256','createdAt']);
const stages=new Set(['LEDGER_BEFORE','OWNER_BEFORE','MULTIPART_UPLOAD','ATTACH','REPEAT_UPLOAD','REPEAT_ATTACH','AUTHORIZED_TICKET','HTTP_DOWNLOAD','ORIGINAL_RESULT','RECORDED_ITEMS','OWNER_AFTER','STORAGE_BYTES','LEDGER_AFTER'].map(x=>'VOUCHER_'+x));
const lanes=new Set(['runtime_a','runtime_b']);
// No token retains a string literal, parameter value, comment or arbitrary SQL.
function tokenize(sql){
 const tokens=[];let unsafe=false,i=0;
 while(i<sql.length&&tokens.length<4096){
  const c=sql[i];if(/\s/u.test(c)){i++;continue;}
  if(sql.startsWith('--',i)){unsafe=true;const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
  if(sql.startsWith('/*',i)){unsafe=true;let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}continue;}
  if(c==="'"){unsafe=true;i++;while(i<sql.length){if(sql[i]==="'"){if(sql[i+1]==="'"){i+=2;continue;}i++;break;}i++;}tokens.push({kind:'opaque'});continue;}
  const dollar=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(i));
  if(dollar){unsafe=true;const end=sql.indexOf(dollar[0],i+dollar[0].length);i=end<0?sql.length:end+dollar[0].length;tokens.push({kind:'opaque'});continue;}
  if(c==='"'){
   let value='',closed=false;i++;while(i<sql.length){if(sql[i]==='"'){if(sql[i+1]==='"'){value+='"';i+=2;continue;}i++;closed=true;break;}value+=sql[i++];}
   if(!closed||value.length>128)unsafe=true;tokens.push({kind:'quoted',value});continue;
  }
  const parameter=/^\$[1-9][0-9]*/u.exec(sql.slice(i));if(parameter){tokens.push({kind:'parameter'});i+=parameter[0].length;continue;}
  const number=/^[0-9]+/u.exec(sql.slice(i));if(number){tokens.push({kind:'number'});i+=number[0].length;continue;}
  const word=/^[A-Za-z_][A-Za-z0-9_$]*/u.exec(sql.slice(i));if(word){tokens.push({kind:'word',value:word[0]});i+=word[0].length;continue;}
  const op=/^(?:<=|>=|<>|!=|[=<>])/u.exec(sql.slice(i));if(op){tokens.push({kind:'op',value:op[0]});i+=op[0].length;continue;}
  if('.,()*;'.includes(c)){tokens.push({kind:c});i++;continue;}
  unsafe=true;tokens.push({kind:'invalid'});i++;
 }
 if(i<sql.length)unsafe=true;return {tokens,unsafe};
}
const word=(t,value)=>t?.kind==='word'&&t.value.toUpperCase()===value;
function relationEnd(tokens,start,relation){
 if((tokens[start]?.kind==='quoted'||tokens[start]?.kind==='word')&&tokens[start]?.value==='public'&&tokens[start+1]?.kind==='.')start+=2;
 return tokens[start]?.kind==='quoted'&&tokens[start].value===relation?start+1:0;
}
function targetRelation(tokens){
 for(let i=0;i<tokens.length;i++)if(['FROM','JOIN','UPDATE','INTO','TRUNCATE','TABLE'].some(k=>word(tokens[i],k))){
  if(relationEnd(tokens,i+1,'WageApprovedSourceVersion'))return 'WageApprovedSourceVersion';
  if(relationEnd(tokens,i+1,'ProjectRosterMember'))return 'ProjectRosterMember';
  if(relationEnd(tokens,i+1,'ContractArchiveEvidenceFile'))return 'ContractArchiveEvidenceFile';
 }
}
// Only roster, archive discovery, and download-time wage evidence lookups are in scope.
// Aliases, COUNT, joins, nested queries and other syntax remain UNKNOWN.
function classify(tokens,relation){
 const archive=relation==='ContractArchiveEvidenceFile',wage=relation==='WageApprovedSourceVersion',columns=archive?archiveColumns:wage?wageColumns:rosterColumns;
 let p=0;const found=new Set(),bad=()=>{throw new Error('UNKNOWN');};
 const take=kind=>{if(tokens[p]?.kind!==kind)bad();p++;};
 const keyword=k=>{if(!word(tokens[p],k))bad();p++;};
 const publicName=()=>{if(!['word','quoted'].includes(tokens[p]?.kind)||tokens[p]?.value!=='public')bad();p++;take('.');};
 const tableName=()=>{if(tokens[p]?.kind!=='quoted'||tokens[p]?.value!==relation)bad();p++;};
 const ref=()=>{
  publicName();tableName();take('.');
  const t=tokens[p];if(t?.kind!=='quoted'||!columns.includes(t.value))bad();found.add(t.value);p++;
 };
 keyword('SELECT');ref();while(tokens[p]?.kind===','){p++;ref();}
 if(wage&&(found.size!==1||!found.has('id')))bad();
 keyword('FROM');publicName();tableName();keyword('WHERE');
 const parenthesized=tokens[p]?.kind==='(';if(parenthesized)p++;
 ref();if(tokens[p-1].value!==(archive?'fileId':wage?'evidenceFileId':'userId'))bad();
 if(tokens[p]?.kind!=='op'||tokens[p]?.value!=='=')bad();p++;take('parameter');
 if(parenthesized)take(')');
 if(archive||wage){keyword('LIMIT');take('parameter');}
 if(word(tokens[p],'OFFSET')){p++;take('parameter');}
 if(tokens[p]?.kind===';')p++;if(p!==tokens.length)bad();
 return {operation:'SELECT',columns:columns.filter(c=>found.has(c))};
}
function projectNativeTask16RosterQuery(event,lane,stage){
 if(!lanes.has(lane)||!stages.has(stage)||!event||typeof event!=='object'||types.isProxy(event))return null;
 const d=Object.getOwnPropertyDescriptor(event,'query');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||Buffer.byteLength(d.value)>32768)return null;
 const {tokens,unsafe}=tokenize(d.value),relation=targetRelation(tokens);if(!relation||(relation==='WageApprovedSourceVersion'&&stage!=='VOUCHER_HTTP_DOWNLOAD'))return null;
 let shape={operation:'UNKNOWN',columns:[],unknownShape:true};
 try{if(!unsafe)shape={...classify(tokens,relation),unknownShape:false};}catch{/* Unknown query shapes never justify extra authority. */}
 return Object.freeze({lane,stage,relation,...shape,columns:Object.freeze(shape.columns)});
}
function nativeTask16VoucherQueryLogOptions(purpose,lane){
 if(purpose!=='TASK16_NATIVE_COMPETITION_VOUCHER_V1'||!lanes.has(lane))return undefined;
 return Object.freeze({log:Object.freeze([Object.freeze({emit:'event',level:'query'})])});
}
function createNativeTask16RosterQueryDiagnostic(receipt,getStage){
 const events=[];
 return Object.freeze({forLane(lane){
  if(!lanes.has(lane))return undefined;
  return event=>{
   // Event handling must never replace or suppress the real SDK/business error.
   try{
    const projection=projectNativeTask16RosterQuery(event,lane,getStage());if(!projection)return;
    const overflow=events.length===12;if(!overflow)events.push(projection);
    receipt.voucherRosterQueries=Object.freeze({events:Object.freeze([...events]),overflow});
   }catch{/* This diagnostic has no authority over business execution. */}
  };
 }});
}
module.exports=Object.freeze({projectNativeTask16RosterQuery,nativeTask16VoucherQueryLogOptions,createNativeTask16RosterQueryDiagnostic});

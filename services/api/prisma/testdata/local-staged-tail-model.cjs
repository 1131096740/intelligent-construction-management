"use strict";
// Explicit synthetic resource-port model. Never a catalog producer or native issuer.
const {createHash}=require('node:crypto');
const digest=x=>createHash('sha256').update(x).digest('hex');
const produced213=new Set(['jg_contract_direct_review_retention_binding_v1','jg_contract_direct_archive_binding_v1','jg_contract_direct_archive_retention_binding_v1']);
function config(sql){const match=/WITH cfg AS \(SELECT '((?:''|[^'])*)'::jsonb AS p\)/u.exec(sql);if(!match)throw new Error('synthetic tail config missing');return JSON.parse(match[1].replaceAll("''","'"));}
function wasPresent(t,stage){return stage===213&&t.kind==='column'&&t.object==='ContractVersion'&&!['supersedesVersionId','firstSubmittedAt','endedAt'].includes(t.member);}
function observe(sql,phase){
 const cfg=config(sql),stage=cfg.stage,staged=phase.endsWith('-supply'),committed=phase.endsWith('-readback'),mode=staged?'staged':committed?'committed':'before';
 const app=cfg.appOid,owner=cfg.identity.actorOid;const objectIds=new Map();let nextOid=40000;
 const objectOid=object=>{if(!objectIds.has(object))objectIds.set(object,String(nextOid++));return objectIds.get(object);};
 const specs=[];for(const t of cfg.targets){for(const role of new Set(t.recipients==='file'?[...cfg.fileCallerOids,app]:[app]))if(role!==owner)specs.push({...t,roleOid:role});}
 const unique=[...new Map(specs.map(t=>[JSON.stringify([t.kind,t.table,t.member,t.privilege,t.roleOid]),t])).values()].sort((a,b)=>{for(const k of ['kind','table','member','privilege'])if(a[k]!==b[k])return a[k]<b[k]?-1:1;return Number(a.roleOid)-Number(b.roleOid);});
 const targetRows=unique.map(t=>{const value={kind:t.kind,object:t.table,member:t.member,privilege:t.privilege,roleOid:t.roleOid};return {...value,objectOid:objectOid(t.table),attnum:t.kind==='column'?1+[...new Set(unique.filter(x=>x.table===t.table).map(x=>x.member))].sort().indexOf(t.member):0,typeOid:t.kind==='column'?'25':'0',effective:mode!=='before'||wasPresent(value,stage),grantable:false,direct:mode!=='before'&&!wasPresent(value,stage)?[[owner,t.roleOid,t.privilege,false]]:[]};});
 const catalogKey=t=>JSON.stringify([t.kind,t.objectOid,t.attnum]);
 const touched=new Set(targetRows.filter(t=>!wasPresent(t,stage)).map(catalogKey));
 for(const t of targetRows)t.catalogXmin=mode!=='before'&&touched.has(catalogKey(t))?String(1000+stage):'100';
 const bindings=cfg.bindings.slice().sort((a,b)=>a.name<b.name?-1:1).map(b=>({name:b.name,oid:objectOid(b.name),owner,kind:'r',persistence:'p',rls:false,forceRls:false,rows:Array.from({length:stage===213&&mode!=='before'&&produced213.has(b.name)?1:b.count},()=>({sha256:digest(b.name),xmin:produced213.has(b.name)?'1213':'100'}))}));
 const required=cfg.required.slice().sort().map(key=>{const [object,member,privilege]=key.split('/');const found=targetRows.find(t=>t.kind==='column'&&t.object===object&&t.member===member&&t.privilege===privilege);return {key,objectOid:objectOid(object),attnum:found?.attnum??100,typeOid:'25',effective:mode!=='before'||!found||found.effective};});
 return {scope:{stage,phase:mode,nonce:cfg.nonce,runId:cfg.runId,sourceSha256:cfg.sourceSha256},identity:{...cfg.identity,actor:'jiangkong',sessionActor:'jiangkong',version:160015,encoding:'UTF8',replication:'origin',backendPid:stage+(staged?20000:committed?30000:10000),backendStart:`2026-11-11T01:${staged?'02':committed?'03':'01'}:00.000001Z`,readOnly:!staged},ledger:cfg.ledger,
 pending:{appOid:app,fileCallerOids:cfg.fileCallerOids,databaseOid:cfg.identity.databaseOid,namespaceOid:cfg.identity.namespaceOid,ownerOid:owner,relationOid:bindings.find(b=>b.name==='jg_contract_direct_pending_binding_v1').oid,sha256:digest('jg_contract_direct_pending_binding_v1')},
 appTablePrivileges:bindings.filter(b=>b.name!=='jg_contract_direct_pending_binding_v1'&&(b.rows.length===1||b.name==='jg_contract_direct_archive_generation_v1')).map(b=>({kind:'table',object:b.name,objectOid:b.oid,privilege:'SELECT',grantable:false})),
 app:{oid:app,name:extractAppName(sql),login:true,limit:0,passwordAbsent:true,superuser:false,inherit:false,createRole:false,createDb:false,replication:false,bypassRls:false,memberships:0,createSchema:false},roleSha256:'1'.repeat(64),catalogSha256:'2'.repeat(64),protectedAclSha256:'3'.repeat(64),bindings,targets:targetRows,required,locks:cfg.locks.slice().sort().map(table=>({table,effective:true})),writeXid:staged?String(1000+stage):null,commitStatus:committed?'committed':null};
}
function extractAppName(sql){const match=/jg_fixture_app_[a-f0-9]{24}/u.exec(sql);if(!match)throw new Error('synthetic app name missing');return match[0];}
module.exports={observe,config};

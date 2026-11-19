"use strict";

const relations=[
 ["ContractDraftAttachment","63001"],["ContractVersion","63002"],
 ["FileObject","63003"],["jg_contract_direct_pending_binding_v1","63004"]
];

function trigger(table,id,name,options={}){
 const relation=relations.find(row=>row[0]===table)[1];
 return {table,id,row:{
  oid:id,tgrelid:relation,tgname:name,tgfoid:"63100",tgtype:23,tgenabled:"O",
  tgisinternal:false,tgparentid:0,tgconstraint:0,tgconstrrelid:0,tgconstrindid:0,
  tgdeferrable:false,tginitdeferred:false,tgnargs:0,tgargs:"",tgattr:[],
  tgqual:null,tgoldtable:null,tgnewtable:null,...options
 }};
}

function scope(phase){
 const witness={
  relations:relations.map(([table,id])=>({table,id,row:{relowner:"10000",relkind:"r",relrowsecurity:false,relforcerowsecurity:false}})),
  columns:relations.map(([table,id])=>({table,id:"1",row:{attrelid:id,attnum:1,attname:"id",atttypid:25}})),
  indexes:[{table:"FileObject",id:"63110",row:{indrelid:"63003",indexrelid:"63110",indisprimary:true}}],
  constraints:[{table:"FileObject",id:"63120",row:{oid:"63120",conrelid:"63003",confrelid:0,contype:"p"}}],
  triggers:[trigger("ContractDraftAttachment","63130","jg_direct_pending_attachment_source")]
 };
 if(phase==="first")return witness;
 witness.triggers.push(trigger("ContractVersion","63131","jg_task16_runtime_version_read_only",{tgtype:19,tgenabled:"A"}));
 if(phase==="baseline")return witness;
 witness.constraints.push({table:"FileObject",id:"63121",row:{
  oid:"63121",conname:"RegisteredPaymentVoucher_fileId_fkey",conrelid:"63005",confrelid:"63003",conindid:"63110",
  contype:"f",conkey:[2],confkey:[1],confdeltype:"r",confupdtype:"r",confmatchtype:"s",
  convalidated:true,condeferrable:false,condeferred:false,conparentid:0
 }});
 witness.triggers.push(trigger("FileObject","63132","RegisteredPaymentVoucher_file_immutable",{tgtype:27}));
 for(const [id,type] of [["63133",9],["63134",17]]){
  witness.triggers.push(trigger("FileObject",id,"RI_ConstraintTrigger_a_"+id,{
   tgtype:type,tgisinternal:true,tgconstraint:"63121",tgconstrrelid:"63005",tgconstrindid:"63110"
  }));
 }
 return witness;
}
const delta=phase=>phase==="baseline"?{versionGuard:"63131"}:
 {voucherGuard:"63132",foreignKey:"63121",restrictDelete:"63133",restrictUpdate:"63134"};
const REGISTRY="jg_file_business_binding_columns";
const ALIAS="jg_file_business_binding_columns_before_registered_payment";
const oldRegistryBody=" SELECT * FROM public.jg_file_business_binding_columns_before_contract_archive_v2() UNION ALL VALUES ('ContractArchiveEvidenceFile','fileId',TRUE); ";
const newRegistryBody="\n SELECT * FROM public.jg_file_business_binding_columns_before_registered_payment()\n UNION ALL VALUES ('RegisteredPaymentVoucher','fileId',TRUE);\n";

function registry(phase){
 const owner="10000",publicNamespace="2200";
 const ownerGrant=[owner,owner,"EXECUTE",false],publicGrant=[owner,"0","EXECUTE",false];
 const priorGrant=[owner,"30000","EXECUTE",true],defaultGrant=[owner,"30001","EXECUTE",true];
 const beforeReset=phase==="first",afterSeven=phase==="seven";
 const rawOld=["jg_task01_owner=X/jg_task01_owner","third_party=X*/jg_task01_owner"];
 const rawGlobal=["jg_task01_owner=X/jg_task01_owner"];
 const rawLocal=["default_party=X*/jg_task01_owner"];
 const rawNew=[...rawGlobal,...rawLocal];
 const routine=(oid,name,source,config,rawAcl,acl)=>({
  oid, name, config, rawAcl, acl, shapeVerified:true,
  definition:{pronamespace:publicNamespace,proowner:owner,prosrc:source,prolang:"14",proretset:true,prosecdef:false}
 });
 const original=routine("63200",afterSeven?ALIAS:REGISTRY,oldRegistryBody,
  afterSeven?["search_path=pg_catalog, public, pg_temp"]:null,beforeReset?["=X/jg_task01_owner",...rawOld]:rawOld,
  beforeReset?[publicGrant,ownerGrant,priorGrant]:[ownerGrant,priorGrant]);
 return {
  namespaceOid:publicNamespace, ownerOid:owner,
  publicRoutine:afterSeven?routine("63201",REGISTRY,newRegistryBody,["search_path=pg_catalog, public, pg_temp"],rawNew,[ownerGrant,defaultGrant]):original,
  alias:afterSeven?original:null,
  globalDefault:beforeReset?null:{oid:"63202",rawAcl:rawGlobal,acl:[ownerGrant]},
  publicDefault:{oid:"63203",rawAcl:rawLocal,acl:[defaultGrant]}
 };
}
module.exports={scope,delta,trigger,registry};

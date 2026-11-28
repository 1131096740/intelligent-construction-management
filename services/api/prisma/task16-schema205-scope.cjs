"use strict";

const tables=["ContractDraftAttachment","ContractVersion","FileObject","jg_contract_direct_pending_binding_v1"];
const kinds=["relations","columns","indexes","constraints","triggers"];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const oid=value=>(typeof value==="string"||Number.isSafeInteger(value))&&/^[1-9][0-9]*$/u.test(String(value));
const sameOid=(left,right)=>String(left)===String(right);
const emptyOid=value=>String(value)==="0";
const voucherFk="RegisteredPaymentVoucher_fileId_fkey";
const voucherGuard="RegisteredPaymentVoucher_file_immutable";
const versionGuard="jg_task16_runtime_version_read_only";

// Full structural rows for the four fixed relations, including inbound FKs.
// Attribute ACLs have a separate B5/B6 witness and are subject to the B5 reset.
function schema205ScopeSql(){
 const scope="c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relname IN ("+tables.map(quote).join(",")+")";
 const aggregate=(source,id,row)=>`(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'id',${id}::text,'row',${row}) ORDER BY c.relname,${id}),'[]'::jsonb) FROM pg_catalog.pg_class c ${source} WHERE ${scope})`;
 return `pg_catalog.jsonb_build_object(
 'relations',${aggregate("","c.oid","pg_catalog.jsonb_build_object('relowner',c.relowner,'relkind',c.relkind,'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity)")},
 'columns',${aggregate("JOIN pg_catalog.pg_attribute x ON x.attrelid=c.oid AND x.attnum>0 AND NOT x.attisdropped LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=x.attrelid AND d.adnum=x.attnum","x.attnum","(pg_catalog.to_jsonb(x)-'attacl')||pg_catalog.jsonb_build_object('defaultOid',d.oid,'defaultNode',d.adbin::text)")},
 'indexes',${aggregate("JOIN pg_catalog.pg_index x ON x.indrelid=c.oid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid","x.indexrelid","pg_catalog.to_jsonb(x)||pg_catalog.jsonb_build_object('indexName',i.relname,'indexOwner',i.relowner,'indexNamespace',i.relnamespace)")},
 'constraints',${aggregate("JOIN pg_catalog.pg_constraint x ON x.conrelid=c.oid OR (x.contype='f' AND x.confrelid=c.oid)","x.oid","pg_catalog.to_jsonb(x)")},
 'triggers',${aggregate("JOIN pg_catalog.pg_trigger x ON x.tgrelid=c.oid","x.oid","(pg_catalog.to_jsonb(x)-'tgargs')||pg_catalog.jsonb_build_object('tgargs',pg_catalog.encode(x.tgargs,'hex'))")})`;
}

const noFilters="t.tgparentid=0 AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0 AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND NOT t.tgdeferrable AND NOT t.tginitdeferred";
const ordinaryTrigger="NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgconstrrelid=0 AND t.tgconstrindid=0";
const fixedRoutine="p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_owner') AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND p.prorettype='pg_catalog.trigger'::regtype AND p.prokind='f' AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset AND p.provolatile='v' AND p.proparallel='u'";

function schema205BaselineDeltaSql(body){
 return `(SELECT pg_catalog.jsonb_build_object('versionGuard',t.oid::text) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgrelid='public."ContractVersion"'::regclass AND t.tgname='${versionGuard}' AND t.tgtype=19 AND t.tgenabled='A'
 AND ${ordinaryTrigger} AND ${noFilters} AND p.oid=pg_catalog.to_regprocedure('public.${versionGuard}()') AND ${fixedRoutine}
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.prosrc=${quote(body)})`;
}

function schema205SevenDeltaSql(){
 const action=(type,name)=>`(SELECT t.oid::text FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid=k.confrelid AND t.tgconstraint=k.oid AND t.tgconstrrelid=k.conrelid AND t.tgconstrindid=k.conindid
 AND t.tgfoid=pg_catalog.to_regprocedure('pg_catalog."${name}"()') AND t.tgtype=${type} AND t.tgenabled='O' AND t.tgisinternal AND ${noFilters})`;
 const guard=`(SELECT t.oid::text FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgrelid=k.confrelid AND t.tgname='${voucherGuard}' AND t.tgtype=27 AND t.tgenabled='O' AND ${ordinaryTrigger} AND ${noFilters}
 AND p.oid=pg_catalog.to_regprocedure('public.jg_registered_payment_voucher_file_immutable()') AND ${fixedRoutine}
 AND p.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
 AND pg_catalog.encode(public.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='91b57f66e67bb1d888d1d0e8803cabbe08c289b01d2a6e810bfa69fe82a48d62')`;
 return `(SELECT pg_catalog.jsonb_build_object('foreignKey',k.oid::text,'voucherGuard',${guard},
 'restrictDelete',${action(9,"RI_FKey_restrict_del")},'restrictUpdate',${action(17,"RI_FKey_restrict_upd")})
 FROM pg_catalog.pg_constraint k
 JOIN pg_catalog.pg_attribute src ON src.attrelid=k.conrelid AND src.attname='fileId' AND src.attnum>0 AND NOT src.attisdropped AND src.atttypid=25
 JOIN pg_catalog.pg_attribute dst ON dst.attrelid=k.confrelid AND dst.attname='id' AND dst.attnum>0 AND NOT dst.attisdropped AND dst.atttypid=25
 JOIN pg_catalog.pg_index idx ON idx.indexrelid=k.conindid AND idx.indrelid=k.confrelid AND idx.indisprimary AND idx.indisvalid AND idx.indisready AND idx.indnatts=1 AND idx.indkey[0]=dst.attnum
 WHERE k.conname='${voucherFk}' AND k.conrelid=pg_catalog.to_regclass('public."RegisteredPaymentVoucher"') AND k.confrelid='public."FileObject"'::regclass
 AND k.contype='f' AND k.conkey=ARRAY[src.attnum] AND k.confkey=ARRAY[dst.attnum] AND k.confdeltype='r' AND k.confupdtype='r' AND k.confmatchtype='s'
 AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conparentid=0)`;
}

function schema205ScopeValid(value){
 if(!value||Object.keys(value).length!==kinds.length||!kinds.every(kind=>Array.isArray(value[kind])))return false;
 if(value.relations.length!==tables.length)return false;
 const relations=new Map(value.relations.map(entry=>[entry?.table,entry]));
 if(!tables.every(table=>{
  const entry=relations.get(table),row=entry?.row;
  return oid(entry?.id)&&row?.relkind==="r"&&row.relrowsecurity===false&&row.relforcerowsecurity===false&&oid(row.relowner);
 })||new Set(value.relations.map(entry=>entry.id)).size!==tables.length)return false;
 for(const kind of kinds.slice(1)){
  const rows=value[kind],seen=new Set();
  for(const entry of rows){
   const owner=relations.get(entry?.table)?.id,row=entry?.row,key=entry?.table+"#"+entry?.id;
   if(!owner||!oid(entry.id)||!row||Array.isArray(row)||seen.has(key))return false;
   seen.add(key);
   if(kind==="columns"&&(!sameOid(row.attrelid,owner)||!sameOid(row.attnum,entry.id)||typeof row.attname!=="string"||!oid(row.atttypid)))return false;
   if(kind==="indexes"&&(!sameOid(row.indrelid,owner)||!sameOid(row.indexrelid,entry.id)))return false;
   if(kind==="constraints"&&(!sameOid(row.oid,entry.id)||!(sameOid(row.conrelid,owner)||(row.contype==="f"&&sameOid(row.confrelid,owner)))))return false;
   if(kind==="triggers"&&(!sameOid(row.oid,entry.id)||!sameOid(row.tgrelid,owner)||!oid(row.tgfoid)||typeof row.tgname!=="string"))return false;
  }
 }
 return tables.every(table=>value.columns.some(entry=>entry.table===table));
}

function schema205ScopesMatch(first,observed){
 return schema205ScopeValid(first)&&schema205ScopeValid(observed)
  &&kinds.every(kind=>JSON.stringify(first[kind])===JSON.stringify(observed[kind]));
}

function stageTrigger(entry,type,enabled,internal){
 const row=entry?.row;
 return row?.tgtype===type&&row.tgenabled===enabled&&row.tgisinternal===internal
  &&row.tgnargs===0&&row.tgargs===""&&Array.isArray(row.tgattr)&&row.tgattr.length===0&&row.tgqual===null
  &&row.tgoldtable===null&&row.tgnewtable===null&&emptyOid(row.tgparentid)&&row.tgdeferrable===false&&row.tginitdeferred===false;
}
const ordinaryRow=row=>["tgconstraint","tgconstrrelid","tgconstrindid"].every(key=>emptyOid(row[key]));

function schema205ScopeTransitionMatches(first,observed,delta,phase){
 if(!schema205ScopeValid(first)||!schema205ScopeValid(observed)||!delta)return false;
 const names=phase==="baseline"?["versionGuard"]:["voucherGuard","foreignKey","restrictDelete","restrictUpdate"];
 if(Object.keys(delta).length!==names.length||!names.every(name=>oid(delta[name]))||new Set(names.map(name=>String(delta[name]))).size!==names.length)return false;
 const trigger=(table,id)=>observed.triggers.find(entry=>entry.table===table&&sameOid(entry.id,id));
 const removed=[];
 let fk;
 if(phase==="baseline"){
  const row=trigger("ContractVersion",delta.versionGuard);
  if(!stageTrigger(row,19,"A",false)||row.row.tgname!==versionGuard||!ordinaryRow(row.row))return false;
  removed.push(row);
 }else if(phase==="seven"){
  const guard=trigger("FileObject",delta.voucherGuard);
  fk=observed.constraints.find(entry=>entry.table==="FileObject"&&sameOid(entry.id,delta.foreignKey));
  if(!stageTrigger(guard,27,"O",false)||guard.row.tgname!==voucherGuard||!ordinaryRow(guard.row))return false;
  const row=fk?.row;
  if(!row||row.conname!==voucherFk||row.contype!=="f"||!oid(row.conrelid)||!oid(row.conindid)||row.confdeltype!=="r"||row.confupdtype!=="r"||row.confmatchtype!=="s"
   ||row.convalidated!==true||row.condeferrable!==false||row.condeferred!==false||!emptyOid(row.conparentid)||row.conkey?.length!==1||row.confkey?.length!==1)return false;
  const file=observed.relations.find(entry=>entry.table==="FileObject");
  if(!sameOid(row.confrelid,file.id)||sameOid(row.conrelid,file.id)
   ||!observed.columns.some(entry=>entry.table==="FileObject"&&entry.row.attname==="id"&&sameOid(entry.id,row.confkey[0]))
   ||!observed.indexes.some(entry=>entry.table==="FileObject"&&sameOid(entry.id,row.conindid)&&entry.row.indisprimary===true))return false;
  removed.push(guard);
  for(const [key,type] of [["restrictDelete",9],["restrictUpdate",17]]){
   const ri=trigger("FileObject",delta[key]);
   if(!stageTrigger(ri,type,"O",true)||ri.row.tgname!=="RI_ConstraintTrigger_a_"+ri.id||!sameOid(ri.row.tgconstraint,fk.id)
    ||!sameOid(ri.row.tgconstrrelid,row.conrelid)||!sameOid(ri.row.tgconstrindid,row.conindid))return false;
   removed.push(ri);
  }
 }else return false;
 return schema205ScopesMatch(first,{...observed,triggers:observed.triggers.filter(entry=>!removed.includes(entry)),constraints:observed.constraints.filter(entry=>entry!==fk)});
}

module.exports={schema205ScopeSql,schema205BaselineDeltaSql,schema205SevenDeltaSql,schema205ScopeValid,schema205ScopesMatch,schema205ScopeTransitionMatches};

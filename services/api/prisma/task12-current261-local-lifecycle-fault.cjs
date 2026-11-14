'use strict';
// Fixed SQL description only. The owner window alone issues/consumes a live
// one-use fault-phase permit after independent signed-original readback.
const {createHash}=require('node:crypto');
const issued=new WeakSet();
const name='jg_task12_local_lifecycle_audit_failure',signature='public.'+name+'()';
const quote=x=>"'"+x.replaceAll("'","''")+"'";
const need=ok=>{if(!ok)throw new Error('CURRENT261_LOCAL_LIFECYCLE_FAULT_SOURCE');};
function describeCurrent261LocalLifecycleAuditFault(versionId){
 need(arguments.length===1&&typeof versionId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(versionId));
 const body=`\nBEGIN\n IF NEW."businessType"='contract_version' AND NEW."businessId"=${quote(versionId)} AND NEW.action='contract.archive.complete' THEN\n  RAISE EXCEPTION 'TASK12_LOCAL_LIFECYCLE_AUDIT_FAILURE';\n END IF;\n RETURN NEW;\nEND;\n`;
 const bodySha256=createHash('sha256').update(body).digest('hex');
 const functionAbsentSql=`NOT EXISTS(SELECT FROM pg_catalog.pg_proc f WHERE f.pronamespace=pg_catalog.to_regnamespace('public') AND f.proname=${quote(name)})`;
 const triggerAbsentSql=`NOT EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(name)})`;
 const metadataSql=`(SELECT count(*)=1 FROM pg_catalog.pg_proc f WHERE f.pronamespace=pg_catalog.to_regnamespace('public') AND f.proname=${quote(name)})
 AND EXISTS(SELECT FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_language l ON l.oid=f.prolang
  WHERE f.oid=pg_catalog.to_regprocedure(${quote(signature)}) AND f.pronamespace=pg_catalog.to_regnamespace('public') AND f.proowner=10
   AND f.prokind='f' AND l.lanname='plpgsql' AND f.prorettype='pg_catalog.trigger'::regtype AND f.proargtypes=''::oidvector
   AND f.pronargs=0 AND f.pronargdefaults=0 AND f.proargnames IS NULL AND f.proargmodes IS NULL AND f.proallargtypes IS NULL
   AND f.provariadic=0 AND f.prosupport=0 AND f.provolatile='v' AND f.proparallel='u'
   AND f.procost=100 AND f.prorows=0 AND f.proargdefaults IS NULL AND f.protrftypes IS NULL
   AND f.probin IS NULL AND f.prosqlbody IS NULL
   AND NOT (f.prosecdef OR f.proisstrict OR f.proretset OR f.proleakproof)
   AND f.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex')=${quote(bodySha256)}
   AND (SELECT count(*)=1 AND bool_and(a.grantor=10 AND a.grantee=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
    FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a))
 AND (SELECT count(*)=1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(name)})
 AND EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(name)}
  AND t.tgfoid=pg_catalog.to_regprocedure(${quote(signature)}) AND t.tgtype=7 AND t.tgenabled='O'
  AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred) AND t.tgconstraint=0 AND t.tgparentid=0
  AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
  AND t.tgconstrrelid=0 AND t.tgconstrindid=0 AND t.tgattr=''::int2vector AND t.tgargs=''::bytea)`;
 const material=Object.freeze({purpose:'CURRENT261_LOCAL_LIFECYCLE_ARCHIVE_AUDIT_FAIL',versionId,name,signature,ownerOid:'10',body,bodySha256,
  functionAbsentSql,triggerAbsentSql,metadataSql,
  installSql:`CREATE FUNCTION ${signature} RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $lifeFault$${body}$lifeFault$;\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;\nCREATE TRIGGER "${name}" BEFORE INSERT ON public."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${signature};`,
  removeSql:`DROP TRIGGER "${name}" ON public."AuditLog";\nDROP FUNCTION ${signature};`,executionAllowed:false});
 issued.add(material);return material;
}
function restoreCurrent261LocalLifecycleFaultCatalog(sql,material){
 need(arguments.length===2&&issued.has(material)&&typeof sql==='string');
 const markers=[
  ["FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public')",` AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure(${quote(signature)})`],
  ["FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=pg_catalog.to_regnamespace('public')",` AND t.oid IS DISTINCT FROM (SELECT fault.oid FROM pg_catalog.pg_trigger fault WHERE fault.tgrelid='public."AuditLog"'::regclass AND fault.tgname=${quote(name)})`]
 ];
 for(const [marker,addition]of markers){need(sql.split(marker).length===2);sql=sql.replace(marker,()=>marker+addition);}
 return sql;
}
module.exports=Object.freeze({describeCurrent261LocalLifecycleAuditFault,restoreCurrent261LocalLifecycleFaultCatalog});

'use strict';
const schema='jg_t12_normal_approval', signature=schema+'.read_locked_assignments(text,text,text,text[],text[])';
const signatureReader=schema+'.read_locked_approval_signature(text,text)';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const literal=value=>"'"+value+"'";
function renderTask12NativeApprovalLock(identity,fixture){
 const {database,databaseOid,ordinaryName,ordinaryOid,serverPort,systemIdentifier}=identity;
 const {project,handler,members,globalRoles,users}=fixture;
 const invalid=()=>{throw new Error('TASK12_NATIVE_APPROVAL_LOCK_SCOPE');};
 if(!/^jg_task01_[a-f0-9]{32}$/u.test(database)||!/^[1-9][0-9]{0,9}$/u.test(databaseOid)||
    !/^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinaryName)||!/^[1-9][0-9]{0,9}$/u.test(ordinaryOid)||
    !/^([1-9][0-9]{0,19})$/u.test(systemIdentifier)||!Number.isInteger(serverPort)||serverPort<=1024||serverPort>65535||!uuid(project.id)||!uuid(handler.id)||
    members.length!==2||globalRoles.length!==5||users.length!==8||!users.every(user=>uuid(user.id)))invalid();
 const memberRoleKeys=['contract_staff','project_manager'];
 const globalRoleKeys=['material_director','contract_director','finance_director','general_manager','comprehensive_director'];
 if(!members.every(row=>uuid(row.id)&&uuid(row.userId)&&row.projectId===project.id&&memberRoleKeys.includes(row.positionKey))||
    !globalRoles.every(row=>uuid(row.id)&&uuid(row.userId)&&uuid(row.positionId)&&globalRoleKeys.includes(row.roleKey)))invalid();
 const tuples=(rows,fields)=>rows.map(row=>'('+fields.map(field=>literal(row[field])).join(',')+')').join(',');
 const actors=users.map(user=>literal(user.id)).join(',');
 const approvers=[members.find(row=>row.positionKey==='project_manager')?.userId,
  ...globalRoles.filter(row=>row.roleKey!=='comprehensive_director').map(row=>row.userId)];
 if(new Set(approvers).size!==5||!approvers.every(id=>id&&users.some(user=>user.id===id)))invalid();
 const signatureActors=approvers.map(literal).join(',');
 const scopedMembers=tuples(members,['id','userId','positionKey']);
 const scopedPositions=tuples(globalRoles,['id','userId','positionId','roleKey']);
 return `BEGIN;
DO $owner$ BEGIN
 IF current_user::regrole::oid<>10 OR session_user<>current_user OR current_database()<>'${database}'
 OR inet_server_port() IS DISTINCT FROM ${serverPort}
 OR (SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10) IS DISTINCT FROM '${databaseOid}'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '${systemIdentifier}'
 OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${ordinaryName}' AND oid='${ordinaryOid}'::oid AND rolcanlogin AND NOT rolsuper AND NOT rolinherit)
 THEN RAISE EXCEPTION 'TASK12_NATIVE_APPROVAL_LOCK_OWNER'; END IF;
END $owner$;
CREATE SCHEMA ${schema};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
CREATE FUNCTION ${signature.replace('(text,text,text,text[],text[])','(project_id text, actor_id text, phase text, project_roles text[] DEFAULT ARRAY[]::text[], global_roles text[] DEFAULT ARRAY[]::text[])')}
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fixed$
DECLARE result jsonb; unexpected boolean; scoped_project_roles text[]; scoped_global_roles text[];
BEGIN
 IF session_user::regrole::oid IS DISTINCT FROM '${ordinaryOid}'::oid OR session_user <> '${ordinaryName}' OR
    current_database() <> '${database}' OR inet_server_port() IS DISTINCT FROM ${serverPort} OR
    (SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10) IS DISTINCT FROM '${databaseOid}' OR
    NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) OR
    project_id IS DISTINCT FROM '${project.id}' OR actor_id IS NULL OR actor_id NOT IN (${actors}) OR
    phase IS NULL OR phase NOT IN ('applicant','candidates','review','seal') OR
    (phase IN ('applicant','candidates') AND actor_id IS DISTINCT FROM '${handler.id}') OR
    project_roles IS NULL OR global_roles IS NULL OR
    NOT (project_roles <@ ARRAY['project_manager','engineering_director']::text[]) OR
    NOT (global_roles <@ ARRAY['contract_director','material_director','comprehensive_director','finance_director','chairman','general_manager','super_admin']::text[]) OR
    (phase IN ('applicant','candidates') AND (cardinality(project_roles)<>0 OR cardinality(global_roles)<>0)) OR
    (phase='seal' AND (cardinality(project_roles)<>0 OR global_roles IS DISTINCT FROM ARRAY['comprehensive_director','super_admin']::text[])) THEN
  RAISE EXCEPTION 'TASK12_NATIVE_APPROVAL_LOCK_SCOPE' USING ERRCODE='42501';
 END IF;
 scoped_project_roles := CASE phase WHEN 'applicant' THEN ARRAY['contract_staff']::text[]
   WHEN 'candidates' THEN ARRAY['project_manager','engineering_director']::text[] ELSE project_roles END;
 scoped_global_roles := CASE phase WHEN 'applicant' THEN ARRAY['contract_director','contract_staff']::text[]
   WHEN 'candidates' THEN ARRAY['contract_director','material_director','comprehensive_director','finance_director','chairman','general_manager']::text[]
   ELSE global_roles END;
 WITH unlisted AS MATERIALIZED (
  SELECT 1 FROM public."ProjectMember" pm JOIN public."User" u ON u.id=pm."userId"
  WHERE pm."projectId"=project_id AND u."isActive"
    AND (phase='candidates' OR pm."userId"=actor_id) AND pm."positionKey"=ANY(scoped_project_roles)
    AND NOT EXISTS (SELECT FROM (VALUES ${scopedMembers}) permitted(mid,uid,role)
     WHERE (pm.id,pm."userId",pm."positionKey")=(permitted.mid,permitted.uid,permitted.role))
  UNION ALL
  SELECT 1 FROM public."UserPosition" up JOIN public."Position" p ON p.id=up."positionId"
  JOIN public."User" u ON u.id=up."userId" WHERE u."isActive" AND (
   (up."projectId"=project_id AND (phase='candidates' OR up."userId"=actor_id) AND p."key"=ANY(scoped_project_roles))
   OR (up."projectId" IS NULL AND (phase='candidates' OR up."userId"=actor_id) AND p."key"=ANY(scoped_global_roles)
    AND NOT EXISTS(SELECT FROM (VALUES ${scopedPositions}) permitted(aid,uid,pid,role)
      WHERE (up.id,up."userId",p.id,p."key")=(permitted.aid,permitted.uid,permitted.pid,permitted.role)))
  )
 ), members AS MATERIALIZED (
  SELECT pm."userId",pm."positionKey" AS "roleKey" FROM public."ProjectMember" pm
  JOIN public."User" u ON u.id=pm."userId"
  JOIN (VALUES ${scopedMembers}) permitted(mid,uid,role) ON (pm.id,pm."userId",pm."positionKey")=(permitted.mid,permitted.uid,permitted.role)
  WHERE pm."projectId"=project_id AND u."isActive"
    AND (phase='candidates' OR pm."userId"=actor_id) AND pm."positionKey"=ANY(scoped_project_roles)
  FOR SHARE OF pm,u
 ), positions AS MATERIALIZED (
  SELECT up."userId",p."key" AS "roleKey" FROM public."UserPosition" up
  JOIN public."Position" p ON p.id=up."positionId" JOIN public."User" u ON u.id=up."userId"
  JOIN (VALUES ${scopedPositions}) permitted(aid,uid,pid,role) ON (up.id,up."userId",p.id,p."key")=(permitted.aid,permitted.uid,permitted.pid,permitted.role)
  WHERE up."projectId" IS NULL AND u."isActive"
    AND (phase='candidates' OR up."userId"=actor_id) AND p."key"=ANY(scoped_global_roles)
  FOR SHARE OF up,p,u
 )
 SELECT jsonb_build_object('project',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) FROM members m),
                           'global',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM positions p)),
   EXISTS(SELECT FROM unlisted) INTO result,unexpected;
 IF unexpected THEN RAISE EXCEPTION 'TASK12_NATIVE_APPROVAL_LOCK_ASSIGNMENT_DRIFT' USING ERRCODE='42501'; END IF;
 RETURN result;
END $fixed$;
REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO "${ordinaryName}";
GRANT EXECUTE ON FUNCTION ${signature} TO "${ordinaryName}";
CREATE FUNCTION ${signatureReader.replace('(text,text)','(project_id text, actor_id text)')}
RETURNS TABLE(id text, "fileId" text, "contentSha256" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $signature$
BEGIN
 IF session_user::regrole::oid IS DISTINCT FROM '${ordinaryOid}'::oid OR session_user <> '${ordinaryName}' OR
    current_database() <> '${database}' OR inet_server_port() IS DISTINCT FROM ${serverPort} OR
    (SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10) IS DISTINCT FROM '${databaseOid}' OR
    NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) OR
    project_id IS DISTINCT FROM '${project.id}' OR actor_id IS NULL OR actor_id NOT IN (${signatureActors}) THEN
  RAISE EXCEPTION 'TASK12_NATIVE_APPROVAL_SIGNATURE_SCOPE' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
  SELECT s.id, s."fileId", s."contentSha256" FROM public."HandwrittenSignatureVersion" s
  WHERE s."userId"=actor_id AND s."source"='canvas'
  ORDER BY s."createdAt" DESC,s.id DESC LIMIT 1 FOR UPDATE OF s;
END $signature$;
REVOKE ALL ON FUNCTION ${signatureReader} FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${signatureReader} TO "${ordinaryName}";
COMMIT;`;
}
module.exports=Object.freeze({renderTask12NativeApprovalLock});

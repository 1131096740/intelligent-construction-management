"use strict";
// Source-only finite SQL profile policy; it never issues an owned token.
const {createHash}=require('node:crypto');
const ID='CURRENT259_OWNED_TECHNICAL_V1',OWNER='jg_task01_owner';
const need=ok=>{if(!ok)throw new Error('CURRENT259_TECHNICAL_PROFILE');};
const hash=x=>createHash('sha256').update(x).digest('hex');
function planProfile(plan){
 if(!Object.hasOwn(plan,'technicalProfile')){need(!Object.hasOwn(plan,'resourceRunId'));return null;}
 need(plan.technicalProfile===ID&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.resourceRunId)&&
  plan.database==='jg_task01_'+plan.resourceRunId.replaceAll('-','')&&plan.actorOid==='10'&&plan.ownerOid==='10');
 return Object.freeze({owner:OWNER,id:ID});
}
// Finite transformations of technical fixtures, never of product migrations.
function projectTechnicalSql(plan,sql,kind){
 if(!planProfile(plan))return {sql,beforeSha256:hash(sql),afterSha256:hash(sql)};
 const replacements={
  setup:[["'jiangkong'","'jg_task01_owner'",3],['AUTHORIZATION jiangkong;','AUTHORIZATION jg_task01_owner;',1]],
  post213:[["'^jiangkong_project_financing_quota_[a-z0-9_]+$'","'^jg_task01_[a-f0-9]{32}$'",2],["'jiangkong'","'jg_task01_owner'",1]]
 }[kind];
 need(replacements&&typeof sql==='string');const beforeSha256=hash(sql);
 for(const [before,after,count] of replacements){need(sql.split(before).length===count+1);sql=sql.split(before).join(after);}
 return Object.freeze({sql,beforeSha256,afterSha256:hash(sql)});
}
module.exports={planProfile,projectTechnicalSql};

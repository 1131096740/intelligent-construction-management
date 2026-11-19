'use strict';
// Dedicated main can mint only after its plan/source checks and native login
// admission. This module performs no SQL and does not establish resources.
const path=require('node:path'),{types}=require('node:util');
const issued=new WeakMap(),spent=new WeakSet(),seen=new WeakSet();
const code='TASK12_CON18_OWNER_CAPABILITY';
const need=value=>{if(!value)throw Object.assign(new Error(code),{code});};
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const hex=(x,n)=>typeof x==='string'&&new RegExp('^[a-f0-9]{'+n+'}$','u').test(x);
function issueTask12Con18OwnerCapability(input){
 need(arguments.length===1&&input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);
 const fields=['purpose','candidateSha','planSha256','runId','loginProjection','moduleView','fixture','exec'];
 need(Reflect.ownKeys(input).length===fields.length&&fields.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},'value')));
 const {purpose,candidateSha,planSha256,runId,loginProjection,moduleView,fixture,exec}=input;
 need(((purpose==='TASK12_NATIVE_CON18_WITHDRAWAL_V1'&&require.main?.filename===path.join(__dirname,'run-task12-native-con18-once.cjs'))||(purpose==='TASK12_NATIVE_CON18_DEFAULT_APP_V1'&&require.main?.filename===path.join(__dirname,'run-task12-native-con18-default-once.cjs')))&&hex(candidateSha,40)&&hex(planSha256,64)&&typeof runId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runId)&&loginProjection&&!types.isProxy(loginProjection)&&!seen.has(loginProjection)&&moduleView&&!types.isProxy(moduleView)&&fixture&&Object.isFrozen(fixture)&&typeof exec==='function'&&!types.isProxy(exec));
 const prior=require('./task12-current259-document-login.cjs').readNativeTask12DocumentLoginProjection(loginProjection);
 const modules=require('./task16-current259-client-loader.cjs').claimCurrent261OfficialDocumentModules(moduleView);
 need(prior&&modules&&['candidateSha','tree','sourceSealSha256'].every(k=>own(prior.source,k)===own(modules.source,k))&&prior.source.candidateSha===candidateSha&&hex(prior.source.tree,40)&&hex(prior.source.sourceSealSha256,64)&&prior.identity?.database==='jg_task01_'+runId.replaceAll('-','')&&['TASK12_ARCHIVE261_SOURCE_V1','TASK12_ARCHIVE262_SOURCE_V1'].includes(prior.source.profile?.profile)&&modules.source.profile?.profile===prior.source.profile.profile&&modules.source.profile?.ledgerSha256===prior.source.profile.ledgerSha256&&modules.source.profile?.schemaSha256===prior.source.profile.schemaSha256&&typeof own(moduleView,'isTask12LocalLifecycleFixture')==='function'&&moduleView.isTask12LocalLifecycleFixture(fixture)===true&&own(own(fixture,'case'),'key')==='inside:equipment_rental'&&Number.isInteger(prior.serverPort)&&prior.serverPort>1024&&prior.serverPort<=65535&&prior.serverPort!==5432&&typeof modules.verifyFull==='function');
 modules.verifyFull();seen.add(loginProjection);const token=Object.freeze({});issued.set(token,Object.freeze({loginProjection,moduleView,fixture,exec,prior,modules,sourceSha:candidateSha,planSha256,runId}));return token;
}
function claimTask12Con18OwnerCapability(token,loginProjection,moduleView,fixture,exec){
 const scope=token&&!types.isProxy(token)?issued.get(token):undefined;if(scope){issued.delete(token);spent.add(token);}
 need(arguments.length===5&&scope&&scope.loginProjection===loginProjection&&scope.moduleView===moduleView&&scope.fixture===fixture&&scope.exec===exec);
 scope.modules.verifyFull();return scope;
}
module.exports=Object.freeze({issueTask12Con18OwnerCapability,claimTask12Con18OwnerCapability});

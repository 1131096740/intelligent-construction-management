// Synthetic persistence adapter; real Nest controllers, services, JWT and guards.
// No PrismaClient, PostgreSQL driver, AppModule, external files or SMS transport.
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
process.umask(0o077);
for (const key of ['DATABASE_URL','DIRECT_URL','DIRECT_DATABASE_URL','SHADOW_DATABASE_URL']) delete process.env[key];
Object.assign(process.env,{NODE_ENV:'test',APPROVAL_SMS_ENABLED:'false',AUTH_SMS_ENABLED:'false',SMS_ENABLED:'false'});
const root = path.resolve(__dirname,'../../../..');
if (process.cwd() !== path.join(root,'apps/web-admin') || !root.includes('jg-enterprise-task19-spot-request-20261106')) throw Error('Private task19 cwd required');
const req = createRequire(path.join(root,'services/api/package.json'));
const {Prisma}=req('@prisma/client');
const {Test}=req('@nestjs/testing');
const {Reflector}=req('@nestjs/core');
const shared=req('@jiangkong/shared-domain');
const load=(file,key)=>req(path.join(root,'services/api/dist',file+'.js'))[key];
const MeController=load('me/me.controller','MeController');
const MeService=load('me/me.service','MeService');
const Controller=load('spot-procurement/spot-procurement.controller','SpotProcurementController');
const Application=load('spot-procurement/spot-procurement-application.service','SpotProcurementApplicationService');
const ProgressController=load('approval/approval-progress.controller','ApprovalProgressController');
const ProgressService=load('approval/approval-progress.service','ApprovalProgressService');
const Reads=load('spot-procurement/spot-procurement-read.service','SpotProcurementReadService');
const Access=load('spot-procurement/spot-procurement-access.service','SpotProcurementAccessService');
const Visibility=load('auth/project-visibility.service','ProjectVisibilityService');
const Pilot=load('spot-procurement/spot-procurement-pilot.service','SpotProcurementPilotService');
const Payment=load('spot-procurement/spot-procurement-payment.service','SpotProcurementPaymentService');
const Settlement=load('spot-procurement/spot-procurement-settlement.service','SpotProcurementSettlementService');
const Tokens=load('auth/jwt-token.service','JwtTokenService');
const JwtGuard=load('auth/guards/jwt-auth.guard','JwtAuthGuard');
const Permission=load('auth/guards/permission.guard','PermissionGuard');
const Retired=load('retired-write-entry/retired-write-entry.guard','RetiredWriteEntryGuard');
const {BUSINESS_ENTRY_DEFINITION_REGISTRY: definitions, BUSINESS_ENTRY_ACCESS_REGISTRY: policies}=req(path.join(root,'services/api/dist/business-entry-definition/business-entry-definition.scene-registry.js'));
const DefinitionService=load('business-entry-definition/business-entry-definition.service','BusinessEntryDefinitionService');
const Authorization=load('business-entry-definition/business-entry-scene-authorization.service','BusinessEntrySceneAuthorizationService');
const SnapshotStore=load('business-entry-definition/business-entry-definition.snapshot-store','PrismaBusinessEntrySnapshotStore');
const Transactions=load('business-entry-definition/business-entry-transaction.service','BusinessEntryTransactionService');
const transactionRegistry=load('business-entry-definition/business-entry-transaction-scene-registry','BUSINESS_ENTRY_TRANSACTION_REGISTRY');
const Audit=load('audit/audit.service','AuditService');
const now=new Date();
const actor={id:'spot-actor',name:'合成项目物资员',phone:'13800000001',isActive:true,mustChangePassword:false,sessionVersion:0,departmentId:null,roleKeys:['material_staff'],globalRoleKeys:[]};
const director={...actor,id:'director',name:'合成物资主管',phone:'13800000002',roleKeys:['material_director'],globalRoleKeys:['material_director']};
const manager={...actor,id:'manager',name:'合成项目经理',phone:'13800000003',roleKeys:['project_manager'],globalRoleKeys:[]};
const project={id:'spot-project',code:'合成项目',name:'生产材料申请验收项目',isActive:true,status:'active',createdAt:now,updatedAt:now};
let state={};
let failConfirmationRead=false, confirmationReadPending=false;
function reset(){failConfirmationRead=false;confirmationReadPending=false;state=Object.fromEntries(Prisma.dmmf.datamodel.models.map(m=>[m.name[0].toLowerCase()+m.name.slice(1),[]]));state.user=[actor,director,manager];state.project=[project];state.position=[{id:'director-position',key:'material_director'}];state.userPosition=[{id:'global-director',userId:director.id,projectId:null,positionId:'director-position'}];state.projectMember=[{id:'member',projectId:project.id,userId:actor.id,positionKey:'material_staff'},{id:'manager-member',projectId:project.id,userId:manager.id,positionKey:'project_manager'}];
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=','base64');const hash=createHash('sha256').update(bytes).digest('hex');for(const user of [director,manager]){state.handwrittenSignatureVersion.push({id:'signature-'+user.id,userId:user.id,fileId:'signature-file-'+user.id,source:'canvas',contentSha256:hash,createdAt:now});state.fileObject.push({id:'signature-file-'+user.id,contentSha256:hash,storageStatus:'active',uploadedByUserId:user.id});}}
reset();
const clone=v=>v instanceof Date?new Date(v):Prisma.Decimal.isDecimal(v)?new Prisma.Decimal(v.toString()):Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
function matches(row,where={}){return Object.entries(where).every(([k,w])=>{
 if(k==='AND')return(Array.isArray(w)?w:[w]).every(x=>matches(row,x));if(k==='OR')return w.some(x=>matches(row,x));if(k==='NOT')return !matches(row,w);
 const a=row[k];if(w&&typeof w==='object'&&!(w instanceof Date)&&!Prisma.Decimal.isDecimal(w))return Object.entries(w).every(([op,v])=>op==='in'?v.includes(a):op==='notIn'?!v.includes(a):op==='not'?a!==v:op==='contains'?String(a??'').includes(v):op==='mode'?true:op==='equals'?a===v:op==='gte'?a>=v:op==='gt'?a>v:op==='lte'?a<=v:op==='lt'?a<v:matches(row,w));
 return a===w||(a==null&&w===null);
});}
function make(data){return {id:randomUUID(),createdAt:new Date(),updatedAt:new Date(),...data};}
const db={};
for(const model of Object.keys(state))db[model]={
 findMany:async({where,orderBy,take,skip=0,select}={})=>{let rows=state[model].filter(r=>matches(r,where));if(orderBy)rows.sort((a,b)=>{for(const order of Array.isArray(orderBy)?orderBy:[orderBy])for(const[k,dir]of Object.entries(order))if(a[k]!==b[k])return(a[k]>b[k]?1:-1)*(dir==='desc'?-1:1);return 0;});return rows.slice(skip,take===undefined?undefined:skip+take);},
 findUnique:async({where})=>state[model].find(r=>matches(r,where))??null,
 findFirst:async(args={})=>(await db[model].findMany(args))[0]??null,
 count:async({where}={})=>state[model].filter(r=>matches(r,where)).length,
 create:async({data})=>{const row=make(data);if(model==='spotProcurementVersion')Object.assign(row,{supplierPartyId:null,supplierKey:null,supplierNameSnapshot:null,estimatedTotalAmount:null,changeReason:null,changeSummary:null,submittedAt:null,approvedAt:null,abandonedAt:null,abandonReason:null,requestProtocolVersion:1,draftRevision:1,...data});if(model==='spotProcurement')Object.assign(row,{actualCostCents:null,closedAt:null,voidedAt:null,abandonedAt:null,...data});state[model].push(row);return row;},
 createMany:async({data,skipDuplicates}={})=>{let count=0;for(const item of Array.isArray(data)?data:[data]){if(skipDuplicates&&state[model].some(r=>r.id===item.id))continue;await db[model].create({data:item});count++;}return{count};},
 update:async({where,data})=>{const row=state[model].find(r=>matches(r,where));if(!row)throw Error('Synthetic target missing '+model);Object.assign(row,data,{updatedAt:new Date()});return row;},
 updateMany:async({where,data})=>{const rows=state[model].filter(r=>matches(r,where));rows.forEach(r=>Object.assign(r,data,{updatedAt:new Date()}));return{count:rows.length};},
 deleteMany:async({where}={})=>{const old=state[model].length;state[model]=state[model].filter(r=>!matches(r,where));return{count:old-state[model].length};},
 aggregate:async()=>({_max:{revision:null}})
};
db.$executeRaw=async()=>0;
db.$queryRaw=async (query,...parameters)=>{
 const sql=Array.isArray(query)?query.join(' '):query.strings?.join(' ')??String(query);const values=Array.isArray(query)?parameters:query.values??[];
 if(sql.includes('WITH members')) {const roles=state.projectMember.filter(row=>values.includes(row.projectId)&&values.includes(row.positionKey)).map(row=>({projectId:row.projectId,userId:row.userId,roleKey:row.positionKey,userIsActive:state.user.find(user=>user.id===row.userId)?.isActive===true}));return clone(roles.filter(row=>!sql.includes('AND pm."userId" =')||values.includes(row.userId)));}
 if(sql.includes('FROM "UserPosition" up')) return clone(state.userPosition.filter(row=>row.projectId===null).flatMap(row=>{const position=state.position.find(item=>item.id===row.positionId);return position&&values.includes(position.key)&&(!sql.includes('AND up."userId" =')||values.includes(row.userId))?[{projectId:project.id,userId:row.userId,roleKey:position.key,userIsActive:state.user.find(user=>user.id===row.userId)?.isActive===true}]:[];}));
 if(sql.includes('pg_advisory'))return [];
 for(const model of ['SpotProcurementVersion','SpotProcurement','ApprovalInstance','BusinessEntrySubmissionSnapshot','Project','User','HandwrittenSignatureVersion','FileObject'])if(sql.includes('FROM "'+model+'"')){
 const rows=state[model[0].toLowerCase()+model.slice(1)];
 return clone(values.length?rows.filter(r=>values.includes(r.id)||values.includes(r.businessId)||values.includes(r.userId)):rows);
 }
 return [];
};
let tail=Promise.resolve();db.$transaction=async operation=>{const prior=tail;let unlock;tail=new Promise(resolve=>{unlock=resolve;});await prior;const before=clone(state);try{return await operation(db);}catch(error){state=before;throw error;}finally{unlock();}};
async function main(){
 const tokens=new Tokens();const session={user:actor,accessToken:tokens.signAccessToken(actor),refreshToken:'synthetic-only'};
 const audit=new Audit(db);const visibility=new Visibility(db);const access=new Access(db);const pilot=new Pilot();
 const store=new SnapshotStore(db,audit);
 const authorization=new Authorization(undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,db,undefined);
 const entries=new DefinitionService(definitions,policies,visibility,store,db,authorization);
 const transactions=new Transactions(definitions,transactionRegistry,store);
 const applications=new Application(db,audit,pilot,{tryRefreshLatestForBusiness:async()=>undefined},undefined,undefined,transactions,entries);
 const reads=new Reads(db,visibility,access,pilot);
 const module=await Test.createTestingModule({controllers:[Controller,ProgressController,MeController],providers:[{provide:MeService,useValue:new MeService(db,{},audit)},{provide:ProgressService,useValue:new ProgressService(db,{available:()=>false},undefined,pilot)},{provide:Application,useValue:applications},{provide:Reads,useValue:reads},{provide:Settlement,useValue:{}},{provide:Payment,useValue:{}}]}).compile();
 const app=module.createNestApplication({logger:["error"]});
 app.getHttpAdapter().getInstance().set('json replacer',load('api-json-replacer','apiJsonReplacer'));
 app.use(req('express').json());
 app.use((request,response,next)=>{
  if(request.path==='/__spot_fixture/health')return response.json({status:'synthetic_http_only'});
  if(request.path==='/__spot_fixture/fail-confirmation-read'&&request.method==='POST'){failConfirmationRead=true;return response.json({armed:true});}
  if(request.method==='PATCH'&&/^\/spot-procurements\/[^/]+\/draft$/.test(request.path)&&failConfirmationRead)response.once('finish',()=>{if(response.statusCode>=200&&response.statusCode<300){failConfirmationRead=false;confirmationReadPending=true;}});
  if(request.method==='GET'&&/^\/spot-procurements\/[^/]+$/.test(request.path)&&confirmationReadPending){confirmationReadPending=false;return response.status(503).json({message:'合成保存后读取暂不可用'});}

  if(request.path==='/__spot_fixture/session'){const person=request.query.actor==='director'?director:request.query.actor==='manager'?manager:actor;return response.json({...session,user:person,accessToken:tokens.signAccessToken(person)});}
  if(request.path==='/__spot_fixture/reset'&&request.method==='POST'){reset();return response.json({reset:true});}
  if(request.path==='/projects'&&request.method==='GET')return response.json([project]);
  if(request.path==='/work-items'&&request.method==='GET')return response.json([]);
  if(request.path.startsWith('/notifications')&&request.method==='GET')return response.json({items:[],total:0});
  next();
 });
 app.useGlobalGuards(new JwtGuard(new Reflector(),tokens,db),new Permission(new Reflector(),db,access),new Retired());
 app.useGlobalPipes(load('validation/api-validation','createApiValidationPipe')());
 const port=Number(process.env.JG_SPOT_API_PORT);if(!Number.isInteger(port)||port<1024)throw Error('Loopback port required');
 await app.listen(port,'127.0.0.1');console.log('Task19 real Nest/synthetic adapter listening on loopback');
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
}
main().catch(error=>{console.error(error);process.exitCode=1;});

const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), {createRequire} = require("node:module");
process.umask(0o077);
const root = path.resolve(__dirname, "../../../.."), req = createRequire(root + "/services/api/package.json");
const settings = JSON.parse(fs.readFileSync(process.env.SIGNATURE_REAL_DB_CONFIG));
const {assertSyntheticSignatureDatabase} = require(root + "/services/api/prisma/signature-fixture-guard.cjs");
assertSyntheticSignatureDatabase(settings);
Object.assign(process.env, { NODE_ENV:"test", FILE_STORAGE_DRIVER:"cos", FILE_STORAGE_ROOT: process.env.SIGNATURE_REAL_STORAGE,
 COS_BUCKET:"synthetic-private", COS_REGION:"ap-guangzhou", COS_SECRET_ID:"synthetic-key-id", COS_SECRET_KEY:crypto.randomBytes(32).toString("hex"),
 JWT_ACCESS_SECRET:crypto.randomBytes(32).toString("hex"), JWT_REFRESH_SECRET:crypto.randomBytes(32).toString("hex") });
const {PrismaClient}=req("@prisma/client"), {Test}=req("@nestjs/testing"), {Reflector}=req("@nestjs/core"), bcrypt=req("bcryptjs");
const load = name => req(root + "/services/api/dist/" + name + ".js");
const {MeController}=load("me/me.controller"), {MeService}=load("me/me.service"), {FileService,PrivateFileStorage}=load("file/file.service");
const {FileController}=load("file/file.controller");
const {AuthController}=load("auth/auth.controller"), {AuthService}=load("auth/auth.service"), {JwtTokenService}=load("auth/jwt-token.service");
const {JwtAuthGuard}=load("auth/guards/jwt-auth.guard"), {AuditService}=load("audit/audit.service");
const db=new PrismaClient({datasources:{db:{url:settings.url}}}), objects=new Map(), incoming=[];
const actualFetch=globalThis.fetch;
let puts=0, app;
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input));
 if(!u.hostname.endsWith(".cos.ap-guangzhou.myqcloud.com")) return actualFetch(input,init);
 const key=decodeURI(u.pathname);
 if(init.method==="PUT"){
  const bytes=Buffer.from(init.body), metadata=await req("sharp")(bytes).metadata();
  if(metadata.format!=="png" || !metadata.hasAlpha || !metadata.width || !metadata.height) throw Error("invalid synthetic canvas PNG over HTTP");
  incoming.push({sha256:crypto.createHash("sha256").update(bytes).digest("hex"),width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha});
  const rejected=++puts%2;
  if(!rejected){
   objects.set(key,bytes);
   const target=path.resolve(process.env.SIGNATURE_REAL_STORAGE,"."+key);
   if(!target.startsWith(path.resolve(process.env.SIGNATURE_REAL_STORAGE)+path.sep)) throw Error("fixture path escape");
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
  // Persist wire evidence before responding; Playwright may kill its server group.
  fs.writeFileSync(process.env.SIGNATURE_REAL_PROOF,JSON.stringify({incoming,storedObjects:objects.size,productionWrites:false},null,2));
  return rejected?new Response("<Error><Code>UnavailableForLegalReasons</Code><Message>synthetic billing restriction</Message></Error>",{status:451}):new Response(null,{status:200});
 }
 if(init.method==="GET") return objects.has(key)?new Response(new Uint8Array(objects.get(key)),{status:200}):new Response(null,{status:404});
 if(init.method==="DELETE"){objects.delete(key);return new Response(null,{status:204});}
 throw Error("unexpected synthetic storage operation");
};
(async()=>{
 const password=crypto.randomBytes(16).toString("hex"), runId=crypto.randomUUID(), users=[];
 const project=await db.project.create({data:{code:runId,name:"本次手机签名合成验收项目"}});
 for(const [i,role] of ["employee","project_manager"].entries()){
  const position=await db.position.upsert({where:{key:role},update:{},create:{key:role,name:"合成验收岗位"}});
  const phone="136"+String((parseInt(runId.slice(0,7),16)%99999998)+i).padStart(8,"0");
  const user=await db.user.create({data:{name:"本次手机签名合成验收"+role,phone,passwordHash:await bcrypt.hash(password,4),mustChangePassword:false}});
  await db.userPosition.create({data:{userId:user.id,positionId:position.id,projectId:role==="employee"?null:project.id}});
  users.push({id:user.id,phone,role,password});
 }
 fs.writeFileSync(process.env.SIGNATURE_REAL_ACCOUNTS,JSON.stringify(users));
 const audit=new AuditService(), files=new FileService(db,audit,new PrivateFileStorage()), me=new MeService(db,files,audit), tokens=new JwtTokenService(), auth=new AuthService(db,tokens,audit);
 const module=await Test.createTestingModule({controllers:[MeController,AuthController,FileController],providers:[{provide:MeService,useValue:me},{provide:AuthService,useValue:auth},{provide:FileService,useValue:files}]}).compile();
 app=module.createNestApplication({logger:false});app.useGlobalGuards(new JwtAuthGuard(new Reflector(),tokens,db));
 await app.listen(4391,"127.0.0.1");
 const finish=async()=>{
  const ids=users.map(x=>x.id), count=await db.handwrittenSignatureVersion.count({where:{userId:{in:ids}}});
  const auditRows=await db.auditLog.findMany({where:{actorUserId:{in:ids}},select:{action:true,businessId:true,metadata:true}});
  fs.writeFileSync(process.env.SIGNATURE_REAL_PROOF,JSON.stringify({versions:count,incoming,storedObjects:objects.size,auditRows,productionWrites:false,syntheticUsers:ids},null,2));
  await app.close();await db.$disconnect();process.exit(0);
 };
 process.once("SIGTERM",finish);process.once("SIGINT",finish);
 console.log("Synthetic signature HTTP server ready on loopback");
})().catch(()=>{console.error("Synthetic signature server failed; inspect local fixture");process.exitCode=1});

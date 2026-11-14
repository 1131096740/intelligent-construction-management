import {FileService} from "./file.service";
import {AuditService} from "../audit/audit.service";

function fixture(kind:"settlement"|"payment",role:string,participant=false, ownProject=true){
 const file={id:"bound-file",uploadedByUserId:"other",mimeType:"application/pdf",storageStatus:"active"};
 const empty={findMany:async()=>[],findFirst:async()=>null,findUnique:async()=>null,count:async()=>0};
 const delegates:Record<string,unknown>={
  fileObject:{...empty,findUnique:async()=>file},
  userPosition:{findMany:async({where}:{where:{projectId:string|null}})=>where.projectId===null && role!=="employee" && role!=="project_manager" || where.projectId==="project-1" && ownProject ? [{positionId:"role"}] : []},
  position:{findMany:async()=>[{id:"role",key:role}]},
  settlementArchiveFile:{findFirst:async()=>kind==="settlement"?{status:"confirmed",settlementId:"settlement"}:null},
  settlement:{...empty,findUnique:async()=>({id:"settlement",projectId:"project-1",preparedByUserId:"other"})},
  paymentExecution:{...empty,findFirst:async()=>kind==="payment"?{paymentRequestId:"payment"}:null},
  paymentRequest:{...empty,findUnique:async()=>({id:"payment",projectId:"project-1"})},
  $queryRaw:async(query:{strings:readonly string[]})=>{
   const text=query.strings.join("");
   if(text.includes("/* registered_payment_voucher_catalog */")) return [{state:"absent"}];
   return text.includes('FROM "ApprovalInstance" instance')&&participant?[{id:"participant"}]:[];
  }
 };
 const db=new Proxy(delegates,{get:(target,key)=>target[String(key)]??empty});
 const service=new FileService(db as never,new AuditService(db as never),{} as never);
 return {read:()=>service.assertCanDownloadFile(db as never,file.id,"reader")};
}
it.each(["employee","material_staff","budget_staff","engineering_tech","engineering_foreman","material_director"])("普通或非本职岗位%s不能下载他人结算付款私有附件",async role=>{
 for(const kind of ["settlement","payment"] as const) await expect(fixture(kind,role).read()).rejects.toThrow("无权下载");
});
it.each(["settlement","payment"] as const)("实际参与者可下载相关%s附件，不因同项目自动授权",async kind=>{
 await expect(fixture(kind,"employee",true).read()).resolves.toMatchObject({id:"bound-file"});
});
it.each(["finance_staff","finance_director","comprehensive_director","contract_director"])("公司岗位跨项目读取相关结算/付款附件：%s",async role=>{
 await expect(fixture("settlement",role,false,false).read()).resolves.toMatchObject({id:"bound-file"});
 if(role === "contract_director") await expect(fixture("payment",role,false,false).read()).rejects.toThrow("无权下载");
 else await expect(fixture("payment",role,false,false).read()).resolves.toMatchObject({id:"bound-file"});
});
it("项目经理只读取负责项目附件",async()=>{
 await expect(fixture("settlement","project_manager").read()).resolves.toMatchObject({id:"bound-file"});
 await expect(fixture("settlement","project_manager",false,false).read()).rejects.toThrow("无权下载");
});

it("只有技术管理员身份不自动取得业务附件权限",async()=>{
 await expect(fixture("settlement","super_admin",false,false).read()).rejects.toThrow("无权下载");
 await expect(fixture("payment","super_admin",false,false).read()).rejects.toThrow("无权下载");
});

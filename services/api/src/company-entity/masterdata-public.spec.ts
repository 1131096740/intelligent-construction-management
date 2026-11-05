import { CompanyEntityService } from "./company-entity.service";
import { CompanyEntityAccess } from "./company-entity-access";
import { BusinessPartyService } from "../business-party/business-party.service";
import { AuditService } from "../audit/audit.service";

function unitsFixture(role = "chairman", active = true, global = true, referenced = false) {
  const entity = { id:"c1",name:"我方公司旧名",unifiedSocialCreditCode:"91350211M000100Y46",registeredAddress:"昆明",isActive:true,dataStatus:"complete",currentVersionNo:1 };
  const party = {id:"b1",name:"合作单位旧名",status:"active",createdByUserId:"actor"};
  const versions:object[]=[{id:"cv1",companyEntityId:"c1",versionNo:1,name:entity.name,isActive:true}];
  const partyVersions=[{id:"bv1",businessPartyId:"b1",versionNo:1,snapshot:{name:party.name},createdByUserId:"actor"}];
  const client={
    user:{findUnique:async()=>({id:"actor",isActive:active}),findMany:async()=>[{id:"actor",name:"维护人"}]},
    userPosition:{findMany:async({where}:{where:{projectId:string|null}})=>global&&where.projectId===null?[{positionId:"pos"}]:[]},position:{findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.includes("pos")?[{id:"pos",key:role}]:[]},projectMember:{findMany:async()=>[]},
    companyEntity:{findUnique:async()=>({...entity}),findFirst:async()=>null,update:async({data}:{data:object})=>Object.assign(entity,data),findMany:async({where}:{where?:{isActive?:boolean}}={})=>where?.isActive===true&&!entity.isActive?[]:[{...entity}]},
    companyEntityVersion:{create:async({data}:{data:object})=>{const row={id:"cv2",...data};versions.push(row);return row;},findMany:async()=>versions.map(x=>({...x}))},
    businessParty:{findUnique:async()=>({...party}),update:async({data}:{data:object})=>Object.assign(party,data)},
    businessPartyVersion:{findFirst:async()=>partyVersions.at(-1),findMany:async()=>partyVersions.map(x=>({...x}))},
    auditLog:{create:async({data}:{data:object})=>data},
    $queryRaw:async(query:{strings:readonly string[]})=>query.strings.join("").includes('AS "inUse"')?[{inUse:referenced}]:[{id:"c1"}]
  };
  const db={...client,$transaction:async(run:(tx:typeof client)=>unknown)=>run(client)};
  const audit=new AuditService(db as never);
  return { company:new CompanyEntityService(db as never,new CompanyEntityAccess(db as never),audit),partner:new BusinessPartyService(db as never,audit) };
}

describe("我方公司和合作单位公开服务 IAM12",()=>{
  it.each(["chairman","comprehensive_director"])("仅公司级%s可停用空单位且历史档案版本可读",async(role)=>{
    const f=unitsFixture(role);
    await expect(f.company.updateStatus("c1","actor",{isActive:false})).resolves.toMatchObject({entity:{isActive:false}});
    await expect(f.company.history("c1","actor")).resolves.toMatchObject({versions:expect.arrayContaining([expect.objectContaining({versionNo:1,name:"我方公司旧名",isActive:true})])});
    await expect(f.company.listActive("actor")).resolves.toEqual([]);
    await expect(f.partner.updateStatus("b1","actor",{isActive:false})).resolves.toMatchObject({status:"inactive"});
    await expect(f.partner.get("b1")).resolves.toMatchObject({versions:[expect.objectContaining({snapshot:{name:"合作单位旧名"}})]});
  });
  it.each(["general_manager","finance_director","contract_director","project_manager","super_admin"])("%s不得因项目基础资料权限扩成档案维护人",async(role)=>{
    const f=unitsFixture(role);
    await expect(f.company.updateStatus("c1","actor",{isActive:false})).rejects.toThrow();
    await expect(f.partner.updateStatus("b1","actor",{isActive:false})).rejects.toThrow();
  });
  it("已有业务引用的公司也可退出新选用，旧版本保持原签约名称与生效快照",async()=>{
    const f=unitsFixture("chairman",true,true,true);
    await expect(f.company.updateStatus("c1","actor",{isActive:false})).resolves.toMatchObject({entity:{isActive:false}});
    await expect(f.company.history("c1","actor")).resolves.toMatchObject({versions:expect.arrayContaining([expect.objectContaining({versionNo:1,name:"我方公司旧名",isActive:true})])});
    await expect(f.company.listActive("actor")).resolves.toEqual([]);
  });
  it("停用账号或项目级伪公司岗不能维护档案",async()=>{
    for(const f of[unitsFixture("chairman",false),unitsFixture("chairman",true,false)]){
      await expect(f.company.updateStatus("c1","actor",{isActive:false})).rejects.toThrow();
      await expect(f.partner.updateStatus("b1","actor",{isActive:false})).rejects.toThrow();
    }
  });
});

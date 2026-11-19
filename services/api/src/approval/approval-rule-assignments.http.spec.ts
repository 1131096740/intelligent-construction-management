import {Test} from "@nestjs/testing";
import {ApprovalRuleAssignmentsController} from "./approval-rule-assignments.controller";
import {ApprovalRuleAssignmentsService} from "./approval-rule-assignments.service";
import {ProjectVisibilityService} from "../auth/project-visibility.service";

it("固定流程当前人员只在有权项目读取，缺岗如实返回且无手机号或密码",async()=>{
 const db={
  userPosition:{findMany:async()=>[]},projectMember:{findMany:async()=>[{projectId:"p1"}]},projectRosterMember:{findMany:async()=>[]},position:{findMany:async()=>[]},
  project:{findMany:async({where}:{where:{id?:{in:string[]}}})=>[{id:"p1",name:"一号项目"},{id:"p2",name:"无权项目"}].filter(row=>!where.id||where.id.in.includes(row.id))},
  user:{findMany:async()=>[{id:"manager",name:"当前经理"}]},
  $queryRaw:async(query:{strings:readonly string[]})=>query.strings.join("").includes("WITH members")?[{projectId:"p1",userId:"manager",roleKey:"project_manager",userIsActive:true}]:[]
 };
 const service=new ApprovalRuleAssignmentsService(db as never,new ProjectVisibilityService(db as never));
 const module=await Test.createTestingModule({controllers:[ApprovalRuleAssignmentsController],providers:[{provide:ApprovalRuleAssignmentsService,useValue:service}]}).compile();
 const app=module.createNestApplication();app.use((req:{user:unknown},_res:unknown,next:()=>void)=>{req.user={id:"reader"};next();});await app.listen(0,"127.0.0.1");
 try{
  const reply=await fetch(`${await app.getUrl()}/approval-rule-assignments`);expect(reply.status).toBe(200);const body=await reply.json();
  expect(body.projects).toEqual([{id:"p1",name:"一号项目"}]);
  expect(body.roles).toContainEqual({roleKey:"project_manager",people:[{id:"manager",name:"当前经理"}],missing:false});
  expect(body.roles).toContainEqual({roleKey:"material_director",people:[],missing:true});
  expect(JSON.stringify(body)).not.toMatch(/phone|password|无权项目/);
  expect((await fetch(`${await app.getUrl()}/approval-rule-assignments?projectId=p2`)).status).toBe(404);
 }finally{await app.close();}
});

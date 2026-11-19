import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { contractHandlingWorkItems } from "./contract-handling-workitems";

it.each(["eligible","non-global","wrong-project","revoked-project","registrant"] as const)(
  "项目银行核验待办匹配当前写入权限 (%s)",async state=>{
    const visible=jest.spyOn(ProjectVisibilityService.prototype,"visibleProjectIdsInTransaction").mockResolvedValue(
      state==="wrong-project"?["different"]:["project"]);
    const roles=jest.spyOn(ProjectVisibilityService.prototype,"effectiveRoleKeysByProjectInTransaction").mockResolvedValue(
      new Map([["project",state==="revoked-project"?["project_manager"]:["finance_staff"]]]));
    const row={id:"bank",projectId:"project",status:"pending_confirm",recordedByUserId:state==="registrant"?"actor":"registrant",
      createdAt:new Date("2026-11-18")};
    const findMany=jest.fn().mockResolvedValue([row]);
    const empty=()=>({findMany:jest.fn().mockResolvedValue([])});
    const tx={
      $queryRaw:jest.fn().mockResolvedValue(state==="non-global"?[{key:"finance_staff"}]:[{key:"finance_director"}]),
      contractBankVerificationRequest:{findMany},contractEconomicReview:empty(),contractProxyExecution:empty(),upwardReceiptMatch:empty()
    };
    try {
      const items=await contractHandlingWorkItems(tx as never,"actor",[{projectId:"project",roleKeys:["finance_director"]}],new Map());
      expect(items.map(item=>item.businessId)).toEqual(state==="eligible"?["bank"]:[]);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        select:{id:true,projectId:true,status:true,recordedByUserId:true,createdAt:true}
      }));
    } finally {visible.mockRestore();roles.mockRestore();}
  });

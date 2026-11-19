import type { Prisma } from "@prisma/client";
import { CompanyTransferReadService } from "./company-transfer-read.service";

function fixture() {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `transfer-${index}`, code: `HZ-${index}`, kind: "storage", status: "approved",
    sourceProjectId: "project-a", destinationProjectId: "project-b", sourceCompanyId: "source", destinationCompanyId: "destination",
    sourceAccountLast4: "1234", destinationAccountLast4: "9876", evidenceFileId: "private-proof", reason: "合成凭证备注",
    amountCents: 1000n, frozenParties: {source: {name: "转出公司"}, destination: {name: "转入公司"}},
    createdAt: new Date(10000 - index), approvedAt: null, approvalInstanceId: null
  }));
  const received = [{id:"incoming", transferId:"transfer-50", kind:"incoming", amountCents:200n, occurredAt:new Date(9000)}];
  const query = jest.fn(async ({where}: {where: Prisma.CompanyTransferWhereInput}) => {
    const terms = where.AND as Prisma.CompanyTransferWhereInput[];
    const id = terms.find(term => typeof term.id === "string")?.id;
    const scope = terms.find(term => term.OR?.some(item => item.sourceProjectId));
    return rows.filter(row => (!id || row.id === id) && (!scope || scope.OR!.some(item => {
      const source = item.sourceProjectId as {in: string[]} | undefined;
      const destination = item.destinationProjectId as {in: string[]} | undefined;
      return source?.in.includes(row.sourceProjectId) || destination?.in.includes(row.destinationProjectId);
    })));
  });
  const db = {
    $queryRaw: async (query: Prisma.Sql) => query.values[0] === "leader" ? [{key:"chairman"}] : [],
    companyTransfer: {findMany:query},
    companyTransferEvent: {findMany: async ({where}: {where: {transferId?: string | {in: string[]}}}) => received.filter(event =>
      !where.transferId || (typeof where.transferId === "string" ? where.transferId === event.transferId : where.transferId.in.includes(event.transferId)))},
    approvalActionLog: {findMany: async () => []}, approvalInstance: {findMany: async () => []}, user: {findMany: async () => []},
    project: {findMany: async ({where}: {where:{id:{in:string[]}}}) => where.id.in.map(id=>({id,name:id}))},
    registeredOperationalPayment: {findMany: async () => []},
    interEntityRelationshipEntry: {findMany: async () => []}, projectParticipatingCompany: {findMany: async () => []}, companyEntity: {findMany: async () => []}
  };
  const visibility = {
    visibleProjectIdsInTransaction: async (_tx: unknown, actor: string) => actor === "none" ? [] : actor === "unrelated" ? ["project-c"] : ["project-a"],
    effectiveRoleKeysByProjectInTransaction: async (_tx: unknown, _actor: string, projects: string[]) =>
      new Map(projects.map(id => [id, ["project_manager"]]))
  };
  const service = new CompanyTransferReadService({$transaction: (run: (tx: typeof db) => unknown) => run(db)} as never, visibility as never);
  return {service, query};
}

it("按单读取跨页当前互转，继续使用列表同一项目谓词和敏感字段投影", async () => {
  const {service, query} = fixture();
  const earlier = await service.list("project", {page:"1"});
  const later = await service.list("project", {page:"2"});
  expect(earlier.rows.some(row=>row.id==="transfer-50")).toBe(false);
  const detail = await service.detail("project","transfer-50");
  expect(detail).toEqual(later.rows[0]);
  expect(query.mock.calls.at(-1)?.[0].where.AND).toEqual(expect.arrayContaining([
    {id:"transfer-50"}, {OR:[{sourceProjectId:{in:["project-a"]}},{destinationProjectId:{in:["project-a"]}}]}
  ]));
  expect(detail).toMatchObject({destinationProjectId:null, destinationScope:"其他项目", destinationAccountLast4:null,
    sourceAccountLast4:null, evidenceFileId:null, reason:"项目关联资金互转", events:[]});
  expect(await service.detail("leader","transfer-50")).toMatchObject({
    destinationProjectId:"project-b", destinationAccountLast4:"9876", evidenceFileId:"private-proof"
  });
});

it.each([["unrelated","transfer-50"], ["none","transfer-50"], ["project","absent"]])(
  "按单读取未授权或不存在统一返回 404 (%s %s)", async (actor,id) => {
    const {service}=fixture();
    await expect(service.detail(actor,id)).rejects.toMatchObject({status:404, message:"互转记录不存在或当前账号无权查看"});
  }
);

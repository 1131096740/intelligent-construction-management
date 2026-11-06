import { NON_RECEIPT_FILE_BINDINGS } from "../../file/file-business-binding";
import { Prisma } from "@prisma/client";
import { createFundAccountSyntheticDb } from "../../fund-account/testing/fund-account.synthetic-db";

/** Resolves the legacy payment core's joins from synthetic persistence facts.
 * Advisory and row-lock calls are accepted as boundaries, never as PG lock proof. */
export function createRegisteredPaymentSyntheticDb() {
  const database = createFundAccountSyntheticDb();
  // Explicit synthetic identity facts for the targeted notification port.
  // No ambient phone/environment lookup and no change to the task15 factory.
  const phones = new Map<string, string | null>();
  const projectMembers = new Map<string, {id:string;userId:string;projectId:string;positionKey:string;createdAt:Date}>();
  const findUser = database.prisma.user.findUnique;
  const findUsers = database.prisma.user.findMany;
  Object.assign(database.prisma.user, {
    findUnique: async (args: Parameters<typeof findUser>[0]) => {
      const user = await findUser(args);
      return user && phones.has(String(user.id)) ? { ...user, phone: phones.get(String(user.id)) ?? null } : user;
    },
    findMany: async (args: Parameters<typeof findUsers>[0]) =>
      (await findUsers(args)).map(user => phones.has(String(user.id)) ? { ...user, phone: phones.get(String(user.id)) ?? null } : user)
  });
  const originalProjectMembers = database.prisma.projectMember.findMany;
  Object.assign(database.prisma.projectMember, {findMany:async (args?:{where?:Record<string,unknown>})=>{
    const members = [...projectMembers.values()].filter(member=>Object.entries(args?.where??{}).every(([field,condition])=>{
      if (!["id","userId","projectId","positionKey"].includes(field)) throw new Error("Unsupported synthetic project-member query field");
      const actual = member[field as "id"|"userId"|"projectId"|"positionKey"];
      if (typeof condition === "string") return actual === condition;
      if (condition && typeof condition === "object" && "in" in condition && Array.isArray(condition.in)) return condition.in.includes(actual);
      throw new Error("Unsupported synthetic project-member query condition");
    }));
    return [...await originalProjectMembers(),...members];
  }});
  const originalQuery = database.prisma.$queryRaw;
  const rows = database.prisma as unknown as Record<string, {findFirst(args: {where: Record<string,unknown>}):Promise<Record<string,unknown>|null>; findMany(args:{where:Record<string,unknown>}):Promise<Record<string,unknown>[]>;create(args:{data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
  // Simulate only persisted coordinates. This never proves PG trigger/locks.
  const createContract=rows.contract.create;
  Object.assign(rows.contract,{create:async({data}:{data:Record<string,unknown>})=>{
    const contract=await createContract({data});
    await rows.registeredContractHistoryRevision.create({data:{contractId:contract.id,revision:0n}});
    return contract;
  }});
  const basisFields=["id","contractId","contractVersionId","paymentTermsVersionId","takeoverStatus","historicalBalanceConfirmedAt","activatedAt","updatedAt","historicalPaidCents","historicalProxyPaidCents","historicalAdvancePaidCents"];
  const member=(row:Record<string,unknown>|null)=>row?.takeoverStatus==="confirmed" && row.historicalBalanceConfirmedAt!=null;
  const tuple=(row:Record<string,unknown>|null)=>JSON.stringify(basisFields.map(field=>row?.[field]),(_key,value)=>typeof value==="bigint"?value.toString():value);
  const bumpHistory=async(before:Record<string,unknown>|null,after:Record<string,unknown>)=>{
    if(!member(before)&&!member(after))return;
    if(tuple(before)===tuple(after))return;
    for(const contractId of [...new Set([member(before)?before?.contractId:null,member(after)?after.contractId:null].filter((id):id is string=>typeof id==="string"))].sort()){
      const marker=await rows.registeredContractHistoryRevision.findFirst({where:{contractId}});
      if(typeof marker?.revision!=="bigint")throw new Error("Synthetic history fixture requires its precreated marker");
      const client=database.prisma as unknown as {registeredContractHistoryRevision:{update(input:{where:{contractId:string};data:{revision:bigint}}):Promise<unknown>}};
      await client.registeredContractHistoryRevision.update({where:{contractId},data:{revision:marker.revision+1n}});
    }
  };
  const createTakeover=rows.contractTakeover.create;
  const updateTakeover=(database.prisma as unknown as {contractTakeover:{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}}).contractTakeover.update;
  Object.assign(rows.contractTakeover,{
    create:async({data}:{data:Record<string,unknown>})=>{
      const row=await createTakeover({data:{historicalBalanceConfirmedAt:null,activatedAt:null,historicalPaidCents:0n,historicalProxyPaidCents:0n,historicalAdvancePaidCents:0n,updatedAt:new Date(),...data}});
      await bumpHistory(null,row);return row;
    },
    update:async(args:{where:{id:string};data:Record<string,unknown>})=>{
      const before=await rows.contractTakeover.findFirst({where:args.where});
      const row=await updateTakeover(args);await bumpHistory(before,row);return row;
    }
  });
  const findApprovalRows=rows.approvalInstance.findMany;
  Object.assign(rows.approvalInstance,{findMany:async(args:{where?:Record<string,unknown>;orderBy?:Record<string,unknown>;take?:number}={})=>{
    const found=await findApprovalRows({...args,where:args.where??{}});
    if(args.take===undefined)return found;
    if(!Number.isInteger(args.take)||args.take<0)throw new Error("Unsupported synthetic approval take");
    return found.slice(0,args.take);
  }});
  const notificationLogs = database.prisma as unknown as {approvalActionLog:{findUnique(args:{where:{id:string}}):Promise<Record<string,unknown>|null>;create(args:{data:Record<string,unknown>}):Promise<unknown>}};
  // Exact Prisma bulk persistence boundary used by the durable outbox. Keep
  // primary-key duplicate behavior; this does not simulate real PG contention.
  Object.assign(notificationLogs.approvalActionLog, {createMany:async ({data,skipDuplicates}:{data:Array<Record<string,unknown>>;skipDuplicates?:boolean})=>{
    let count=0;
    for (const row of data) {
      if (typeof row.id !== "string") throw new Error("Synthetic notification bulk rows require explicit stable identities");
      if (await notificationLogs.approvalActionLog.findUnique({where:{id:row.id}})) {
        if (skipDuplicates) continue;
        throw new Prisma.PrismaClientKnownRequestError("synthetic notification primary key conflict",{code:"P2002",clientVersion:"synthetic"});
      }
      await notificationLogs.approvalActionLog.create({data:row}); count++;
    }
    return {count};
  }});
  database.prisma.$queryRaw = (async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(query) ? query.join("?") : (query as Prisma.Sql).sql;
    const args = Array.isArray(query) ? values : (query as Prisma.Sql).values;
    if(sql.includes("jg_registered_operating_scope_lock")){
      const project=await rows.project.findFirst({where:{id:args[0]}});
      return project?[{projectId:project.id,effectiveDate:project.operatingLedgerEffectiveDate??null}]:[];
    }
    if(sql.includes("jg_registered_history_read_revision")||sql.includes("jg_registered_history_lock_revision")){
      const marker=await rows.registeredContractHistoryRevision.findFirst({where:{contractId:args[0]}});
      return [{revision:marker?.revision??null}];
    }
    if (sql.includes("registered_payment_voucher_download")) {
      const voucher=await rows.registeredPaymentVoucher.findFirst({where:{fileId:args[0]}});
      if(!voucher)return [];
      const funding=await rows.registeredPaymentFunding.findFirst({where:{executionId:voucher.executionId}});
      const execution=await rows.paymentExecution.findFirst({where:{id:voucher.executionId}});
      return [{executionId:voucher.executionId,verifiedExecutionId:funding?.executionId??null,paymentRequestId:execution?.paymentRequestId??null,contentSha256:voucher.contentSha256}];
    }
    if (sql.includes("receipt_non_receipt_file_binding")) {
      const ids=new Set(args.map(String)); const bound=new Set<string>();
      for (const binding of NON_RECEIPT_FILE_BINDINGS) {
        const model=binding.table[0].toLowerCase()+binding.table.slice(1);
        for (const row of await rows[model].findMany({where:{}})) for(const column of binding.columns) {
          const selected = new RegExp(`SELECT\\s+x\\."${column}"\\s+AS\\s+"fileId"\\s+FROM\\s+"${binding.table}"\\s+x`).test(sql);
          if(selected && ids.has(String(row[column]))) bound.add(String(row[column]));
        }
      }
      for(const file of await rows.fileObject.findMany({where:{}})) if(file.supersedesFileObjectId) { if(ids.has(String(file.id)))bound.add(String(file.id));if(ids.has(String(file.supersedesFileObjectId)))bound.add(String(file.supersedesFileObjectId)); }
      return [...bound].map(fileId=>({fileId}));
    }
    if (sql.includes('FROM "FileObject"') && sql.includes("FOR UPDATE")) {
      if (String(args[0]).startsWith("signature-file:")) return originalQuery(query,...values);
      return rows.fileObject.findMany({where:{id:args[0]}});
    }
    for (const [payloadName, model, keys] of [
      ["OperatingLedgerFactWritePayload", "operatingFact", "id projectId sourceType sourceBusinessId sourceVersion sourceBusinessCode occurredAt confirmedAt affiliateAssignmentId affiliateBusinessPartyVersionId affiliateNameSnapshot affiliateCreditCodeSnapshot operatingLedgerEffectiveDateSnapshot isBeforeOperatingLedgerEffectiveDate historicalTakeoverBatchId factKind operatingLevel evidenceLevel amountCents currencyCode direction debtorSubjectKind debtorSubjectId creditorSubjectKind creditorSubjectId approvedPayerSubjectKind approvedPayerSubjectId actualPayerSubjectKind actualPayerSubjectId payeeSubjectKind payeeSubjectId costBearingCompanySubjectKind costBearingCompanySubjectId subjectSnapshot sourceSnapshot basisSnapshot entryKind adjustsFactId idempotencyKey confirmedByUserId status paymentExecutionId fundExecutionId fundExecutionCaseId"],
      ["OperatingLedgerImpactWritePayload", "operatingImpactEntry", "id factId projectId sourceType sourceBusinessId sourceImpactKey idempotencyKey impactKind amountCents direction subjectRole subjectKind subjectId costCategoryCode fundPurpose description impactSnapshot paymentExecutionId fundExecutionId fundExecutionCaseId executionAllocationLineId"]
    ]) {
      if (!sql.includes(`::public."${payloadName}"`)) continue;
      const rowSql = /ROW\(([\s\S]+?)\)::public\./.exec(sql)?.[1];
      if (!rowSql) throw new Error("Synthetic controlled operating payload missing");
      const fields = keys.split(" "); const expressions = rowSql.split(",");
      if (fields.length !== expressions.length) throw new Error("Synthetic controlled operating payload shape mismatch");
      let offset = 0;
      const data = Object.fromEntries(fields.map((key,index) => {
        const value = expressions[index].includes("?") ? args[offset++] : null;
        return [key, expressions[index].includes("::jsonb") && typeof value === "string" ? JSON.parse(value) : value];
      }));
      return [await rows[model].create({data})];
    }
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes('FROM "PaymentRequest" payment')) {
      const payment = await rows.paymentRequest.findFirst({where:{OR:[{id:args[0]},{code:args[0]}]}});
      if (!payment) return [];
      const version = await rows.contractVersion.findFirst({where:{id:payment.contractVersionId,contractId:payment.contractId}});
      const contract = await rows.contract.findFirst({where:{id:payment.contractId}});
      if (!version || !contract) return [];
      const company = await rows.companyEntity.findFirst({where:{id:version.companyEntityIdSnapshot}});
      if (!company) return [];
      return [{...payment,signingSubjectType:version.signingSubjectType,companyEntityIdSnapshot:version.companyEntityIdSnapshot,
        companyEntityNameSnapshot:version.companyEntityNameSnapshot,companyEntityCreditCodeSnapshot:version.companyEntityCreditCodeSnapshot,
        companyEntityVersionId:version.companyEntityVersionId,companyDirectoryIsActive:company.isActive,contractVersionStatus:version.status,
        contractProjectId:contract.projectId,contractTypeKey:contract.contractTypeKey}];
    }
    for (const [table,model] of [["Contract","contract"],["Settlement","settlement"],["RegisteredFundAccount","registeredFundAccount"],["PaymentExecution","paymentExecution"]]) {
      if (sql.includes(`FROM "${table}"`) && sql.includes("FOR UPDATE")) return rows[model].findMany({where:{id:args[0]}});
    }
    return originalQuery(query, ...values);
  }) as typeof originalQuery;
  const operating = database.prisma as unknown as {operatingFact:{findUnique(args:{where:Record<string,unknown>;include?:{impacts?:boolean}}):Promise<unknown>};operatingImpactEntry:{findUnique(args:{where:Record<string,unknown>}):Promise<unknown>}};
  operating.operatingFact.findUnique = async ({where,include}) => {
    const fact=await rows.operatingFact.findFirst({where:(where.sourceType_sourceBusinessId as Record<string,unknown>)??where});
    return fact && include?.impacts ? {...fact,impacts:await rows.operatingImpactEntry.findMany({where:{factId:fact.id}})} : fact;
  };
  operating.operatingImpactEntry.findUnique = async ({where}) => rows.operatingImpactEntry.findFirst({where:(where.sourceType_sourceBusinessId_sourceImpactKey as Record<string,unknown>)??where});
  const execution = database.prisma as unknown as {paymentExecution:{aggregate(args:{where:Record<string,unknown>}):Promise<unknown>}};
  execution.paymentExecution.aggregate = async ({where}) => ({_sum:{amountCents:(await rows.paymentExecution.findMany({where})).reduce((sum,row)=>sum+BigInt(String(row.amountCents)),0n)}});
  const closeAggregate = database.prisma as unknown as {projectCloseAggregate:{upsert(args:{where:Record<string,unknown>;create:Record<string,unknown>;update:Record<string,unknown>}):Promise<unknown>}};
  closeAggregate.projectCloseAggregate.upsert = async ({where,create}) => (await rows.projectCloseAggregate.findFirst({where})) ?? rows.projectCloseAggregate.create({data:create});
  Object.assign(database.prisma, { $executeRaw: async (query: Prisma.Sql) => {
    if (query.sql.includes("pg_advisory_xact_lock")) return 0;
    if (query.sql.includes('SELECT 1 FROM "ProjectCloseAggregate"') && query.sql.includes("FOR UPDATE")) return 0;
    throw new Error("Synthetic payment adapter received an unexpected SQL execution boundary");
  } });
  return {
    ...database,
    setPhone(actorUserId: string, phone: string | null) { phones.set(actorUserId, phone); },
    setProjectMember(actorUserId:string,projectId:string,positionKey:string|null) {
      const prefix = `${actorUserId}:${projectId}:`;
      if (positionKey === null) { for (const id of projectMembers.keys()) if (id.startsWith(prefix)) projectMembers.delete(id); return; }
      const id = `${prefix}${positionKey}`;
      projectMembers.set(id,{id,userId:actorUserId,projectId,positionKey,createdAt:new Date()});
    },
    reset() { database.reset(); phones.clear(); projectMembers.clear(); }
  };
}

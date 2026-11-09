import type { createTemplateTestServer, TemplateSyntheticStore } from "./template-management.test-support";
import { directPendingInputFromStoredRows } from "./task12-direct-input-persistence.oracle";

type Row = Record<string, unknown>;
type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;
const reviewTable = "ContractEconomicReview", fileTable = "FileObject";
const referenceTable = "ContractEconomicReviewFileReference", bindingTable = "jg_contract_direct_review_retention_binding_v1";

// Separate synthetic observations. No privilege, catalog object, or SQL is created.
export async function seedDirectReviewDatabaseBinding(server: Server) {
  const authority = [
    [reviewTable,"ContractEconomicReview_direct_source_guard_v1","jg_guard_contract_direct_review_v1",23,"20b307255fb78bd08df03d01708bbb2bf6a8e9660305b15cb24f6acc29a9999c"],
    [reviewTable,"ContractEconomicReview_direct_source_files_v1","jg_materialize_contract_direct_review_files_v1",17,"a8b0f5183bbd92fa7362cf5fea5f7b0aff48ad1e366fd1fdc8ca04e7903ce132"],
    [referenceTable,"ContractEconomicReviewFileReference_guard_v1","jg_guard_contract_direct_review_file_reference_v1",31,"0a637030b274eca9cb609a92549c700946b177befb48e40edac4057b0923e8fd"],
    [reviewTable,"ContractEconomicReview_direct_source_complete_v1","jg_assert_contract_direct_review_files_complete_v1",17,"dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63",true],
    [referenceTable,"ContractEconomicReviewFileReference_complete_v1","jg_assert_contract_direct_review_files_complete_v1",5,"dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63",true],
    [fileTable,"FileObject_contract_direct_review_retention_v1","jg_protect_contract_direct_review_file_v1",31,"6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20"],
    [reviewTable,"ContractEconomicReview_immutable","protectContractEconomicReview",27,"e31b5ffda24ec9aea17ea49716b517355f87b5f9b6c70d31fcb61b383b3b91b1"],
    [fileTable,"PaymentExecutionPayerAttestation_evidence_immutable","guard_payment_execution_payer_evidence_immutable",27,"cf2f8fd6a49b3cac5fef5e397ebe3f6745455cdd898bdea56b9d7879bbad0f20",false,["contentSha256","storageStatus","uploadedByUserId","supersedesFileObjectId"]],
    [fileTable,"VerifiedBankTransactionObservation_evidence_immutable","guard_verified_bank_transaction_observation_evidence_immutable",27,"1d99af05f59b13e9b0d5e2fddf8ff2d79b201352b2175f5e4f58920bfdd031f1",false,["contentSha256","storageStatus","uploadedByUserId","supersedesFileObjectId"]],
    [fileTable,"jg_direct_pending_file_retained","jg_contract_direct_pending_file_guard_v1",27,"106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1"],
    [fileTable,"jg_efb_file_replacement","jg_enforce_file_replacement_exclusive_binding",23,"4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda",false,["supersedesFileObjectId"]]
  ] as const;
  function observations() {
    const columns = (names: string[], notNull: boolean) => names.map(name => ({ name, notNull,
      type: ["directSourcePins","bindings"].includes(name) ? "3802"
        : ["protocolVersion","directInputProtocolVersion","displayOrder","sizeBytes","sourceRevision"].includes(name) ? "23"
        : ["applicationRoleOid","databaseOid","anchorOwnerOid"].includes(name) ? "26" : "25" }));
    const relations = {
      [reviewTable]: { oid:"21000", owner:"9001", kind:"r", rls:false, forceRls:false, columns:columns(["directSourcePins"],false) },
      [fileTable]: { oid:"21001", owner:"9001", kind:"r", rls:false, forceRls:false, columns:columns(["id"],true) },
      [referenceTable]: { oid:"21002", owner:"9001", kind:"r", rls:false, forceRls:false,
        columns:columns(["reviewId","sourceRef","displayOrder","sourceContractVersionId","directInputProtocolVersion","sourceRevision","inputSha256",
          "fileId","mimeType","sizeBytes","contentSha256","bucket","objectKey"],true) },
      [bindingTable]: { oid:"21003", owner:"9001", kind:"r", rls:false, forceRls:false,
        columns:columns(["protocolVersion","applicationRoleOid","databaseOid","anchorOwnerOid","bindings"],true) }
    };
    const routines: Record<string, {oid: string} & Row> = {}, triggers: Record<string, Row> = {};
    for (const [index,[table,name,routine,type,sha,deferred=false,columns=[],args=""]] of authority.entries()) {
      routines[routine] ??= { oid:String(22000+index), owner:"9001", definer:false, language:"plpgsql", returnType:"2279",
        volatility:"v", configuration:["search_path=pg_catalog, pg_temp"], sha };
      triggers[name] = { oid:String(23000+index), relation:relations[table].oid, routine:routines[routine].oid, type, enabled:"O",
        deferred, initiallyDeferred:deferred, args, columns, condition:false, internal:false };
    }
    return { relations, routines, triggers };
  }
  await server.store.table("directReviewExpectedBinding").create({ data: { snapshot: { applicationRoleOid:"7001", databaseOid:"13000",
    anchorOwnerOid:"9001", bindings:observations() } } });
  await server.store.table("directReviewActualCatalog").create({ data: { snapshot: { ...observations(), reads:true,writes:true,noElevatedRights:true,
    triggerCount:11, foreignKeys:2, identityKeys:2, noPublicRoutineExecute:true, replicationOrigin:true, currentRoleOid:"7001",sessionRoleOid:"7001",backendPid:71201,transactionId:"500001" } } });
}

export async function directReviewObservedInputs(store: TemplateSyntheticStore, projectId: string, versionIds: string[]) {
  const project = await store.table("project").findUnique({ where:{id:projectId} });
  if (project?.isActive !== true) return [];
  const result = [];
  for (const versionId of versionIds) {
    const version = await store.table("contractVersion").findUnique({ where:{id:versionId} });
    if (!version || version.versionNo !== 1 || version.changeType !== "original" || version.numericProtocolVersion !== 2 ||
      version.status !== "draft" || version.effectiveAt !== null || version.firstSubmittedAt !== null ||
      !version.draftData || typeof version.draftData !== "object" || !Object.hasOwn(version.draftData,"directSigningInput")) continue;
    const contract = await store.table("contract").findUnique({ where:{id:version.contractId} });
    if (!contract || contract.projectId !== projectId || contract.voidedAt !== null) continue;
    const input=await directPendingInputFromStoredRows(store,versionId);
    const observed=input.Q ? await store.table("directReviewInputDigestObservation").findFirst({where:{
      versionId,sourceRevision:version.draftRevision,originalSignedNumber:input.Q.contract.originalSignedNumber
    }}) : null;
    // A test may supply a second opaque digest for the same revision but changed
    // actual source facts. The fixture still does not compute a PostgreSQL hash.
    if (observed && typeof observed.inputSha256==="string") input.inputSha256=observed.inputSha256;
    result.push({ contractId:contract.id, versionId, draftRevision:version.draftRevision, input });
  }
  return result;
}

export async function createDirectReviewFromRaw(store: TemplateSyntheticStore, values: unknown[]) {
  const [id,projectId,leftSourceRef,rightSourceRef,leftFingerprint,rightFingerprint,relation,coverage,reason,
    preparedByUserId,idempotencyKey,requestFingerprint,targetSourceRef,targetVersionId,supersedesReviewId,financeRequired,rawPins] = values;
  if (values.length !== 17 || typeof id !== "string" || typeof projectId !== "string" || typeof rawPins !== "string" ||
    typeof coverage !== "string" || typeof leftSourceRef !== "string" || typeof rightSourceRef !== "string") throw new Error("合成直签复核插入参数范围不正确");
  const directSourcePins = JSON.parse(rawPins) as Array<{sourceRef:string; contractVersionId:string; sourceRevision:number; inputSha256:string}>;
  const current = await directReviewObservedInputs(store,projectId,directSourcePins.map(pin=>pin.contractVersionId));
  if (!directSourcePins.length || current.length !== directSourcePins.length || directSourcePins.some(pin => {
    const source = current.find(item=>item.versionId===pin.contractVersionId);
    return !source || pin.sourceRef!==`contract:${source.contractId}` || pin.sourceRevision!==source.draftRevision ||
      source.input.state!=="complete" || source.input.inputSha256!==pin.inputSha256 ||
      (pin.sourceRef===leftSourceRef?leftFingerprint:pin.sourceRef===rightSourceRef?rightFingerprint:null)!==pin.inputSha256;
  })) throw new Error("合成直签复核拒绝不匹配的当前实际来源");
  await store.table("contractEconomicReview").create({data:{id,projectId,leftSourceRef,rightSourceRef,leftFingerprint,rightFingerprint,
    relation,coverage:JSON.parse(coverage),reason,preparedByUserId,idempotencyKey,requestFingerprint,targetSourceRef,targetVersionId,
    supersedesReviewId,financeRequired,directSourcePins}});
  return [{id}];
}

export async function confirmDirectReviewFromRaw(store: TemplateSyntheticStore, values: unknown[], lockedFileIds: ReadonlySet<string>) {
  const [actor, confirmedAt, rawFrozen, id, revision] = values;
  if (values.length!==5 || typeof actor!=="string" || !(confirmedAt instanceof Date) || typeof rawFrozen!=="string" ||
    typeof id!=="string" || !Number.isSafeInteger(revision)) throw new Error("合成直签复核确认参数范围不正确");
  const row=await store.table("contractEconomicReview").findUnique({where:{id}});
  if (!row || row.status!=="pending_review" || row.revision!==revision || typeof row.projectId!=="string") return [];
  const frozen=JSON.parse(rawFrozen) as Row[];
  const pins=row.directSourcePins;
  if (!Array.isArray(pins) || frozen.length!==2 || frozen[0]?.ref!==row.leftSourceRef ||
    frozen[1]?.ref!==row.rightSourceRef || frozen.some(side=>Object.hasOwn(side,"directInput"))) throw new Error("合成终局原文书对不完整");
  const drift=await store.table("directReviewSyntheticTerminalDrift").findFirst({where:{reviewId:id}});
  if (drift) {
    const oldSide=frozen.find(side=>pins.every(pin=>pin.sourceRef!==side.ref));
    if (!oldSide || !drift.changes || typeof drift.changes!=="object") throw new Error("合成混合原文书漂移夹具不完整");
    Object.assign(oldSide,drift.changes);
  }
  if (pins.length===1) {
    const oldSide=frozen.find(side=>side.ref!==pins[0].sourceRef);
    if (!oldSide || oldSide.coverageNumericProtocolVersion!==2 || oldSide.excludedDeltaYuan!=="0.0000"
      || Object.hasOwn(oldSide,"excludedDeltaCents") || oldSide.operatingBaseline!==null) throw new Error("合成混合复核拒绝既有文书金额调整");
  }
  const sources=await directReviewObservedInputs(store,row.projectId,pins.map(pin=>pin.contractVersionId));
  if (sources.length!==pins.length) throw new Error("合成终局当前来源不完整");
  const retained: Row[]=[];
  for (const pin of pins) {
    const source=sources.find(current=>current.versionId===pin.contractVersionId);
    const side=frozen.find(item=>item.ref===pin.sourceRef);
    if (!source?.input.Q || source.input.state!=="complete" || source.input.inputSha256!==pin.inputSha256 ||
      source.draftRevision!==pin.sourceRevision || !side || side.formal!==false || side.operatingBaseline!==null ||
      side.version!==`${source.versionId}:direct:${source.draftRevision}:${source.input.inputSha256}` ||
      side.amountYuan!==source.input.Q.money.amountYuan) throw new Error("合成终局拒绝伪造或漂移来源");
    side.directInput={ Q:source.input.Q,inputSha256:source.input.inputSha256 };
    for (const item of source.input.Q.signedFiles) {
      if (typeof item.fileId!=="string" || !lockedFileIds.has(item.fileId)) throw new Error("合成终局原件没有实际取F");
      const file=await store.table("fileObject").findUnique({where:{id:item.fileId}});
      if (!file || file.storageStatus!=="active" || file.purgeReceiptId || !file.objectKey ||
        (await store.table("fileObject").count({where:{objectKey:file.objectKey}}))!==1) throw new Error("合成终局原件不可用");
      retained.push({...item,reviewId:id,sourceRef:side.ref,sourceContractVersionId:source.versionId,directInputProtocolVersion:1,
        sourceRevision:source.draftRevision,inputSha256:source.input.inputSha256,bucket:file.bucket,objectKey:file.objectKey});
    }
  }
  await store.table("contractEconomicReview").update({where:{id},data:{status:"confirmed",revision:{increment:1},contractReviewedById:actor,
    confirmedAt,frozenSources:frozen}});
  for (const reference of retained) await store.table("contractEconomicReviewFileReference").create({data:reference});
  return [{id}];
}

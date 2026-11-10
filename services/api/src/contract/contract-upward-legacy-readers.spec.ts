import { Prisma } from "@prisma/client";
import { UPWARD_SOURCE_DEFINERS } from "./contract-upward-direct-source-pins";
import { assertUpwardPendingSaveContinuity, qualifyUpwardPendingSave } from "./contract-upward-pending-save-profile";

// Existing pre-closure qualification fixture; the new source may not silently replace it.
const legacyProfile = {
  databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
  bindingOid: "42001", createBindingOid: "42002", versionRoutineOid: "42003",
  attachmentRoutineOid: "42004", slotRoutineOid: "42005", createBindingSha256: "1".repeat(64), backendPid: 71201, transactionId: "500003",
  dualIdentityCheck: true, restrictedRole: true, privateTechnicalAcl: true,
  routineBodies: {
    version: "bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f",
    attachment: "0a0b17642f39c96064f1184fcd03e4151569136c385b2ea0d94ff67dbc5963cf",
    slot: "86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999",
    save: "ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50",
    binding: "637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028",
    after: "1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059",
    file: "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
    exclusive: "e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999"
  },
  triggerOids: { jg_direct_pending_version_shape: "30001", jg_direct_pending_attachment_source: "30002",
    ContractDraftAttachment_direct_archive_transfer_v1: "30003", jg_upward_pending_save_binding_immutable: "30004",
    jg_upward_pending_save_binding_no_truncate: "30005", jg_upward_pending_save_persistent_proof: "30006",
    jg_direct_pending_file_retained: "30007", jg_direct_pending_attachment_exclusive: "30008" }
};
function catalogClient(status: "absent" | "invalid", profile = legacyProfile) {
  return { $queryRaw: async (query: Prisma.Sql) => {
    const text = query.strings.join("?");
    if (text.includes("contract_upward_pending_save_catalog_v1")) return [profile];
    if (text.includes("contract_upward_archive_projection_probe_v2")) return [{
      status, projectionOid: status === "absent" ? null : "49001", closureOid: null
    }];
    throw new Error("Unexpected catalog request");
  } } as unknown as Prisma.TransactionClient;
}

describe("旧对上来源读取与后继目录边界", () => {
  it("新闭包完整缺席仍按原保存资格读取", async () => {
    await expect(qualifyUpwardPendingSave(catalogClient("absent"))).resolves.toEqual(legacyProfile);
  });
  it("新闭包只安装一部分时不能凭旧保存目录继续办理", async () => {
    await expect(qualifyUpwardPendingSave(catalogClient("invalid"))).rejects.toMatchObject({ status: 503 });
  });
});

// This injected catalog response models an already qualified source. It does not execute or qualify SQL.
const successorSignatures = [
  'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")',
  "public.jg_check_contract_upward_pending_save_v1()", "public.jg_guard_generated_upward_seal_completion_v1()",
  'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")', "public.jg_guard_contract_direct_archive_slot_v1()",
  "public.jg_contract_archive_v2_complete_guard()", "public.jg_require_contract_direct_archive_complete_v1()",
  "public.jg_require_contract_direct_archive_generations_v1()", "public.jg_contract_archive_v2_ownership_day(text)",
  "public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)",
  "public.jg_check_contract_direct_upward_issuer_v2()",
  "public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)"
] as const;
function syntheticProjection() {
  return {
    protocolVersion: 2, recipeVersion: "contract-upward-direct-archive-v2/1", sourceClosureSha256: "c".repeat(64),
    databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
    backendPid: 71201, transactionId: "500003",
    routines: successorSignatures.map((signature, index) => ({ signature, oid: String(50001 + index), ownerOid: "9001",
      namespaceOid: "2200", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64) })),
    constraint: { beforeOid: "51001", afterOid: "51002", beforeSha256: "d".repeat(64), afterSha256: "e".repeat(64) },
    definers: Object.entries(UPWARD_SOURCE_DEFINERS).map(([signature, bodySha256], index) => ({ signature, bodySha256, oid: String(52001 + index) }))
  };
}
function successorClient(current: () => ReturnType<typeof syntheticProjection>, profile = legacyProfile) {
  return { $queryRaw: async (query: Prisma.Sql) => {
    const text = query.strings.join("?");
    if (text.includes("contract_upward_archive_projection_probe_v2")) return [{ status: "qualified", projectionOid: "49001", closureOid: "49002",
      databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
      backendPid: 71201, transactionId: "500003" }];
    if (text.includes("contract_upward_archive_projection_read_v2")) return [{ projection: current() }];
    if (text.includes("contract_upward_pending_save_catalog_v1")) return [profile];
    throw new Error("Unexpected catalog request");
  } } as unknown as Prisma.TransactionClient;
}

describe("已核后继来源在原保存入口的连续性", () => {
  it("保留原保存资格并在同一事务内拒绝后继来源漂移", async () => {
    let observation = syntheticProjection();
    const tx = successorClient(() => observation);
    const before = await qualifyUpwardPendingSave(tx);
    expect(before).toMatchObject(legacyProfile);
    await expect(assertUpwardPendingSaveContinuity(tx, before)).resolves.toBeUndefined();
    // The old projected save fields remain identical; physical successor replacement still invalidates the witness.
    observation = { ...observation, constraint: { ...observation.constraint, afterOid: "51003" } };
    await expect(assertUpwardPendingSaveContinuity(tx, before)).rejects.toMatchObject({ status: 503 });
  });
  it("拒绝来自另一事务的后继目录响应", async () => {
    await expect(qualifyUpwardPendingSave(successorClient(() => ({ ...syntheticProjection(), transactionId: "500004" }))))
      .rejects.toMatchObject({ status: 503 });
  });
});


describe("后继来源保留表外槽的真实最近前态", () => {
  const latestSlot = "99d80f7a4bb9105acda415aa7cedd6dba0266849cb9b945cb5e7b0aaf6885164";
  const latestProfile = { ...legacyProfile, routineBodies: { ...legacyProfile.routineBodies, slot: latestSlot } };
  function slotProjection() {
    const projection = syntheticProjection();
    const slot = projection.routines.find(item => item.signature === "public.jg_guard_contract_direct_archive_slot_v1()")!;
    slot.oid = legacyProfile.slotRoutineOid;
    slot.beforeSha256 = latestSlot;
    return projection;
  }
  it("仅已核同一槽OID的最近前态可保留99d哈希继续原保存路径", async () => {
    await expect(qualifyUpwardPendingSave(successorClient(slotProjection, latestProfile))).resolves.toMatchObject(latestProfile);
  });
  it("缺少后继资格时不能仅凭99d哈希放行", async () => {
    await expect(qualifyUpwardPendingSave(catalogClient("absent", latestProfile))).rejects.toMatchObject({ status: 503 });
  });
  it.each(["oid", "beforeSha256"] as const)("相同显示哈希但后继证明的%s不符仍拒绝", async field => {
    const projection = slotProjection();
    const slot = projection.routines.find(item => item.signature === "public.jg_guard_contract_direct_archive_slot_v1()")!;
    slot[field] = field === "oid" ? "42006" : "f".repeat(64);
    await expect(qualifyUpwardPendingSave(successorClient(() => projection, latestProfile))).rejects.toMatchObject({ status: 503 });
  });
});

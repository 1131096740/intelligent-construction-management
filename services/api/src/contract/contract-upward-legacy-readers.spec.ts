import { Prisma } from "@prisma/client";
import { matchesDirectOutsideOperatingReader } from "./contract-direct-outside-operating-reader-catalog";
import { qualifiedUpwardConstraintOid, qualifiedUpwardConstraintSha, type UpwardLegacyProjection } from "./contract-upward-archive-catalog";
import { observeTask12DirectSourceDiagnostic } from "./task12-direct-source-diagnostic";
import { UPWARD_NORMAL_GENERATED_PROJECTION_SHA256, UPWARD_NORMAL_VOUCHER_PROJECTION_SHA256, UPWARD_OUTSIDE_CHECK_PROJECTION_SHA256, UPWARD_PROJECTION_SOURCE_SHA256, UPWARD_SIGNED_CHANGE_FILE_ADMISSION_SHA256, UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256, UPWARD_SOURCE_DEFINERS } from "./contract-upward-direct-source-pins";
import { readUpwardArchiveAdmission } from "./contract-upward-direct-archive-native";
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
function successorClient(current: () => ReturnType<typeof syntheticProjection>, profile = legacyProfile, projectionSource = UPWARD_PROJECTION_SOURCE_SHA256) {
  return { $queryRaw: async (query: Prisma.Sql) => {
    const text = query.strings.join("?");
    if (text.includes("contract_upward_archive_projection_probe_v2")) return [{ status: query.values.includes(projectionSource) ? "qualified" : "invalid",
      projectionSource, projectionOid: "49001", closureOid: "49002",
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
  it("新应用拒绝 261 旧 projection 摘要，避免混用 262 新闭包", async () => {
    const oldProjectionSha = "785c21ee595eb128fa0911d3f18c9718457615f1d6df1abf532bf4159659210c";
    const projection = syntheticProjection();
    projection.definers = projection.definers.map(row => row.signature === "public.jg_upward_archive_catalog_projection_v2()"
      ? { ...row, bodySha256: oldProjectionSha } : row);
    await expect(qualifyUpwardPendingSave(successorClient(() => projection))).rejects.toMatchObject({ status: 503 });
  });
  it("仅在目录和权威投影摘要一致时接受表外执行权限后继", async () => {
    const projection = syntheticProjection();
    const definer = projection.definers.find(row => row.signature === "public.jg_upward_archive_catalog_projection_v2()")!;
    definer.bodySha256 = UPWARD_OUTSIDE_CHECK_PROJECTION_SHA256;
    await expect(qualifyUpwardPendingSave(successorClient(
      () => projection, legacyProfile, UPWARD_OUTSIDE_CHECK_PROJECTION_SHA256
    ))).resolves.toMatchObject(legacyProfile);
    await expect(qualifyUpwardPendingSave(successorClient(() => projection))).rejects.toMatchObject({ status: 503 });
  });
  it.each([UPWARD_NORMAL_GENERATED_PROJECTION_SHA256, UPWARD_NORMAL_VOUCHER_PROJECTION_SHA256])("仅接受目录探针与闭包一致的表内归档后继 %s", async signature => {
    const projection = syntheticProjection();
    const definer = projection.definers.find(row => row.signature === "public.jg_upward_archive_catalog_projection_v2()")!;
    definer.bodySha256 = signature;
    const candidate = successorClient(() => projection, legacyProfile, signature);
    await expect(qualifyUpwardPendingSave(candidate)).resolves.toMatchObject(legacyProfile);
    definer.bodySha256 = UPWARD_OUTSIDE_CHECK_PROJECTION_SHA256;
    await expect(qualifyUpwardPendingSave(candidate)).rejects.toMatchObject({ status: 503 });
  });
  it("拒绝来自另一事务的后继目录响应", async () => {
    await expect(qualifyUpwardPendingSave(successorClient(() => ({ ...syntheticProjection(), transactionId: "500004" }))))
      .rejects.toMatchObject({ status: 503 });
  });
  it("接受签署资料后继的精确投影和准入正文，保留同一事务校验", async () => {
    const projection = syntheticProjection();
    const definer = projection.definers.find(row => row.signature === "public.jg_upward_archive_catalog_projection_v2()")!;
    definer.bodySha256 = UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256;
    const candidate = successorClient(() => projection, legacyProfile, UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256);
    await expect(qualifyUpwardPendingSave(candidate)).resolves.toMatchObject(legacyProfile);
    projection.transactionId = "500004";
    await expect(qualifyUpwardPendingSave(candidate)).rejects.toMatchObject({ status: 503 });

    const admission = { nonce: "10000000-0000-4000-8000-000000000001", databaseOid: "13000", roleOid: "7001",
      backendPid: 71201, transactionId: "500003" };
    const client = { $queryRaw: async (query: Prisma.Sql) => query.values.includes(UPWARD_SIGNED_CHANGE_FILE_ADMISSION_SHA256)
      ? [admission] : [] } as unknown as Prisma.TransactionClient;
    await expect(readUpwardArchiveAdmission(client)).resolves.toEqual(admission);
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


it("records the underlying save query failure before preserving its public 503", async () => {
  const published = jest.fn();
  const tx = {
    $queryRaw: async (query: Prisma.Sql) => {
      if (query.strings.join("?").includes("contract_upward_archive_projection_probe_v2")) {
        return [{ status: "absent", projectionOid: null, closureOid: null }];
      }
      throw Object.assign(new Error("private query detail"), { code: "P2010", meta: { code: "42501" } });
    }
  } as unknown as Prisma.TransactionClient;
  await expect(observeTask12DirectSourceDiagnostic(() => qualifyUpwardPendingSave(tx), published))
    .rejects.toMatchObject({ status: 503 });
  expect(published.mock.calls).toEqual([[{
    phase: "SHAPE_UPWARD_SAVE_CATALOG", operation: "PRISMA_QUERY_RAW", prismaCode: "P2010", sqlState: "42501"
  }]]);
});


it("keeps the sealed OIDs and digests when normalizing the exact B7 function prefix", () => {
  const projection = syntheticProjection() as UpwardLegacyProjection;
  const prior = Prisma.sql`candidate.prior_oid`, current = Prisma.sql`candidate.current_oid`;
  const definition = Prisma.sql`pg_catalog.pg_get_constraintdef(candidate.current_oid,false)`;
  const oid = qualifiedUpwardConstraintOid(projection, prior);
  const sha = qualifiedUpwardConstraintSha(projection, current, definition);
  for (const rule of [oid, sha]) {
    expect(rule.sql).toContain("pg_catalog.starts_with");
    expect(rule.sql).toContain("pg_catalog.replace");
    expect(rule.values).toContain("CHECK (jg_upward_archive_constraint_v2(");
    expect(rule.values).toContain("CHECK ((jg_upward_archive_constraint_v2(");
    expect(rule.values).toContain(projection.constraint.afterOid);
    expect(rule.values).toContain(projection.constraint.afterSha256);
  }
  expect(oid.values).toContain(projection.constraint.beforeOid);
  expect(sha.values).toContain(projection.constraint.beforeSha256);
  const legacy = qualifiedUpwardConstraintSha(null, current, definition);
  expect(legacy.sql).not.toContain("pg_catalog.replace");
  expect(legacy.sql).toContain("pg_catalog.pg_get_constraintdef(candidate.current_oid,false)");
});

it("binds the installed outside archive reader to its proof and exact transaction", () => {
  const identity = { anchorOwnerOid: "9001", namespaceOid: "2200", databaseOid: "13000",
    sessionRoleOid: "7001", currentRoleOid: "7001", backendPid: 71201, transactionId: "500003" };
  const witness = { ...identity, ownerOid: identity.anchorOwnerOid, completionOid: "71300", routineOid: "71301" };
  const definer = { oid: witness.routineOid,
    bodySha256: "97187bfe8ea4afecec7836dfaa984f4afd095a58456b433879f485e107fb1776" };
  expect(matchesDirectOutsideOperatingReader(witness, identity, "71300", definer)).toBe(true);
  for (const bad of [null, { ...witness, transactionId: "500004" }, { ...witness, completionOid: "71302" },
    { ...witness, ownerOid: "9002" }, { ...witness, currentRoleOid: "7002" }, { ...witness, routineOid: "71302" }]) {
    expect(matchesDirectOutsideOperatingReader(bad, identity, "71300", definer)).toBe(false);
  }
  expect(matchesDirectOutsideOperatingReader(witness, identity, "71300", { ...definer, bodySha256: "0".repeat(64) })).toBe(false);
});

import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export function rejectUnqualifiedDirectArchiveWriter(): never {
  throw new ServiceUnavailableException("直签登记写入资格尚未完整核对，请保留原件和本次标识");
}

/** The attached, still-closed profile can diagnose source scope before refusing the write. */
export async function readDirectArchivePreflightProfile(tx: Prisma.TransactionClient, completionAttached: boolean) {
  try {
    const rows = await tx.$queryRaw<Array<{ routineCount: number; parentGuardCount: number; transitionGuardCount: number }>>(Prisma.sql`
      /* contract_direct_archive_writer_probe_v1 */
      SELECT (SELECT count(*)::integer FROM pg_catalog.pg_proc p
        WHERE p.pronamespace=n.oid AND p.proname IN (
          'jg_assert_contract_direct_archive_write_profile_v1','jg_write_contract_direct_archive_v1'
        )) AS "routineCount",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p
          WHERE p.pronamespace=n.oid AND p.proname='jg_guard_contract_direct_archive_parent_v1') AS "parentGuardCount",
        (SELECT count(*)::integer FROM pg_catalog.pg_proc p WHERE p.pronamespace=n.oid AND p.proname IN (
          'jg_require_contract_direct_archive_transition_profile_v1','jg_guard_contract_direct_archive_version_transition_v1',
          'jg_guard_contract_direct_archive_slot_v1')) AS "transitionGuardCount"
      FROM pg_catalog.pg_namespace n WHERE n.nspname='public'
    `);
    const row = rows.length === 1 ? rows[0] : null;
    if (!completionAttached && row?.routineCount === 0 && row.parentGuardCount === 0 && row.transitionGuardCount === 0) return "legacy";
    if (completionAttached && row?.routineCount === 2 && row.parentGuardCount === 1 && row.transitionGuardCount === 3) return "attached_closed";
  } catch {
    // Failed observations never establish absence.
  }
  rejectUnqualifiedDirectArchiveWriter();
}

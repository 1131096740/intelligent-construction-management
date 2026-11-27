import { BadRequestException } from "@nestjs/common";
import type { PrecheckHistoryExpenseDto } from "./dto/history-expense.dto";
import {
  HISTORY_EXPENSE_MAX_ROWS,
  historyExpenseImportFingerprint,
  normalizeHistoryExpenseRow,
  summarizeHistoryExpenseRows,
  type NormalizedHistoryExpenseRow
} from "./history-expense.domain";
import type { HistoryExpensePrecheckResult, HistoryExpensePrecheckRow } from "./history-expense.service";

export function evaluateHistoryExpenseRows(
  rows: NormalizedHistoryExpenseRow[],
  existing: Array<{
    businessRef: string | null;
    occurredAt: Date | null;
    amountCents: bigint | null;
    generatedFactId: string | null;
  }>,
  effectiveDate: Date | null
): HistoryExpensePrecheckResult {
  const fingerprintsInWorkbook = new Map<string, number>();
  const output: HistoryExpensePrecheckRow[] = [];
  for (const [index, normalized] of rows.entries()) {
    const issues = [...normalized.issues];
    let duplicateStatus: HistoryExpensePrecheckRow["duplicateStatus"] = "none";
    let duplicateNote: string | null = null;
    const duplicateRowNo = fingerprintsInWorkbook.get(normalized.fingerprint);
    if (duplicateRowNo !== undefined) {
      duplicateStatus = "confirmed";
      duplicateNote = `与第 ${duplicateRowNo} 行完全重复`;
      issues.push({
        code: "duplicate_in_workbook",
        severity: "error",
        fieldKey: "businessRef",
        message: `该行与本次导入第 ${duplicateRowNo} 行完全重复，请删除重复行`
      });
    }
    fingerprintsInWorkbook.set(normalized.fingerprint, index + 1);
    const exact = existing.find(
      (row) =>
        row.occurredAt &&
        row.occurredAt.toISOString().slice(0, 10) ===
          normalized.occurredAt.toISOString().slice(0, 10) &&
        row.amountCents === normalized.amountCents &&
        row.businessRef === normalized.businessRef
    );
    const sameBusinessRef = existing.find(
      (row) => row.businessRef && row.businessRef === normalized.businessRef
    );
    if (exact) {
      duplicateStatus = "confirmed";
      duplicateNote = "与既有历史费用批次完全重复";
      issues.push({
        code: exact.generatedFactId ? "already_posted_duplicate" : "duplicate_in_existing_batch",
        severity: "error",
        fieldKey: "businessRef",
        message: exact.generatedFactId
          ? "该行已入账，不能再次导入；更正请走反转+重登"
          : "该行已在既有历史费用批次中，重复导入不会新增"
      });
    } else if (sameBusinessRef) {
      duplicateStatus = "suspected";
      duplicateNote = "业务整理编号已在既有批次出现，请人工说明";
      issues.push({
        code: "business_ref_reused",
        severity: "warning",
        fieldKey: "businessRef",
        message: "业务整理编号已在既有历史费用批次出现，请在核实说明中确认是否同一事实"
      });
    }
    if (
      effectiveDate &&
      normalized.occurredAt >= effectiveDate
    ) {
      issues.push({
        code: "post_effective_history_expense",
        severity: "error",
        fieldKey: "occurredAt",
        message: "发生日期不在经营账启用日前，请走正式费用流程"
      });
    }
    output.push({
      ...normalized,
      rowNo: index + 1,
      duplicateStatus,
      duplicateNote,
      issues
    });
  }
  const summary = summarizeHistoryExpenseRows(
    output.map((row) => ({
      reviewStatus: "pending",
      posted: false,
      amountCents: row.amountCents,
      paidCents: row.paidCents,
      paymentStatus: row.paymentStatus,
      costCategoryCode: row.costCategoryCode
    }))
  );
  return {
    rows: output,
    summary,
    zeroWrites: true,
    importFingerprint: historyExpenseImportFingerprint(output),
    blockingRows: output.filter((row) => row.issues.some((issue) => issue.severity === "error")).length,
    warningRows: output.filter((row) => row.issues.some((issue) => issue.severity === "warning")).length,
    batchStatusCounts: {}
  };
}


export function normalizeHistoryExpenseInputRows(
  input: PrecheckHistoryExpenseDto,
  normalize = normalizeHistoryExpenseRow
): NormalizedHistoryExpenseRow[] {
  if (!Array.isArray(input.rows) || !input.rows.length) {
    throw new BadRequestException("历史费用批次至少需要一行");
  }
  if (input.rows.length > HISTORY_EXPENSE_MAX_ROWS) throw new BadRequestException("单次历史费用导入最多500行");
  return input.rows.map((row) => {
    if (!row || typeof row.values !== "object" || Array.isArray(row.values)) {
      throw new BadRequestException("历史费用行必须是业务字段对象");
    }
    return normalize(row.values, {
      today: new Date().toISOString().slice(0, 10)
    });
  });
}

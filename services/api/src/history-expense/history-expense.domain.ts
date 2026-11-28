import {
  PRIMARY_COST_CATEGORY_CODES,
  PRIMARY_COST_CATEGORY_LABELS,
  type PrimaryCostCategoryCode
} from "@jiangkong/shared-domain";
import {
  canonicalize,
  fingerprint,
  parseAmountCents,
  parseDateOnly
} from "../operating-takeover/operating-takeover.utils";

/**
 * 历史无合同费用批量核实入账（HIS-10 / HIS-11 / HIS-12）。
 *
 * 本模块只解释“接管前已经发生什么”：
 * - 费用与已付只在历史事实中确认一次，不写资金账户，不再次扣启用时现金/公司资金；
 * - 付款状态未知就是未知，不能当作已付或未付；
 * - 空白金额不是 0，显式 0 才是不发生费用；
 * - 公司/资金来源不明时费用与实付仍可确认，主体来源保留待核对。
 */
export const HISTORY_EXPENSE_SOURCE_TYPE = "history_expense_batch";
export const HISTORY_EXPENSE_SCENE_KEY = "historical_expense";
export const HISTORY_EXPENSE_CORRECTION_SOURCE_TYPE = "history_expense_correction";
export const HISTORY_EXPENSE_MAX_ROWS = 500;

export const HISTORY_EXPENSE_PAYMENT_STATUSES = [
  "paid",
  "unpaid",
  "partially_paid",
  "unknown"
] as const;
export type HistoryExpensePaymentStatus =
  (typeof HISTORY_EXPENSE_PAYMENT_STATUSES)[number];

export const HISTORY_EXPENSE_PAYMENT_STATUS_LABELS = Object.freeze({
  paid: "已付款",
  unpaid: "未付款",
  partially_paid: "部分付款",
  unknown: "付款状态待核对"
} as const satisfies Readonly<Record<HistoryExpensePaymentStatus, string>>);

export const HISTORY_EXPENSE_REVIEW_OUTCOMES = [
  "verified",
  "pending",
  "not_occurred"
] as const;
export type HistoryExpenseReviewOutcome =
  (typeof HISTORY_EXPENSE_REVIEW_OUTCOMES)[number];

export const HISTORY_EXPENSE_REVIEW_OUTCOME_LABELS = Object.freeze({
  verified: "已核实入账",
  pending: "待核对",
  not_occurred: "未发生"
} as const satisfies Readonly<Record<HistoryExpenseReviewOutcome, string>>);

export type HistoryExpenseIssue = {
  code: string;
  severity: "error" | "warning";
  fieldKey?: string;
  message: string;
};

export interface NormalizedHistoryExpenseRow {
  businessRef: string | null;
  occurredAt: Date;
  amountCents: bigint;
  paidCents: bigint | null;
  paymentStatus: HistoryExpensePaymentStatus;
  costCategoryCode: PrimaryCostCategoryCode | null;
  values: Record<string, unknown>;
  fingerprint: string;
  issues: HistoryExpenseIssue[];
}

export interface SummarizableHistoryExpenseRow {
  reviewStatus: string;
  posted: boolean;
  amountCents: bigint;
  paidCents: bigint | null;
  paymentStatus: string;
  costCategoryCode: string | null;
}

export interface HistoryExpenseCategorySummary {
  code: PrimaryCostCategoryCode;
  label: string;
  rowCount: number;
  amountCents: string;
  postedAmountCents: string;
}

export interface HistoryExpenseSummary {
  totalRows: number;
  verifiedRows: number;
  pendingRows: number;
  notOccurredRows: number;
  activatedRows: number;
  unknownPaymentRows: number;
  unpaidRows: number;
  zeroAmountRows: number;
  pendingSourceRows: number;
  totalAmountCents: string;
  verifiedAmountCents: string;
  postedAmountCents: string;
  pendingAmountCents: string;
  paidAmountCents: string;
  categories: HistoryExpenseCategorySummary[];
}

const paymentStatusSet = new Set<string>(HISTORY_EXPENSE_PAYMENT_STATUSES);
const categorySet = new Set<string>(PRIMARY_COST_CATEGORY_CODES);

export function isHistoryExpensePaymentStatus(
  value: string
): value is HistoryExpensePaymentStatus {
  return paymentStatusSet.has(value);
}

export function isHistoryExpenseReviewOutcome(
  value: string
): value is HistoryExpenseReviewOutcome {
  return (HISTORY_EXPENSE_REVIEW_OUTCOMES as readonly string[]).includes(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | null {
  const result = text(value);
  return result.length ? result : null;
}

function issue(
  code: string,
  message: string,
  fieldKey: string,
  severity: "error" | "warning" = "error"
): HistoryExpenseIssue {
  return { code, message, fieldKey, severity };
}

export function normalizeHistoryExpenseRow(
  input: Record<string, unknown>,
  options: { today?: string } = {}
): NormalizedHistoryExpenseRow {
  const issues: HistoryExpenseIssue[] = [];
  const businessRef = optionalText(input.businessRef);
  if (!businessRef) issues.push(issue("businessRef_required", "请填写业务整理编号", "businessRef"));
  if (businessRef && businessRef.length > 100) {
    issues.push(issue("businessRef_too_long", "业务整理编号不能超过100个字符", "businessRef"));
  }

  let occurredAt = new Date(0);
  const occurredAtText = text(input.occurredAt);
  if (!occurredAtText) {
    issues.push(issue("occurred_at_required", "请填写发生日期", "occurredAt"));
  } else {
    try {
      occurredAt = parseDateOnly(occurredAtText);
      const today = options.today ?? new Date().toISOString().slice(0, 10);
      if (occurredAtText > today) {
        issues.push(issue("future_occurred_at", "历史费用不能填写未来发生日期", "occurredAt"));
      }
    } catch {
      issues.push(issue("invalid_occurred_at", "发生日期必须使用 YYYY-MM-DD", "occurredAt"));
    }
  }

  const purpose = text(input.purpose);
  if (!purpose) issues.push(issue("purpose_required", "请填写费用用途", "purpose"));
  if (purpose.length > 200) issues.push(issue("purpose_too_long", "费用用途不能超过200个字符", "purpose"));

  const categoryText = text(input.costCategoryCode);
  const costCategoryCode = categorySet.has(categoryText)
    ? (categoryText as PrimaryCostCategoryCode)
    : null;
  if (!costCategoryCode) {
    issues.push(issue("invalid_cost_category", "请选择有效的费用类别", "costCategoryCode"));
  }

  let amountCents = 0n;
  const amountText = text(input.amountYuan);
  if (!amountText) {
    issues.push(issue("amount_required", "请填写费用金额；确实未发生请填写0并标记未发生", "amountYuan"));
  } else {
    try {
      amountCents = parseAmountCents(amountText);
    } catch (error) {
      issues.push(
        issue(
          "invalid_amount",
          error instanceof Error ? error.message : "费用金额格式不正确",
          "amountYuan"
        )
      );
    }
  }
  if (amountText && amountCents === 0n) {
    issues.push(issue("zero_amount", "金额为0，请核实是否属于未发生费用", "amountYuan", "warning"));
  }

  const paymentStatusText = text(input.paymentStatus);
  const paymentStatus: HistoryExpensePaymentStatus = isHistoryExpensePaymentStatus(paymentStatusText)
    ? paymentStatusText
    : "unknown";
  if (!isHistoryExpensePaymentStatus(paymentStatusText)) {
    issues.push(issue("invalid_payment_status", "请选择真实的付款情况", "paymentStatus"));
  }

  let paidCents: bigint | null = null;
  const paidText = text(input.paidAmountYuan);
  if (paidText && ["unpaid", "unknown"].includes(paymentStatusText)) {
    issues.push(
      issue(
        paymentStatusText === "unpaid" ? "unpaid_payment_amount" : "unknown_payment_amount",
        paymentStatusText === "unpaid"
          ? "未付款行不能填写已付金额"
          : "付款状态待核对时不能先填写已付金额，避免把未知当已付",
        "paidAmountYuan"
      )
    );
  } else if (paymentStatusText === "paid") {
    if (paidText) {
      try {
        paidCents = parseAmountCents(paidText);
        if (paidCents !== amountCents) {
          issues.push(issue("full_payment_mismatch", "已付款金额必须等于费用金额", "paidAmountYuan"));
        }
      } catch (error) {
        issues.push(
          issue("invalid_paid_amount", error instanceof Error ? error.message : "已付金额格式不正确", "paidAmountYuan")
        );
      }
    } else {
      paidCents = amountCents;
    }
  } else if (paymentStatusText === "partially_paid") {
    if (!paidText) {
      issues.push(issue("partial_payment_required", "部分付款请填写已付金额", "paidAmountYuan"));
    } else {
      try {
        paidCents = parseAmountCents(paidText);
        if (paidCents <= 0n || paidCents >= amountCents) {
          issues.push(
            issue("partial_payment_range", "部分付款的已付金额必须大于0且小于费用金额", "paidAmountYuan")
          );
        }
      } catch (error) {
        issues.push(
          issue("invalid_paid_amount", error instanceof Error ? error.message : "已付金额格式不正确", "paidAmountYuan")
        );
      }
    }
  }

  if (paymentStatusText === "unknown") {
    issues.push(
      issue("payment_status_pending", "付款状态待核对，不按已付或未付记账", "paymentStatus", "warning")
    );
  }

  const paymentDate = optionalText(input.paymentDate);
  if (paymentDate) {
    try {
      parseDateOnly(paymentDate);
      const today = options.today ?? new Date().toISOString().slice(0, 10);
      if (paymentDate > today) {
        issues.push(issue("future_payment_date", "付款日期不能是未来日期", "paymentDate"));
      }
    } catch {
      issues.push(issue("invalid_payment_date", "付款日期必须使用 YYYY-MM-DD", "paymentDate"));
    }
  }

  const costBearingCompanyName = optionalText(input.costBearingCompanyName);
  const payerCompanyName = optionalText(input.payerCompanyName);
  if (!costBearingCompanyName) {
    issues.push(
      issue(
        "cost_company_pending",
        "成本承担公司待核对；入账前必须明确到具体公司",
        "costBearingCompanyName",
        "warning"
      )
    );
  }
  if ((paymentStatusText === "paid" || paymentStatusText === "partially_paid") && !payerCompanyName) {
    issues.push(
      issue(
        "payer_source_pending",
        "费用与实付可确认，付款公司/资金来源待核对",
        "payerCompanyName",
        "warning"
      )
    );
  }

  const sourceDescription = text(input.sourceDescription);
  if (!sourceDescription) {
    issues.push(issue("source_required", "请填写已有依据或资料来源", "sourceDescription"));
  }

  const values: Record<string, unknown> = {
    businessRef,
    occurredAt: occurredAtText || null,
    purpose: purpose || null,
    costCategoryCode: costCategoryCode ?? null,
    amountYuan: amountText || null,
    paymentStatus: isHistoryExpensePaymentStatus(paymentStatusText)
      ? paymentStatusText
      : null,
    paidAmountYuan: paidText || null,
    paymentDate: paymentDate || null,
    costBearingCompanyName,
    payerCompanyName,
    payeeName: optionalText(input.payeeName),
    sourceDescription: sourceDescription || null,
    note: optionalText(input.note),
    evidenceLevel: null
  };

  return {
    businessRef,
    occurredAt,
    amountCents,
    paidCents,
    paymentStatus,
    costCategoryCode,
    values,
    fingerprint: fingerprint(values),
    issues
  };
}

export function historyExpenseImportFingerprint(
  rows: ReadonlyArray<Pick<NormalizedHistoryExpenseRow, "fingerprint">>
): string {
  return fingerprint(rows.map((row) => row.fingerprint).sort());
}

export function historyExpenseHasBlockingIssue(
  row: Pick<NormalizedHistoryExpenseRow, "issues">
): boolean {
  return row.issues.some((entry) => entry.severity === "error");
}

export function summarizeHistoryExpenseRows(
  rows: ReadonlyArray<SummarizableHistoryExpenseRow>
): HistoryExpenseSummary {
  const categories = new Map<PrimaryCostCategoryCode, HistoryExpenseCategorySummary>();
  let totalAmountCents = 0n;
  let verifiedAmountCents = 0n;
  let postedAmountCents = 0n;
  let pendingAmountCents = 0n;
  let paidAmountCents = 0n;
  let verifiedRows = 0;
  let pendingRows = 0;
  let notOccurredRows = 0;
  let activatedRows = 0;
  let unknownPaymentRows = 0;
  let unpaidRows = 0;
  let zeroAmountRows = 0;
  let pendingSourceRows = 0;
  for (const row of rows) {
    totalAmountCents += row.amountCents;
    if (row.paidCents !== null) paidAmountCents += row.paidCents;
    if (row.amountCents === 0n) zeroAmountRows += 1;
    if (row.paymentStatus === "unknown") unknownPaymentRows += 1;
    if (row.paymentStatus === "unpaid") unpaidRows += 1;
    if (row.costCategoryCode && !categorySet.has(row.costCategoryCode)) pendingSourceRows += 1;
    if (row.reviewStatus === "verified" || row.reviewStatus === "activated") verifiedRows += 1;
    if (row.reviewStatus === "pending") pendingRows += 1;
    if (row.reviewStatus === "not_occurred") notOccurredRows += 1;
    if (row.reviewStatus === "activated" || row.posted) {
      activatedRows += 1;
      postedAmountCents += row.amountCents;
    } else if (row.reviewStatus === "verified") {
      verifiedAmountCents += row.amountCents;
    } else if (row.reviewStatus === "pending") {
      pendingAmountCents += row.amountCents;
    }
    const code = row.costCategoryCode as PrimaryCostCategoryCode | null;
    if (code && categorySet.has(code)) {
      const existing = categories.get(code) ?? {
        code,
        label: PRIMARY_COST_CATEGORY_LABELS[code],
        rowCount: 0,
        amountCents: "0",
        postedAmountCents: "0"
      };
      existing.rowCount += 1;
      existing.amountCents = (BigInt(existing.amountCents) + row.amountCents).toString();
      if (row.reviewStatus === "activated" || row.posted) {
        existing.postedAmountCents = (
          BigInt(existing.postedAmountCents) + row.amountCents
        ).toString();
      }
      categories.set(code, existing);
    }
  }
  return {
    totalRows: rows.length,
    verifiedRows,
    pendingRows,
    notOccurredRows,
    activatedRows,
    unknownPaymentRows,
    unpaidRows,
    zeroAmountRows,
    pendingSourceRows,
    totalAmountCents: totalAmountCents.toString(),
    verifiedAmountCents: verifiedAmountCents.toString(),
    postedAmountCents: postedAmountCents.toString(),
    pendingAmountCents: pendingAmountCents.toString(),
    paidAmountCents: paidAmountCents.toString(),
    categories: [...categories.values()].sort((a, b) => a.code.localeCompare(b.code))
  };
}

export function historyExpenseValuesForStorage(
  values: Record<string, unknown>
): Record<string, unknown> {
  return canonicalize(values) as Record<string, unknown>;
}

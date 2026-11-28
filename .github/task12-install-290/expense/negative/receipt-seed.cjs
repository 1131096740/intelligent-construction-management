'use strict';

function retainedFixtureSql(label, mode) {
  const actor = `receipt_${label}_actor`;
  const applicant = mode === "actorMissing"
    ? `receipt_${label}_missing_actor`
    : actor;
  const request = `receipt_${label}_request`;
  const confirmed = !["shapeInvalid", "auditReverse"].includes(mode);
  const confirmedAt = mode === "shapeInvalid" || confirmed
    ? "'2026-07-31T01:00:00.000Z'"
    : "NULL";
  const confirmedBy = mode === "shapeInvalid"
    ? "NULL"
    : confirmed
      ? `'${applicant}'`
      : "NULL";
  const expenseType = mode === "businessInvalid"
    ? "reimbursement"
    : "spot_purchase";
  const expenseSubtype = mode === "businessInvalid"
    ? "reimbursement"
    : "spot_material_purchase";
  const shouldAudit = mode !== "auditMissing" && mode !== "shapeInvalid";
  const auditConfirmedAt = "2026-07-31T01:00:00.000Z";

  return `
    INSERT INTO "User" (
      "id", "name", "mustChangePassword", "isActive", "updatedAt"
    ) VALUES (
      '${actor}', '收货存量测试人', FALSE, TRUE, CURRENT_TIMESTAMP
    );
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (
      'receipt_${label}_project', 'receipt_${label}_project_code',
      '收货存量项目', CURRENT_TIMESTAMP
    );
    INSERT INTO "ProjectExpenseRequest" (
      "id", "projectId", "code", "expenseType", "expenseSubtype",
      "paymentSubject", "reason", "requestedAmountCents",
      "approvedAmountCents", "paidAmountCents", "paymentMethod",
      "handlerUserId", "applicantUserId", "purchaseExecutedByUserId",
      "purchaseExecutedAt", "receiptConfirmedByUserId",
      "receiptConfirmedAt", "receiptConfirmationNote", "status",
      "updatedAt"
    ) VALUES (
      '${request}', 'receipt_${label}_project', 'receipt_${label}_code',
      '${expenseType}', '${expenseSubtype}', '收货存量测试',
      '迁移闭合验收', 1000, 1000, 1000, 'bank_transfer',
      '${applicant}', '${applicant}', '${applicant}',
      '2026-07-31T00:00:00.000Z', ${confirmedBy}, ${confirmedAt},
      ${confirmed ? "'存量收货'" : "NULL"}, 'paid',
      '2026-07-31T00:30:00.000Z'
    );
    ${shouldAudit ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId",
        "metadata"
      ) VALUES (
        'receipt_${label}_audit', '${applicant}',
        'project_expense.receipt.confirm', 'project_expense_request',
        '${request}', jsonb_build_object(
          'projectId', 'receipt_${label}_project',
          'confirmedAt', '${auditConfirmedAt}'
        )
      );
    ` : ""}
    ${mode === "auditDuplicate" ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId",
        "metadata"
      ) VALUES (
        'receipt_${label}_audit_duplicate', '${applicant}',
        'project_expense.receipt.confirm', 'project_expense_request',
        '${request}', jsonb_build_object(
          'projectId', 'receipt_${label}_project',
          'confirmedAt', '${auditConfirmedAt}'
        )
      );
    ` : ""}
  `;
}
module.exports={retainedFixtureSql};

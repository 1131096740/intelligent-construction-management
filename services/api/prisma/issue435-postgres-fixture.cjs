"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");

const migrationDirectory = "20261129020000_company_transfer_settled_return";
const read = (directory) => readFileSync(path.join(__dirname, "migrations", directory, "migration.sql"), "utf8");

function section(sql, from, to) {
  const start = sql.indexOf(from);
  const end = sql.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error("缺少隔离迁移所需的既有 SQL 定义");
  return sql.slice(start, end);
}

// prisma db push supplies the base tables. Reconstruct the immediate preimage
// of the delta and install existing guards from their owning migrations.
function preimage() {
  const authority = read("20260814120000_operating_ledger_runtime_write_guard");
  const fundExecution = read("20260831120000_pol13d_fund_execution_v7");
  const impactWriter = read("20261019120000_operating_impact_created_at_return");
  const refund = read("20261123220000_actual_purchase_batch");
  const eventWriter = read("20261020150000_contract_finance_runtime_boundary");
  const transferOperating = read("20261020130000_company_transfer_repayment_ownership");
  return [
    `ALTER TABLE public."PaymentExecutionRefund"
        DROP COLUMN "companyTransferDebtCorrectionId",
        DROP COLUMN "companyTransferReturnEventId",
        DROP COLUMN "companyTransferIncomingEventId",
        ALTER COLUMN "projectId" SET NOT NULL,
        ADD CONSTRAINT "PaymentExecutionRefund_amount_positive_check" CHECK ("amountCents" > 0),
        ADD CONSTRAINT "PaymentExecutionRefund_reason_check" CHECK (length(btrim("reason")) > 0),
        ADD CONSTRAINT "PaymentExecutionRefund_fingerprint_check" CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$');
      ALTER TABLE public."CompanyTransferEvent" DROP COLUMN "returnedIncomingEventId";
    `,
    section(authority, 'CREATE TYPE "OperatingLedgerFactWritePayload"', 'CREATE TABLE "OperatingLedgerWriteContext"'),
    section(fundExecution, 'ALTER TYPE "OperatingLedgerFactWritePayload"', 'CREATE OR REPLACE FUNCTION "appendOperatingImpactThroughService"'),
    section(impactWriter, 'CREATE FUNCTION public."appendOperatingImpactThroughService"', '$definition$;'),
    read("20261019140000_operating_context_noop_update"),
    section(eventWriter, 'CREATE FUNCTION public.append_company_transfer_event', "COMMIT;"),
    section(refund, 'ALTER TABLE "PaymentExecutionRefund"\n  DROP CONSTRAINT', 'CREATE FUNCTION public."jg_actual_purchase_batch_guard"'),
    refund.slice(refund.indexOf('CREATE OR REPLACE FUNCTION public."jg_payment_execution_refund_guard"')),
    transferOperating.slice(transferOperating.indexOf('CREATE FUNCTION public.jg_validate_company_transfer_fact_identity()')).replace(/\nCOMMIT;\s*$/u, ""),
    'INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash") VALUES (1, public.crypt(:\'issue435_secret\', public.gen_salt(\'bf\')));',
  ].join("\n");
}

module.exports = { preimage, migrationDirectory, migration: () => read(migrationDirectory) };

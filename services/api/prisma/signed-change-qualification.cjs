"use strict";

const { randomBytes } = require("node:crypto");

function createSignedChangeQualification(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^\/(?:jiangkong_(?:pol114|governance_uat)|jg_task01_[a-f0-9]{32})$/u.test(url.pathname)) {
    throw new Error("补充协议验收只允许使用本机专用 PostgreSQL");
  }

  const role = url.pathname === "/jiangkong_pol114" ? "pol114_signed_change_qualification"
    : `signed_change_qualification_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  const witnessKey = randomBytes(32).toString("hex");
  url.username = role;
  url.password = password;
  url.searchParams.set("connection_limit", "3");

  // The same non-owner session and bound witness checks used by the Line A fixture.
  // Other API traffic (including fixture setup, login and payment reads) stays on its own connection.
  const install = [
    `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD '${password}'`,
    `GRANT CONNECT ON DATABASE ${url.pathname.slice(1)} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON public."User", public."UserPosition", public."Position", public."ProjectMember", public."Project", public."Contract", public."ContractVersion", public."FileObject", public."Settlement", public."PaymentRequest", public."PaymentExecution", public."ContractTakeover" TO ${role}`,
    `GRANT SELECT ("settlementId", "voidedAt", "amountCents") ON public."ProjectProxyPayment" TO ${role}`,
    `GRANT INSERT ON public."AuditLog" TO ${role}`,
    `GRANT EXECUTE ON FUNCTION public.jg_submit_contract_signed_change_v1(text,text,text,text,text,text,integer,integer,text,text,text,text,text), public.jg_read_contract_signed_change_review_v1(text,text,text,text), public.jg_review_contract_signed_change_v1(text,text,text,text,text,text,text,text,text,text,integer,integer,text,text), public.jg_list_contract_signed_changes_v1(text,text,text) TO ${role}`,
    `INSERT INTO public.jg_contract_signed_change_submit_witness (singleton, "key", "databaseOid", "runtimeRoleOid") SELECT true, decode('${witnessKey}', 'hex'), oid, '${role}'::regrole::oid FROM pg_database WHERE datname = current_database()`
  ];
  const uninstall = [
    `DELETE FROM public.jg_contract_signed_change_submit_witness WHERE "runtimeRoleOid" = '${role}'::regrole::oid`,
    `DROP OWNED BY ${role}`,
    `DROP ROLE ${role}`
  ];
  return { databaseUrl: url.toString(), witnessKey, install, uninstall };
}

module.exports = { createSignedChangeQualification };

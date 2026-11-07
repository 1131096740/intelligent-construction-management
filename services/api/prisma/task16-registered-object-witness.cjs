"use strict";
// Fixed Task16 seven-fragment DDL scope; not a generic schema attestation tool.
const TABLES=["RegisteredPaymentFunding","RegisteredFundPaymentAllocation","RegisteredPaymentEvent","RegisteredPaymentVoucher","RegisteredContractHistoryRevision","RegisteredFundAccount","FundAccountBalanceRegistration","PaymentExecution","InterEntityRelationshipEntry","OperatingFact","OperatingImpactEntry","Contract","ContractTakeover","PaymentExecutionAllocation"];
function registeredObjectWitnessSql(){
 const names=TABLES.map(name=>`'${name}'`).join(",");
 const scope=`n.nspname='public' AND c.relname IN (${names})`;
 return `pg_catalog.jsonb_build_object(
 'columns',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'number',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)) ORDER BY c.relname,a.attnum),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${scope}),
 'constraints',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_catalog.pg_get_constraintdef(k.oid,false)) ORDER BY c.relname,k.conname),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid WHERE ${scope}),
 'triggers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_catalog.pg_get_triggerdef(t.oid,false)) ORDER BY c.relname,t.tgname),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE ${scope}))`;
}
module.exports={registeredObjectWitnessSql};

'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { renderFileRegistryGrant } = require('./task12-onboarding-282-admission.cjs');
const material = require('./onboarding-acl-material.json');

function need(condition, phase) {
  if (!condition) throw new Error('ONBOARDING_FIXED_ROLE_' + phase);
}

const selectCatalogSql = `SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,
  'kind',c.relkind) ORDER BY c.relname COLLATE "C"),'[]'::jsonb)
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f');`;

function verifyBaseline(baseline) {
  need(Array.isArray(baseline) && baseline.length > 100 && baseline.length <= 1024
    && Buffer.byteLength(JSON.stringify(baseline)) <= 131072
    && new Set(baseline.map(row=>row?.name)).size === baseline.length
    && baseline.every(row=>/^[_A-Za-z][_A-Za-z0-9]{0,62}$/u.test(row?.name) &&
      /^[1-9][0-9]{0,9}$/u.test(row.oid) && BigInt(row.oid) <= 4294967295n &&
      /^[rpvmf]$/u.test(row.kind)), 'BASELINE');
}

function renderOriginalSetup(database, password, baseline, current) {
  verifyBaseline(baseline);
  verifyBaseline(current);
  need(/^[a-f0-9]{96}$/u.test(password),'PASSWORD');
  const byName=new Map(current.map(row=>[row.name,row]));
  need(baseline.every(row=>byName.get(row.name)?.oid===row.oid && byName.get(row.name)?.kind===row.kind),'RELATION_IDENTITY');
  const anchor = 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${runtime};';
  need(material.bootstrap.split(anchor).length===2,'LEGACY_SELECT_ANCHOR');
  const fixed = material.bootstrap.replace(anchor,
    'GRANT SELECT ON TABLE ' + baseline.map(row=>'public."' + row.name + '"').join(', ') + ' TO onboarding_runtime;')
    .replaceAll('${runtime}','onboarding_runtime').replaceAll('${password}',password);
  return 'BEGIN;\n' + fixed + '\n' + renderFileRegistryGrant(database) + '\nCOMMIT;';
}

function renderOriginalHardening() {
  const source=fs.readFileSync(path.join(__dirname,'employee-onboarding-runtime-grants.sql'));
  need(createHash('sha256').update(source).digest('hex')===material.authorizationSha256,'HISTORICAL_ACL_SOURCE');
  const boundary='\\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE';
  const sql=source.toString('utf8');
  need(sql.split(boundary).length===2,'HISTORICAL_PSQL_BINDING');
  return sql.replace(boundary,'\\set runtime_role onboarding_runtime');
}

module.exports = { selectCatalogSql, verifyBaseline, renderOriginalSetup, renderOriginalHardening };

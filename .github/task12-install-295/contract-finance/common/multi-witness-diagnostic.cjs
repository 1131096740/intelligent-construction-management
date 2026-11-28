'use strict';
const {name}=require('./multi-witness.cjs');
const reasons=new Map([
  ['company_transfer_ordinary_multi_witness_preimage','PROTECTED_TABLE_PREIMAGE'],
  ['company_transfer_ordinary_multi_witness_routine','PROTECTED_ROUTINE_PREIMAGE'],
  ['company_transfer_ordinary_multi_witness_triggers','PROTECTED_TRIGGER_PREIMAGE'],
  ['record "expected" has no field "trigger_name"','EXPECTED_RECORD_TRIGGER_FIELD'],
  ['record "expected" has no field "trigger_type"','EXPECTED_RECORD_TRIGGER_FIELD'],
  ['column reference "expected.signature" is ambiguous','EXPECTED_ALIAS_AMBIGUITY'],
  ['could not determine polymorphic type','SQL_TYPE_RESOLUTION'],
  ['permission denied','PERMISSION_DENIED'],
  ['deadlock detected','DEADLOCK'],
  ['canceling statement due to statement timeout','STATEMENT_TIMEOUT'],
  ['migration failed to apply','MIGRATION_APPLY_FAILED'],
  ['found failed migrations','PREVIOUS_MIGRATION_FAILED'],
]);
function select(channel,text) {
  if(typeof text!=='string'||text.length===0) return [];
  const lines=text.split(/\r?\n/u).filter(Boolean).slice(0,160);
  const result={channel,lineCount:lines.length};
  const codes=(pattern)=>[...new Set(lines.flatMap(line=>[...line.matchAll(pattern)].map(match=>match[1])))].slice(0,4);
  const prisma=codes(/\b(P[0-9]{4})\b/gu);
  const sqlstates=codes(/(?:Database error code:|SQLSTATE[=:]?|ERROR:|Code:\s*Some\()\s*["`']?([0-9A-Z]{5})(?=["`':\s,)]|$)/gu)
    .filter(code=>!/^P[0-9]{4}$/u.test(code)||code==='P0001'||code==='P0002');
  const markers=[...reasons].filter(([raw])=>lines.some(line=>line.includes(raw))).map(([,label])=>label);
  if(prisma.length)result.prisma=prisma;
  if(sqlstates.length)result.sqlstates=sqlstates;
  if(markers.length)result.markers=markers;
  if(lines.some(line=>line.includes(name)))result.exactMigrationMentioned=true;
  const plpgsqlLine=lines.map(line=>line.match(/PL\/pgSQL function inline_code_block line ([0-9]{1,3})\b/u)?.[1]).find(Boolean);
  if(plpgsqlLine)result.plpgsqlLine=Number(plpgsqlLine);
  return [result];
}
function projectCommand(result) {
  return [...select('stdout',result.stdout),...select('stderr',result.stderr)];
}
function projectLedger(rows) {
  if(!Array.isArray(rows)||rows.length!==1)return {exactEntryCount:Array.isArray(rows)?rows.length:null};
  const [row]=rows;
  return {exactEntryCount:1,finished:row.finished===true,rolledBack:row.rolledBack===true,
    logs:select('prisma-ledger',row.logs)};
}
module.exports={projectCommand,projectLedger};

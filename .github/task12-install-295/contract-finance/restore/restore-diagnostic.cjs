'use strict';

const {technical}=require('./archive-contract.cjs');

const objectTypes=[
  'FK CONSTRAINT','TABLE ATTACH','TABLE DATA','INDEX ATTACH','SEQUENCE OWNED BY',
  'DEFAULT ACL','EVENT TRIGGER','MATERIALIZED VIEW','PUBLICATION TABLE','SEQUENCE SET',
  'SCHEMA','EXTENSION','TYPE','TABLE','FUNCTION','PROCEDURE','VIEW','CONSTRAINT',
  'INDEX','TRIGGER','RULE','POLICY','ACL','COMMENT','SEQUENCE','DEFAULT',
];
const names=[
  ...technical,'pgcrypto','public','Settlement','ContractVersion','ContractBankVerificationRequest',
  'VerifiedBankTransactionObservation','CompanyTransfer','CompanyTransferBankClaim','CompanyTransferEvent',
  'FundAccountBalanceRegistration','ApprovalInstance','AuditLog','_prisma_migrations',
];
const reasonRules=[
  ['PERMISSION_DENIED',/^(?:permission denied|must be (?:owner|superuser)|only superuser)/u],
  ['MISSING_ROLE',/^role .+ does not exist/u],
  ['MISSING_RELATION',/^relation .+ does not exist/u],
  ['MISSING_ROUTINE',/^(?:function|procedure) .+ does not exist/u],
  ['MISSING_SCHEMA',/^schema .+ does not exist/u],
  ['MISSING_EXTENSION',/^extension .+ (?:is not available|does not exist)/u],
  ['MISSING_TYPE',/^type .+ does not exist/u],
  ['ALREADY_PRESENT',/^.+ already exists/u],
  ['NOT_NULL_VIOLATION',/^null value in column .+ violates not-null constraint/u],
  ['CHECK_VIOLATION',/^.+ violates check constraint/u],
  ['UNIQUE_VIOLATION',/^duplicate key value violates unique constraint/u],
  ['FOREIGN_KEY_VIOLATION',/^.+ violates foreign key constraint/u],
  ['INVALID_INPUT',/^invalid input syntax/u],
  ['DATABASE_CONNECTION',/^(?:connection to server|could not connect to server)/u],
  ['ARCHIVE_FORMAT',/^unsupported version .+ in file header/u],
  ['SYNTAX',/^syntax error at or near/u],
];
const restorePhases=new Set([
  'BUSINESS_PRE_DATA','BUSINESS_DATA','BUSINESS_POST_DATA','OWNER_PRE_DATA','OWNER_POST_DATA',
]);

function restoreFailure(stderr,phase,exit){
  if(!restorePhases.has(phase)) throw new Error('BACKUP292_DIAGNOSTIC_PHASE');
  const lines=stderr.split(/\r?\n/u);
  const errorLine=lines.findIndex(line=>/^pg_restore: error:/u.test(line));
  const error=errorLine<0?'':lines[errorLine].replace(/^pg_restore: error: (?:could not execute query: )?(?:ERROR:\s*|FATAL:\s*)?/u,'').trim();
  const sqlstate=/^([0-9A-Z]{5}):\s+/u.exec(error)?.[1];
  const reason=reasonRules.find(([,pattern])=>pattern.test(sqlstate?error.slice(7):error))?.[0]??'UNCLASSIFIED';
  let toc;
  for(let i=errorLine-1;i>=0&&i>=errorLine-4;i--){
    const match=/^pg_restore: from TOC entry (\d{1,6}); \d+ \d+ (.+)$/u.exec(lines[i]);
    if(!match)continue;
    const item=Number(match[1]);
    const type=objectTypes.find(value=>match[2].startsWith(value+' '))??'OTHER';
    const tokens=match[2].slice(type.length).trim().split(' ');
    const name=names.find(value=>value===tokens[1]||(tokens[0]==='-'&&value===tokens[1]));
    toc={item,type,...(name?{name}:{})};
    break;
  }
  return {phase,reason,...(sqlstate?{sqlstate}:{}),...(toc?{toc}:{}),exit};
}

module.exports={restoreFailure};

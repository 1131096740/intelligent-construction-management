'use strict';

const assert=require('node:assert/strict');
const {projectNamedSevenFailure}=require('./owner-observation.cjs');
const deny='psql:<stdin>:17: ERROR:  P0001: CURRENT259_SEVEN_INSTALL_SCOPE\nDETAIL:  CURRENT259_SEVEN_SCOPE_DATABASE_ACL\nCONTEXT:  PL/pgSQL function inline_code_block line 18 at RAISE\n';
assert.deepEqual(projectNamedSevenFailure(deny),{
 sqlstate:'P0001',marker:'CURRENT259_SEVEN_INSTALL_SCOPE',detail:'DATABASE_ACL',frames:[{routine:'inline_code_block',line:18,action:'RAISE'}]
});
assert.deepEqual(projectNamedSevenFailure('ERROR:  P0001: CURRENT259_SEVEN_INSTALL_ARCHIVE_PREIMAGE_DRIFT DIGEST\nCONTEXT:  PL/pgSQL function inline_code_block line 11 at RAISE'),{
 sqlstate:'P0001',marker:'CURRENT259_SEVEN_INSTALL_ARCHIVE_PREIMAGE_DRIFT DIGEST',frames:[{routine:'inline_code_block',line:11,action:'RAISE'}]
});
assert.deepEqual(projectNamedSevenFailure('ERROR:  55000: private booking id\nDETAIL: secret\nCONTEXT: PL/pgSQL function public.jg_install_contract_direct_upward_v2(text,text,text,uuid) line 7 at RAISE'),{
 sqlstate:'55000',frames:[{routine:'jg_install_contract_direct_upward_v2',line:7,action:'RAISE'}]
});
assert.deepEqual(projectNamedSevenFailure('ERROR:  P0001: CURRENT259_ARCHIVE_INSTALL_REGISTERED_DRIFT injected\nDETAIL:  CURRENT259_SEVEN_SCOPE_DATABASE_ACL\nCONTEXT: PL/pgSQL function udp_secret line 900 at RAISE'),{
 sqlstate:'P0001'
});
assert.deepEqual(projectNamedSevenFailure('NOTICE: CURRENT259_ARCHIVE_INSTALL_REGISTERED_DRIFT'),{});
console.log('NAMED_290_SEVEN_WRITE_PROJECTION_OFFLINE_PASSED');

'use strict';
const { types } = require('node:util');

const DRAFT_IDENTITY261 = 'TASK12_DRAFT261_TLS_IDENTITY_V2';
const UPWARD_IDENTITY261 = 'TASK12_UPWARD_Q2_TLS_IDENTITY_V2';
const profiles = Object.freeze([DRAFT_IDENTITY261, UPWARD_IDENTITY261]);
const roleTail = Object.freeze([
  'jg_c259_outside_issuer_login',
  'jg_c259_outside_executor_login',
  'jg_c259_upward_issuer_login',
  'jg_c259_upward_runtime_login',
]);

function isIdentity261(value) {
  return profiles.includes(value);
}

function identityRoles(names) {
  return !types.isProxy(names) && Array.isArray(names) && names.length === 5 &&
    /^jg_fixture_app_[a-f0-9]{24}$/u.test(names[0]) &&
    roleTail.every((name, index) => names[index + 1] === name);
}

function validateIdentityResult(result, profile) {
  const evidence = Object.getOwnPropertyDescriptor(result ?? {}, 'identityQualification')?.value;
  const clients = evidence?.clients;
  if (evidence?.profile !== profile || !Array.isArray(clients) ||
      !identityRoles(clients.map(row => row.name)) ||
      !clients.every(row => row.identityVerified === true &&
        (row.closeKind === 'REAL_FIN' && row.backendGone === undefined ||
         row.closeKind === 'CLOSED_BY_RESET' && row.backendGone === true))) {
    throw new Error('IDENTITY261_RESULT_REJECTED');
  }
  return evidence;
}

module.exports = Object.freeze({
  DRAFT_IDENTITY261, UPWARD_IDENTITY261, isIdentity261, identityRoles, validateIdentityResult,
});

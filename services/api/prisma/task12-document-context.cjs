'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const fault = part => Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_' + part), { code:'TASK12_OFFICIAL_DOCUMENT_' + part });

/** Each verifier owns a private authority. Creating a different authority never
 * grants access to another verifier's AsyncLocalStorage or one-use proofs. */
function createDocumentContextAuthority() {
  const storage = new AsyncLocalStorage(), issued = new WeakMap();
  const current = () => {
    const state = storage.getStore();
    if (!state) return undefined;
    state.scope.check(); return state.scope;
  };
  return Object.freeze({
    issue(value, check) {
      if (!value || typeof check !== 'function' || Object.hasOwn(value,'check')) throw fault('SCOPE');
      const proof = Object.freeze({}); issued.set(proof,{ value,check }); return proof;
    },
    async run(proof, use) {
      const record = issued.get(proof);
      if (!record || typeof use !== 'function' || storage.getStore()) throw fault('SCOPE');
      issued.delete(proof); let active = true;
      const check = () => { if (!active || storage.getStore()?.scope !== scope) throw fault('CONTINUITY'); record.check(); };
      const scope = Object.freeze({ ...record.value, check });
      try { return await storage.run({scope},async () => { check(); const result=await use(current()); check(); return result; }); }
      finally { active=false; }
    },
    current
  });
}
module.exports = Object.freeze({createDocumentContextAuthority});

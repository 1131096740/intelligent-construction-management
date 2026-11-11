'use strict';
const {assertCurrent259BusinessIssuer:businessIssuer,assertCurrent259CommitCancellationIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { createCurrent259A16FaultPlan } = require('./task16-current259-a16-fault.cjs');
const { isDeepStrictEqual: equal, types } = require('node:util');
// Load the genuine technical lineage before the original physical producer.
const { claimCurrent259B7Installation } = require('./task16-current259-b7-install.cjs');
const { claimCurrent259TechnicalResource, claimCurrent259TechnicalResourceContinuity, closeCurrent259OwnedResource } = require('./task16-current259-owned-resource.cjs');
const { current259ClientIdentitySql, parseCurrent259ClientSessions } = require('./task16-current259-session-identity.cjs');
const { renderCurrent259CatalogRead, parseCurrent259CatalogRead } = require('./task16-current259-catalog.cjs');
const { readQualifiedTask16File: read } = require('./task16-runtime-inputs.cjs');

const receipts = new WeakMap(), impactBoundaries = new WeakMap(), competitionPairs=new WeakMap(), used = new WeakSet();
const CODE = 'CURRENT259_LIVE_SESSIONS';
const KINDS = ['owner', 'runtime', 'observer'];
const METHOD_NAMES = ['$disconnect', '$connect', '$queryRawUnsafe', '$transaction'];
const stamp = expression => `pg_catalog.to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const fail = suffix => Object.assign(new Error(CODE + '_' + suffix), { code: CODE + '_' + suffix });
function need(ok, suffix = 'INVALID') { if (!ok) throw fail(suffix); }
function own(object, key) {
  need(object && !types.isProxy(object));
  const d = Object.getOwnPropertyDescriptor(object, key);
  need(d && Object.hasOwn(d, 'value'));
  return d.value;
}
function stableCatalog(raw) {
  return { ...raw, identity: Object.fromEntries(Object.entries(raw.identity).filter(([key]) => !['backendPid', 'backendStart'].includes(key))) };
}
function claimCurrent259LiveSessions(proof, handle) {
  need(proof && !types.isProxy(proof) && receipts.has(proof), 'HANDLE');
  const record = receipts.get(proof);
  need(record.handle === handle, 'HANDLE');
  receipts.delete(proof);
  record.session.checkLight();
  return record.session;
}
function verifyCurrent259ImpactFileBoundary(session) {
  // The installed-session scope is the only producer of this check. Plain
  // sessions and the old inactive business path retain their original checks.
  impactBoundaries.get(session)?.();
}
function assertCurrent259CompetitionLivePair(proofs,handle) {
  need(arguments.length===2&&competitionPairs.get(proofs)===handle&&proofs.every(proof=>receipts.get(proof)?.handle===handle),'HANDLE');
  return true;
}

async function withCurrent259LiveSessions(b7Completion, handle, consume) {
  need(arguments.length === 3 && typeof consume === 'function', 'ARGUMENTS');
  return withLiveSessions(b7Completion,handle,consume,false);
}
async function withCurrent259CompetitionLiveSessions(b7Completion,handle,permit,consume) {
  need(arguments.length===4&&typeof consume==='function','ARGUMENTS');
  const issuer=require('./task16-current259-payment-run-authorization.cjs');
  const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259CompetitionLivePermit')?.value;
  need(typeof claim==='function'&&claim(permit,handle,b7Completion)===true,'HANDLE');
  return withLiveSessions(b7Completion,handle,consume,true);
}
async function withLiveSessions(b7Completion, handle, consume, competition) {
  const lease = claimCurrent259B7Installation(b7Completion, handle);
  need((lease.request.identity.runtimeProfile==='CURRENT259_TWO_RUNTIME_LANES')===competition,'HANDLE');
  const view = claimCurrent259TechnicalResource(handle);
  need(!used.has(handle), 'REUSED'); used.add(handle);
  const clients = [], resource = view.resource, loader = view.loader, Class = loader.Class;
  let active = true, broken = false, checking = false, closing, resourceClosing;
  let cleanup = 'DISCONNECTED', resourceCleanup = 'NOT_NEEDED', proofs = [], initialRows, ca;
  let methods, initial, businessToken, cancelUsed = false;
  const activeLanes=new Set();
  const applicationName=(kind,index)=>'task16_live_'+view.runId.replaceAll('-', '')+'_'+kind+(competition&&kind==='runtime'?(index===1?'_a':'_b'):'');
  const committedRequest = { ...lease.request, phase: 'committed', installXid: b7Completion.installXid };
  const expected = {
    ...Object.fromEntries(['database', 'databaseOid', 'systemIdentifier', 'ownerOid', 'runtimeOid', 'observerOid'].map(key => [key, lease.request.identity[key]])),
    publishedPort: resource.port
  };
  function closeResource() {
    if (!resourceClosing) resourceClosing = (async () => {
      try { await closeCurrent259OwnedResource(handle); resourceCleanup = 'CLOSED'; }
      catch { resourceCleanup = 'UNKNOWN'; }
    })();
    return resourceClosing;
  }
  function checkLight() {
    if(businessToken)return checkContinuity(businessToken);
    need(active && !broken, 'CLOSED');
    try {
      lease.check(); view.check();
      need(claimCurrent259TechnicalResource(handle) === view && view.loader === loader && loader.Class === Class &&
        lease.completion === b7Completion && equal(view.source, lease.source) &&
        b7Completion.installXid === committedRequest.installXid &&
        view.runId === lease.request.identity.runId && resource.databaseName === expected.database);
      need(Object.keys(methods).every(key => own(resource, key) === methods[key]));
      const current = methods.getReceipt();
      need(['runId', 'containerId', 'networkId', 'databaseName', 'port'].every(key => current[key] === initial[key]) &&
        current.requestedCertificateMode === 'correct' && current.reloadState === 'OBSERVED_PEER_CERTIFICATE_MATCHED' &&
        current.presentedCertificate?.mode === 'correct' &&
        current.presentedCertificate.derSha256 === initial.tls.correctCertificateDerSha256 &&
        current.tls.caSha256 === initial.tls.caSha256);
      if (ca) need(read(resource.caPath, { privateFile: false, maxBytes: 1048576, expectedIdentity: ca.identity, code: CODE + '_CA' }).sha256 === ca.sha256, 'CA');
      for (const entry of clients) {
        need(entry.registered, 'CLIENT_REGISTRATION_UNKNOWN');
        need(METHOD_NAMES.every(key => entry.client[key] === entry.methods[key]), 'METHOD_CHANGED');
      }
    } catch {
      broken = true; active = false;
      void closeResource();
      throw fail('CONTINUITY');
    }
  }
  function checkContinuity(token) {
    businessIssuer(token,handle);need(active && !broken, 'CLOSED');
    try {
      lease.checkContinuity(token); view.checkLifetime();
      need(claimCurrent259TechnicalResourceContinuity(handle,token) === view && view.loader === loader && loader.Class === Class &&
        lease.completion === b7Completion && equal(view.source, lease.source) &&
        b7Completion.installXid === committedRequest.installXid &&
        view.runId === lease.request.identity.runId && resource.databaseName === expected.database);
      need(Object.keys(methods).every(key => own(resource, key) === methods[key]));
      const current = own(resource,'getReceiptContinuity')(token);
      need(['runId', 'containerId', 'networkId', 'databaseName', 'port'].every(key => current[key] === initial[key]) &&
        current.requestedCertificateMode === 'correct' && current.reloadState === 'OBSERVED_PEER_CERTIFICATE_MATCHED' &&
        current.presentedCertificate?.mode === 'correct' &&
        current.presentedCertificate.derSha256 === initial.tls.correctCertificateDerSha256 &&
        current.tls.caSha256 === initial.tls.caSha256);
      if(ca)checkCurrent259FileIdentity(resource.caPath,ca.identity);
      for (const entry of clients) {
        need(entry.registered, 'CLIENT_REGISTRATION_UNKNOWN');
        need(METHOD_NAMES.every(key => entry.client[key] === entry.methods[key]), 'METHOD_CHANGED');
      }
    } catch {
      broken = true; active = false;
      void closeResource();
      throw fail('CONTINUITY');
    }
  }
  function activateBusinessContinuity(token,lane){
    businessIssuer(token,handle);need(!businessToken||businessToken===token,'CONTINUITY');
    need(!activeLanes.has(lane),'CONTINUITY');
    if(!businessToken)view.activateBusinessContinuity(token);
    checkContinuity(token);businessToken=token;activeLanes.add(lane);
  }
  function deactivateBusinessContinuity(token,lane){
    businessIssuer(token,handle);need(businessToken===token&&activeLanes.has(lane),'CONTINUITY');checkContinuity(token);
    activeLanes.delete(lane);
    if(!activeLanes.size){view.deactivateBusinessContinuity(token);businessToken=undefined;}
  }
  function verifyImpactFiles() {
    if (!businessToken) return;
    try { checkContinuity(businessToken); view.verifyBusinessFiles(businessToken); }
    catch {
      broken = true; active = false; void closeResource();
      throw fail('CONTINUITY');
    }
  }
  async function cancelCommit(token, submit) {
    need(!competition,'CANCEL_SCOPE');
    assertCurrent259CommitCancellationIssuer(token, handle);
    checkContinuity(token);
    need(businessToken === token && !cancelUsed && typeof submit === 'function', 'CANCEL_SCOPE');
    cancelUsed = true;
    await verify(false, true);
    const runtime = initialRows[1], identity = committedRequest.identity;
    const fault = createCurrent259A16FaultPlan({ mode: 'cancel-commit', nonce: randomBytes(32).toString('hex'),
      database: { name: identity.database, oid: identity.databaseOid, namespaceOid: identity.namespaceOid, systemIdentifier: identity.systemIdentifier },
      runtime: { oid: runtime.loginOid, pid: runtime.pid, startedAt: runtime.start, clientAddress: runtime.clientAddress, clientPort: runtime.clientPort } });
    const run = (sql, phase) => settled(() => methods.execOwnerSql(sql, phase));
    const readyDeadline = performance.now() + 5000;
    let ownerPending = true, probe, request;
    const owner = run(fault.ownerSql, 'current259-a16-cancel-owner').finally(() => { ownerPending = false; });
    const prematureExit = owner.then(() => { throw fail('CANCEL_OWNER_EXIT'); });
    // Rejection remains observed if the other side wins a readiness race.
    void prematureExit.catch(() => {});
    try {
      let witness;
      do {
        need(ownerPending && performance.now() < readyDeadline, 'CANCEL_READY');
        probe = run(fault.readySql, 'current259-a16-cancel-ready');
        const output = await Promise.race([probe, prematureExit]);
        checkContinuity(token);
        witness = fault.parseReady(own(output, 'stdout'));
        if (!witness) await Promise.race([delay(25), prematureExit]);
      } while (!witness);
      checkContinuity(token);
      need(ownerPending && performance.now() < readyDeadline, 'CANCEL_READY');
      request = Promise.resolve(submit());
      await Promise.all([request, owner.then(output => fault.parseOutcome(own(output, 'stdout'), witness))]);
      checkContinuity(token);
    } catch (error) {
      broken = true; active = false;
      await Promise.allSettled([closeResource(), owner, probe, request]);
      throw error;
    }
  }
  async function settled(action, disconnect = false) {
    if (!disconnect) checkLight();
    let timer;
    const result = await Promise.race([
      Promise.resolve().then(action).then(value => ({ value }), () => ({ failed: true })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), disconnect ? 10000 : 30000); })
    ]);
    clearTimeout(timer);
    if (result.timeout || result.failed) {
      if (result.timeout) cleanup = 'UNKNOWN';
      broken = true; active = false;
      throw fail(result.timeout ? 'UNSETTLED' : 'OPERATION');
    }
    if (!disconnect) checkLight();
    return result.value;
  }
  async function close() {
    active = false;
    for(const proof of proofs)receipts.delete(proof);
    if (closing) return closing;
    closing = (async () => {
      for (const entry of clients) {
        if (entry.disconnectAttempted) continue;
        entry.disconnectAttempted = true;
        if (typeof entry.methods?.$disconnect !== 'function') { cleanup = 'UNKNOWN'; continue; }
        try { await settled(() => entry.methods.$disconnect.call(entry.client), true); }
        catch { cleanup = 'UNKNOWN'; }
      }
      if (broken || cleanup === 'UNKNOWN') await closeResource();
      need(cleanup === 'DISCONNECTED', 'CLEANUP_UNKNOWN');
    })();
    return closing;
  }
  async function endpoint() {
    const value = await settled(() => methods.inspectConnectionEndpoint());
    need(value && Reflect.ownKeys(value).length === 7 &&
      ['containerId', 'networkId', 'databaseName'].every(key => own(value, key) === resource[key]) &&
      own(value, 'publishedHost') === '127.0.0.1' && own(value, 'publishedPort') === resource.port &&
      own(value, 'serverPort') === 5432, 'PHYSICAL_ENDPOINT');
    return value;
  }
  async function catalog() {
    const output = await settled(() => methods.execOwnerSql(renderCurrent259CatalogRead(committedRequest), 'current259-live-catalog'));
    need(typeof output?.stdout === 'string' && Buffer.byteLength(output.stdout) <= 1048576);
    const next = parseCurrent259CatalogRead(output.stdout, committedRequest, lease.stagedProof);
    need(equal(stableCatalog(next.raw), stableCatalog(lease.committedProof.raw)) &&
      next.raw.identity.backendPid !== lease.committedProof.raw.identity.backendPid &&
      next.raw.identity.backendStart !== lease.committedProof.raw.identity.backendStart, 'CATALOG');
  }
  async function observe(indices, nonce) {
    const rows = [];
    for (const index of indices) {
      const entry = clients[index];
      rows.push(await settled(() => entry.methods.$queryRawUnsafe.call(entry.client, current259ClientIdentitySql, nonce)));
    }
    return rows;
  }
  async function independentlyObserve(rows, nonce) {
    const projection = rows.map(row => Object.fromEntries(['database', 'databaseOid', 'loginRole', 'loginOid', 'pid', 'start', 'tls', 'clientAddress', 'clientPort'].map(key => [key, row[key]])));
    const ids = rows.map(row => row.pid).join(',');
    const sql = `SELECT pg_catalog.row_to_json(v) FROM (SELECT '${nonce}'::pg_catalog.text AS nonce,
 pg_catalog.current_database()::pg_catalog.text AS database,d.oid::pg_catalog.text AS "databaseOid",d.datdba::pg_catalog.text AS "ownerOid",
 (SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
 pg_catalog.pg_backend_pid() AS "readerPid",current_user::pg_catalog.text AS "readerRole",
 current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "readerOid",
 (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()) AS "readerTls",
 (SELECT ${stamp('backend_start')} FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()) AS "readerStart",
 (SELECT pg_catalog.json_agg(t ORDER BY t.pid) FROM (SELECT d.datname::pg_catalog.text AS database,a.datid::pg_catalog.text AS "databaseOid",
 a.usename::pg_catalog.text AS "loginRole",a.usesysid::pg_catalog.text AS "loginOid",a.pid,${stamp('a.backend_start')} AS start,
 coalesce(s.ssl,false) AS tls,pg_catalog.host(a.client_addr) AS "clientAddress",a.client_port AS "clientPort"
 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_database d ON d.oid=a.datid LEFT JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid
 WHERE a.pid IN (${ids})) t) AS sessions${competition?`,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.pid,r.application_name) ORDER BY r.pid)
 FROM pg_catalog.pg_stat_activity r WHERE r.datid=d.oid AND r.usesysid=${expected.runtimeOid}::oid) AS "runtimeLanes"`:''}
 FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()) v`;
    const output = await settled(() => methods.execOwnerSql(sql, 'current259-live-independent'));
    need(typeof output?.stdout === 'string' && Buffer.byteLength(output.stdout) <= 1048576);
    const row = JSON.parse(output.stdout.trim());
    const lanes=competition?[1,3].map(index=>[rows[index].pid,applicationName('runtime',index)]).sort((a,b)=>a[0]-b[0]):null;
    need(row && Reflect.ownKeys(row).length === (competition?12:11) &&
      ['database', 'databaseOid', 'systemIdentifier', 'ownerOid'].every(key => own(row, key) === expected[key]) &&
      own(row, 'nonce') === nonce && own(row, 'readerRole') === 'jg_task01_owner' && own(row, 'readerOid') === expected.ownerOid &&
      own(row, 'readerTls') === true && Number.isInteger(own(row, 'readerPid')) &&
      row.readerPid > 0 && row.readerPid <= 0x7fffffff && rows.every(r => r.pid !== row.readerPid && r.start !== row.readerStart) &&
      typeof row.readerStart === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.readerStart) &&
      equal(own(row, 'sessions'), projection.slice().sort((a, b) => a.pid - b.pid))&&
      (!competition||equal(own(row,'runtimeLanes'),lanes)), 'INDEPENDENT_IDENTITY');
  }
  async function verify(installedOnly = false, sourceContinuityOnly = false, lane=1) {
    try {
      checkLight(); need(!checking, 'CONCURRENT_VERIFY'); checking = true;
      if (!((installedOnly || sourceContinuityOnly) && businessToken)) { view.verifyFull(); checkLight(); }
      const physical = await endpoint(), nonce = randomBytes(32).toString('hex');
      const indices = installedOnly?[0,2]:!initialRows&&competition?[0,1,2,3]:[0,lane,2];
      const observed = await observe(indices, nonce);
      if (!initialRows) {
        parseCurrent259ClientSessions(observed.slice(0,3), { ...expected, nonce });
        if(competition){
          parseCurrent259ClientSessions([observed[0],observed[3],observed[2]],{...expected,nonce});
          need(observed[1][0].pid!==observed[3][0].pid&&observed[1][0].start!==observed[3][0].start,'SESSION_CHANGED');
        }
        initialRows = observed.map(rows => Object.freeze({ ...rows[0] }));
      } else {
        need(observed.every((rows, i) => Array.isArray(rows) && rows.length === 1 &&
          equal(rows[0], { ...initialRows[indices[i]], nonce })), 'SESSION_CHANGED');
      }
      need(initialRows.every(row => row.serverAddress === physical.serverAddress), 'PHYSICAL_ENDPOINT');
      await independentlyObserve(initialRows, nonce);
      await catalog();
      if (!((installedOnly || sourceContinuityOnly) && businessToken)) view.verifyFull();
      checkLight();
    } catch {
      broken = true; active = false; await closeResource(); throw fail('VERIFICATION');
    } finally { checking = false; }
  }
  let value, hasPrimary = false;
  try {
    methods = Object.fromEntries(['getReceipt', 'inspectConnectionEndpoint', 'execOwnerSql'].map(key => [key, own(resource, key)]));
    need(Object.values(methods).every(fn => typeof fn === 'function'));
    initial = methods.getReceipt();
    checkLight();
    await endpoint();
    need(typeof Class === 'function' && Object.values(methods).every(fn => typeof fn === 'function'));
    ca = read(resource.caPath, { privateFile: false, maxBytes: 1048576, code: CODE + '_CA' });
    need(ca.identity.uid === process.getuid() && ca.sha256 === initial.tls.caSha256, 'CA');
    const credentials = view.credentials();
    for (const kind of [...KINDS,...(competition?['runtime']:[])]) {
      checkLight(); view.verifyFull();
      const password = credentials[kind];
      need(typeof password === 'string' && /^[a-f0-9]{96}$/u.test(password));
      const url = new URL(`postgresql://jg_task01_${kind}:${password}@127.0.0.1:${resource.port}/${resource.databaseName}`);
      for (const [key, val] of Object.entries({ schema: 'public', connection_limit: '1', sslmode: 'require', sslaccept: 'strict', sslcert: resource.caPath, application_name:applicationName(kind,clients.length), connect_timeout: '5', pool_timeout: '5' })) url.searchParams.set(key, val);
      let client;
      try { client = new Class({ datasources: { db: { url: url.toString() } }, log: [] }); }
      catch { cleanup = 'UNKNOWN'; throw fail('CONSTRUCTOR_UNKNOWN'); }
      const entry = { client, registered: false, methods: {}, disconnectAttempted: false }; clients.push(entry);
      try {
        need(client && (typeof client === 'object' || typeof client === 'function') && clients.filter(row => row.client === client).length === 1);
        for (const name of METHOD_NAMES) { entry.methods[name] = client[name]; need(typeof entry.methods[name] === 'function'); }
        entry.registered = true;
      } catch { cleanup = 'UNKNOWN'; throw fail('CLIENT_REGISTRATION_UNKNOWN'); }
      await settled(() => entry.methods.$connect.call(client));
    }
    await verify();
    proofs=(competition?[1,3]:[1]).map(lane=>{
    const parsed = parseCurrent259ClientSessions([0,lane,2].map(i=>[initialRows[i]]), { ...expected, nonce: initialRows[0].nonce });
    const session = Object.freeze({ source: lease.request.source, owner: clients[0].client, runtime: clients[lane].client, observer: clients[2].client,
      identity: parsed.identity, endpoint: parsed.endpoint,
      b7: Object.freeze({ profile: 'B7_ORIGINAL', xid: b7Completion.installXid, routineOid: lease.committedProof.raw.reader.oid, bodySha256: lease.committedProof.raw.reader.bodySha256 }),
      checkLight, checkContinuity, activateBusinessContinuity:token=>activateBusinessContinuity(token,lane),deactivateBusinessContinuity:token=>deactivateBusinessContinuity(token,lane),
      cancelCommit, verifyFull: () => verify(false,false,lane), verifyRequestBoundary: () => verify(false,true,lane), verifyInstalled259: () => verify(true,false,lane), close,
      ...(competition?{competitionLane:lane===1?'a':'b'}:{}) });
    checkLight(); const proof = Object.freeze({ kind: 'CURRENT259_LIVE_SESSIONS' });
    receipts.set(proof, { handle, session });
    impactBoundaries.set(session, verifyImpactFiles);
    return proof;
    });
    if(competition){Object.freeze(proofs);competitionPairs.set(proofs,handle);}
    value = await consume(competition?proofs:proofs[0]); checkLight();
    await verify();
  } catch {
    hasPrimary = true; broken = true; active = false;
  } finally {
    try { await close(); } catch { hasPrimary = true; }
  }
  if (hasPrimary) throw Object.assign(fail('FAILED_CLOSED'), { clientCleanupOutcome: cleanup, resourceCleanupOutcome: resourceCleanup });
  return value;
}

module.exports = Object.freeze({ withCurrent259LiveSessions,withCurrent259CompetitionLiveSessions,claimCurrent259LiveSessions,assertCurrent259CompetitionLivePair,verifyCurrent259ImpactFileBoundary });

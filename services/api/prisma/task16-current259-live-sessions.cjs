'use strict';
const {assertCurrent259BusinessIssuer:businessIssuer,assertCurrent259CommitCancellationIssuer,assertCurrent259CommitDisconnectIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { createCurrent259A16FaultPlan } = require('./task16-current259-a16-fault.cjs');
const { isDeepStrictEqual: equal, types } = require('node:util');
// Load the genuine technical lineage before the original physical producer.
const { claimCurrent259B7Installation } = require('./task16-current259-b7-install.cjs');
const { claimCurrent259TechnicalResource, claimCurrent259TechnicalResourceContinuity, closeCurrent259OwnedResource } = require('./task16-current259-owned-resource.cjs');
const { current259ClientIdentitySql, parseCurrent259ClientSessions } = require('./task16-current259-session-identity.cjs');
const { renderCurrent259CatalogRead, parseCurrent259CatalogRead, current259Schema205WitnessSql } = require('./task16-current259-catalog.cjs');
const { registeredObjectWitnessSql, schema205RegistrySql } = require('./task16-registered-object-witness.cjs');
const { schema205ScopeSql } = require('./task16-schema205-scope.cjs');
const { readQualifiedTask16File: read } = require('./task16-runtime-inputs.cjs');

const { paymentLoopbackForScenario, isCurrent259PaymentLoopbackTopology } = require('./task16-current259-payment-loopback.cjs');
const { captureCurrent259DisconnectFailure, carryCurrent259DisconnectFailure } = require('./task16-current259-disconnect-failure.cjs');

const paymentLoopbackImpactSessions = new WeakSet();
const receipts = new WeakMap(), impactBoundaries = new WeakMap(), competitionPairs=new WeakMap(), used = new WeakSet();
const ROLLBACK_TOPOLOGY = paymentLoopbackForScenario('cancel-commit').topology;
const COMPETITION_TOPOLOGY = paymentLoopbackForScenario('competition').topology;
const VOUCHER_TOPOLOGY = paymentLoopbackForScenario('competition-voucher').topology;
const DISCONNECT_TOPOLOGY = paymentLoopbackForScenario('disconnect-commit-recovery').topology;
const CODE = 'CURRENT259_LIVE_SESSIONS';
const KINDS = ['owner', 'runtime', 'observer'];
const METHOD_NAMES = ['$disconnect', '$connect', '$queryRawUnsafe', '$transaction'];
const liveFailures = new WeakMap();
const prismaCodes = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017', 'P2010', 'P2024']);
const sqlStates = new Set(['08000', '08001', '08003', '08004', '08006', '08P01', '0A000', '22023', '25006',
  '28000', '28P01', '3D000', '42501', '42601', '42702', '42703', '42725', '42804', '42883', '42P01',
  '53300', '57014', '57P01', 'XX000']);

function describeCurrent259LiveFailure(error) {
  return liveFailures.get(error);
}
function liveFailure(error, checkpoint) {
  const data = (value, key) => value && typeof value === 'object' && !types.isProxy(value)
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const code = data(error, 'code');
  const prismaCode = [data(error, 'errorCode'), code].find(value => prismaCodes.has(value)) ?? null;
  const sqlState = [prismaCode === 'P2010' ? data(data(error, 'meta'), 'code') : undefined, code]
    .find(value => sqlStates.has(value)) ?? null;
  return Object.freeze({ checkpoint, prismaCode, sqlState });
}
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
function isCurrent259PaymentLoopbackImpactSession(session) {
  return paymentLoopbackImpactSessions.has(session);
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
  try {
    return await withLiveSessions(b7Completion,handle,consume,false);
  } catch (error) {
    // Failure before the live scope starts keeps the existing error and cleanup path.
    if (error && typeof error === 'object' && !types.isProxy(error) && !liveFailures.has(error)) {
      liveFailures.set(error, liveFailure(error, 'LIVE_PREPARE'));
    }
    throw error;
  }
}
async function withCurrent259CompetitionLiveSessions(b7Completion,handle,permit,consume) {
  need(arguments.length===4&&typeof consume==='function','ARGUMENTS');
  const issuer=require('./task16-current259-payment-run-authorization.cjs');
  const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259CompetitionLivePermit')?.value;
  need(typeof claim==='function'&&claim(permit,handle,b7Completion)===true,'HANDLE');
  return withLiveSessions(b7Completion,handle,consume,true);
}
async function withCurrent259DisconnectLiveSessions(b7Completion,handle,permit,consume) {
  need(arguments.length===4&&typeof consume==='function','ARGUMENTS');
  const issuer=require('./task16-current259-payment-run-authorization.cjs');
  const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259DisconnectLivePermit')?.value;
  need(typeof claim==='function'&&claim(permit,handle,b7Completion)===true,'HANDLE');
  return withLiveSessions(b7Completion,handle,consume,false,true);
}
async function withLiveSessions(b7Completion, handle, consume, competition, recovery=false) {
  const lease = claimCurrent259B7Installation(b7Completion, handle);
  const voucher=lease.request.identity.voucherProfile==='CURRENT259_PAYMENT_VOUCHER_V1';
  need((lease.request.identity.runtimeProfile==='CURRENT259_TWO_RUNTIME_LANES')===competition&&(!voucher||competition),'HANDLE');
  const view = claimCurrent259TechnicalResource(handle);
  need(!used.has(handle), 'REUSED'); used.add(handle);
  const clients = [], resource = view.resource, loader = view.loader, Class = loader.Class;
  const topology = resource.topology;
  const paymentLoopback = isCurrent259PaymentLoopbackTopology(topology);
  let active = true, broken = false, checking = false, closing, resourceClosing;
  let cleanup = 'DISCONNECTED', resourceCleanup = 'NOT_NEEDED', proofs = [], initialRows, ca;
  let methods, initial, businessToken, faultUsed = false;
  let replacementRow, retiredRuntime, disconnectOutcome, directoryBefore, replacementUsed=false, recoveryComplete=false;
  let disconnectStage='LIVE_ADMISSION', disconnectFailure;
  let checkpoint = 'LIVE_PREPARE', firstLiveFailure;
  function rememberLiveFailure(error) {
    if (!competition && !recovery) firstLiveFailure ??= liveFailure(error, checkpoint);
  }
  function rememberDisconnectFailure(error,stage=disconnectStage) {
    if(recovery)disconnectFailure??=captureCurrent259DisconnectFailure(error,stage);
  }
  const activeLanes=new Set();
  const applicationName=(kind,index)=>'task16_live_'+view.runId.replaceAll('-', '')+'_'+kind+
    (competition&&kind==='runtime'?(index===1?'_a':'_b'):recovery&&index===3?'_repl':'');
  const committedRequest = { ...lease.request, phase: 'committed', installXid: b7Completion.installXid };
  const expected = {
    ...Object.fromEntries(['database', 'databaseOid', 'systemIdentifier', 'ownerOid', 'runtimeOid', 'observerOid'].map(key => [key, lease.request.identity[key]])),
    publishedPort: resource.port,
    ...(paymentLoopback ? { transport: topology, relayId: resource.relayId } : {})
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
      lease.check();
      // The branded claim checks this same resource before returning the view.
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
  async function commitFault(token, submit, disconnect) {
    const faultTopology=disconnect?DISCONNECT_TOPOLOGY:ROLLBACK_TOPOLOGY;
    need(!competition&&disconnect===recovery&&(!paymentLoopback||topology===faultTopology),'CANCEL_SCOPE');
    const authorize=disconnect?assertCurrent259CommitDisconnectIssuer:assertCurrent259CommitCancellationIssuer;
    authorize(token, handle);
    checkContinuity(token);
    need(businessToken === token && !faultUsed && typeof submit === 'function', 'CANCEL_SCOPE');
    faultUsed = true;
    await verify(false, true);
    if(disconnect)directoryBefore=await recoveryDirectory();
    const runtime = initialRows[1], identity = committedRequest.identity;
    const mode=disconnect?'disconnect-commit':'cancel-commit';
    const phase=disconnect?'current259-a16-disconnect':'current259-a16-cancel';
    const fault = createCurrent259A16FaultPlan({ mode,
      ...(paymentLoopback ? { transport: topology } : {}), nonce: randomBytes(32).toString('hex'),
      database: { name: identity.database, oid: identity.databaseOid, namespaceOid: identity.namespaceOid, systemIdentifier: identity.systemIdentifier },
      runtime: { oid: runtime.loginOid, pid: runtime.pid, startedAt: runtime.start, clientAddress: runtime.clientAddress, clientPort: runtime.clientPort } });
    const run = (sql, phase) => settled(() => methods.execOwnerSql(sql, phase));
    const readyDeadline = performance.now() + 5000;
    let ownerPending = true, probe, request;
    const owner = run(fault.ownerSql, phase+'-owner').finally(() => { ownerPending = false; });
    const prematureExit = owner.then(() => { throw fail('CANCEL_OWNER_EXIT'); });
    // Rejection remains observed if the other side wins a readiness race.
    void prematureExit.catch(() => {});
    try {
      let witness;
      do {
        need(ownerPending && performance.now() < readyDeadline, 'CANCEL_READY');
        probe = run(fault.readySql, phase+'-ready');
        const output = await Promise.race([probe, prematureExit]);
        checkContinuity(token);
        witness = fault.parseReady(own(output, 'stdout'));
        if (!witness) await Promise.race([delay(25), prematureExit]);
      } while (!witness);
      checkContinuity(token);
      need(ownerPending && performance.now() < readyDeadline, 'CANCEL_READY');
      request = Promise.resolve(submit());
      const [,outcome]=await Promise.all([request, owner.then(output => fault.parseOutcome(own(output, 'stdout'), witness))]);
      checkContinuity(token);
      if(disconnect)disconnectOutcome=outcome;
      return outcome;
    } catch (error) {
      rememberDisconnectFailure(error,'ORIGINAL_COMMIT_FAULT');
      broken = true; active = false;
      await Promise.allSettled([closeResource(), owner, probe, request]);
      throw disconnectFailure?carryCurrent259DisconnectFailure(error,disconnectFailure):error;
    }
  }
  async function settled(action, disconnect = false, failureStage) {
    if (!disconnect) checkLight();
    let timer;
    const result = await Promise.race([
      Promise.resolve().then(action).then(value => ({ value }), error => ({ failed: true, error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), disconnect ? 10000 : 30000); })
    ]);
    clearTimeout(timer);
    if (result.timeout || result.failed) {
      if (result.timeout) cleanup = 'UNKNOWN';
      broken = true; active = false;
      rememberLiveFailure(result.error);
      if(failureStage&&result.failed)rememberDisconnectFailure(result.error,failureStage);
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
    need(value && Reflect.ownKeys(value).length === (paymentLoopback ? 9 : 7) &&
      ['containerId', 'networkId', 'databaseName'].every(key => own(value, key) === resource[key]) &&
      own(value, 'serverPort') === 5432, 'PHYSICAL_ENDPOINT');
    if (paymentLoopback) {
      need(own(value, 'transport') === topology && own(value, 'relayId') === resource.relayId &&
        own(value, 'host') === '127.0.0.1' && own(value, 'port') === resource.port &&
        own(value, 'serverAddress') === '127.0.0.1', 'PHYSICAL_ENDPOINT');
    } else {
      need(own(value, 'publishedHost') === '127.0.0.1' && own(value, 'publishedPort') === resource.port, 'PHYSICAL_ENDPOINT');
    }
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
  async function independentlyObserve(rows, nonce, retirement=false) {
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
 WHERE a.pid IN (${ids})) t) AS sessions${competition||retirement?`,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.pid,r.application_name) ORDER BY r.pid)
 FROM pg_catalog.pg_stat_activity r WHERE r.datid=d.oid AND r.usesysid=${expected.runtimeOid}::oid) AS "runtimeLanes"`:''}${retirement?`,
 EXISTS(SELECT FROM pg_catalog.pg_stat_activity r WHERE r.pid=${retiredRuntime.pid}
   AND ${stamp('r.backend_start')}='${retiredRuntime.start}') AS "retiredRuntimePresent"`:''}
 FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()) v`;
    const output = await settled(() => methods.execOwnerSql(sql, 'current259-live-independent'));
    need(typeof output?.stdout === 'string' && Buffer.byteLength(output.stdout) <= 1048576);
    const row = JSON.parse(output.stdout.trim());
    const lanes=competition?[1,3].map(index=>[rows[index].pid,applicationName('runtime',index)]).sort((a,b)=>a[0]-b[0]):
      retirement&&rows.length===3?[[rows[1].pid,applicationName('runtime',3)]]:null;
    need(row && Reflect.ownKeys(row).length === (retirement?13:competition?12:11) &&
      ['database', 'databaseOid', 'systemIdentifier', 'ownerOid'].every(key => own(row, key) === expected[key]) &&
      own(row, 'nonce') === nonce && own(row, 'readerRole') === 'jg_task01_owner' && own(row, 'readerOid') === expected.ownerOid &&
      own(row, 'readerTls') === true && Number.isInteger(own(row, 'readerPid')) &&
      row.readerPid > 0 && row.readerPid <= 0x7fffffff && rows.every(r => r.pid !== row.readerPid && r.start !== row.readerStart) &&
      typeof row.readerStart === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.readerStart) &&
      equal(own(row, 'sessions'), projection.slice().sort((a, b) => a.pid - b.pid))&&
      (!(competition||retirement)||equal(own(row,'runtimeLanes'),lanes)) &&
      (!retirement||own(row,'retiredRuntimePresent')===false), 'INDEPENDENT_IDENTITY');
  }
  async function verify(installedOnly = false, sourceContinuityOnly = false, lane=replacementRow?3:1) {
    try {
      checkpoint = 'VERIFY_CONTINUITY';
      checkLight(); need(!checking, 'CONCURRENT_VERIFY'); checking = true;
      if (!((installedOnly || sourceContinuityOnly) && businessToken)) { view.verifyFull(); checkLight(); }
      checkpoint = 'VERIFY_ENDPOINT';
      const physical = await endpoint(), nonce = randomBytes(32).toString('hex');
      const indices = installedOnly?[0,2]:!initialRows&&competition?[0,1,2,3]:[0,lane,2];
      checkpoint = 'IDENTITY_SELF';
      const observed = await observe(indices, nonce);
      checkpoint = 'IDENTITY_PARSE';
      if (!initialRows) {
        parseCurrent259ClientSessions(observed.slice(0,3), { ...expected, nonce });
        if(competition){
          parseCurrent259ClientSessions([observed[0],observed[3],observed[2]],{...expected,nonce});
          const left=observed[1][0],right=observed[3][0];
          need(left.pid!==right.pid&&left.start!==right.start&&left.clientPort!==right.clientPort,'SESSION_CHANGED');
        }
        initialRows = observed.map(rows => Object.freeze({ ...rows[0] }));
      } else {
        need(observed.every((rows, i) => Array.isArray(rows) && rows.length === 1 &&
          equal(rows[0], { ...(indices[i]===3&&replacementRow?replacementRow:initialRows[indices[i]]), nonce })), 'SESSION_CHANGED');
      }
      const currentRows=replacementRow?[initialRows[0],replacementRow,initialRows[2]]:initialRows;
      need(currentRows.every(row => row.serverAddress === physical.serverAddress), 'PHYSICAL_ENDPOINT');
      checkpoint = 'IDENTITY_INDEPENDENT';
      await independentlyObserve(currentRows, nonce, !!replacementRow);
      checkpoint = 'CATALOG';
      await catalog();
      checkpoint = 'VERIFY_CONTINUITY';
      if(replacementRow&&!installedOnly&&!sourceContinuityOnly)need(await recoveryDirectory()===directoryBefore,'RECOVERY_DIRECTORY');
      if (!((installedOnly || sourceContinuityOnly) && businessToken)) view.verifyFull();
      checkLight();
    } catch(error) {
      rememberLiveFailure(error);
      rememberDisconnectFailure(error);
      broken = true; active = false; await closeResource();
      const failure=fail('VERIFICATION');
      throw disconnectFailure?carryCurrent259DisconnectFailure(failure,disconnectFailure):failure;
    } finally { checking = false; }
  }
  async function connectClient(kind, credentials) {
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
  function issueProof(lane) {
    const runtimeRow=replacementRow&&lane===3?replacementRow:initialRows[lane];
    const parsed = parseCurrent259ClientSessions([initialRows[0],runtimeRow,initialRows[2]].map(row=>[{...row,nonce:runtimeRow.nonce}]), { ...expected, nonce: runtimeRow.nonce });
    const guard=()=>need(!recovery||lane!==1||!retiredRuntime,'RETIRED');
    const session = Object.freeze({ source: lease.request.source, owner: clients[0].client, runtime: clients[lane].client, observer: clients[2].client,
      identity: parsed.identity, endpoint: parsed.endpoint,
      b7: Object.freeze({ profile: 'B7_ORIGINAL', xid: b7Completion.installXid, routineOid: lease.committedProof.raw.reader.oid, bodySha256: lease.committedProof.raw.reader.bodySha256 }),
      checkLight:()=>{guard();checkLight();},checkContinuity:token=>{guard();checkContinuity(token);},
      activateBusinessContinuity:token=>{guard();activateBusinessContinuity(token,lane);},
      deactivateBusinessContinuity:token=>{guard();deactivateBusinessContinuity(token,lane);},
      cancelCommit:(token,submit)=>commitFault(token,submit,false),
      ...(recovery?(lane===1?{disconnectOriginal:true,disconnectCommit:(token,submit)=>{guard();return commitFault(token,submit,true);}}:{disconnectReplacement:true}):{}),
      verifyFull:()=>{guard();return verify(false,false,lane);},verifyRequestBoundary:()=>{guard();return verify(false,true,lane);},
      verifyInstalled259:()=>{guard();return verify(true,false,lane);},close:()=>{guard();return close();},
      ...(competition?{competitionLane:lane===1?'a':'b'}:{}) });
    checkLight(); const proof=Object.freeze({kind:'CURRENT259_LIVE_SESSIONS'});
    receipts.set(proof,{handle,session});
    impactBoundaries.set(session,()=>{guard();verifyImpactFiles();});
    if (paymentLoopback) paymentLoopbackImpactSessions.add(session);
    return proof;
  }

  async function recoveryDirectory() {
    const {identity}=committedRequest;
    const ordinary=lease.roleCompletion.ordinary.oid;
    need(/^[1-9][0-9]{0,9}$/u.test(ordinary)&&Number(ordinary)<=0xffffffff,'RECOVERY_DIRECTORY');
    const nonce=randomBytes(32).toString('hex');
    const bindings=['jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1',
      'jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_execution_binding_v2','jg_contract_direct_upward_closure_v2'];
    const pending=`SELECT pg_catalog.to_jsonb(b) FROM public.jg_contract_direct_pending_binding_v1 b
      WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=${ordinary}::oid AND b."databaseOid"=${identity.databaseOid}::oid
      AND b."anchorNamespaceOid"=${identity.namespaceOid}::oid AND b."anchorOwnerOid"=10`;
    const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,pg_temp;
SELECT pg_catalog.jsonb_build_object('nonce','${nonce}','valid',(
  current_user='jg_task01_owner' AND session_user=current_user AND current_user::regrole::oid=10
  AND current_database()='${identity.database}' AND pg_catalog.to_regnamespace('public')::oid=${identity.namespaceOid}::oid
  AND (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10)=${identity.databaseOid}::oid
  AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='${identity.systemIdentifier}'
  AND current_setting('server_version_num')::integer BETWEEN 160000 AND 169999
  AND current_setting('session_replication_role')='origin' AND current_setting('transaction_read_only')='on'
  AND pg_catalog.host(inet_client_addr())='127.0.0.1' AND pg_catalog.host(inet_server_addr())='127.0.0.1'
  AND inet_server_port()=5432 AND (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid())
  AND pg_backend_pid() NOT IN (${initialRows.map(row=>row.pid).join(',')})
  AND (SELECT count(*) FROM (${pending}) b)=1
  AND EXISTS(SELECT FROM pg_catalog.pg_authid r WHERE r.oid=${ordinary}::oid AND r.rolcanlogin AND r.rolconnlimit=0 AND r.rolpassword IS NULL)
  AND ${bindings.map(name=>`NOT EXISTS(SELECT FROM public.${name})`).join(' AND ')}
 ) IS TRUE,'sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  pg_catalog.jsonb_build_array(${registeredObjectWitnessSql()},${schema205ScopeSql()},${current259Schema205WitnessSql()},
    ${schema205RegistrySql()},(${pending}))::text,'UTF8')),'hex'));
ROLLBACK;`;
    const output=await settled(()=>methods.execOwnerSql(sql,'current259-live-recovery-directory'));
    need(typeof output?.stdout==='string'&&Buffer.byteLength(output.stdout)<=1024,'RECOVERY_DIRECTORY');
    const row=JSON.parse(output.stdout);
    need(row&&Reflect.ownKeys(row).length===3&&row.nonce===nonce&&row.valid===true&&
      typeof row.sha256==='string'&&/^[a-f0-9]{64}$/u.test(row.sha256),'RECOVERY_DIRECTORY');
    return row.sha256;
  }

  async function verifyRetained() {
    const physical=await endpoint(), nonce=randomBytes(32).toString('hex');
    const retained=[initialRows[0],initialRows[2]];
    const observed=await observe([0,2],nonce);
    need(observed.every((rows,index)=>Array.isArray(rows)&&rows.length===1&&
      equal(rows[0],{...retained[index],nonce}))&&retained.every(row=>row.serverAddress===physical.serverAddress),'RECOVERY_RETAINED');
    await independentlyObserve(retained,nonce,true);
    await catalog();
    need(await recoveryDirectory()===directoryBefore,'RECOVERY_DIRECTORY');
    checkLight();
  }
  async function replaceRuntime(closeProof,attempt,consumeReplacement) {
    try {
      disconnectStage='ORIGINAL_RUNTIME_RETIREMENT';
      checkLight();
      need(recovery&&disconnectOutcome?.state==='commit-disconnected'&&directoryBefore&&!businessToken&&
        !replacementUsed&&typeof consumeReplacement==='function','REPLACEMENT_SCOPE');
      replacementUsed=true;
      const factory=require('./task16-current259-application-factory.cjs');
      const claim=own(factory,'claimCurrent259DisconnectApplicationClose');
      const oldOrigin=claim(closeProof,proofs[0],handle);
      retiredRuntime=initialRows[1];
      const oldClient=clients[1];
      oldClient.disconnectAttempted=true;
      try{await settled(()=>oldClient.methods.$disconnect.call(oldClient.client),true);}
      catch{cleanup='UNKNOWN';throw fail('REPLACEMENT_RETIRE_UNKNOWN');}
      disconnectStage='RETAINED_SESSIONS';
      await verifyRetained();
      disconnectStage='ROLLBACK_OBSERVATION';
      const load=own(loader,'loadPaymentModules');
      const confirmation=own(load.call(loader),'confirmRegisteredNullCrossCompanyDisconnectRollback');
      const rollback=await settled(()=>confirmation(attempt,Object.freeze({checkLight})),false,disconnectStage);
      disconnectStage='RETAINED_SESSIONS';
      await verifyRetained();
      disconnectStage='REPLACEMENT_RUNTIME';
      await connectClient('runtime',view.credentials());
      const nonce=randomBytes(32).toString('hex'), physical=await endpoint();
      const observed=await observe([0,3,2],nonce);
      parseCurrent259ClientSessions(observed,{...expected,nonce});
      need(equal(observed[0][0],{...initialRows[0],nonce})&&equal(observed[2][0],{...initialRows[2],nonce}), 'RECOVERY_RETAINED');
      const next=observed[1][0];
      need(next.pid!==retiredRuntime.pid&&next.start>retiredRuntime.start&&next.serverAddress===physical.serverAddress,'REPLACEMENT_IDENTITY');
      await independentlyObserve(observed.map(rows=>rows[0]),nonce,true);
      await catalog();
      need(await recoveryDirectory()===directoryBefore,'RECOVERY_DIRECTORY');
      // Use an immutable new record. Do not overwrite the old application's proof.
      replacementRow=Object.freeze({...next});
      const replacement=issueProof(3);
      proofs.push(replacement);
      disconnectStage='RECOVERY_APPLICATION';
      const result=await consumeReplacement(replacement,rollback,oldOrigin);
      checkLight();need(!receipts.has(replacement),'REPLACEMENT_REQUIRED');
      recoveryComplete=true;
      return result;
    } catch(error) {
      rememberDisconnectFailure(error);
      broken=true;active=false;await closeResource();throw error;
    }
  }
  let value, hasPrimary = false;
  try {
    need((topology === COMPETITION_TOPOLOGY || topology === VOUCHER_TOPOLOGY) === competition &&
      (topology === VOUCHER_TOPOLOGY) === voucher && (topology === DISCONNECT_TOPOLOGY) === recovery, 'PHYSICAL_ENDPOINT');
    methods = Object.fromEntries(['getReceipt', 'inspectConnectionEndpoint', 'execOwnerSql'].map(key => [key, own(resource, key)]));
    need(Object.values(methods).every(fn => typeof fn === 'function'));
    initial = methods.getReceipt();
    checkLight();
    checkpoint = 'ENDPOINT';
    await endpoint();
    checkpoint = 'CA';
    need(typeof Class === 'function' && Object.values(methods).every(fn => typeof fn === 'function'));
    ca = read(resource.caPath, { privateFile: false, maxBytes: 1048576, code: CODE + '_CA' });
    need(ca.identity.uid === process.getuid() && ca.sha256 === initial.tls.caSha256, 'CA');
    checkpoint = 'CREDENTIALS';
    const credentials=view.credentials();
    for (const kind of [...KINDS,...(competition?['runtime']:[])]) {
      checkpoint = 'CONNECT_' + kind.toUpperCase();
      await connectClient(kind, credentials);
    }
    await verify();
    checkpoint = 'PROOF';
    proofs=(competition?[1,3]:[1]).map(issueProof);
    if(competition){Object.freeze(proofs);competitionPairs.set(proofs,handle);}
    disconnectStage='ORIGINAL_APPLICATION';
    checkpoint = 'CALLBACK_ENTRY';
    value = recovery?await consume(proofs[0],replaceRuntime):await consume(competition?proofs:proofs[0]);
    disconnectStage='FINAL_LIVE_VERIFICATION';
    checkLight();
    need(!recovery||recoveryComplete,'REPLACEMENT_REQUIRED');
    await verify();
  } catch(error) {
    rememberLiveFailure(error);
    rememberDisconnectFailure(error);
    hasPrimary = true; broken = true; active = false;
  } finally {
    checkpoint = 'CLEANUP';
    try { await close(); }
    catch(error) {
      rememberLiveFailure(error);
      rememberDisconnectFailure(error,'LIVE_CLEANUP');
      hasPrimary = true;
    }
  }
  if (hasPrimary) {
    const error=Object.assign(fail('FAILED_CLOSED'), { clientCleanupOutcome: cleanup, resourceCleanupOutcome: resourceCleanup });
    if (firstLiveFailure) liveFailures.set(error, firstLiveFailure);
    throw disconnectFailure?carryCurrent259DisconnectFailure(error,disconnectFailure):error;
  }
  return value;
}

module.exports = Object.freeze({ describeCurrent259LiveFailure, withCurrent259LiveSessions,withCurrent259CompetitionLiveSessions,withCurrent259DisconnectLiveSessions,claimCurrent259LiveSessions,assertCurrent259CompetitionLivePair,isCurrent259PaymentLoopbackImpactSession,verifyCurrent259ImpactFileBoundary });

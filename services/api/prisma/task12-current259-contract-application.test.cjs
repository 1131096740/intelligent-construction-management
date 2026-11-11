'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withCurrent259FirstQ2Application } = require('./task12-current259-contract-login.cjs');

test('only the same live five-login proof can start the fixed first Q2 assembly', async () => {
  const proof = Object.freeze({
    status: 'CURRENT259_CONTRACT_FIVE_TLS_VERIFIED_NOT_ADMISSION',
    executionAllowed: false,
  });
  const handle = Object.freeze({});
  await assert.rejects(
    () => withCurrent259FirstQ2Application(proof, handle),
    { code: 'CURRENT259_CONTRACT_LOGIN_HANDLE' },
  );
  await assert.rejects(
    () => withCurrent259FirstQ2Application(proof, handle, () => assert.fail('unexpected callback')),
    { code: 'CURRENT259_CONTRACT_LOGIN_HANDLE' },
  );
});

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function assemblyFixture(nativeMode = false) {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'jg-q2-model-'));
  const caPath = path.join(parent, 'tls-private', 'ca.crt');
  const events = [];
  const [ContractModule, PrismaService, Outside, Upward] = [class {}, class {}, class {}, class {}];
  const provided = [{}, {}, {}];
  const values = new Map();
  const server = { listening: false, address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 32123 }) };
  const testing = { get: token => values.get(token), close() { events.push('module-close'); } };
  const adapter = { getInstance: () => ({ set(name) { events.push(name); } }) };
  const app = {
    get: token => values.get(token),
    getHttpAdapter: () => adapter,
    getHttpServer: () => server,
    enableCors(options) { assert.deepEqual(options, { origin: [], credentials: false }); },
    useGlobalPipes(pipe) { assert.equal(pipe, 'real-validation'); },
    async init() { assert.equal(process.env.NODE_ENV, 'production'); events.push('init'); },
    async close() { server.listening = false; events.push('app-close'); },
  };
  let claimed = false;
  const loaded = {
    ContractModule, PrismaService, ContractDirectArchiveRuntime: Outside, ContractUpwardDirectArchiveRuntime: Upward,
    configureApiSecurity(target) { assert.equal(target, app); events.push('security'); },
    configureProjectionExportJson(target) { assert.equal(target, app); events.push('projection'); },
    apiJsonReplacer() {},
    createApiValidationPipe: () => 'real-validation',
    async listenApi(target, port, host) {
      assert.equal(target, app); assert.equal(port, 0); assert.equal(host, '127.0.0.1');
      server.listening = true; events.push('listen');
    },
  };
  const bridge = {
    caPath, loaded, check() {},
    constructProviders() { return provided; },
    createTestingModule() {
      return {
        overrideProvider(token) { return { useValue(value) { values.set(token, value); } }; },
        async compile() { events.push('compile'); return testing; },
      };
    },
    async verifyProviders() {
      assert.deepEqual([...values.keys()], [PrismaService, Outside, Upward]);
      assert.deepEqual([...values.values()], provided);
      assert.equal(server.listening, false);
      events.push('tls'); return 5;
    },
    async verifyClosed() { assert.equal(server.listening, false); events.push('readback'); },
    async disconnectUnowned() { events.push('disconnect-unowned'); },
  };
  const cosKeys=['FILE_STORAGE_DRIVER','COS_BUCKET','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY','COS_SESSION_TOKEN'];
  if(nativeMode)bridge.native={
    fixture:Object.freeze(nativeMode==='outside-operating'?{relationship:'outside',outsideOperating:true}:{}),
    beginHttp(){events.push('full-before-http');},
    endHttp(success){events.push(success?'full-after-http':'end-failed-http');},
    storageEnvironment(){return Object.fromEntries(cosKeys.map((key,i)=>[key,i===0?'cos':'synthetic-'+i]));}
  };
  const ports = {
    './task12-current259-first-q2-http.cjs':{async runCurrent259FirstQ2Http(value,target){
      module.exports.takeCurrent259FirstQ2HttpBridge(value,target);
      assert.equal(target,server);assert.equal(server.listening,true);
      assert.equal(process.env.FILE_STORAGE_DRIVER,'cos');
      assert.equal(process.env.COS_SESSION_TOKEN,'synthetic-5');
      events.push('http');
      if(nativeMode==='fail')throw new Error('sensitive remote error should not escape');
      return Object.freeze({status:nativeMode==='outside-operating'?'CURRENT259_FIRST_OUTSIDE_OPERATING_PROTOCOL_MATCHED_NOT_ACCEPTANCE'
        :'CURRENT259_FIRST_Q2_PROTOCOL_MATCHED_NOT_ACCEPTANCE',httpSteps:9,proofSha256:'a'.repeat(64)});
    }},
    './task12-current259-contract-login.cjs': { takeCurrent259FirstQ2Bridge(value) {
      assert.equal(value, bridge); assert.equal(claimed, false); claimed = true;
    } },
    './task16-current259-client-loader.cjs': {
      isCurrent259OwnedModule: value => value === testing,
      createCurrent259OwnedApplication: value => { assert.equal(value, testing); return app; },
      current259OwnedApplicationView: value => { assert.equal(value, app); return app; },
      takeCurrent259CreationFailure: () => undefined,
    },
  };
  const filename = path.join(__dirname, 'task12-current259-contract-application.cjs');
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(filename, 'utf8'))(name => ports[name] ?? require(name), module);
  return { parent, bridge, app, events, values, PrismaService, run: module.exports.runCurrent259FirstQ2Application };
}

test('fixed first Q2 assembly verifies the exact three injected providers before opening and closes once', async () => {
  const model = assemblyFixture();
  try {
    const result = await model.run(model.bridge);
    assert.deepEqual(model.events, ['compile', 'security', 'projection', 'json replacer', 'init', 'tls', 'listen', 'app-close', 'readback']);
    assert.deepEqual(result, Object.freeze({
      status: 'CURRENT259_FIRST_Q2_NEST_ASSEMBLY_CLOSED',
      verifiedClients: 5,
      storageAcceptance: false,
      executionAllowed: false,
      nativeAdmission: false,
    }));
    assert.deepEqual(fs.readdirSync(model.parent), []);
  } finally {
    fs.rmSync(model.parent, { recursive: true, force: true });
  }
});

test('a substituted Nest provider stops before TLS and still closes the one acquired app', async () => {
  const model = assemblyFixture();
  try {
    model.app.init = async () => model.values.set(model.PrismaService, {});
    await assert.rejects(model.run(model.bridge), { code: 'CURRENT259_FIRST_Q2_APP_PROVIDERS' });
    assert.deepEqual(model.events, ['compile', 'security', 'projection', 'json replacer', 'app-close', 'readback']);
    assert.deepEqual(fs.readdirSync(model.parent), []);
  } finally {
    fs.rmSync(model.parent, { recursive: true, force: true });
  }
});

test('the fixed assembly refuses inherited COS credentials before any provider is constructed', async () => {
  const model = assemblyFixture();
  const old = Object.getOwnPropertyDescriptor(process.env, 'COS_SECRET_ID');
  try {
    process.env.COS_SECRET_ID = 'synthetic-conflicting-environment';
    await assert.rejects(model.run(model.bridge), { code: 'CURRENT259_FIRST_Q2_APP_ENVIRONMENT' });
    assert.deepEqual(model.events, []);
    assert.deepEqual(fs.readdirSync(model.parent), []);
    assert.equal(process.env.COS_SECRET_ID, 'synthetic-conflicting-environment');
  } finally {
    if (old) Object.defineProperty(process.env, 'COS_SECRET_ID', old);
    else delete process.env.COS_SECRET_ID;
    fs.rmSync(model.parent, { recursive: true, force: true });
  }
});

test('a rejected app close leaves the environment owned and never calls another close', async () => {
  const model = assemblyFixture();
  const keys = ['NODE_ENV','SMS_ENABLED','APPROVAL_SMS_ENABLED','FILE_STORAGE_DRIVER','FILE_STORAGE_ROOT',
    'JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'];
  const prior = keys.map(key => Object.getOwnPropertyDescriptor(process.env, key));
  try {
    model.app.close = async () => { model.events.push('close-rejected'); throw new Error('private exception'); };
    await assert.rejects(model.run(model.bridge), {
      code: 'CURRENT259_FIRST_Q2_APP_CLOSE', appCleanupOutcome: 'UNKNOWN_DO_NOT_CONTINUE',
    });
    assert.equal(model.events.at(-1), 'close-rejected');
    assert.equal(model.events.filter(event => event.includes('close')).length, 1);
    assert.equal(process.env.NODE_ENV, 'production');
    assert.equal(fs.readdirSync(model.parent).length, 1);
  } finally {
    keys.forEach((key,index) => {
      if (prior[index]) Object.defineProperty(process.env,key,prior[index]); else delete process.env[key];
    });
    fs.rmSync(model.parent, { recursive: true, force: true });
  }
});


test('genuine native bridge sets only its own STS environment until owned app and sessions close',async()=>{
  const model=assemblyFixture(true);
  try{
    const result=await model.run(model.bridge);
    assert.equal(result.status,'CURRENT259_FIRST_Q2_HTTP_AND_NEST_CLOSED');
    assert.equal(result.httpSteps,9);
    assert.equal(result.proofSha256,'a'.repeat(64));
    assert.deepEqual(model.events.slice(-6),['listen','full-before-http','http','full-after-http','app-close','readback']);
    for(const key of ['COS_BUCKET','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY','COS_SESSION_TOKEN'])assert.equal(process.env[key],undefined);
  }finally{fs.rmSync(model.parent,{recursive:true,force:true});}
});

test('native request failure preserves its fixed stage and closes before restoring the private environment',async()=>{
  const model=assemblyFixture('fail');
  try{
    await assert.rejects(model.run(model.bridge),{code:'CURRENT259_FIRST_Q2_APP_HTTP'});
    assert.deepEqual(model.events.slice(-6),['listen','full-before-http','http','end-failed-http','app-close','readback']);
    assert.equal(process.env.COS_SESSION_TOKEN,undefined);
  }finally{fs.rmSync(model.parent,{recursive:true,force:true});}
});

test('the verified operating outside fixture closes the same Nest providers before releasing its distinct result',async()=>{
  const model=assemblyFixture('outside-operating');
  try{
    const result=await model.run(model.bridge);
    assert.equal(result.status,'CURRENT259_FIRST_OUTSIDE_OPERATING_HTTP_AND_NEST_CLOSED');
    assert.equal(result.verifiedClients,5);
    assert.deepEqual(model.events.slice(-6),['listen','full-before-http','http','full-after-http','app-close','readback']);
  }finally{fs.rmSync(model.parent,{recursive:true,force:true});}
});

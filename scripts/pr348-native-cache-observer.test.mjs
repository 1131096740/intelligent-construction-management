import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module, {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const filename=fileURLToPath(new URL("./pr348-native-cache-observer.cjs",import.meta.url));
const observer=createRequire(import.meta.url)(filename),{applyInsertions,createRecorder,cliArgs,hash}=observer._testing;

test("import has no vendor resolution or reads before the explicit cache phase",()=>{
  const code='const fs=require("node:fs"),Module=require("node:module");let vendorReads=0,vendorResolves=0;const read=fs.readFileSync,resolve=Module._resolveFilename;fs.readFileSync=function(file,...args){if(String(file).includes("node_modules"))vendorReads++;return read.call(this,file,...args);};Module._resolveFilename=function(request,...args){if(!String(request).startsWith("node:")&&!String(request).startsWith("/"))vendorResolves++;return resolve.call(this,request,...args);};require(process.argv[1]);process.stdout.write(JSON.stringify({vendorReads,vendorResolves}));';
  const result=spawnSync(process.execPath,["-e",code,filename],{encoding:"utf8"});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{vendorReads:0,vendorResolves:0});
});

test("fixed-source insertion verifies bytes before patching and restores exact original",()=>{
  const original='module.exports = function(value) { return value; };\n';
  const patched=applyInsertions(original,hash(original),[{offset:0,text:'"use strict";\n'},{offset:original.indexOf("return"),text:'module.seen=true;'}]);
  const selected=new Module(filename);selected.filename=filename;selected._compile(patched,filename);
  const marker={};assert.equal(selected.exports(marker),marker);assert.equal(selected.seen,true);
  assert.throws(()=>applyInsertions(original+' ',hash(original),[{offset:0,text:';'}]),/vendor-pin-rejected/);
});

test("an instrumented function retains Promise and thrown-object identities",()=>{
  const original='module.exports = function(value) { if (value.fail) throw value; return value; };\n';
  const recorder=createRecorder([{id:"tiny",sha256:"a".repeat(64)}],true);recorder.state.active=recorder.state.rows[0];
  const patched=applyInsertions(original,hash(original),[{offset:0,text:'const __jgPr348CacheMark=module.__jgPr348CacheMark;\n'},
    {offset:original.indexOf("{")+1,text:'__jgPr348CacheMark("transformer-process");'}]);
  const selected=new Module(filename);selected.filename=filename;selected.__jgPr348CacheMark=recorder.record;selected._compile(patched,filename);
  const promise=Promise.resolve(1);assert.equal(selected.exports(promise),promise);
  const failure={fail:true};assert.throws(()=>selected.exports(failure),error=>error===failure);
  assert.equal(recorder.result()[0].counters["transformer-process"],2);
});

test("ambiguous insertion offsets and previously instrumented source fail closed",()=>{
  const original="returnValue;";
  for(const edits of [[{offset:-1,text:"x"}],[{offset:99,text:"x"}],[{offset:1,text:"x"},{offset:1,text:"y"}],[{offset:1,text:""}]])
    assert.throws(()=>applyInsertions(original,hash(original),edits),/insertion-rejected/);
  const patched="__jgPr348CacheMark";assert.throws(()=>applyInsertions(patched,hash(patched),[]),/vendor-pin-rejected/);
});

test("key data is projected only as a digest and cache bodies never enter safe rows",()=>{
  const recorder=createRecorder([{id:"tiny",sha256:"a".repeat(64)}],true);recorder.state.active=recorder.state.rows[0];
  recorder.record("jest-key-ready","/private/control/tiny.ts","PRIVATE_KEY_BODY");
  const rows=recorder.result();assert.deepEqual(rows[0].keySha256,[hash("PRIVATE_KEY_BODY")]);
  assert.equal(JSON.stringify(rows).includes("PRIVATE_KEY_BODY"),false);
  assert.equal(Object.hasOwn(rows[0],"cachePath"),false);
});

test("successful code-path write is separate from source-map write and helper entry",()=>{
  const recorder=createRecorder([{id:"tiny",sha256:"a".repeat(64)}],true);recorder.state.active=recorder.state.rows[0];
  recorder.record("cache-path-ready","/private/tiny.ts","/private/cache/code");
  assert.equal(recorder.result()[0].cachePathSha256,hash("/private/cache/code"));
  recorder.record("code-write-attempt");recorder.record("atomic-write-returned","/private/cache/code.map");
  assert.equal(recorder.result()[0].counters["atomic-write-returned"],0);
  recorder.record("atomic-write-returned","/private/cache/code");
  assert.equal(recorder.result()[0].counters["atomic-write-returned"],1);
});

test("recorder failures and overflow are explicit without throwing into the observed call",()=>{
  const recorder=createRecorder([{id:"tiny",sha256:"a".repeat(64)}],true);
  assert.doesNotThrow(()=>recorder.record("transformer-process"));assert.equal(recorder.state.failures,1);
  recorder.state.active=recorder.state.rows[0];
  assert.doesNotThrow(()=>recorder.record("not-an-event"));assert.equal(recorder.state.failures,2);
  for(let i=0;i<2001;i++)recorder.record("transformer-process");
  assert.equal(recorder.state.overflow,true);assert.equal(recorder.result()[0].counters["transformer-process"],2000);
});

test("initialization events remain separate from the first target",()=>{
  const recorder=createRecorder([{id:"tiny",sha256:"a".repeat(64)}],true);recorder.state.phase="initialization";
  recorder.record("ts-config-request");
  assert.equal(recorder.state.initializationCounters["ts-config-request"],1);
  assert.equal(recorder.result()[0].counters["ts-config-request"],0);assert.equal(recorder.state.failures,0);
});

test("CLI requires explicit private cache scope and rejects duplicate or extra controls",()=>{
  assert.throws(()=>cliArgs(["observe","--vendor-root","x"]),/arguments-rejected/);
  assert.throws(()=>cliArgs(["positive-control","--vendor-root","x","--private-root","y","--private-root","z"]),/arguments-rejected/);
  assert.throws(()=>cliArgs(["positive-control","--vendor-root","x","--private-root","y","--allow-unknown-pin","true"]),/arguments-rejected/);
  assert.equal(cliArgs(["positive-control","--vendor-root","x","--private-root","y"]).mode,"positive-control");
});

test("invalid CLI output is a fixed classification without exception or supplied path",()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"pr348-cache-cli-"));
  try {const marker="PRIVATE_ERROR_VALUE",result=spawnSync(process.execPath,[filename,"observe","--vendor-root",marker],{encoding:"utf8"});
    assert.equal(result.status,1);assert.equal(result.stdout,"");assert.deepEqual(JSON.parse(result.stderr),{status:"cache-observation-rejected"});
    assert.equal(result.stderr.includes(marker),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

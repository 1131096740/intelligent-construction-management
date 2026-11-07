"use strict";
// Fixed in-process client loader. No cache deletion or interpreter and no I/O on import.
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const {readQualifiedTask16File:read}=require("./task16-runtime-inputs.cjs");
const BUILTIN_LOADER_SOURCE=process.binding("natives")["internal/modules/cjs/loader"];
const TREES=["node_modules","services/api/node_modules","packages/shared-domain/node_modules","services/api/dist","packages/shared-domain/dist"];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
function coreHooksUnmodified(){
 // Fixed Node CJS assignments, not a JavaScript interpreter. Comparing to the
 // pinned running Node's builtin source prevents an earlier wrapper from being
 // adopted as the baseline merely because its reference stays unchanged.
 const source=BUILTIN_LOADER_SOURCE;
 if(typeof source!=="string")return false;
 const checks=[[Module._load,"Module._load = function"],[Module._resolveFilename,"Module._resolveFilename = function"],[Module._findPath,"Module._findPath = function"],[Module.prototype.require,"Module.prototype.require = function"],...[".js",".json",".node"].map(ext=>[Module._extensions[ext],`Module._extensions['${ext}'] = function`])];
 return checks.every(([fn,marker])=>{const assignment=source.indexOf(marker);if(assignment<0||typeof fn!=="function")return false;const begin=source.indexOf("function",assignment),end=source.indexOf("\n};",begin);return end>begin&&Function.prototype.toString.call(fn)===source.slice(begin,end+2);});
}
function loadTask16Client(source,facts,simulation){
 const root=source.candidateRoot;
 need(coreHooksUnmodified()&&facts&&facts.hooks&&Module._load===facts.hooks.load&&Module._resolveFilename===facts.hooks.resolve&&Module._findPath===facts.hooks.find&&Module.prototype.require===facts.hooks.require&&[".js",".json",".node"].every(ext=>Module._extensions[ext]===facts.hooks.extensions[ext]),"TASK16_CLIENT_LOADER_HOOK_CHANGED");
 need(simulation||facts.freshCli===true,"TASK16_CLIENT_FRESH_CLI_REQUIRED");
 const entry=source.runtimeAdmission.clientEntry;
 need(entry&&typeof entry.path==="string"&&inside(root,entry.path)&&/\.(?:c?js)$/u.test(entry.path)&&fs.realpathSync(entry.path)===entry.path,"TASK16_CLIENT_ENTRY");
 const manifests=source.inputs.trees.map(tree=>{const captured=read(tree.manifest,{privateFile:true,maxBytes:64*1024*1024,collect:true,code:"TASK16_CLIENT_TREE"});need(captured.sha256===tree.sha256,"TASK16_CLIENT_TREE");const value=JSON.parse(captured.bytes.toString("utf8"));need(value.schemaVersion===1&&value.status==="captured"&&value.root===path.join(root,tree.root),"TASK16_CLIENT_TREE");return{root:path.join(root,tree.root),entries:value.entries};});
 const members=new Map(source.executionFiles.map(row=>[path.join(root,row.path),row]));
 const capture=file=>{need(fs.realpathSync(file)===file&&inside(root,file),"TASK16_CLIENT_MODULE_ESCAPES");const tree=manifests.find(item=>inside(item.root,file));const expected=tree?.entries[path.relative(tree.root,file)]??members.get(file);need(expected&&(expected.kind===undefined||expected.kind==="file")&&/^[a-f0-9]{64}$/u.test(expected.sha256),"TASK16_CLIENT_MODULE_UNSEALED");const actual=read(file,{maxBytes:64*1024*1024,code:"TASK16_CLIENT_MODULE_CHANGED"});need(actual.sha256===expected.sha256,"TASK16_CLIENT_MODULE_CHANGED");return{path:file,...actual};};
 const initial=capture(entry.path);need(entry.identity&&read(entry.path,{maxBytes:64*1024*1024,expectedIdentity:entry.identity,code:"TASK16_CLIENT_ENTRY"}).sha256===entry.sha256,"TASK16_CLIENT_ENTRY");need(initial.sha256===entry.sha256,"TASK16_CLIENT_ENTRY");
 need(!Object.keys(require.cache).some(file=>TREES.some(tree=>inside(path.join(root,tree),file))),"TASK16_CLIENT_PRELOADED_MODULE");
 need(!Object.values(Module._pathCache).some(file=>typeof file==="string"&&TREES.some(tree=>inside(path.join(root,tree),file))),"TASK16_CLIENT_PRELOADED_PATH");
 const loaded=require(entry.path),actual=require.cache[entry.path];
 need(actual?.loaded===true&&actual.exports===loaded&&typeof loaded.PrismaClient==="function"&&loaded.Prisma?.prismaVersion?.client==="5.22.0"&&loaded.Prisma?.prismaVersion?.engine==="605197351a3c8bdd595af2d2a9bc3025bca48ea2","TASK16_CLIENT_CLASS");
 const Class=loaded.PrismaClient,files=new Map();
 const check=()=>{
  need(coreHooksUnmodified()&&Module._load===facts.hooks.load&&Module._resolveFilename===facts.hooks.resolve&&Module._findPath===facts.hooks.find&&Module.prototype.require===facts.hooks.require&&[".js",".json",".node"].every(ext=>Module._extensions[ext]===facts.hooks.extensions[ext]),"TASK16_CLIENT_LOADER_HOOK_CHANGED");
  need(require.cache[entry.path]===actual&&actual.exports===loaded&&loaded.PrismaClient===Class,"TASK16_CLIENT_CLASS_CHANGED");
  const visited=new Set();const visit=mod=>{if(visited.has(mod))return;visited.add(mod);need(mod?.loaded===true&&typeof mod.filename==="string","TASK16_CLIENT_MODULE_CHANGED");const previous=files.get(mod.filename);if(previous){const current=read(previous.path,{maxBytes:64*1024*1024,expectedIdentity:previous.identity,code:"TASK16_CLIENT_MODULE_CHANGED"});need(current.sha256===previous.sha256&&require.cache[mod.filename]===mod,"TASK16_CLIENT_MODULE_CHANGED");}else{need(require.cache[mod.filename]===mod,"TASK16_CLIENT_MODULE_CHANGED");files.set(mod.filename,capture(mod.filename));}for(const child of mod.children)visit(child);};visit(actual);
  const current=read(entry.path,{maxBytes:64*1024*1024,expectedIdentity:initial.identity,code:"TASK16_CLIENT_ENTRY"});need(current.sha256===entry.sha256,"TASK16_CLIENT_ENTRY");
 };
 check();return{Class,check,witness:()=>({entry:entry.path,entrySha256:entry.sha256,modules:[...files.values()].map(row=>({path:row.path,sha256:row.sha256})).sort((a,b)=>a.path.localeCompare(b.path))})};
}
module.exports={loadTask16Client};

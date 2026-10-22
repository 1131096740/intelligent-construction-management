#!/usr/bin/env node
/* Offline import proof. Does not instantiate AppModule, listen, or connect to DB. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
async function main() {
  const [tree, entry, apiPackage] = process.argv.slice(2);
  assert(tree && entry, 'restore tree and API entry required');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.match(process.version, /^v20\./);
  const root = fs.realpathSync(tree);
  const inside = value => {
    const real = fs.realpathSync(value);
    assert(real.startsWith(root + path.sep), 'module escaped restored closure');
    return real;
  };
  inside(entry);
  const Module = require('node:module');
  const originalResolve = Module._resolveFilename;
  const resolvedModules = new Set();
  Module._resolveFilename = function (...args) {
    const found = originalResolve.apply(this, args);
    if (path.isAbsolute(found)) resolvedModules.add(inside(found));
    return found;
  };
  const r = createRequire(path.resolve(entry));
  const apiManifest = JSON.parse(fs.readFileSync(inside(apiPackage || r.resolve('./../package.json')), 'utf8'));
  const modules = [];
  for (const name of Object.keys(apiManifest.dependencies)) {
    const resolved = inside(r.resolve(name));
    r(name);
    modules.push({ name, resolved });
  }
  const prismaEntry = inside(r.resolve('@prisma/client'));
  const generated = inside(createRequire(prismaEntry).resolve('.prisma/client/default'));
  const engines = fs.readdirSync(path.dirname(generated)).filter(name => /query_engine.*\.so\.node$/.test(name));
  assert(engines.length > 0, 'native Prisma engine missing');
  for (const name of engines) assert.equal(typeof require(inside(path.join(path.dirname(generated), name))).QueryEngine, 'function');
  const sharp = r('sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
  const image = await sharp(png).metadata();
  assert.equal(image.width, 1); assert.equal(image.height, 1); assert.equal(image.format, 'png');
  // Import the captured compiled module. Constructor hooks/DB connections never run.
  assert.equal(typeof r(path.resolve(entry)).AppModule, 'function');
  console.log(JSON.stringify({ status: 'passed', platform: process.platform, architecture: process.arch,
    node: process.version, modules, prismaEngineImports: engines.length, prismaEnginePaths: engines.map(name => path.join(path.dirname(generated), name)), sharpNativePngRoundtrip: true,
    capturedAppModuleImported: true, allResolvedModulesInsideClosure: true, resolvedModuleCount: resolvedModules.size, appModuleInstantiated: false, databaseConnected: false,
    network: 'disabled by the caller container' }));
}
main().catch(error => {
  if (process.env.CLOSURE_PROBE_DIAGNOSTICS_FILE) fs.writeFileSync(process.env.CLOSURE_PROBE_DIAGNOSTICS_FILE, JSON.stringify({name:error.name,code:error.code,message:error.message,stack:error.stack}));
  console.error(JSON.stringify({ status: 'failed', errorClass: error.name, error: 'restored native dependency probe failed' }));
  process.exitCode = 1;
});

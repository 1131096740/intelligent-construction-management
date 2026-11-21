'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const workerSha256 = '1a7607f28cfbc63f0e4e0a41927c89f991e353e4f3fb4565ecfd621ac5975089';
const configSha256 = '5eab7509cde0cc5753638d652ad02789a4f506ece5339075f4867d9cd6eb2293';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function allowExactPdfWorker(workDir, web) {
  assert.match(workDir, /^\/tmp\/jg394-[A-Za-z0-9]+$/u);
  assert.equal(fs.realpathSync(workDir), workDir);
  assert.equal(fs.statSync(workDir).uid, process.getuid());
  assert.equal(web, path.join(workDir, 'apps/web-admin'));
  assert.equal(fs.realpathSync(web), web);

  const load = createRequire(path.join(web, 'package.json'));
  assert.equal(load('vite/package.json').version, '5.4.21');
  assert.equal(load('pdfjs-dist/package.json').version, '6.2.108');
  const defaultRoot = load('vite').searchForWorkspaceRoot(web);
  assert.equal(defaultRoot, workDir);
  const worker = fs.realpathSync(load.resolve('pdfjs-dist/build/pdf.worker.mjs'));
  assert.match(worker, /^\/qualification\/workspace\/node_modules\/\.pnpm\/pdfjs-dist@6\.2\.108(?:_[^/]+)?\/node_modules\/pdfjs-dist\/build\/pdf\.worker\.mjs$/u);
  assert.ok(fs.statSync(worker).isFile());
  assert.equal(sha256(fs.readFileSync(worker)), workerSha256);

  const config = path.join(web, 'vite.config.ts');
  assert.equal(fs.realpathSync(config), config);
  assert.ok(fs.lstatSync(config).isFile());
  const original = fs.readFileSync(config, 'utf8');
  assert.equal(sha256(original), configSha256);
  const anchor = '  server: {\n';
  assert.equal(original.split(anchor).length, 2);
  const allow = JSON.stringify([defaultRoot, worker]);
  fs.writeFileSync(config, original.replace(anchor, anchor + '    fs: { allow: ' + allow + ' },\n'));
  return { workerSha256, configSha256, defaultRootPreserved: true, additionalFiles: 1 };
}

module.exports = { allowExactPdfWorker };

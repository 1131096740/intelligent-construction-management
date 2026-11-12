'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readQualifiedTask16File: read } = require('./task16-runtime-inputs.cjs');

const PURPOSE = 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_V1';
const CODE = 'CURRENT259_GENERATED_DOCUMENT_RUNTIME';
const ASSETS = path.resolve(__dirname, '../assets/document-converter');
const LOCK = path.join(ASSETS, 'runtime-lock-material-body25-v4.json');
const READER = path.resolve(__dirname, '../test-support/task12-read-drawn-pdf.py');
const BODY25_SHA = '6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128';
const WRAPPER_SHA = '81c7db1c6dbcdd606d95abef337b4529aeda6a4fa1cf23a5a567f9c5655c8b66';
const NATIVE_SHA = '0602181a6c26c8e46aa166db18412cef1b31b6d95eb9d7033ffc4cc0ce2e66f2';
const PYTHON_SHA = '7e470bc0e4889177f9acb5f62208fae2825aba9ccd6a67b7c3378f522aa8f148';
const PYMUPDF_SHA = '1a72fa8292254ce92d0030b1adcddd1bbceeacaaf602c84e9a8afebe23566f39';
const PY_FILES = Object.freeze(['__init__.py', '__main__.py', '_apply_pages.py', '_build.py', '_extra.so', '_mupdf.so',
  '_wxcolors.py', 'extra.py', 'libmupdf.dylib', 'libmupdfcpp.so', 'mupdf.py', 'pymupdf.py', 'table.py', 'utils.py']);
const JAVA_ENV = 'CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST';
const ENV_KEYS = ['PATH', 'TMPDIR', JAVA_ENV];
const OVERRIDES = ['DOC_CONVERTER_COMMAND', 'DOC_ALLOWED_FONTS'];
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_PDF = 100_000_000;
const MAX_TEXT = 500_000;
const accepted = new WeakMap();
let busy = false;
const sha = value => createHash('sha256').update(value).digest('hex');
const fault = part => Object.assign(new Error(CODE + '_' + part), { code: CODE + '_' + part });
const need = (value, part) => { if (!value) throw fault(part); };
const sameKeys = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const validPath = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value &&
  !/[\u0000-\u001f]/u.test(value);
const desc = (name, part, options = {}) => {
  need(validPath(name), part);
  return { path: name, ...read(name, { maxBytes: MAX_BYTES, code: CODE + '_' + part, ...options }) };
};
const bind = (name, digest, part, options) => {
  const captured = desc(name, part, options);
  need(captured.sha256 === digest, part);
  return captured;
};
const inside = (parent, target) => target.startsWith(parent + path.sep);

function directory(name, part, privateDirectory = false) {
  need(validPath(name) && fs.realpathSync(name) === name && (!privateDirectory || name.startsWith('/private/tmp/')), part);
  const stat = fs.lstatSync(name);
  need(stat.isDirectory() && !stat.isSymbolicLink() && [0, process.getuid()].includes(stat.uid) && (stat.mode & 0o022) === 0 &&
    (!privateDirectory || stat.uid === process.getuid() && (stat.mode & 0o077) === 0), part);
  return { path: name, identity: { dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid, gid: stat.gid } };
}

function sameIdentity(file, part) {
  const stat = fs.lstatSync(file.path);
  need(!stat.isSymbolicLink() && fs.realpathSync(file.path) === file.path &&
    Object.entries(file.identity).every(([key, value]) => stat[key] === value), part);
}

// This is the same component ordering and digest as the original Java
// converter's runtime lock. The converter still verifies it at use time.
function jdkTree(root, lock) {
  const found = [];
  let entries = 0, bytes = 0;
  const walk = current => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const file = path.join(current, item.name), relative = path.relative(root, file), stat = fs.lstatSync(file);
      need(++entries <= 2_000, 'JDK');
      if (stat.isDirectory()) walk(file);
      else if (stat.isSymbolicLink()) {
        need(inside(root, fs.realpathSync(file)), 'JDK');
        found.push([relative, 'link', fs.readlinkSync(file)]);
      } else {
        need(stat.isFile() && (bytes += stat.size) <= 1024 * 1024 * 1024, 'JDK');
        found.push([relative, 'file', desc(file, 'JDK').sha256, stat.mode & 0o7777]);
      }
    }
  };
  walk(root);
  need(found.length === lock.jdkTreeEntries && sha(JSON.stringify(found)) === lock.jdkTreeSha256, 'JDK');
}

function lockedList(actual, expected, part) {
  need(Array.isArray(actual) && actual.length === expected.length, part);
  return expected.map(({ name, sha256 }) => {
    const matches = actual.filter(row => sameKeys(row, ['name', 'path']) && row.name === name);
    need(matches.length === 1, part);
    return { name, ...bind(matches[0].path, sha256, part) };
  });
}

/** A source/runtime check only. Neither admits nor acquires any resource. */
function verifyCurrent259GeneratedDocumentRuntime(file, expectedSha256) {
  need(arguments.length === 2 && isHash(expectedSha256), 'INPUT');
  try {
    const input = bind(file, expectedSha256, 'INPUT', { privateFile: true, maxBytes: 64 * 1024, collect: true });
    directory(path.dirname(file), 'INPUT', true);
    const plan = JSON.parse(input.bytes.toString('utf8'));
    need(sameKeys(plan, ['version', 'purpose', 'libreOffice', 'python', 'body25']) && plan.version === 1 && plan.purpose === PURPOSE &&
      sameKeys(plan.libreOffice, ['wrapper', 'native']) && sameKeys(plan.python, ['executable', 'package']) &&
      sameKeys(plan.body25, ['jdkHome', 'jars', 'classes', 'fonts']), 'INPUT');
    const wrapper = bind(plan.libreOffice.wrapper, WRAPPER_SHA, 'LIBREOFFICE', { executable: true, maxBytes: 64 * 1024 });
    const native = bind(plan.libreOffice.native, NATIVE_SHA, 'LIBREOFFICE', { executable: true, maxBytes: 64 * 1024 * 1024 });
    need(path.basename(wrapper.path) === 'soffice' && path.resolve(path.dirname(wrapper.path),
      '../../native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice') === native.path, 'LIBREOFFICE');

    const python = bind(plan.python.executable, PYTHON_SHA, 'PYTHON', { executable: true, maxBytes: 64 * 1024 * 1024 });
    const packageDir = directory(plan.python.package, 'PYTHON');
    need(path.basename(packageDir.path) === 'pymupdf', 'PYTHON');
    const pythonFiles = PY_FILES.map(name => ({ name, ...desc(path.join(packageDir.path, name), 'PYTHON', { maxBytes: 64 * 1024 * 1024 }) }));
    need(sha(JSON.stringify(pythonFiles.map(({ name, sha256 }) => [name, sha256]))) === PYMUPDF_SHA, 'PYTHON');

    const locked = bind(LOCK, BODY25_SHA, 'BODY25', { collect: true, maxBytes: 64 * 1024 });
    const lock = JSON.parse(locked.bytes.toString('utf8'));
    const adapter = bind(path.join(ASSETS, 'material-body25-v4/ContractDocxPdf.java'), lock.adapterSourceSha256, 'BODY25');
    const jdk = directory(plan.body25.jdkHome, 'JDK');
    jdkTree(jdk.path, lock);
    const java = desc(path.join(jdk.path, 'bin/java'), 'JDK', { executable: true });
    const jars = lockedList(plan.body25.jars, lock.jars, 'JARS');
    const classes = lockedList(plan.body25.classes, lock.classes, 'CLASSES');
    const fonts = lockedList(plan.body25.fonts, lock.fonts, 'FONTS');
    const reader = desc(READER, 'READER', { maxBytes: 64 * 1024 });
    const evidence = Object.freeze({ profile: PURPOSE, inputSha256: input.sha256, wrapperSha256: wrapper.sha256,
      nativeSha256: native.sha256, body25LockSha256: BODY25_SHA, jdkTreeSha256: lock.jdkTreeSha256,
      pythonSha256: python.sha256, pymupdfSha256: PYMUPDF_SHA, drawnReaderSha256: reader.sha256 });
    accepted.set(evidence, { input, wrapper, native, python, packageDir, pythonFiles, locked, adapter, jdk, java, jars, classes, fonts, reader, lock });
    return evidence;
  } catch (error) {
    if (error?.code?.startsWith(CODE + '_')) throw error;
    throw fault('INPUT');
  }
}

const shellLiteral = value => "'" + value.replaceAll("'", "'\\''") + "'";
const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function write(file, value, mode = 0o600) {
  fs.writeFileSync(file, value, { mode, flag: 'wx' });
}

function ownedCopy(item, destination, part) {
  const captured = bind(item.path, item.sha256, part, { collect: true, expectedIdentity: item.identity });
  write(destination, captured.bytes);
  return bind(destination, item.sha256, part);
}

function parseDrawnPdf(bytes, signal, profile, directoryPath, packageRoot) {
  return new Promise((resolve, reject) => {
    const child = execFile(profile.python.path, ['-I', '-S', '-B', profile.reader.path, packageRoot], {
      cwd: directoryPath, env: { PATH: '/usr/bin:/bin', HOME: directoryPath, TMPDIR: directoryPath, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      timeout: 25_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL', encoding: 'utf8', signal
    }, (error, stdout, stderr) => {
      try {
        need(!error && stderr.length === 0, 'READER');
        const pages = JSON.parse(stdout);
        need(Array.isArray(pages) && pages.length > 0 && pages.length <= 100 && pages.every(page => typeof page === 'string') &&
          pages.reduce((length, page) => length + page.length, 0) <= MAX_TEXT, 'READER');
        resolve(Object.freeze(pages));
      } catch { reject(fault('READER')); }
    });
    child.stdin.on('error', () => { /* execFile close owns the fixed failure. */ });
    child.stdin.end(bytes);
  });
}

/** Scope around only the new document once; preserve the existing app environment. */
async function withCurrent259GeneratedDocumentRuntime(evidence, runRoot, use) {
  const profile = accepted.get(evidence);
  need(arguments.length === 3 && profile && typeof use === 'function' && !busy, 'SCOPE');
  accepted.delete(evidence);
  let prior, installed, root, anchor, first, failed = false, value, active = false, readStarted = false;
  const environment = process.env;
  busy = true;
  const baseInputs = [profile.input, profile.wrapper, profile.native, profile.python, profile.locked,
    profile.adapter, profile.jdk, profile.java, ...profile.jars, ...profile.classes, ...profile.fonts, profile.reader];
  try {
    anchor = directory(runRoot, 'SCOPE', true);
    need(OVERRIDES.every(key => environment[key] === undefined) && environment[JAVA_ENV] === undefined, 'ENV');
    for (const item of baseInputs) sameIdentity(item, 'CONTINUITY');
    prior = Object.fromEntries(ENV_KEYS.map(key => [key, environment[key]]));
    const rootPath = fs.mkdtempSync(path.join(runRoot, 'document-runtime-'));
    root = directory(rootPath, 'SCOPE', true);
    const locations = Object.fromEntries(['bin', 'home', 'temp', 'fonts', 'cache', 'java-scratch', 'python-site'].map(name => {
      const target = path.join(rootPath, name);
      fs.mkdirSync(target, { mode: 0o700 });
      return [name, directory(target, 'SCOPE', true)];
    }));
    const packageRoot = path.join(locations['python-site'].path, 'pymupdf');
    fs.mkdirSync(packageRoot, { mode: 0o700 });
    const packageIdentity = directory(packageRoot, 'SCOPE', true);
    const localPython = profile.pythonFiles.map(item => ownedCopy(item, path.join(packageRoot, item.name), 'PYTHON'));
    const localFonts = profile.fonts.map(item => ownedCopy(item, path.join(locations.fonts.path, item.name + '.ttf'), 'FONTS'));
    const config = path.join(rootPath, 'fonts.conf');
    write(config, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig><dir>${xmlText(locations.fonts.path)}</dir><cachedir>${xmlText(locations.cache.path)}</cachedir></fontconfig>\n`);
    const shim = path.join(locations.bin.path, 'soffice');
    const childEnv = { PATH: '/usr/bin:/bin', HOME: locations.home.path, TMPDIR: locations.temp.path, FONTCONFIG_FILE: config,
      XDG_CACHE_HOME: locations.cache.path, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
    write(shim, '#!/bin/sh\nexec /usr/bin/env -i ' +
      Object.entries(childEnv).map(([key, setting]) => key + '=' + shellLiteral(setting)).join(' ') +
      ' ' + shellLiteral(profile.wrapper.path) + ' "$@"\n', 0o700);
    const manifest = path.join(rootPath, 'material-body25.json');
    const listed = entries => entries.map(({ name, path }) => ({ name, path }));
    write(manifest, JSON.stringify({ schemaVersion: 1, engine: profile.lock.engine, jdkHome: profile.jdk.path,
      scratchDirectory: locations['java-scratch'].path, jars: listed(profile.jars), classes: listed(profile.classes),
      fonts: profile.fonts.map(({ name }, index) => ({ name, path: localFonts[index].path })) }));
    const manifestProof = desc(manifest, 'SCOPE', { privateFile: true });
    const scopeInputs = [...baseInputs, anchor, root, ...Object.values(locations), packageIdentity, ...localPython, ...localFonts,
      desc(config, 'SCOPE'), desc(shim, 'SCOPE', { executable: true }), manifestProof];
    const check = () => {
      try {
        need(active && process.env === environment && ENV_KEYS.every(key => environment[key] === installed[key]) &&
          OVERRIDES.every(key => environment[key] === undefined), 'CONTINUITY');
        for (const item of scopeInputs) sameIdentity(item, 'CONTINUITY');
      } catch { throw fault('CONTINUITY'); }
    };
    installed = { PATH: locations.bin.path + path.delimiter + (prior.PATH ?? '/usr/bin:/bin'), TMPDIR: locations.temp.path, [JAVA_ENV]: manifest };
    for (const key of ENV_KEYS) environment[key] = installed[key];
    active = true;
    check();
    const readPdfDrawnText = async (bytes, signal) => {
      check();
      need(!readStarted && Buffer.isBuffer(bytes) && bytes.length > 4 && bytes.length <= MAX_PDF &&
        bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) && signal instanceof AbortSignal && !signal.aborted, 'READER');
      readStarted = true;
      const pages = await parseDrawnPdf(bytes, signal, profile, locations.temp.path, locations['python-site'].path);
      check();
      return pages;
    };
    value = await use(Object.freeze({ check, readPdfDrawnText,
      evidence: Object.freeze({ ...evidence, body25RuntimeManifestSha256: manifestProof.sha256 }) }));
    check();
  } catch (error) {
    failed = true;
    first = error?.code?.startsWith(CODE + '_') || active ? error : fault('SCOPE');
  } finally {
    active = false;
    let unknown = false;
    if (installed) {
      if (process.env === environment && ENV_KEYS.every(key => environment[key] === installed[key])) {
        for (const key of ENV_KEYS) if (prior[key] === undefined) delete environment[key]; else environment[key] = prior[key];
      } else unknown = true;
    }
    if (root) {
      const unclosed = first?.appCleanupOutcome === 'UNKNOWN_DO_NOT_CONTINUE' || first?.code === 'CURRENT259_APP_ENV_CLEANUP_UNKNOWN';
      if (unclosed) unknown = true;
      else {
        try {
          sameIdentity(anchor, 'CLEANUP'); sameIdentity(root, 'CLEANUP');
          fs.rmSync(root.path, { recursive: true, force: false });
        } catch { unknown = true; }
      }
    }
    busy = false;
    if (unknown) {
      const error = Object.assign(fault('CLEANUP_UNKNOWN'), { appCleanupOutcome: 'UNKNOWN_DO_NOT_CONTINUE' });
      if (failed) Object.defineProperty(error, 'cause', { value: first });
      throw error;
    }
  }
  if (failed) throw first;
  return value;
}

// Candidate tools are never runtime authority until independent qualification
// and a reviewed source-bound activation have completed.
function verifyOfficialTask12DocumentRuntime(file,expectedSha256,moduleView) {
  if(arguments.length!==3)throw Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_INPUT'),{code:'TASK12_OFFICIAL_DOCUMENT_INPUT'});
  return require('./task12-official-document-profile.cjs').verifyOfficialTask12DocumentRuntime(file,expectedSha256,moduleView);
}
function observeOfficialTask12DocumentPublication(file,expectedSha256) {
  if(arguments.length!==2)throw Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_INPUT'),{code:'TASK12_OFFICIAL_DOCUMENT_INPUT'});
  return require('./task12-official-document-profile.cjs').observeOfficialTask12DocumentPublication(file,expectedSha256);
}
async function withOfficialTask12DocumentRuntime(proof,runRoot,use) {
  if(arguments.length!==3)throw Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_SCOPE'),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
  return require('./task12-official-document-profile.cjs').withOfficialTask12DocumentRuntime(proof,runRoot,use);
}
function prepareOfficialTask12DocumentRuntimeInput(outputPath,runRoot) {
  if(arguments.length!==2)throw Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_INPUT'),{code:'TASK12_OFFICIAL_DOCUMENT_INPUT'});
  return require('./task12-official-document-profile.cjs').prepareOfficialTask12DocumentRuntimeInput(outputPath,runRoot);
}
module.exports = Object.freeze({ verifyCurrent259GeneratedDocumentRuntime, withCurrent259GeneratedDocumentRuntime,
  observeOfficialTask12DocumentPublication, verifyOfficialTask12DocumentRuntime, withOfficialTask12DocumentRuntime,prepareOfficialTask12DocumentRuntimeInput });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { verifyCurrent259GeneratedDocumentRuntime: verify, withCurrent259GeneratedDocumentRuntime: withRuntime } =
  require('./task12-current259-generated-document-runtime.cjs');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('rejects changed, non-private, linked and out-of-profile runtime inputs before acquisition', () => {
  const root = fs.mkdtempSync('/private/tmp/task12-runtime-negative-');
  try {
    const file = path.join(root, 'runtime.json');
    const bytes = Buffer.from(JSON.stringify({ version: 1, purpose: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_V1', worker: '/unexpected' }));
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    for (const expected of ['0'.repeat(64), digest(bytes)]) {
      assert.throws(() => verify(file, expected), { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_INPUT' });
    }
    fs.chmodSync(file, 0o644);
    assert.throws(() => verify(file, digest(bytes)), { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_INPUT' });
    const link = path.join(root, 'link.json');
    fs.symlinkSync(file, link);
    assert.throws(() => verify(link, digest(bytes)), { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_INPUT' });
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('refuses cloned evidence before touching environment or directories', async () => {
  await assert.rejects(withRuntime(Object.freeze({ profile: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_V1' }),
    '/private/tmp/nonexistent-runtime', () => assert.fail('must not call')), { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_SCOPE' });
});

function glyphControl() {
  const stream = [
    'BT /F1 12 Tf 30 30 Td (visible) Tj ET',
    'BT /F1 12 Tf 3 Tr 30 60 Td (hidden) Tj ET',
    'BT /F1 12 Tf 0 Tr 500 90 Td (outside) Tj ET'
  ].join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let document = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(document);
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  const xref = Buffer.byteLength(document);
  return Buffer.from(document + `xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

const input = process.env.TASK12_OFFLINE_DOCUMENT_RUNTIME_INPUT;
const expected = process.env.TASK12_OFFLINE_DOCUMENT_RUNTIME_INPUT_SHA256;
test('real offline locked parser accepts only the drawn glyph and restores the environment',
  { skip: !input && !expected }, async () => {
    const proof = verify(input, expected);
    const root = fs.mkdtempSync('/private/tmp/task12-runtime-drawn-');
    const keys = ['PATH', 'TMPDIR', 'CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST', 'JWT_ACCESS_SECRET'];
    const prior = keys.map(key => process.env[key]);
    const invalid = { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_READER' };
    let lateCheck;
    try {
      const result = await withRuntime(proof, root, async scope => {
        scope.check();
        lateCheck = scope.check;
        const controller = new AbortController();
        assert.equal(process.env.JWT_ACCESS_SECRET, prior[3]);
        assert.match(process.env.TMPDIR, /\/document-runtime-[^/]+\/temp$/u);
        const pages = await scope.readPdfDrawnText(glyphControl(), controller.signal);
        assert.deepEqual(pages, ['visible']);
        await assert.rejects(scope.readPdfDrawnText(glyphControl(), controller.signal), invalid);
        return scope.evidence;
      });
      assert.ok(Object.values(result).every(value => /^[a-f0-9]{64}$/u.test(value) || value === proof.profile));
      assert.deepEqual(fs.readdirSync(root), []);
      assert.deepEqual(keys.map(key => process.env[key]), prior);
      assert.throws(lateCheck, { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_CONTINUITY' });
      await assert.rejects(withRuntime(proof, root, () => assert.fail('must not replay')), { code: 'CURRENT259_GENERATED_DOCUMENT_RUNTIME_SCOPE' });
    } finally { fs.rmSync(root, { recursive: true }); }
  });

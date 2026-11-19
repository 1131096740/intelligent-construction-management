'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { exerciseCurrent259GeneratedDocument, projectCurrent259GeneratedDocumentOutcome } =
  require('./task12-current259-generated-document-exercise.cjs');

function model() {
  const calls = [];
  const id = value => 'aa00000' + value + '-1234-4234-8234-123456789012';
  const template = Object.freeze({ layoutId: id(4) });
  const opened = Object.freeze({});
  const fields = Object.freeze({});
  const saved = Object.freeze({
    status: 'DRAFT_DOCUMENT_SAVE_READBACK_MATCHED', projectId: id(1), contractId: id(2), versionId: id(3),
    layoutId: template.layoutId, leaseRevision: 1, sourceRevision: 2, documentContentRevision: 2,
    documentContentFingerprint: 'a'.repeat(64), fields
  });
  const coordinates = Object.freeze({
    status: 'DRAFT_WORD_PDF_COORDINATES_MATCHED', versionId: saved.versionId,
    generationId: id(5), docxFileId: id(6), pdfFileId: id(7)
  });
  const docx = {
    fileId: coordinates.docxFileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 80, sha256: 'b'.repeat(64)
  };
  const pdf = { fileId: coordinates.pdfFileId, mimeType: 'application/pdf', sizeBytes: 90, sha256: 'c'.repeat(64) };
  const publicResult = {
    status: 'DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED', generationId: coordinates.generationId, versionId: saved.versionId,
    layoutId: saved.layoutId, files: { docx: { ...docx, private: 'discard' }, pdf: { ...pdf, pageCount: 3 } }
  };
  const owner = {
    status: 'CURRENT259_GENERATED_DOCUMENT_OWNER_READBACK_MATCHED', generationId: coordinates.generationId, versionId: saved.versionId,
    layoutId: saved.layoutId, sourceRevision: saved.sourceRevision, documentContentRevision: saved.documentContentRevision,
    documentContentFingerprint: saved.documentContentFingerprint, files: { docx, pdf }, pdfPageCount: 3,
    auditRows: 5, nativeAdmission: false, executionAllowed: false, private: 'discard'
  };
  const ownerScope = Object.freeze({});
  const parserSignal = new AbortController().signal;
  const runtime = {
    check() {},
    evidence: { inputSha256: 'd'.repeat(64), body25RuntimeManifestSha256: 'e'.repeat(64) },
    async readPdfDrawnText(bytes, signal) {
      assert.equal(bytes.toString(), '%PDF-');
      assert.ok(signal instanceof AbortSignal);
      calls.push('parser');
      return [['合成正文']];
    }
  };
  const scoped = {
    http: {
      publishMaterialTemplate(bytes) {
        assert.equal(bytes.length, 29389);
        calls.push('template');
        return template;
      },
      openDraft() { calls.push('open'); return opened; },
      saveGeneratedDraft(draft, published) {
        assert.equal(draft, opened);
        assert.equal(published, template);
        calls.push('save');
        return saved;
      },
      generateDocument(published, current) {
        assert.equal(published, template);
        assert.equal(current, saved);
        calls.push('generate');
        return coordinates;
      },
      async readDocumentOutputs(result, scope, savedFields, parse) {
        assert.equal(result, coordinates);
        assert.equal(scope, ownerScope);
        assert.equal(savedFields, fields);
        calls.push('public');
        assert.deepEqual(await parse(Buffer.from('%PDF-'), parserSignal), [['合成正文']]);
        return publicResult;
      }
    },
    beginOwnerReadback() { calls.push('owner-before'); return ownerScope; },
    readOwnerResult(scope, result) {
      assert.equal(scope, ownerScope);
      assert.equal(result, publicResult);
      calls.push('owner-after');
      return owner;
    }
  };
  const signal = new AbortController().signal;
  const businessDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return { calls, owner, scoped, runtime, options: { signal, businessDate } };
}

test('composes the same draft, template, parser and independent owner result once', async () => {
  const f = model();
  const value = await exerciseCurrent259GeneratedDocument(f.scoped, f.runtime, f.options);
  assert.deepEqual(f.calls, ['template', 'open', 'save', 'owner-before', 'generate', 'public', 'parser', 'owner-after']);
  assert.throws(() => projectCurrent259GeneratedDocumentOutcome({ ...value }), /RESULT/u);
  assert.equal(projectCurrent259GeneratedDocumentOutcome(value), value);
  assert.equal(value.auditRows, 5);
  assert.equal(value.files.pdf.sizeBytes, 90);
  assert.equal(value.files.docx.private, undefined);
  assert.equal(value.private, undefined);
  assert.throws(() => projectCurrent259GeneratedDocumentOutcome(value), /RESULT/u);
});

test('stops at the first failure and rejects disagreement between public bytes and owner evidence', async () => {
  const first = model();
  first.scoped.http.saveGeneratedDraft = () => { throw Error('private raw details'); };
  await assert.rejects(exerciseCurrent259GeneratedDocument(first.scoped, first.runtime, first.options),
    { message: 'CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE' });
  assert.deepEqual(first.calls, ['template', 'open']);
  const second = model();
  second.owner.files.pdf = { ...second.owner.files.pdf, sizeBytes: 91 };
  await assert.rejects(exerciseCurrent259GeneratedDocument(second.scoped, second.runtime, second.options), /RESULT/u);
});

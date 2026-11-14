'use strict';

const path = require('node:path');
const { isDeepStrictEqual: equal } = require('node:util');
const { readQualifiedTask16File } = require('./task16-runtime-inputs.cjs');

const TEMPLATE = path.resolve(__dirname, '../assets/templates/material-purchase-real-v1.docx');
const TEMPLATE_SHA = '44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd';
const TEMPLATE_BYTES = 29389;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';
const completed = new WeakSet();
const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const day = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

function failure(stage) {
  const code = 'CURRENT259_GENERATED_DOCUMENT_EXERCISE_' + stage;
  return Object.assign(new Error(code), { code });
}
function need(condition, stage) {
  if (!condition) throw failure(stage);
}
function fileFacts(file) {
  return Object.freeze(Object.fromEntries(['fileId', 'mimeType', 'sizeBytes', 'sha256'].map(key => [key, own(file, key)])));
}
function validFile(file, mime) {
  return UUID.test(file.fileId) && file.mimeType === mime && Number.isSafeInteger(file.sizeBytes) &&
    file.sizeBytes > 0 && SHA.test(file.sha256);
}

async function exerciseCurrent259GeneratedDocument(scoped, runtime, { signal, businessDate }) {
  const { http } = scoped;
  need(signal instanceof AbortSignal && businessDate === day() && typeof runtime.check === 'function' &&
    typeof runtime.readPdfDrawnText === 'function' && SHA.test(runtime.evidence?.inputSha256) &&
    SHA.test(runtime.evidence?.body25RuntimeManifestSha256), 'INPUT');
  const check = stage => {
    need(!signal.aborted && businessDate === day(), stage);
    runtime.check();
  };
  const stage = async (name, action) => {
    check(name);
    let result;
    try { result = await action(); }
    catch { throw failure(name); }
    check(name);
    return result;
  };

  const template = await stage('TEMPLATE', () => {
    const source = readQualifiedTask16File(TEMPLATE, {
      collect: true, maxBytes: TEMPLATE_BYTES, code: 'CURRENT259_GENERATED_DOCUMENT_EXERCISE_TEMPLATE'
    });
    need(source.sha256 === TEMPLATE_SHA && source.bytes.length === TEMPLATE_BYTES, 'TEMPLATE');
    return http.publishMaterialTemplate(source.bytes);
  });
  const opened = await stage('OPEN', () => http.openDraft());
  const saved = await stage('SAVE', () => http.saveGeneratedDraft(opened, template));
  need(saved.status === 'DRAFT_DOCUMENT_SAVE_READBACK_MATCHED' && saved.leaseRevision === 1 &&
    saved.sourceRevision === 2 && Number.isSafeInteger(saved.documentContentRevision) &&
    saved.documentContentRevision > 0 && SHA.test(saved.documentContentFingerprint), 'SAVE');
  const ownerScope = await stage('OWNER_BEGIN', () => scoped.beginOwnerReadback());
  const coordinates = await stage('GENERATE', () => http.generateDocument(template, saved));
  const readDrawnText = (bytes, parserSignal) => {
    check('PUBLIC_READBACK');
    return runtime.readPdfDrawnText(bytes, AbortSignal.any([signal, parserSignal]));
  };
  const publicResult = await stage('PUBLIC_READBACK', () => http.readDocumentOutputs(coordinates, ownerScope, saved.fields, readDrawnText));
  const owner = await stage('OWNER_READBACK', () => scoped.readOwnerResult(ownerScope, publicResult));

  const { projectId, contractId, versionId, layoutId, sourceRevision, documentContentRevision, documentContentFingerprint } = saved;
  const { generationId } = coordinates;
  const docx = fileFacts(owner.files?.docx);
  const pdf = fileFacts(owner.files?.pdf);
  const ids = [projectId, contractId, versionId, layoutId, generationId, docx.fileId, pdf.fileId];
  need(ids.every(id => typeof id === 'string' && UUID.test(id)) && new Set(ids).size === ids.length &&
    validFile(docx, DOCX) && validFile(pdf, PDF) &&
    coordinates.status === 'DRAFT_WORD_PDF_COORDINATES_MATCHED' && coordinates.versionId === versionId &&
    coordinates.docxFileId === docx.fileId && coordinates.pdfFileId === pdf.fileId &&
    publicResult.status === 'DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED' && publicResult.generationId === generationId &&
    publicResult.versionId === versionId && publicResult.layoutId === layoutId &&
    equal(docx, fileFacts(publicResult.files?.docx)) && equal(pdf, fileFacts(publicResult.files?.pdf)) &&
    owner.status === 'CURRENT259_GENERATED_DOCUMENT_OWNER_READBACK_MATCHED' && owner.generationId === generationId &&
    owner.versionId === versionId && owner.layoutId === layoutId && owner.sourceRevision === sourceRevision &&
    owner.documentContentRevision === documentContentRevision && owner.documentContentFingerprint === documentContentFingerprint &&
    owner.auditRows === 5 && owner.nativeAdmission === false && owner.executionAllowed === false &&
    Number.isSafeInteger(owner.pdfPageCount) && owner.pdfPageCount > 0 && owner.pdfPageCount === publicResult.files.pdf.pageCount, 'RESULT');
  const result = Object.freeze({ projectId, contractId, versionId, layoutId, generationId, sourceRevision,
    documentContentRevision, documentContentFingerprint, files: Object.freeze({ docx, pdf }), pdfPageCount: owner.pdfPageCount,
    auditRows: 5, templateSha256: TEMPLATE_SHA, runtimeInputSha256: runtime.evidence.inputSha256,
    body25RuntimeManifestSha256: runtime.evidence.body25RuntimeManifestSha256 });
  completed.add(result);
  return result;
}

function projectCurrent259GeneratedDocumentOutcome(result) {
  need(completed.delete(result), 'RESULT');
  return result;
}

module.exports = Object.freeze({ exerciseCurrent259GeneratedDocument, projectCurrent259GeneratedDocumentOutcome });

"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { isExactObjectKey, sha256 } = require("./business-zeroing-core.cjs");
const { assertProductionInspectionBoundary } = require("./isolated-file-cleanup-production-boundary.cjs");

// Internal seam for the external COS service. The coordinator supplies its
// bounded, signed read and one-shot DELETE transports; this module prevents
// either adapter from receiving an unapproved coordinate or a replayed DELETE.
function createProductionObjectOperations({ source, plan, verifyAuthority,
  listObjectVersions, deleteObjectVersion, runtime }) {
  const reject = () => { throw new Error("PRODUCTION_OBJECT_SCOPE_INVALID"); };
  assertProductionInspectionBoundary(source, runtime);
  const bucket = (runtime?.environment ?? process.env).COS_BUCKET;
  if (!plan || plan.mode !== "isolated_file_cleanup_dry_run" ||
      !Array.isArray(plan.operations) || plan.operations.length !== 2 ||
      [verifyAuthority, listObjectVersions, deleteObjectVersion].some(value => typeof value !== "function")) reject();
  const approved = new Map();
  const ids = new Set();
  for (const operation of plan.operations) {
    const object = operation?.object;
    const id = operation?.database?.primaryKey?.id;
    if (operation.database?.table !== "FileObject" || typeof id !== "string" || !id || ids.has(id) ||
        object?.kind !== "cos_versions" || object.bucket !== bucket ||
        !isExactObjectKey(object.objectKey) ||
        !Array.isArray(object.versions) || object.versions.length === 0) reject();
    const versions = object.versions.map(version => version?.versionId);
    if (versions.some(version => typeof version !== "string" || !version) ||
        new Set(versions).size !== versions.length) reject();
    const coordinate = `${object.bucket}\0${object.objectKey}`;
    if (approved.has(coordinate)) reject();
    ids.add(id);
    approved.set(coordinate, { digest: sha256(object), versions: new Set(versions) });
  }
  const attempted = new Set();
  const guard = async object => {
    assertProductionInspectionBoundary(source, runtime);
    const environment = runtime?.environment ?? process.env;
    const coordinate = `${object?.bucket}\0${object?.objectKey}`;
    const allowed = approved.get(coordinate);
    if (!allowed || object.bucket !== environment.COS_BUCKET || sha256(object) !== allowed.digest) reject();
    await verifyAuthority();
    return { coordinate, allowed };
  };
  return {
    async listVersions(object) {
      await guard(object);
      return listObjectVersions(object);
    },
    async deleteVersion(object, versionId) {
      const { coordinate, allowed } = await guard(object);
      if (!allowed.versions.has(versionId)) reject();
      const attempt = `${coordinate}\0${versionId}`;
      if (attempted.has(attempt)) throw new Error("PRODUCTION_VERSION_ATTEMPTED");
      attempted.add(attempt);
      return deleteObjectVersion(object, versionId);
    }
  };
}

module.exports = { createProductionObjectOperations };

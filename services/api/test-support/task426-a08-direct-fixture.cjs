"use strict";

const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const {
  buildCurrent259FirstOutsideDirectFixture, buildCurrent259FirstQ2Fixture
} = require("../prisma/task12-current259-q2-fixture.cjs");
const { createCurrent259FirstQ2Seed, createNativeA08Seed } = require("../prisma/task12-current259-q2-seed.cjs");
const { readOwnedNativeArchiveIdentity } = require("../prisma/seal-retirement-329-archive.cjs");
const { prepareA08OwnerPreflight } = require("./task426-a08-owner-preflight.cjs");
const { prepareA08OriginalAssociation } = require("./task426-a08-original-association.cjs");
const { assertA08Source } = require("./task426-a08-upward-pin-332-profile.cjs");

const bucket = "a08-offline-fixture-0000000000";
const region = "ap-chengdu";
const prefix = "a08-offline-fixture/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{64}$/u;
const downloadReason = "A08 隔离验收签章原件";
const attachmentSlot = "direct_signed_originals_v1";
const contractType = "material_purchase";
const enterprisePosition = { roleKey: "party_a", displayOrder: 0 };
const companyPosition = { roleKey: "party_b", displayOrder: 0 };

async function createOriginals() {
  const originals = [];
  for (const sequence of [1, 2]) {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.setTitle(`A08 isolated synthetic signed original ${sequence}`);
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(`A08 fictional contract original ${sequence}`, { x: 48, y: 700, size: 18, font });
    const bytes = Buffer.from(await pdf.save());
    const originalName = `synthetic-signed-original-0${sequence}.pdf`;
    originals.push({ metadata: { originalName, mimeType: "application/pdf", sizeBytes: bytes.length,
      contentSha256: hash(bytes), bucket, objectKey: prefix + originalName,
      objectGeneration: `a08-offline-generation-${sequence}` }, bytes, region });
  }
  return originals;
}

// The fixture only answers the application's exact storage reads in memory.
function createOfflineOriginalTransport(originals) {
  const reads = [];
  const byUrl = new Map(originals.flatMap(original => {
    const { bucket, objectKey, objectGeneration } = original.metadata;
    const url = new URL(`https://${bucket}.cos.${original.region}.myqcloud.com/${objectKey}`);
    const generation = encodeURIComponent(objectGeneration).replace(/[!'()*]/gu, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return [[url.href, { original, pinned: false }],
      [`${url.href}?versionId=${generation}`, { original, pinned: true }]];
  }));
  return {
    fetch(url, init) {
      assert.equal(typeof url, "string", "A08_OFFLINE_URL");
      const request = byUrl.get(url);
      const target = new URL(url);
      assert.ok(request && init?.method === "GET" && init.redirect === "error" && init.body === undefined,
        "A08_OFFLINE_READ_SCOPE");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("host"), target.host, "A08_OFFLINE_HOST");
      assert.equal(headers.get("accept-encoding"), "identity", "A08_OFFLINE_ENCODING");
      const { original, pinned } = request;
      const { objectGeneration, mimeType, sizeBytes } = original.metadata;
      reads.push({ contentSha256: original.metadata.contentSha256, pinned });
      return Promise.resolve(new Response(original.bytes, { headers: {
        "x-cos-version-id": objectGeneration, "content-type": mimeType, "content-length": String(sizeBytes)
      } }));
    },
    checkpoint() { return reads.length; },
    readsSince(checkpoint) { return reads.slice(checkpoint); }
  };
}

// This material is handed to an independently qualified database owner.
// The public draft upload route writes a new object and is outside this case.
function directCase(relationship, caseId, businessDate, originals, source, sourceSha) {
  const outside = relationship === "outside";
  const master = outside ? buildCurrent259FirstOutsideDirectFixture(caseId, businessDate)
    : buildCurrent259FirstQ2Fixture(caseId, businessDate, false);
  const { User: actor, Project: project, CompanyEntity: company, BusinessPartyVersion: enterprise } = master.seed;
  const files = Object.freeze(originals.map(({ metadata }) => Object.freeze({ ...metadata, id: randomUUID() })));
  const fileIds = files.map(file => file.id);
  const ownerFileObjects = Object.freeze(files.map(({ objectGeneration, ...file }) => Object.freeze({
    ...file, uploadedByUserId: actor.id, storageStatus: "active", purgeReceiptId: null, supersedesFileObjectId: null
  })));
  const saveKey = randomUUID();
  const archiveKey = master.archiveIdempotencyKey;
  const drafted = new WeakMap();
  let seededArchive;
  let associationPrepared = false;

  function onCreated({ contract, version }) {
    assert.match(contract.id, uuid);
    assert.match(version.id, uuid);
    assert.equal(contract.projectId, project.id);
    assert.equal(contract.ownerUserId, actor.id);
    assert.equal(contract.contractTypeKey, contractType);
    assert.equal(version.contractId, contract.id);
    assert.equal(version.status, "draft");
    assert.equal(version.draftRevision, 1);
    const draft = "/contract-drafts/" + version.id;
    const contractPath = "/contracts/" + version.id;
    const ownerFileBinding = Object.freeze({
      relation: outside ? "jg_a08_outside_original_pair_v1" : "jg_a08_direct_original_voucher_binding_v1",
      projectId: project.id, versionId: version.id, applicantId: actor.id,
      originals: files.map(({ id, contentSha256, sizeBytes, mimeType }) => ({ id, contentSha256, sizeBytes, mimeType }))
    });
    drafted.set(ownerFileBinding, contract.id);
    return {
      leaseRequest: { method: "POST", path: draft + "/edit-lease" },
      ownerFileBinding,
      saveRequest({ token }) {
        assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
        return {
          method: "PUT", path: draft, headers: { "x-contract-draft-lease": token },
          json: {
            idempotencyKey: saveKey, saveKind: "manual", expectedRevision: version.draftRevision,
            changedSections: ["draft", "parties", "attachments"],
            draft: {
              ...(!outside ? { companyEntityId: company.id } : {}),
              numericProtocolVersion: 2, manualAmountYuan: "100.0054",
              originalSignedNumber: "A08-" + caseId.slice(0, 8),
              draftData: {
                contractName: "A08 隔离直签材料采购合同",
                contractBasics: { businessType: contractType, relationship, amountBasis: "tax_inclusive",
                  invoiceStatus: "pending", settlementText: "按纸面结算" },
                directSigningInput: {
                  protocolVersion: outside ? 1 : 2, source: "direct_signed", relationship, signedOn: businessDate,
                  enterpriseParty: enterprisePosition,
                  ...(outside ? { counterpartyParty: companyPosition } :
                    { companyParty: companyPosition, companyParticipationId: null }),
                  fixedPaymentTermsVersionId: null
                }
              },
              clauses: [], pricingNature: "unit_price", amountSource: "manual",
              taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "13.25", source: "contract_document" }
            },
            parties: [{ ...enterprisePosition, businessPartyVersionId: enterprise.id, snapshot: {} },
              ...(outside ? [{ ...companyPosition, businessPartyVersionId: master.counterparty.version.id, snapshot: {} }] : [])],
            bills: [], paymentTerms: { originalText: "以纸面原文为准", stages: [] },
            attachments: fileIds.map((fileId, displayOrder) => ({ slotKey: attachmentSlot, fileId, displayOrder })),
            negotiationDocuments: { referencedGeneratedDocumentIds: [] }
          }
        };
      },
      archiveRequest(saved) {
        const { directSigningInput: input } = saved;
        assert.equal(saved.draftRevision, version.draftRevision + 1);
        assert.equal(input.state, "complete");
        assert.match(input.inputSha256, sha);
        assert.deepEqual(input.Q.locator, { projectId: project.id, contractId: contract.id,
          contractVersionId: version.id, draftRevision: saved.draftRevision, versionNo: 1, changeType: "original" });
        assert.deepEqual(input.Q.source, { kind: "direct_signed", relationship });
        assert.deepEqual(input.Q.signedFiles, files.map(({ id, mimeType, sizeBytes, contentSha256 }, displayOrder) =>
          ({ fileId: id, displayOrder, mimeType, sizeBytes, contentSha256 })));
        return { method: "POST", path: contractPath + "/signed-archive", json: {
          archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: archiveKey,
          expectedDraftRevision: saved.draftRevision, expectedInputSha256: input.inputSha256,
          fileIds: [...fileIds], confirmedMatchingSignedDocument: true
        } };
      },
      archiveResultRequest: { method: "GET", path: contractPath + "/archive-requests/" + archiveKey },
      verifyArchiveResult(archived, recovered) {
        assert.match(archived.archiveId, uuid);
        assert.deepEqual(archived, { archiveId: archived.archiveId, contractVersionId: version.id,
          status: "effective", fileIds });
        assert.equal(recovered.status, "archived");
        assert.deepEqual(recovered.result, archived);
        assert.equal(recovered.intent.idempotencyKey, archiveKey);
        assert.deepEqual(recovered.intent.fileIds, fileIds);
        assert.match(recovered.requestSha256, sha);
      },
      downloadTicketRequests: fileIds.map(id => ({ method: "POST", path: "/files/" + id + "/download-ticket",
        json: { downloadReason } }))
    };
  }

  return {
    relationship, caseId, offlineOriginalTransport: createOfflineOriginalTransport(originals),
    applicantId: actor.id,
    loginRequest: () => master.createCase().next(),
    createOwnerSeed: identity => createCurrent259FirstQ2Seed(master, identity),
    prepareNativeOwnerSeed(archiveMaterial) {
      const { owner, application } = readOwnedNativeArchiveIdentity(archiveMaterial);
      const preflight = prepareA08OwnerPreflight(source, sourceSha, { database: owner.database, databaseOid: owner.databaseOid,
        systemIdentifier: owner.systemIdentifier, serverPort: owner.serverPort, appName: application.name, appOid: application.oid });
      return {
        sql: preflight.sql,
        accept(readback) {
          const evidence = preflight.verify(readback);
          const seed = createNativeA08Seed(master, archiveMaterial, source, sourceSha, readback.ledger);
          return { evidence, seed: { ...seed, finish(raw) {
            const result = seed.finish(raw);
            seededArchive = archiveMaterial;
            return result;
          } } };
        }
      };
    },
    prepareNativeOriginalAssociation(archiveMaterial, binding) {
      const contractId = drafted.get(binding);
      assert.ok(contractId && seededArchive && seededArchive === archiveMaterial && !associationPrepared,
        "A08_ORIGINAL_ASSOCIATION_PROVENANCE");
      const association = prepareA08OriginalAssociation(archiveMaterial, { relationship, contractId,
        versionId: binding.versionId, projectId: project.id, applicantId: actor.id, saveKey, files: ownerFileObjects });
      associationPrepared = true;
      return association;
    },
    ownerFileObjects, expectedOriginals: files,
    verifyArchivedOriginals(rows) {
      assert.deepEqual(rows, files.map(({ id, originalName, ...evidence }, displayOrder) =>
        ({ fileId: id, displayOrder, ...evidence })));
    },
    verifyDownload(fileId, bytes) {
      const original = files.find(file => file.id === fileId);
      assert.ok(original && Buffer.isBuffer(bytes));
      assert.equal(bytes.length, original.sizeBytes);
      assert.equal(hash(bytes), original.contentSha256);
    },
    createDraftRequest: { method: "POST", path: "/contracts", json: {
      projectId: project.id, contractTypeKey: contractType, numericProtocolVersion: 2, handlingMode: "direct_signed", relationship
    } },
    onCreated
  };
}

// The runtime owns the HTTP and database ports. Only the application writes
// the draft and archive, and the owner callback may only prepare file fixtures.
async function runTask426A08DirectHttp(scenario, { http, archiveMaterial, ownerSql, outsiderId, outsiderLoginRequest, readArchive, recordArchiveStage, enter }) {
  const stages = [];
  async function send(stage, request, expected, actor = 0) {
    enter(`A08_HTTP_${stage}`);
    const result = await http.send(actor, request);
    if (result.status !== expected) {
      throw Object.assign(new Error(`A08_HTTP_${stage}`), { code: `A08_HTTP_${stage}`, httpStatus: result.status,
        expectedStatus: expected });
    }
    stages.push({ stage, status: result.status });
    return result.body;
  }
  const loggedIn = await send("LOGIN", scenario.loginRequest(), 201);
  assert.equal(loggedIn.user.id, scenario.applicantId);
  assert.deepEqual(loggedIn.user.roleKeys, ["contract_staff"]);
  assert.deepEqual(loggedIn.user.globalRoleKeys, []);
  const created = await send("CREATE", scenario.createDraftRequest, 201);
  const scenarioDraft = scenario.onCreated(created);
  const lease = await send("LEASE", scenarioDraft.leaseRequest, 201);
  enter("A08_ORIGINAL_ASSOCIATION_OPEN");
  const originals = scenario.prepareNativeOriginalAssociation(archiveMaterial, scenarioDraft.ownerFileBinding);
  originals.acceptOpen(await ownerSql(originals.openSql()));
  const saved = await send("SAVE", scenarioDraft.saveRequest(lease), 200);
  const archiveRequest = scenarioDraft.archiveRequest(saved);
  enter("A08_ORIGINAL_ASSOCIATION_CLOSE");
  originals.acceptClosed(await ownerSql(originals.closeSql()));
  const archived = await send("ARCHIVE", archiveRequest, 201);
  const recovered = await send("RECOVERY", scenarioDraft.archiveResultRequest, 200);
  scenarioDraft.verifyArchiveResult(archived, recovered);
  const archivedScope = { archiveId: archived.archiveId, versionId: created.version.id,
    actorId: scenario.applicantId, outsiderId, fileIds: archived.fileIds };
  enter("A08_ARCHIVE_BEFORE_TICKET");
  const beforeTicket = await readArchive(archivedScope);
  scenario.verifyArchivedOriginals(beforeTicket.originals);
  assert.deepEqual(beforeTicket.counts, {
    archives: 1, approvalRounds: 0, sealTasks: 0, draftOriginals: 0, archiveAudits: 1,
    downloadTicketAudits: 0, downloadAudits: 0, outsiderTicketAudits: 0
  });
  recordArchiveStage({ originalCount: beforeTicket.originals.length, counts: beforeTicket.counts });


  for (const [index, request] of scenarioDraft.downloadTicketRequests.entries()) {
    const original = scenario.expectedOriginals[index];
    const beforeTicket = Date.now();
    const ticket = await send("TICKET", request, 201);
    const expiration = Date.parse(ticket.expiresAt);
    assert.ok(expiration >= beforeTicket + 300_000 && expiration <= Date.now() + 300_000, "A08_TICKET_EXPIRY");
    const origin = "http://127.0.0.1";
    const download = new URL(ticket.downloadUrl, origin);
    assert.equal(download.origin, origin);
    assert.equal(download.pathname, `/files/${original.id}/download`);
    assert.equal(download.searchParams.get("actorUserId"), scenario.applicantId);
    assert.equal(download.searchParams.get("downloadReason"), downloadReason);
    assert.equal(download.searchParams.get("expiresAt"), ticket.expiresAt);
    assert.equal(download.searchParams.get("accessMode"), "download");
    assert.equal(download.searchParams.has("delegatorUserId"), false);
    assert.ok(/^[A-Za-z0-9_-]{43}$/u.test(download.searchParams.get("token") ?? ""), "A08_TICKET_TOKEN_SHAPE");
    assert.equal(ticket.fileId, original.id);
    assert.equal(ticket.fileName, original.originalName);
    assert.equal(ticket.mimeType, original.mimeType);
    assert.equal(ticket.sizeBytes, original.sizeBytes);
    enter("A08_HTTP_DOWNLOAD");
    const result = await http.download(0, download.pathname + download.search);
    if (result.status !== 200) throw Object.assign(new Error("A08_HTTP_DOWNLOAD"),
      { code: "A08_HTTP_DOWNLOAD", httpStatus: result.status, expectedStatus: 200 });
    assert.equal(result.mimeType, original.mimeType);
    scenario.verifyDownload(original.id, result.bytes);
    stages.push({ stage: "DOWNLOAD", status: result.status });
  }

  const outsider = await send("OUTSIDER_LOGIN", outsiderLoginRequest(), 201, 7);
  assert.equal(outsider.user.id, outsiderId);
  assert.notEqual(outsider.user.id, scenario.applicantId);
  assert.deepEqual(outsider.user.roleKeys, []);
  assert.deepEqual(outsider.user.globalRoleKeys, []);
  for (const request of scenarioDraft.downloadTicketRequests) {
    const denied = await send("OUTSIDER_TICKET", request, 403, 7);
    assert.equal(Object.hasOwn(denied, "downloadUrl"), false, "A08_OUTSIDER_NO_TICKET");
  }

  enter("A08_ARCHIVE_READBACK");
  const evidence = await readArchive(archivedScope);
  scenario.verifyArchivedOriginals(evidence.originals);
  assert.deepEqual(evidence.counts, {
    archives: 1, approvalRounds: 0, sealTasks: 0, draftOriginals: 0, archiveAudits: 1,
    downloadTicketAudits: archived.fileIds.length, downloadAudits: archived.fileIds.length, outsiderTicketAudits: 0
  });
  return { relationship: scenario.relationship, stages, counts: evidence.counts };
}

async function prepareTask426A08DirectFixtures({ source, sourceSha, businessDate, outsideCaseId, upwardCaseId }) {
  assertA08Source(source, sourceSha);
  assert.notEqual(outsideCaseId, upwardCaseId);
  const originals = await createOriginals();
  return {
    status: "A08_DIRECT_HOST_MATERIAL_VERIFIED",
    sourceSha, bucket, region,
    // The present upward owner binding admits one file. These cases use independent databases.
    outside: directCase("outside", outsideCaseId, businessDate, originals, source, sourceSha),
    upward: directCase("upward", upwardCaseId, businessDate, [originals[1]], source, sourceSha)
  };
}

module.exports = { prepareTask426A08DirectFixtures, runTask426A08DirectHttp };

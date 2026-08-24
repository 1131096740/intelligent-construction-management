const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerPath = path.join(__dirname, "run-contract-settlement-governance-uat.cjs");
const runnerSource = fs.readFileSync(runnerPath, "utf8");
const contractControllerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "contract", "contract.controller.ts"),
  "utf8"
);
const formalFileDtoSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "contract", "dto", "contract-formal-file.dto.ts"),
  "utf8"
);
const sealDtoSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "contract", "dto", "contract-seal.dto.ts"),
  "utf8"
);
const browserTestSource = fs.readFileSync(
  path.join(__dirname, "../../../apps/web-admin/e2e/real-role-browser-uat.e2e.ts"),
  "utf8"
);
const browserRunnerSource = fs.readFileSync(
  path.join(__dirname, "run-real-role-browser-uat.cjs"),
  "utf8"
);
function controllerPostSource(route) {
  const start = contractControllerSource.indexOf(`@Post(":contractVersionId/${route}")`);
  return contractControllerSource.slice(
    start,
    contractControllerSource.indexOf("\n  @Post(", start + 1)
  );
}
const counterpartyControllerSource = controllerPostSource("formal-files/counterparty");
const counterpartyConfirmationControllerSource = controllerPostSource("formal-files/counterparty/confirmation");
const finalControllerSource = controllerPostSource("formal-files/final");
const finalConfirmationControllerSource = controllerPostSource("formal-files/final/confirmation");
const start = runnerSource.indexOf("async function uploadCanvasSignature");
const end = runnerSource.indexOf("\nasync function prepareSharedFixtures", start);
const signaturePreparationSource = runnerSource.slice(start, end);
const fixtureStart = runnerSource.indexOf("async function createContractFixture");
const fixtureEnd = runnerSource.indexOf("\nasync function prepareAndSubmitContract", fixtureStart);
const fixtureSource = runnerSource.slice(fixtureStart, fixtureEnd);
const submitStart = runnerSource.indexOf("async function prepareAndSubmitContract");
const submitEnd = runnerSource.indexOf("\nfunction roleSequenceForType", submitStart);
const submitSource = runnerSource.slice(submitStart, submitEnd);
const sealStart = runnerSource.indexOf("async function sealAndArchive");
const sealEnd = runnerSource.indexOf("\nasync function assertAuthorizationCombinations", sealStart);
const sealSource = runnerSource.slice(sealStart, sealEnd);
const selfArchiveStart = runnerSource.indexOf("async function assertDirectorHandlerSelfArchive");
const selfArchiveEnd = runnerSource.indexOf("\nasync function createEffectiveBoundaryBase", selfArchiveStart);
const selfArchiveSource = runnerSource.slice(selfArchiveStart, selfArchiveEnd);
const directorSelfReviewStart = runnerSource.indexOf("async function assertDirectorInitiatorSelfReview");
const directorSelfReviewEnd = runnerSource.indexOf("\nasync function assertDirectorHandlerSelfArchive", directorSelfReviewStart);
const directorSelfReviewSource = runnerSource.slice(directorSelfReviewStart, directorSelfReviewEnd);
const approvalStart = runnerSource.indexOf("async function approveContract");
const approvalEnd = runnerSource.indexOf("\nasync function sealAndArchive", approvalStart);
const approvalSource = runnerSource.slice(approvalStart, approvalEnd);
const finalConfirmationStart = sealSource.indexOf("/formal-files/final/confirmation`");
const finalConfirmationEnd = sealSource.indexOf("\n  const effective", finalConfirmationStart);
const finalConfirmationSource = sealSource.slice(finalConfirmationStart, finalConfirmationEnd);
const finalUploadStart = sealSource.indexOf("const final = await request");
const finalUploadSource = sealSource.slice(finalUploadStart, finalConfirmationStart);
const selfArchiveFinalUploadStart = selfArchiveSource.indexOf("const final = await request");
const selfArchiveFinalUploadEnd = selfArchiveSource.indexOf("\n  const pending", selfArchiveFinalUploadStart);
const selfArchiveFinalUploadSource = selfArchiveSource.slice(
  selfArchiveFinalUploadStart,
  selfArchiveFinalUploadEnd
);
const changeStart = runnerSource.indexOf("async function assertChangeBoundary");
const changeEnd = runnerSource.indexOf("\nasync function createSettlementTemplate", changeStart);
const changeSource = runnerSource.slice(changeStart, changeEnd);

test("governance UAT prepares each personal signature through the domain route", () => {
  assert.match(signaturePreparationSource, /\/me\/signature\/canvas/u);
  assert.match(signaturePreparationSource, /uploadCanvasSignature\(\s*tokens\[role\]/u);
  assert.doesNotMatch(signaturePreparationSource, /uploadBuffer\(\s*tokens\[role\]/u);
});

test("director self-review governance fixture uploads its template through contract staff", () => {
  assert.match(fixtureSource, /uploadPdf\(tokens\.contractStaff,/u);
  assert.doesNotMatch(fixtureSource, /uploadPdf\(tokens\[applicantRole\],/u);
});

test("director-initiated contracts retain the frozen director node and submit a real self-review confirmation", () => {
  assert.doesNotMatch(runnerSource, /expectedContractRoutes\[fixture\.config\.type\]\.slice\(1\)/u);
  assert.match(approvalSource, /selfReviewReason: "UAT 合同部主管作为冻结经办人自审"/u);
  assert.match(approvalSource, /confirmationPassword: password/u);
  assert.match(directorSelfReviewSource, /"contract_director_initiator_self_review"/u);
  assert.match(directorSelfReviewSource, /tokens\.projectManager/u);
  assert.match(directorSelfReviewSource, /HTTP-403-project-manager-before-self-review/u);
  assert.match(directorSelfReviewSource, /contract\.approval\.approve/u);
  assert.match(directorSelfReviewSource, /selfReviewReason/u);
});

test("contract-owned formal files use the draft domain upload route", () => {
  assert.match(runnerSource, /async function uploadContractDraftPdf\(/u);
  assert.match(
    runnerSource,
    /uploadContractDraftPdf\(\s*tokens\[fixture\.applicantRole\],\s*fixture\.version\.id,\s*`UAT-\$\{runId\}-\$\{fixture\.config\.type\}-counterparty-signed\.pdf`/u
  );
});

test("governance UAT confirms the current counterparty-signed file before contract submission", () => {
  assert.match(
    submitSource,
    /uploadContractDraftPdf\(\s*tokens\[fixture\.applicantRole\],\s*fixture\.version\.id,\s*`UAT-\$\{runId\}-\$\{fixture\.config\.type\}-counterparty-signed\.pdf`/u
  );
  assert.match(submitSource, /\/formal-files\/counterparty`,\s*tokens\[fixture\.applicantRole\]/u);
  assert.match(
    submitSource,
    /\/formal-files\/counterparty\/confirmation`,\s*tokens\[fixture\.applicantRole\]/u
  );
  assert.match(submitSource, /fileIds: \[counterpartySignedPdf\.id\]/u);
  assert.match(submitSource, /formalFileId: counterpartySigned\.previewFormalFileId/u);
  assert.match(submitSource, /const unconfirmedSubmission = await request\(/u);
  assert.match(submitSource, /unconfirmedSubmission\.status >= 400 && unconfirmedSubmission\.status < 500/u);
  assert.match(submitSource, /unconfirmedVersion\?\.status === "draft"/u);
  assert.match(submitSource, /!unconfirmedInstance/u);
  assert.doesNotMatch(submitSource, /\/formal-files\/approval/u);
  const counterpartyUploadIndex = submitSource.indexOf("/formal-files/counterparty`");
  const unconfirmedSubmissionIndex = submitSource.indexOf("/approval-submission`");
  const counterpartyConfirmationIndex = submitSource.indexOf("/formal-files/counterparty/confirmation`");
  const confirmedSubmissionIndex = submitSource.lastIndexOf("/approval-submission`");
  assert(
    counterpartyUploadIndex < unconfirmedSubmissionIndex &&
      unconfirmedSubmissionIndex < counterpartyConfirmationIndex &&
      counterpartyConfirmationIndex < confirmedSubmissionIndex,
    "乙方签章上传、确认前阻断、整体确认、审批提交必须按当前正式链顺序编排"
  );
});

test("governance UAT establishes document content through the public draft flow before counterparty upload", () => {
  const preparationStart = runnerSource.indexOf("async function establishContractDocumentContent");
  const preparationEnd = runnerSource.indexOf("\nasync function prepareAndSubmitContract", preparationStart);
  assert.ok(preparationStart >= 0, "runner must establish document content through a named fixture seam");
  assert.ok(preparationEnd > preparationStart, "document content preparation seam must end before submission");
  const preparationSource = runnerSource.slice(preparationStart, preparationEnd);

  assert.match(preparationSource, /\/contract-drafts\/\$\{fixture\.version\.id\}\/edit-lease/u);
  assert.match(preparationSource, /\/contract-drafts\/\$\{fixture\.version\.id\}\/workbench/u);
  assert.match(preparationSource, /request\(\s*"PUT",\s*`\/contract-drafts\//u);
  assert.match(preparationSource, /x-contract-draft-lease/u);
  assert.match(preparationSource, /documentContentFingerprint/u);
  assert.doesNotMatch(preparationSource, /contractGeneratedDocument\.create/u);

  const counterpartyUploadIndex = submitSource.indexOf("/formal-files/counterparty`");
  const preparationCallIndex = submitSource.indexOf("establishContractDocumentContent(fixture, tokens)");
  assert.ok(preparationCallIndex >= 0, "submission must call the public-flow content preparation seam");
  assert.ok(preparationCallIndex < counterpartyUploadIndex, "content preparation must precede counterparty upload");
});

test("governance UAT confirms counterparty files before every operational contract submission", () => {
  const contractSubmissionRoutes = [...runnerSource.matchAll(/`(\/contracts\/\$\{[^`]+?\/approval-submission)`/gu)]
    .map((match) => match[1]);
  assert.deepEqual(contractSubmissionRoutes, [
    "/contracts/${fixture.version.id}/approval-submission",
    "/contracts/${fixture.version.id}/approval-submission",
    "/contracts/${draft.id}/approval-submission",
    "/contracts/${draft.id}/approval-submission"
  ]);
  assert.doesNotMatch(runnerSource, /\/formal-files\/approval/u);
  assert(
    submitSource.indexOf("/formal-files/counterparty/confirmation`") <
      submitSource.lastIndexOf("/approval-submission`"),
    "正常合同提交必须发生在乙方签章整体确认之后"
  );
  assert.match(
    changeSource,
    /const changeCounterpartySignedPdf = await uploadContractDraftPdf\(\s*tokens\.contractStaff,\s*draft\.id,\s*`UAT-\$\{runId\}-change-\$\{suffix\}-counterparty-signed\.pdf`/u
  );
  assert.match(changeSource, /fileIds: \[changeCounterpartySignedPdf\.id\]/u);
  assert.match(changeSource, /formalFileId: changeCounterpartySigned\.previewFormalFileId/u);
  const changeCounterpartyUploadIndex = changeSource.indexOf("/formal-files/counterparty`");
  const changeCounterpartyConfirmationIndex = changeSource.indexOf("/formal-files/counterparty/confirmation`");
  const changeSubmissionIndex = changeSource.indexOf("/approval-submission`");
  assert(
    changeCounterpartyUploadIndex < changeCounterpartyConfirmationIndex &&
      changeCounterpartyConfirmationIndex < changeSubmissionIndex,
    "变更边界的允许和 10.01% 阻断提交都必须发生在乙方签章整体确认之后"
  );
});

test("governance UAT formal-file request bodies conform to the current controller DTOs", () => {
  assert.match(counterpartyControllerSource, /UploadCounterpartySignedFileDto/u);
  assert.match(counterpartyConfirmationControllerSource, /ConfirmCounterpartySignedFileDto/u);
  assert.match(finalControllerSource, /UploadMutuallySignedContractDto/u);
  assert.match(finalConfirmationControllerSource, /ConfirmMutuallySignedContractDto/u);
  assert.match(formalFileDtoSource, /class UploadCounterpartySignedFileDto[\s\S]*fileIds[\s\S]*sourceRevision/u);
  assert.match(formalFileDtoSource, /class ConfirmCounterpartySignedFileDto[\s\S]*formalFileId[\s\S]*expectedDraftRevision/u);
  assert.match(sealDtoSource, /class UploadMutuallySignedContractDto[\s\S]*fileId[\s\S]*sourceRevision/u);
  assert.match(sealDtoSource, /class ConfirmMutuallySignedContractDto[\s\S]*formalFileId[\s\S]*documentOrderConfirmed/u);
  assert.doesNotMatch(
    sealDtoSource.slice(sealDtoSource.indexOf("class ConfirmMutuallySignedContractDto")),
    /confirmationPassword/u
  );

  assert.match(submitSource, /fileIds: \[counterpartySignedPdf\.id\][\s\S]*sourceRevision: current\.draftRevision/u);
  assert.match(submitSource, /formalFileId: counterpartySigned\.previewFormalFileId[\s\S]*expectedDraftRevision: current\.draftRevision/u);
  for (const source of [sealSource, selfArchiveSource]) {
    assert.match(source, /firstPartySignedOrStamped[\s\S]*companySealCompleted[\s\S]*crossPageSealCompleted[\s\S]*signingDateCompleted/u);
  }
  for (const source of [finalUploadSource, selfArchiveFinalUploadSource]) {
    assert.match(source, /\.\.\.completion,[\s\S]*fileId: finalPdf\.id[\s\S]*sourceRevision:[\s\S]*onlyPermittedSignatureChanges: true[\s\S]*documentOrderConfirmed: true/u);
  }
  assert.match(finalConfirmationSource, /\.\.\.completion,[\s\S]*formalFileId: final\.id[\s\S]*onlyPermittedSignatureChanges: true[\s\S]*documentOrderConfirmed: true/u);
  assert.doesNotMatch(finalConfirmationSource, /confirmationPassword/u);
  assert.match(changeSource, /fileIds: \[changeCounterpartySignedPdf\.id\][\s\S]*sourceRevision: current\.draftRevision/u);
  assert.match(changeSource, /formalFileId: changeCounterpartySigned\.previewFormalFileId[\s\S]*expectedDraftRevision: current\.draftRevision/u);
});

test("post-approval final files use the non-draft upload route", () => {
  assert.match(
    sealSource,
    /const finalPdf = await uploadPdf\(tokens\[fixture\.applicantRole\],\s*`UAT-\$\{runId\}-\$\{fixture\.config\.type\}-final\.pdf`/u
  );
  assert.doesNotMatch(sealSource, /uploadContractDraftPdf\([\s\S]*-final\.pdf/u);
});

test("global director handler fixture leaves its own final archive pending for the real browser confirmation", () => {
  assert.match(selfArchiveSource, /createContractFixture\(\{ \.\.\.config, id: `\$\{config\.id\}_\$\{browserKey\}` \}, shared, tokens, "contractDirector"\)/u);
  assert.match(selfArchiveSource, /\/formal-files\/final`, tokens\.contractDirector/u);
  assert.doesNotMatch(selfArchiveSource, /formal-files\/final\/confirmation/u);
  assert.match(selfArchiveSource, /await approveContract\(fixture, tokens\);/u);
  assert.doesNotMatch(selfArchiveSource, /roleSequenceForType\(config\.type\)\.slice\(1\)/u);
  assert.match(runnerSource, /"contract_director_handler_self_archive"/u);
});

test("dual-browser self-archive fixtures fail closed on duplicate contract UUIDs", () => {
  assert.match(
    selfArchiveSource,
    /assert\(\s*chromium\.fixture\.contract\.id !== webkit\.fixture\.contract\.id,\s*[^\n]+双浏览器[^\n]+不同/u
  );
  assert.match(
    browserRunnerSource,
    /assert\(resolved\.chromium !== resolved\.webkit, [^\n]+双浏览器[^\n]+不同/u
  );
  assert.match(browserTestSource, /expect\(selfArchiveContractIds\.chromium\)\.not\.toBe\(selfArchiveContractIds\.webkit\)/u);
});

test("real browser acceptance completes the self-archive assertion in both browser projects", () => {
  assert.doesNotMatch(browserTestSource, /test\.skip\(/u);
  assert.match(runnerSource, /browserContractIds/u);
  assert.match(browserRunnerSource, /REAL_BROWSER_SELF_ARCHIVE_CONTRACT_IDS/u);
  assert.match(browserTestSource, /REAL_BROWSER_SELF_ARCHIVE_CONTRACT_IDS/u);
});

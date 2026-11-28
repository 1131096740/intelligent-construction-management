import { syntheticWordSource } from "../contract-template/template-management.test-support";
import { prepareLayoutSourceMapping, readLayoutSourcePositions, mappedLayoutSourceForVersion } from "../contract-template/layout-field-mapping";

it("accepts the synthetic queue fixture's source mapping without a converter", () => {
  const source=syntheticWordSource(true), fileId="10000000-0000-4000-8000-000000000001";
  const positions=readLayoutSourcePositions(source).positions;
  const fields=[["合成工程合同","contract.name"],["合成甲方公司","party.owner.name"],["合成乙方公司","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]] as const;
  const bindings=fields.map(([text,fieldKey])=>{const position=positions.find(value=>value.text.includes(text));expect(position).toBeDefined();const start=position!.text.indexOf(text);return {positionId:position!.positionId,start,end:start+text.length,fieldKey};});
  const mapping=prepareLayoutSourceMapping(source,fileId,1,bindings).mapping;
  const confirmation={sourceFileId:fileId,sourceSha256:mapping.sourceSha256,draftRevision:1,mappingFingerprint:mapping.fingerprint,previewJobId:"synthetic-preview",previewPdfFileId:"synthetic-pdf"};
  const mapped=mappedLayoutSourceForVersion(source,{docxFileId:fileId,draftRevision:1,placeholderSchema:{sourceMapping:{...mapping,confirmation}}});
  expect(mapped).toBeInstanceOf(Buffer);
});

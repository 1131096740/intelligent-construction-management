import {describe,expect,it} from "vitest";
import {restoreLaborSignaturePosition} from "./contract-labor-signature-recovery";
describe("labor signature recovery",()=>{
 const plan={protocolVersion:1 as const,layoutTemplateVersionId:"layout",sourceSha256:"a".repeat(64),edits:[{positionId:"table",text:"需先复制"},{positionId:"other",text:"保留"}],deletedPositionIds:["top"],paragraphOrder:["other"],additions:[{id:"x",afterPositionId:"other",text:"保留新增"}]};
 const recovery={entries:[{id:"table",text:"需先复制",kind:"edit" as const},{id:"top",text:"原标签",kind:"deletion" as const}],groups:[["top","other"]]};
 it("restores only one table edit after its visible text is verified",()=>{
  const result=restoreLaborSignaturePosition(plan,recovery,"table");expect(result).toEqual({...plan,edits:[plan.edits[1]]});expect(plan.edits).toHaveLength(2);
 });
 it("restores a deleted top-level position while retaining unrelated ordering and additions",()=>{
  const result=restoreLaborSignaturePosition(plan,recovery,"top");expect(result).toMatchObject({paragraphOrder:["top","other"],deletedPositionIds:[],edits:plan.edits,additions:plan.additions});
 });
 it("refuses stale or unknown visible content",()=>{
  expect(restoreLaborSignaturePosition({...plan,edits:[{positionId:"table",text:"更新"}]},recovery,"table")).toBeNull();
  expect(restoreLaborSignaturePosition(plan,recovery,"unknown")).toBeNull();
 });
});

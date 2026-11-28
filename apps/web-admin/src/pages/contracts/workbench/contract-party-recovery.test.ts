import { describe,expect,it } from "vitest";
import { restorePartyRoles } from "./contract-party-recovery";

describe("restorePartyRoles",()=>{
  it("restores only the selected role and retains other edits and their ordering",()=>{
    const plan={protocolVersion:1 as const,layoutTemplateVersionId:"layout",sourceSha256:"a".repeat(64),edits:[{positionId:"other",text:"keep"}],deletedPositionIds:["role","removed"],paragraphOrder:["other","after"],additions:[{id:"x",afterPositionId:"other",text:"keep addition"}]};
    const result=restorePartyRoles(plan,{roleIds:["role"],groups:[["role","other","removed"],["after"]]});
    expect(result).toEqual({...plan,edits:[{positionId:"other",text:"keep"}],deletedPositionIds:["removed"],paragraphOrder:["role","other","after"]});
    expect(plan.deletedPositionIds).toEqual(["role","removed"]);
  });
  it("rejects inconsistent recovery metadata without changing the plan",()=>{
    const plan={protocolVersion:1 as const,layoutTemplateVersionId:"layout",sourceSha256:"a".repeat(64),edits:[],deletedPositionIds:["role"],paragraphOrder:["unknown"]};
    expect(restorePartyRoles(plan,{roleIds:["role"],groups:[["role","other"]]})).toBeNull();
  });
});

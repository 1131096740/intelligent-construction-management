import { assertValidUnifiedSocialCreditCode } from "../company-entity/unified-social-credit-code";
import { syntheticCreditCode } from "./task16-shared-standard-fixture";

it("generates distinct check-valid fixture codes marked with a non-registration prefix",()=>{
 const first=syntheticCreditCode("a1b2c3d4e5f6",0),second=syntheticCreditCode("a1b2c3d4e5f6",1);
 expect(first.startsWith("00")).toBe(true);expect(second.startsWith("00")).toBe(true);
 expect(assertValidUnifiedSocialCreditCode(first)).toBe(first);expect(assertValidUnifiedSocialCreditCode(second)).toBe(second);
 expect(first).not.toBe(second);
 expect(()=>syntheticCreditCode("invalid",0)).toThrow();expect(()=>syntheticCreditCode("a1b2c3d4e5f6",2 as 0)).toThrow();
});

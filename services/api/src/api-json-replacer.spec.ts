import { apiJsonReplacer } from "./api-json-replacer";

describe("apiJsonReplacer", () => {
  it("serializes BigInt values as decimal strings", () => {
    expect(JSON.stringify({ cents: 123n }, apiJsonReplacer)).toBe('{"cents":"123"}');
  });
});

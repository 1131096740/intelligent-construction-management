import {
  normalizeSupplierName,
  supplierKey
} from "./spot-procurement-supplier";

describe("spot procurement supplier identity", () => {
  it("always uses a trimmed party id when one is present", () => {
    expect(
      supplierKey({
        supplierPartyId: " party-1 ",
        supplierName: " 甲方 "
      })
    ).toBe("party:party-1");
    expect(
      supplierKey({
        supplierPartyId: "party-1",
        supplierName: "   "
      })
    ).toBe("party:party-1");
  });

  it("normalizes only leading, trailing and repeated Unicode whitespace", () => {
    expect(normalizeSupplierName(" \u00a0北京\u3000\u3000某某商贸\u00a0 ")).toBe(
      "北京 某某商贸"
    );
    expect(normalizeSupplierName("\u0085\uFEFF北京\u0085\u0085某某商贸\uFEFF")).toBe(
      "北京 某某商贸"
    );
    expect(
      supplierKey({
        supplierPartyId: null,
        supplierName: " \u00a0北京\u3000\u3000某某商贸\u00a0 "
      })
    ).toBe("name:北京 某某商贸");
  });

  it("rejects a blank free supplier name", () => {
    expect(() =>
      supplierKey({
        supplierPartyId: null,
        supplierName: "\u00a0\u3000\u0085\uFEFF \t\n"
      })
    ).toThrow("供应商名称不能为空");
  });

  it("uses full Unicode trimming for party ids without collapsing internal whitespace", () => {
    expect(
      supplierKey({
        supplierPartyId: "\u0085\uFEFFparty-1\u0085",
        supplierName: "备用供应商"
      })
    ).toBe("party:party-1");
    expect(
      supplierKey({
        supplierPartyId: "\u0085party\u0085one\uFEFF",
        supplierName: "备用供应商"
      })
    ).toBe("party:party\u0085one");
  });

  it("does not perform case, punctuation, simplified-traditional or fuzzy merging", () => {
    expect(supplierKey({ supplierName: "ABC商贸" })).toBe("name:ABC商贸");
    expect(supplierKey({ supplierName: "abc商贸" })).toBe("name:abc商贸");
    expect(supplierKey({ supplierName: "北京-某某商贸" })).toBe(
      "name:北京-某某商贸"
    );
    expect(supplierKey({ supplierName: "北京某某商貿" })).toBe(
      "name:北京某某商貿"
    );
  });
});

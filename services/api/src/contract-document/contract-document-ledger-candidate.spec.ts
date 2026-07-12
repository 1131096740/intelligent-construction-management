import { contractDocumentCandidateMatchesLedger } from "./contract-document-ledger-candidate";

describe("contractDocumentCandidateMatchesLedger", () => {
  const ledger = {
    amountCents: 12_300n,
    draftData: { fieldValues: { signingDate: "2026-07-12" } },
    templateSnapshot: {
      fieldSchema: [{ key: "signingDate", label: "签订日期" }]
    },
    clauseSnapshot: [
      { key: "payment", title: "付款条款", content: { text: "付款条款：按月结算" } }
    ]
  };

  it.each([
    [{ kind: "amount", label: "合同金额", cents: "12300" }],
    [{ kind: "date", fieldKey: "signingDate", label: "签订日期", isoDate: "2026-07-12" }],
    [
      {
        kind: "key_clause",
        clauseKey: "payment",
        title: "付款条款",
        proposedText: "付款条款：按月结算",
        baseTextSha256: "hash"
      }
    ]
  ])("accepts an exactly equal $kind candidate", (candidate) => {
    expect(contractDocumentCandidateMatchesLedger(candidate, ledger)).toBe(true);
  });

  it.each([
    [{ kind: "amount", label: "合同金额", cents: "12301" }],
    [{ kind: "date", fieldKey: "signingDate", label: "签订日期", isoDate: "2026-07-13" }],
    [
      {
        kind: "key_clause",
        clauseKey: "payment",
        title: "付款条款",
        proposedText: "付款条款：按季结算",
        baseTextSha256: "hash"
      }
    ]
  ])("rejects a non-equal $kind candidate", (candidate) => {
    expect(contractDocumentCandidateMatchesLedger(candidate, ledger)).toBe(false);
  });

  it("does not stringify arbitrary clause content objects into an apparent match", () => {
    expect(
      contractDocumentCandidateMatchesLedger(
        {
          kind: "key_clause",
          clauseKey: "payment",
          title: "付款条款",
          proposedText: "付款条款 按月结算",
          baseTextSha256: "hash"
        },
        {
          ...ledger,
          clauseSnapshot: [
            { key: "payment", content: { title: "付款条款", body: "按月结算" } }
          ]
        }
      )
    ).toBe(false);
  });

  it("fails closed when the ledger contains duplicate field labels or clause titles", () => {
    expect(
      contractDocumentCandidateMatchesLedger(
        {
          kind: "date",
          fieldKey: "signingDate",
          label: "签订日期",
          isoDate: "2026-07-12"
        },
        {
          ...ledger,
          templateSnapshot: {
            fieldSchema: [
              { key: "signingDate", label: "签订日期" },
              { key: "effectiveDate", label: "签订日期" }
            ]
          }
        }
      )
    ).toBe(false);

    expect(
      contractDocumentCandidateMatchesLedger(
        {
          kind: "key_clause",
          clauseKey: "payment",
          title: "付款条款",
          proposedText: "付款条款：按月结算",
          baseTextSha256: "hash"
        },
        {
          ...ledger,
          clauseSnapshot: [
            ...ledger.clauseSnapshot,
            { key: "payment-copy", title: "付款条款", content: "其他内容" }
          ]
        }
      )
    ).toBe(false);
  });
});

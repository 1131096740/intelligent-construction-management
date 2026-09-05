import {
  POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS,
  canonicalizePol219Set,
  canonicalPol219CreditorStableKey,
  computePol219AssignedWageExclusionSet,
  computePol219HistoricalWageAuthorityFingerprint,
  computePol219HistoricalWageBalanceReconciliationFingerprint,
  computePol219HistoricalWageSourceVersionFingerprint,
  computePol219VerifiedPaymentExecutionSet,
  normalizePol219Hash,
  normalizePol219EvidenceCoordinate,
  normalizePol219Instant,
  normalizePol219NonNegativeInteger,
  normalizePol219SignedInteger,
  normalizePol219Text,
  normalizePol219Uuid,
  pol219DomainFingerprint,
  strictJcs
} from "./historical-wage-takeover-fingerprint";

describe("POL219 historical wage R2 canonical fingerprints", () => {
  const coordinate = {
    sourceObjectSha256: "1".repeat(64),
    worksheetName: " 工资\r\n表 ",
    rowNumber: "12",
    columnNumber: null,
    normalizedRowSha256: "2".repeat(64)
  };
  const evidence = {
    fileObjectId: "file-1",
    contentSha256: "3".repeat(64),
    evidenceCoordinate: coordinate
  };
  const source = {
    schemaVersion: 1 as const,
    sourceDiscriminator: "historical_wage_summary" as const,
    sourceObjectId: "legacy-wage-1",
    sourceObjectCoordinate: coordinate,
    originalSourceVersion: "V-01",
    originalBusinessNumber: " WAGE-01 ",
    asOfDate: "2026-08-31",
    basisDate: null,
    sourceHeader: {
      employmentCompanyId: "company-1",
      employmentCompanyNameSnapshot: "甲公司",
      employmentCompanyCreditCodeSnapshot: "913100000000000001",
      projectId: "project-1",
      projectCodeSnapshot: "P-1",
      projectNameSnapshot: "项目一",
      wageMonth: "2026-08",
      catalogVersion: "historical_wage_position_category_v1",
      positionCategoryCode: "engineering_technical",
      positionCategoryLabelSnapshot: "工程技术人员"
    },
    creditorSourceFacts: [{
      categoryCode: "employee_net_pay",
      categoryLabelSnapshot: "员工实发工资",
      creditorIdentityKind: "aggregate_creditor_scope",
      creditorPartyVersionId: null,
      controlledScopeCode: "employees",
      controlledScopeDescription: " 现场人员\r\n工资 ",
      controlledScopeEvidenceCoordinate: coordinate,
      grossDebtCents: "1000",
      historicallySettledCents: "0",
      outstandingBalanceCents: "1000",
      debtStatus: "outstanding"
    }],
    originalControlledScopeDescription: null,
    evidence: [evidence],
    sourceEvidenceReviewerSnapshot: {
      externalIdentityId: "external-reviewer-1",
      evidence: [evidence]
    }
  };
  const balance = {
    schemaVersion: 1 as const,
    reservedTargetId: "550e8400-e29b-41d4-a716-446655440001",
    reconciliationAuthorityVersionId: "reconciliation-authority-v1",
    reconciliationReference: " REC-01 ",
    sourceVersionFingerprint: "4".repeat(64),
    employmentCompanyId: "company-1",
    employmentCompanyNameSnapshot: "甲公司",
    employmentCompanyCreditCodeSnapshot: "913100000000000001",
    projectId: "project-1",
    projectCodeSnapshot: "P-1",
    projectNameSnapshot: "项目一",
    wageMonth: "2026-08",
    catalogVersion: "historical_wage_position_category_v1",
    positionCategoryCode: "engineering_technical",
    positionCategoryLabelSnapshot: "工程技术人员",
    categoryCode: "employee_net_pay",
    categoryLabelSnapshot: "员工实发工资",
    creditorIdentityKind: "aggregate_creditor_scope",
    creditorPartyVersionId: null,
    controlledScopeCode: "employees",
    controlledScopeDescription: " 现场人员\r\n工资 ",
    targetKind: "historical_wage_balance_reconciliation_version" as const,
    targetBusinessKey: "reconciliation-authority-v1",
    currencyCode: "CNY" as const,
    debtStatus: "outstanding" as const,
    grossDebtCents: "1000",
    historicallySettledCents: "0",
    outstandingBalanceCents: "1000",
    asOfDate: "2026-08-31",
    evidence: [evidence],
    supportingPaymentExecutions: []
  };
  const payment = {
    paymentExecutionId: "payment-execution-b",
    paymentExecutionFingerprint: "5".repeat(64),
    paymentRequestId: "request-b",
    paymentRequestSourceType: "legacy_wage",
    paymentRequestProjectId: "project-1",
    paymentRequestFingerprint: "6".repeat(64),
    paymentSubjectType: "business_party",
    payerCompanyId: "company-1",
    payerCompanyNameSnapshot: "甲公司",
    payerCompanyCreditCodeSnapshot: "913100000000000001",
    amountCents: "1000",
    paidAt: "2026-08-20T08:00:00.000Z",
    voucherFileId: "voucher-1",
    voucherContentSha256: "7".repeat(64),
    payerAttestationId: "payer-attestation-1",
    payerVerificationId: "payer-verification-1",
    bankAccountReference: "bank-account-1",
    legalAccountHolderCompanyId: "company-1",
    legalAccountHolderNameSnapshot: "甲公司",
    legalAccountHolderCreditCodeSnapshot: "913100000000000001",
    verificationEvidenceFileId: "verification-1",
    verificationEvidenceContentSha256: "8".repeat(64),
    bankTransactionClaimId: "claim-1",
    bankObservationId: "observation-1",
    transactionSourceType: "bank_statement",
    transactionSourceId: "bank-source-1",
    transactionSourceIdentity: "transaction-1",
    transactionAmountCents: "1000",
    currencyCode: "CNY" as const,
    direction: "outflow",
    occurredAt: "2026-08-20T07:59:59.000Z",
    transactionEvidenceFileId: "transaction-file-1",
    transactionEvidenceContentSha256: "9".repeat(64),
    observationPayloadFingerprint: "a".repeat(64),
    creditorScopeEvidenceCoordinate: coordinate
  };

  it("uses RFC8785 JCS and domain-separated lowercase SHA-256 golden values", () => {
    const payload = {
      string: "€$\u000f\nA'B\"\\\\\"/",
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
      literals: [null, true, false]
    };

    expect(strictJcs(payload)).toBe(
      "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}"
    );
    expect(pol219DomainFingerprint(
      POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.sourceVersion,
      { schemaVersion: 1, sourceDiscriminator: "historical_wage_summary" }
    )).toBe("9ecac7a410d2c138f194afa7b7f1e780911f07188292d578a79755fd4a91e695");
    expect(pol219DomainFingerprint(
      POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.authority,
      { schemaVersion: 1, sourceDiscriminator: "historical_wage_summary" }
    )).toBe("dd13d573771b85fb1953d7051094588bea43173e3d04e7436b1cd9e4fbe78ca8");
  });

  it("normalizes protocol values without trimming business text", () => {
    expect(normalizePol219Text("  工资\r\n范围\r  ")).toBe("  工资\n范围\n  ");
    expect(normalizePol219Text("e\u0301")).toBe("é");
    expect(normalizePol219Uuid("550E8400-E29B-41D4-A716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(normalizePol219Hash("A".repeat(64))).toBe("a".repeat(64));
    expect(normalizePol219NonNegativeInteger(0n)).toBe("0");
    expect(normalizePol219NonNegativeInteger("9007199254740993")).toBe("9007199254740993");
    expect(normalizePol219SignedInteger(-42n)).toBe("-42");
    expect(normalizePol219Instant("2026-09-04T01:02:03.004Z")).toBe("2026-09-04T01:02:03.004Z");
  });

  it.each([
    ["lone high surrogate", () => strictJcs({ value: "\ud800" })],
    ["lone low surrogate", () => normalizePol219Text("\udc00")],
    ["undefined", () => strictJcs({ value: undefined })],
    ["array hole", () => strictJcs(Array(1))],
    ["non-finite number", () => strictJcs({ value: Number.POSITIVE_INFINITY })],
    ["negative zero", () => strictJcs({ value: -0 })],
    ["toJSON object", () => strictJcs({ toJSON: () => ({}) })],
    ["non-plain object", () => strictJcs(new Date("2026-09-04T01:02:03.004Z"))],
    ["invalid UUID", () => normalizePol219Uuid("not-a-uuid")],
    ["invalid hash", () => normalizePol219Hash("A".repeat(63))],
    ["leading zero unsigned", () => normalizePol219NonNegativeInteger("01")],
    ["negative unsigned", () => normalizePol219NonNegativeInteger("-1")],
    ["negative zero signed", () => normalizePol219SignedInteger("-0")],
    ["non-canonical instant", () => normalizePol219Instant("2026-09-04T01:02:03Z")]
  ])("rejects %s", (_label, action) => {
    expect(action).toThrow();
  });

  it("sorts sets by element JCS UTF-8 bytes and rejects exact or stable-key duplicates", () => {
    expect(canonicalizePol219Set(
      [{ id: "b", value: 2 }, { id: "a", value: 1 }],
      (item) => item.id
    )).toEqual([{ id: "a", value: 1 }, { id: "b", value: 2 }]);

    expect(() => canonicalizePol219Set(
      [{ id: "a", value: 1 }, { value: 1, id: "a" }],
      (item) => item.id
    )).toThrow("重复");
    expect(() => canonicalizePol219Set(
      [{ id: "a", value: 1 }, { id: "a", value: 2 }],
      (item) => item.id
    )).toThrow("稳定键");
    expect(canonicalizePol219Set(
      [{ id: "\u{10000}" }, { id: "\ue000" }],
      (item) => item.id
    ).map((item) => item.id)).toEqual(["\ue000", "\u{10000}"]);
  });

  it("builds the five R2 DAG fingerprints from strict closed payloads", () => {
    const sourceResult = computePol219HistoricalWageSourceVersionFingerprint(source);
    const reconciliationResult = computePol219HistoricalWageBalanceReconciliationFingerprint({
      ...balance,
      sourceVersionFingerprint: sourceResult.fingerprint
    });
    const exclusionResult = computePol219AssignedWageExclusionSet([{
      authorityVersionId: "assigned-authority-1",
      lineId: "assigned-line-1",
      lineFingerprint: "b".repeat(64),
      fileObjectId: "exclusion-file-1",
      contentSha256: "c".repeat(64),
      evidenceCoordinate: coordinate
    }]);
    const paymentResult = computePol219VerifiedPaymentExecutionSet([payment]);
    const stableBucketKey = canonicalPol219CreditorStableKey({
      categoryCode: "employee_net_pay",
      creditorIdentityKind: "aggregate_creditor_scope",
      creditorPartyVersionId: null,
      controlledScopeCode: "employees",
      controlledScopeDescription: sourceResult.payload.creditorSourceFacts[0]?.controlledScopeDescription ?? null,
      targetKind: "historical_wage_balance_reconciliation_version",
      targetBusinessKey: "reconciliation-authority-v1"
    });
    const authorityInput = {
      schemaVersion: 1,
      authorityVersionId: "550e8400-e29b-41d4-a716-446655440002",
      atomicScopeVersionId: "550e8400-e29b-41d4-a716-446655440003",
      sourceVersionFingerprint: sourceResult.fingerprint,
      summaryBucketKey: "company-1:project-1:2026-08:engineering_technical",
      authorityHeader: sourceResult.payload.sourceHeader,
      revision: 1,
      supersedesVersionId: null,
      lineageRootAuthorityVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      rootClosureFingerprint: "e".repeat(64),
      creditorLines: [{
        authorityCreditorLineId: "550e8400-e29b-41d4-a716-446655440004",
        stableBucketKey,
        ...sourceResult.payload.creditorSourceFacts[0],
        targetKind: balance.targetKind,
        targetBusinessKey: balance.targetBusinessKey,
        targetPayload: reconciliationResult.payload,
        targetFingerprint: reconciliationResult.fingerprint,
        signedGrossDeltaCents: "1000",
        signedHistoricallySettledDeltaCents: "0",
        signedOutstandingBalanceDeltaCents: "1000",
        deltaFingerprint: "f".repeat(64),
        rootCreditorLineId: null,
        rootPayableRefId: null
      }],
      legacySources: [{
        factId: "legacy-fact-1",
        factFingerprint: "1".repeat(64),
        costImpactId: "legacy-cost-1",
        costImpactFingerprint: "2".repeat(64),
        payableImpactId: "legacy-payable-1",
        payableImpactFingerprint: "3".repeat(64)
      }],
      assignedWageExclusions: exclusionResult.payload.assignedWageExclusions,
      assignedWageExclusionSetFingerprint: exclusionResult.fingerprint,
      verifiedPaymentExecutionSets: [],
      conflictReadSet: {
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        projectIds: ["project-1"],
        contracts: [{
          id: "affiliate-contract-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          companyEntityVersionId: "company-version-1",
          requestFingerprint: "8".repeat(64),
          fileContentSha256Snapshot: "9".repeat(64)
        }],
        authorities: [{
          id: "assigned-authority-1",
          affiliateCompanyContractId: "affiliate-contract-1",
          authorityFingerprint: "a".repeat(64)
        }],
        lines: [{
          id: "assigned-line-1",
          authorityVersionId: "assigned-authority-1",
          projectId: "project-1",
          coverageKind: "PERSON",
          personAuthorityKey: "employee-1",
          lineFingerprint: "b".repeat(64)
        }]
      },
      scopeCreatorIdentity: {
        actualUserId: "finance-1",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-1"]
      },
      permissionScopeFingerprint: "0".repeat(64)
    };
    const authorityResult = computePol219HistoricalWageAuthorityFingerprint(authorityInput);

    expect(() => computePol219HistoricalWageSourceVersionFingerprint({
      ...source,
      creditorSourceFacts: []
    })).toThrow("creditorSourceFacts");
    expect(() => computePol219VerifiedPaymentExecutionSet([])).toThrow("paymentExecutions");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      legacySources: []
    })).toThrow("legacySources");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      summaryBucketKey: "project-1:company-1:2026-08:engineering_technical"
    })).toThrow("summaryBucketKey");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [{
        ...authorityInput.creditorLines[0]!,
        signedGrossDeltaCents: "1000",
        signedHistoricallySettledDeltaCents: "100",
        signedOutstandingBalanceDeltaCents: "800"
      }]
    })).toThrow("signed delta");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      scopeCreatorIdentity: {
        ...authorityInput.scopeCreatorIdentity,
        actorIds: ["finance-1", "intruder-1"]
      }
    })).toThrow("actorIds");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      scopeCreatorIdentity: {
        ...authorityInput.scopeCreatorIdentity,
        delegatorUserId: "finance-director-1",
        delegatorRoles: null,
        actorIds: ["finance-1", "finance-director-1"]
      }
    })).toThrow("delegator");

    const normalizedCoordinate = { ...coordinate, worksheetName: " 工资\n表 " };
    const normalizedEvidence = { ...evidence, evidenceCoordinate: normalizedCoordinate };
    expect(sourceResult.payload).toStrictEqual({
      ...source,
      sourceObjectCoordinate: normalizedCoordinate,
      creditorSourceFacts: [{
        ...source.creditorSourceFacts[0],
        controlledScopeDescription: " 现场人员\n工资 ",
        controlledScopeEvidenceCoordinate: normalizedCoordinate
      }],
      evidence: [normalizedEvidence],
      sourceEvidenceReviewerSnapshot: {
        externalIdentityId: "external-reviewer-1",
        evidence: [normalizedEvidence]
      }
    });
    expect(reconciliationResult.payload).toStrictEqual({
      ...balance,
      sourceVersionFingerprint: sourceResult.fingerprint,
      controlledScopeDescription: " 现场人员\n工资 ",
      evidence: [normalizedEvidence]
    });
    expect(exclusionResult.payload).toStrictEqual({
      schemaVersion: 1,
      assignedWageExclusions: [{
        authorityVersionId: "assigned-authority-1",
        lineId: "assigned-line-1",
        lineFingerprint: "b".repeat(64),
        fileObjectId: "exclusion-file-1",
        contentSha256: "c".repeat(64),
        evidenceCoordinate: normalizedCoordinate
      }]
    });
    expect(paymentResult.payload).toStrictEqual({
      schemaVersion: 1,
      paymentExecutionIds: ["payment-execution-b"],
      paymentExecutions: [{ ...payment, creditorScopeEvidenceCoordinate: normalizedCoordinate }]
    });
    expect(authorityResult.payload).toStrictEqual({
      schemaVersion: 1,
      authorityVersionId: "550e8400-e29b-41d4-a716-446655440002",
      atomicScopeVersionId: "550e8400-e29b-41d4-a716-446655440003",
      sourceVersionFingerprint: sourceResult.fingerprint,
      summaryBucketKey: "company-1:project-1:2026-08:engineering_technical",
      authorityHeader: sourceResult.payload.sourceHeader,
      revision: 1,
      supersedesVersionId: null,
      lineageRootAuthorityVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      rootClosureFingerprint: "e".repeat(64),
      creditorLines: [{
        authorityCreditorLineId: "550e8400-e29b-41d4-a716-446655440004",
        stableBucketKey,
        ...sourceResult.payload.creditorSourceFacts[0],
        targetKind: balance.targetKind,
        targetBusinessKey: balance.targetBusinessKey,
        targetPayload: reconciliationResult.payload,
        targetFingerprint: reconciliationResult.fingerprint,
        signedGrossDeltaCents: "1000",
        signedHistoricallySettledDeltaCents: "0",
        signedOutstandingBalanceDeltaCents: "1000",
        deltaFingerprint: "f".repeat(64),
        rootCreditorLineId: null,
        rootPayableRefId: null
      }],
      legacySources: [{
        factId: "legacy-fact-1",
        factFingerprint: "1".repeat(64),
        costImpactId: "legacy-cost-1",
        costImpactFingerprint: "2".repeat(64),
        payableImpactId: "legacy-payable-1",
        payableImpactFingerprint: "3".repeat(64)
      }],
      assignedWageExclusions: exclusionResult.payload.assignedWageExclusions,
      assignedWageExclusionSetFingerprint: exclusionResult.fingerprint,
      verifiedPaymentExecutionSets: [],
      conflictReadSet: {
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        projectIds: ["project-1"],
        contracts: [{
          id: "affiliate-contract-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          companyEntityVersionId: "company-version-1",
          requestFingerprint: "8".repeat(64),
          fileContentSha256Snapshot: "9".repeat(64)
        }],
        authorities: [{
          id: "assigned-authority-1",
          affiliateCompanyContractId: "affiliate-contract-1",
          authorityFingerprint: "a".repeat(64)
        }],
        lines: [{
          id: "assigned-line-1",
          authorityVersionId: "assigned-authority-1",
          projectId: "project-1",
          coverageKind: "PERSON",
          personAuthorityKey: "employee-1",
          lineFingerprint: "b".repeat(64)
        }]
      },
      scopeCreatorIdentity: {
        actualUserId: "finance-1",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-1"]
      },
      permissionScopeFingerprint: "0".repeat(64)
    });

    const fixed = [
      [POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.sourceVersion, sourceResult.payload, sourceResult.fingerprint, "53ccdfc1d27fe9ae6b7b4f738ec869cbbfca089e313d0b77fe7e1f5de5f13ad4"],
      [POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.balanceReconciliation, reconciliationResult.payload, reconciliationResult.fingerprint, "14ef96851182bbd6efdce1956aba24b94745a705d3ffebe7565f5fc8d10ece95"],
      [POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.assignedWageExclusionSet, exclusionResult.payload, exclusionResult.fingerprint, "545a9140d67491965b951776346c290b68f92c37cdd2080f8b003522ef69282f"],
      [POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.verifiedPaymentExecutionSet, paymentResult.payload, paymentResult.fingerprint, "159d19f40d83f591621001ef184a76985875d89d4baa1eb93af5f7cf688e04c6"],
      [POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.authority, authorityResult.payload, authorityResult.fingerprint, "a2a8bac84b50daace0c4ba91f23bbdfa0f9aa3d52b73d8e658ef1fdf4a93f1b2"]
    ] as const;
    for (const [domain, payload, implementationDigest, fixedDigest] of fixed) {
      expect(referenceDomainHash(domain, payload)).toBe(fixedDigest);
      expect(implementationDigest).toBe(fixedDigest);
    }

    const poisonedTargetPayload = { ...reconciliationResult.payload, unknownField: true };
    const poisonedTargetFingerprint = pol219DomainFingerprint(
      POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.balanceReconciliation,
      poisonedTargetPayload
    );
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [{
        ...authorityInput.creditorLines[0]!,
        targetPayload: poisonedTargetPayload,
        targetFingerprint: poisonedTargetFingerprint
      }]
    })).toThrow("未知字段");

    const wrongSourceTarget = computePol219HistoricalWageBalanceReconciliationFingerprint({
      ...balance,
      sourceVersionFingerprint: "9".repeat(64)
    });
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [{
        ...authorityInput.creditorLines[0]!,
        targetPayload: wrongSourceTarget.payload,
        targetFingerprint: wrongSourceTarget.fingerprint
      }]
    })).toThrow("sourceVersionFingerprint");

    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      verifiedPaymentExecutionSets: [{
        paymentExecutionSetFingerprint: paymentResult.fingerprint,
        payload: paymentResult.payload
      }]
    })).toThrow("付款集合");

    expect(() => computePol219HistoricalWageSourceVersionFingerprint({
      ...source,
      sourceDeclarerSnapshot: { identityId: "post-takeover-actor" }
    })).toThrow("未知字段");
    expect(() => computePol219HistoricalWageSourceVersionFingerprint({
      ...source,
      sourceEvidenceReviewerSnapshot: {
        externalIdentityId: "external-reviewer-1",
        evidence: [{ ...evidence, fileObjectId: "not-a-source-evidence" }]
      }
    })).toThrow("不属于 source evidence");

    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      conflictReadSet: { ...authorityInput.conflictReadSet, activatedAt: "2026-09-04T00:00:00.000Z" }
    })).toThrow("未知字段");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      conflictReadSet: {
        wageMonth: "2026-08",
        projectIds: ["project-1", "project-1"],
        authorities: [],
        lines: []
      }
    })).toThrow();
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      conflictReadSet: {
        ...authorityInput.conflictReadSet,
        wageMonth: "2026-07"
      }
    })).toThrow("wageMonth");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      conflictReadSet: {
        ...authorityInput.conflictReadSet,
        projectIds: ["project-1", "project-2"]
      }
    })).toThrow("projectIds");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      conflictReadSet: {
        ...authorityInput.conflictReadSet,
        lines: []
      }
    })).toThrow();

    for (const [label, change] of [
      ["reconciliationAuthorityVersionId", { reconciliationAuthorityVersionId: "other-authority" }],
      ["employmentCompanyId", { employmentCompanyId: "company-2" }],
      ["projectId", { projectId: "project-2" }],
      ["wageMonth", { wageMonth: "2026-07" }],
      ["categoryCode", { categoryCode: "employee_social_insurance" }],
      ["grossDebtCents", { grossDebtCents: "999", outstandingBalanceCents: "999" }]
    ] as const) {
      void label;
      const mismatched = computePol219HistoricalWageBalanceReconciliationFingerprint({
        ...reconciliationResult.payload,
        ...change
      });
      expect(() => computePol219HistoricalWageAuthorityFingerprint({
        ...authorityInput,
        creditorLines: [{
          ...authorityInput.creditorLines[0]!,
          targetPayload: mismatched.payload,
          targetFingerprint: mismatched.fingerprint
        }]
      })).toThrow();
    }

    const settledPaymentLine = {
      ...authorityInput.creditorLines[0]!,
      stableBucketKey: canonicalPol219CreditorStableKey({
        categoryCode: "employee_net_pay",
        creditorIdentityKind: "aggregate_creditor_scope",
        creditorPartyVersionId: null,
        controlledScopeCode: "employees",
        controlledScopeDescription: sourceResult.payload.creditorSourceFacts[0]?.controlledScopeDescription ?? null,
        targetKind: "existing_verified_payment_execution_set",
        targetBusinessKey: paymentResult.fingerprint
      }),
      grossDebtCents: "1000",
      historicallySettledCents: "1000",
      outstandingBalanceCents: "0",
      debtStatus: "settled",
      targetKind: "existing_verified_payment_execution_set",
      targetBusinessKey: paymentResult.fingerprint,
      targetPayload: paymentResult.payload,
      targetFingerprint: paymentResult.fingerprint,
      signedGrossDeltaCents: "1000",
      signedHistoricallySettledDeltaCents: "1000",
      signedOutstandingBalanceDeltaCents: "0"
    };
    expect(computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [settledPaymentLine],
      verifiedPaymentExecutionSets: [{
        paymentExecutionSetFingerprint: paymentResult.fingerprint,
        payload: paymentResult.payload
      }]
    }).payload.creditorLines).toHaveLength(1);

    for (const [label, paymentChange] of [
      ["payment project", { paymentRequestProjectId: "project-2" }],
      ["payer company", { payerCompanyId: "company-2" }],
      ["creditor scope evidence", {
        creditorScopeEvidenceCoordinate: { ...coordinate, rowNumber: "99" }
      }]
    ] as const) {
      void label;
      const mismatchedSet = computePol219VerifiedPaymentExecutionSet([{ ...payment, ...paymentChange }]);
      const mismatchedLine = {
        ...settledPaymentLine,
        stableBucketKey: canonicalPol219CreditorStableKey({
          categoryCode: "employee_net_pay",
          creditorIdentityKind: "aggregate_creditor_scope",
          creditorPartyVersionId: null,
          controlledScopeCode: "employees",
          controlledScopeDescription: sourceResult.payload.creditorSourceFacts[0]?.controlledScopeDescription ?? null,
          targetKind: "existing_verified_payment_execution_set",
          targetBusinessKey: mismatchedSet.fingerprint
        }),
        targetBusinessKey: mismatchedSet.fingerprint,
        targetPayload: mismatchedSet.payload,
        targetFingerprint: mismatchedSet.fingerprint
      };
      expect(() => computePol219HistoricalWageAuthorityFingerprint({
        ...authorityInput,
        creditorLines: [mismatchedLine],
        verifiedPaymentExecutionSets: [{
          paymentExecutionSetFingerprint: mismatchedSet.fingerprint,
          payload: mismatchedSet.payload
        }]
      })).toThrow();
    }

    const shortPaymentSet = computePol219VerifiedPaymentExecutionSet([{ ...payment, amountCents: "999", transactionAmountCents: "999" }]);
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [{
        ...settledPaymentLine,
        stableBucketKey: canonicalPol219CreditorStableKey({
          categoryCode: "employee_net_pay",
          creditorIdentityKind: "aggregate_creditor_scope",
          creditorPartyVersionId: null,
          controlledScopeCode: "employees",
          controlledScopeDescription: sourceResult.payload.creditorSourceFacts[0]?.controlledScopeDescription ?? null,
          targetKind: "existing_verified_payment_execution_set",
          targetBusinessKey: shortPaymentSet.fingerprint
        }),
        targetBusinessKey: shortPaymentSet.fingerprint,
        targetPayload: shortPaymentSet.payload,
        targetFingerprint: shortPaymentSet.fingerprint
      }],
      verifiedPaymentExecutionSets: [{
        paymentExecutionSetFingerprint: shortPaymentSet.fingerprint,
        payload: shortPaymentSet.payload
      }]
    })).toThrow("金额");
    expect(() => computePol219VerifiedPaymentExecutionSet([{
      ...payment,
      transactionAmountCents: "999"
    }])).toThrow("交易金额");
    expect(() => computePol219HistoricalWageSourceVersionFingerprint({
      ...source,
      schemaVersion: 2
    })).toThrow("schemaVersion");
    expect(() => computePol219HistoricalWageBalanceReconciliationFingerprint({
      ...reconciliationResult.payload,
      asOfDate: "2026-02-30"
    })).toThrow("有效日期");
    expect(() => computePol219HistoricalWageBalanceReconciliationFingerprint({
      ...reconciliationResult.payload,
      grossDebtCents: 1000
    })).toThrow("非负整数");
    expect(() => computePol219HistoricalWageAuthorityFingerprint({
      ...authorityInput,
      creditorLines: [{
        ...authorityInput.creditorLines[0]!,
        signedGrossDeltaCents: -0
      }]
    })).toThrow("有符号整数");

    const secondExclusion = {
      authorityVersionId: "assigned-authority-2",
      lineId: "assigned-line-2",
      lineFingerprint: "d".repeat(64),
      fileObjectId: "exclusion-file-2",
      contentSha256: "e".repeat(64),
      evidenceCoordinate: { ...coordinate, rowNumber: "14" }
    };
    const firstExclusion = exclusionResult.payload.assignedWageExclusions[0]!;
    expect(computePol219AssignedWageExclusionSet([firstExclusion, secondExclusion]).fingerprint)
      .toBe(computePol219AssignedWageExclusionSet([secondExclusion, firstExclusion]).fingerprint);
  });

  it("derives creditor/payment stable identities without category-only collapse", () => {
    const first = canonicalPol219CreditorStableKey({
      categoryCode: "employee_net_pay",
      creditorIdentityKind: "aggregate_creditor_scope",
      creditorPartyVersionId: null,
      controlledScopeCode: "employees-a",
      controlledScopeDescription: null,
      targetKind: "historical_wage_balance_reconciliation_version",
      targetBusinessKey: "balance-a"
    });
    const second = canonicalPol219CreditorStableKey({
      categoryCode: "employee_net_pay",
      creditorIdentityKind: "aggregate_creditor_scope",
      creditorPartyVersionId: null,
      controlledScopeCode: "employees-b",
      controlledScopeDescription: null,
      targetKind: "historical_wage_balance_reconciliation_version",
      targetBusinessKey: "balance-b"
    });
    expect(first).not.toBe(second);

    const earlier = { ...payment, paymentExecutionId: "payment-execution-z", paidAt: "2026-08-19T08:00:00.000Z" };
    const set = computePol219VerifiedPaymentExecutionSet([payment, earlier]);
    expect(set.payload.paymentExecutionIds).toEqual(["payment-execution-z", "payment-execution-b"]);
    expect(set.payload.paymentExecutions.map((item) => item.paymentExecutionId)).toEqual(set.payload.paymentExecutionIds);
    expect(computePol219VerifiedPaymentExecutionSet([earlier, payment]).fingerprint).toBe(set.fingerprint);
    expect(() => computePol219VerifiedPaymentExecutionSet([payment, { ...payment }])).toThrow("重复");
    expect(() => computePol219VerifiedPaymentExecutionSet([
      payment,
      { ...payment, amountCents: "999", transactionAmountCents: "999" }
    ])).toThrow("稳定键");
    const sameTimeUpper = { ...payment, paymentExecutionId: "PAYMENT-EXECUTION-A" };
    const sameTimeLower = { ...payment, paymentExecutionId: "payment-execution-b2" };
    expect(computePol219VerifiedPaymentExecutionSet([sameTimeLower, sameTimeUpper]).payload.paymentExecutionIds)
      .toEqual(["PAYMENT-EXECUTION-A", "payment-execution-b2"]);
  });

  it("requires exact coordinate/source shapes and preserves meaningful source whitespace", () => {
    expect(normalizePol219EvidenceCoordinate(coordinate)).toEqual({ ...coordinate, worksheetName: " 工资\n表 " });
    expect(() => normalizePol219EvidenceCoordinate({ ...coordinate, unexpected: true } as never)).toThrow("未知字段");
    expect(() => computePol219HistoricalWageSourceVersionFingerprint({ ...source, unexpected: true } as never)).toThrow("未知字段");
    const withoutOptional = { ...source } as Record<string, unknown>;
    delete withoutOptional.basisDate;
    expect(() => computePol219HistoricalWageSourceVersionFingerprint(withoutOptional as never)).toThrow("缺少字段");
    const normalized = computePol219HistoricalWageSourceVersionFingerprint(source);
    expect(normalized.payload.originalBusinessNumber).toBe(" WAGE-01 ");
    expect(normalized.payload.creditorSourceFacts[0]?.controlledScopeDescription).toBe(" 现场人员\n工资 ");
  });
});

function referenceDomainHash(domain: string, payload: unknown): string {
  return createHash("sha256").update(`${domain}\n${referenceJcs(payload)}`, "utf8").digest("hex");
}

function referenceJcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(referenceJcs).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${referenceJcs(record[key])}`).join(",")}}`;
}
import { createHash } from "node:crypto";

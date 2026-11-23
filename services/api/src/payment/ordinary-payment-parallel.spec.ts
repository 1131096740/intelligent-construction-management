import { ordinaryPaymentParallelNodes, paymentParallelRoundEvidence } from "./ordinary-payment-parallel";

const approve = (id: string, approvedRoleKey: string, duty?: number) => ({
  id, action: "approve", actorUserId: "test-signer", approvedRoleKey,
  signatureFileIdSnapshot: "test-file", signatureVersionIdSnapshot: "test-version",
  signatureSha256Snapshot: "a".repeat(64), metadata: { approverName: "原审批人", ordinaryPaymentDutyIndex: duty }
});

const nodes = ordinaryPaymentParallelNodes([
  { name: "原综合岗", mode: "any", roleKeys: ["comprehensive_director"], approvedRoleKeys: ["comprehensive_director"],
    legacyPaymentApprovalActionId: "effective" },
  { name: "原财务岗", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"],
    legacyPaymentNoticeRevision: "2026-11-24T01:00:00.000Z" }
]);

it("renders only the effective original signature and the new duty-bound signature", () => {
  const legacy = approve("effective", "comprehensive_director");
  const later = approve("later", "finance_director", 1);
  const logs = [
    approve("superseded", "comprehensive_director"),
    { id: "rewind", action: "reject_previous" },
    legacy,
    { id: "queued", action: "system_notification", metadata: {
      kind: "payment_approval_duty_notification", event: "queued", recipientId: "finance", nodeIndex: 1
    } },
    later
  ];
  expect(paymentParallelRoundEvidence("approved", nodes, logs)).toEqual([legacy, later]);
  expect(() => paymentParallelRoundEvidence("approved", nodes, logs.filter(log => log.id !== "effective"))).toThrow("签批");
  expect(() => paymentParallelRoundEvidence("approved", nodes, [...logs, {
    id: "foreign", action: "system_notification", metadata: { kind: "other_notice" }
  }])).toThrow("通知");
});

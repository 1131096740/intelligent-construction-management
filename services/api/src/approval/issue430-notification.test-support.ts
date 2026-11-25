import type { ApprovalSmsService, SmsOutcome } from "./approval-sms.service";
import type { AuditDutyNoticeStatus } from "./audit-duty-notification-delivery";

export function issue430SmsProbe() {
  let enabled = false;
  let outcome: SmsOutcome["status"] = "failed";
  const sends: string[] = [];
  const send = async (phone: string) => {
    sends.push(phone);
    if (outcome === "unknown") throw new Error("合成供应商超时");
    return { status: outcome, message: "合成供应商回执" };
  };
  const sms = { available: () => enabled, send, sendDutyIntent: send } as unknown as ApprovalSmsService;
  return { sms, sends, setOutcome(value: SmsOutcome["status"]) { outcome = value; }, enable() { enabled = true; }, disable() { enabled = false; } };
}

export async function verifyIssue430CorrectionDelivery(input: {
  scenario: string;
  deliveryKey: string;
  applicant: { id: string; phone: string | null };
  otherActorId: string;
  probe: ReturnType<typeof issue430SmsProbe>;
  sendPending: () => Promise<void>;
  status: (key: string, actorId: string) => Promise<AuditDutyNoticeStatus | null>;
  retry: (key: string, actorId: string, attemptId: string) => Promise<AuditDutyNoticeStatus>;
  queueUnknown: () => Promise<string>;
}) {
  const { probe, applicant, deliveryKey, status, retry, sendPending } = input;
  const before = probe.sends.length;
  probe.setOutcome("failed");
  probe.enable();
  await sendPending();
  expect(probe.sends.slice(before)).toEqual([applicant.phone]);
  const failed = await status(deliveryKey, applicant.id);
  expect(failed).toMatchObject({ status: "failed", canRetry: true });
  expect(await status(deliveryKey, input.otherActorId)).toBeNull();
  await expect(retry(deliveryKey, input.otherActorId, failed!.attemptId)).rejects.toThrow("当前待办或短信记录已变化");
  probe.setOutcome("accepted");
  expect(await retry(deliveryKey, applicant.id, failed!.attemptId)).toMatchObject({ status: "accepted", canRetry: false });
  expect(await retry(deliveryKey, applicant.id, failed!.attemptId)).toMatchObject({ status: "accepted", canRetry: false });
  expect(probe.sends.slice(before)).toEqual([applicant.phone, applicant.phone]);

  probe.disable();
  const unknownDeliveryKey = await input.queueUnknown();
  probe.setOutcome("unknown");
  probe.enable();
  await sendPending();
  await sendPending();
  expect(probe.sends.slice(before)).toEqual([applicant.phone, applicant.phone, applicant.phone]);
  const unknown = await status(unknownDeliveryKey, applicant.id);
  expect(unknown).toMatchObject({ status: "unknown", canRetry: false });
  await expect(retry(unknownDeliveryKey, applicant.id, unknown!.attemptId)).rejects.toThrow("仅确认发送失败的短信可以重试");
  expect(probe.sends).toHaveLength(before + 3);
  probe.disable();
  process.stdout.write(JSON.stringify({ scenario: input.scenario, mockedCorrectionSends: 3, unknownResends: 0, externalSends: 0 }) + "\n");
}

export function isOwnedIssue430NativeDatabase(url: URL) {
  return process.env.RUN_ISSUE430_SMS === "1" &&
    process.env.ISSUE430_NATIVE_PG_DATABASE === url.pathname.slice(1) &&
    /^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname) &&
    url.username === "jg_task01_owner" &&
    url.searchParams.get("sslmode") === "require" &&
    url.searchParams.get("sslaccept") === "strict" &&
    Boolean(url.searchParams.get("sslcert"));
}

import { Injectable } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";

export type SmsOutcome = { status: "accepted" | "failed" | "unknown"; message: string; receipt?: string };

/** Tencent Cloud SendSms 2021-01-11. Never log credentials, phone numbers or provider errors. */
@Injectable()
export class ApprovalSmsService {
  available() {
    return process.env.APPROVAL_SMS_ENABLED === "true" && [
      "APPROVAL_SMS_SECRET_ID", "APPROVAL_SMS_SECRET_KEY", "APPROVAL_SMS_APP_ID",
      "APPROVAL_SMS_SIGN_NAME", "APPROVAL_SMS_TEMPLATE_ID", "APPROVAL_SMS_REGION"
    ].every(key => Boolean(process.env[key]?.trim()));
  }

  async send(phone: string, businessLabel: string, nodeName: string, businessCode = "额度申请"): Promise<SmsOutcome> {
    if (!this.available()) return { status: "failed", message: "短信服务尚未启用" };
    const normalized = /^1\d{10}$/.test(phone) ? `+86${phone}` : phone;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return { status: "failed", message: "接收人手机号无效" };
    const host = "sms.tencentcloudapi.com";
    const body = JSON.stringify({
      PhoneNumberSet: [normalized], SmsSdkAppId: process.env.APPROVAL_SMS_APP_ID,
      SignName: process.env.APPROVAL_SMS_SIGN_NAME, TemplateId: process.env.APPROVAL_SMS_TEMPLATE_ID,
      TemplateParamSet: [businessLabel, businessCode, nodeName]
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
    const scope = `${date}/sms/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${hash(body)}`;
    const signingKey = hmac(hmac(hmac(`TC3${process.env.APPROVAL_SMS_SECRET_KEY}`, date), "sms"), "tc3_request");
    const signature = createHmac("sha256", signingKey).update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest("hex");
    try {
      const response = await fetch(`https://${host}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000), body,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `TC3-HMAC-SHA256 Credential=${process.env.APPROVAL_SMS_SECRET_ID}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
          "X-TC-Action": "SendSms", "X-TC-Version": "2021-01-11",
          "X-TC-Timestamp": String(timestamp), "X-TC-Region": process.env.APPROVAL_SMS_REGION!,
          ...(process.env.APPROVAL_SMS_SESSION_TOKEN ? { "X-TC-Token": process.env.APPROVAL_SMS_SESSION_TOKEN } : {})
        }
      });
      if (!response.ok) return { status: "unknown", message: "短信发送结果待确认，请勿重复发送" };
      const data = await response.json() as { Response?: { Error?: unknown; SendStatusSet?: Array<{ Code?: string; PhoneNumber?: string; SerialNo?: string }> } };
      if (data.Response?.Error) return { status: "failed", message: "短信服务拒绝发送，请稍后联系管理员核查" };
      const receipt = data.Response?.SendStatusSet?.find(item => item.PhoneNumber === normalized);
      if (receipt?.Code === "Ok" && receipt.SerialNo) return { status: "accepted", message: "短信已提交发送，送达以运营商结果为准", receipt: receipt.SerialNo };
      if (receipt?.Code && receipt.Code !== "Ok") return { status: "failed", message: "短信发送失败" };
      return { status: "unknown", message: "短信发送结果待确认，请勿重复发送" };
    } catch {
      return { status: "unknown", message: "短信发送结果待确认，请勿重复发送" };
    }
  }
}

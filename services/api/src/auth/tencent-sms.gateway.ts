import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { sms } from "tencentcloud-sdk-nodejs-sms";

@Injectable()
export class TencentSmsGateway {
  async send(phone: string, code: string) {
    const client = new sms.v20210111.Client({
      credential: { secretId: process.env.SMS_SECRET_ID!, secretKey: process.env.SMS_SECRET_KEY! },
      region: "ap-guangzhou", profile: { httpProfile: { endpoint: "sms.tencentcloudapi.com", reqTimeout: 10 } }
    });
    try {
      const response = await client.SendSms({ PhoneNumberSet: [`+86${phone}`], SmsSdkAppId: process.env.SMS_SDK_APP_ID!,
        SignName: process.env.SMS_SIGN_NAME!, TemplateId: process.env.SMS_TEMPLATE_ID!, TemplateParamSet: [code, "5"] });
      if (response.SendStatusSet?.length !== 1 || response.SendStatusSet[0].Code !== "Ok") throw new Error("rejected");
    } catch {
      // 供应商错误可能含手机号或请求参数；不直接记录或返回，也不自动重发。
      throw new ServiceUnavailableException("短信暂未发送成功，请稍后重试或联系管理员");
    }
  }
}

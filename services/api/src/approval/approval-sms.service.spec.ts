import { ApprovalSmsService } from "./approval-sms.service";

describe("短信服务边界（不连接真实短信服务）", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });
  function enabled() {
    Object.assign(process.env, {
      APPROVAL_SMS_ENABLED: "true", APPROVAL_SMS_SECRET_ID: "test-only-id", APPROVAL_SMS_SECRET_KEY: "test-only-key",
      APPROVAL_SMS_APP_ID: "test-app", APPROVAL_SMS_SIGN_NAME: "本地测试", APPROVAL_SMS_TEMPLATE_ID: "test-template", APPROVAL_SMS_REGION: "ap-guangzhou"
    });
    return new ApprovalSmsService();
  }
  it("默认关闭且不发网络请求", async () => {
    delete process.env.APPROVAL_SMS_ENABLED;
    const send = jest.spyOn(global, "fetch");
    expect((await new ApprovalSmsService().send("13800000000", "合同审批", "项目经理")).status).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });
  it("只在指定手机号获得服务商受理回执后报告已提交，不报告已送达", async () => {
    const service = enabled();
    const send = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ Response: { SendStatusSet: [{ Code: "Ok", PhoneNumber: "+8613800000000", SerialNo: "test-receipt" }] } })));
    expect(await service.send("13800000000", "合同审批", "项目经理")).toEqual({ status: "accepted", receipt: "test-receipt", message: "短信已提交发送，送达以运营商结果为准" });
    const [url, input] = send.mock.calls[0];
    expect(url).toBe("https://sms.tencentcloudapi.com");
    expect(JSON.parse(String(input?.body))).toMatchObject({ PhoneNumberSet: ["+8613800000000"], TemplateParamSet: ["合同审批", "额度申请", "项目经理"] });
    expect(input?.redirect).toBe("error");
  });
  it.each([
    { Response: { SendStatusSet: [{ Code: "Ok", PhoneNumber: "+8613900000000", SerialNo: "other" }] } },
    { Response: {} }
  ])("不匹配或缺失的回执不能判为成功", async body => {
    const service = enabled();
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
    expect((await service.send("13800000000", "合同审批", "项目经理")).status).toBe("unknown");
  });
  it("服务商错误不泄露手机号或原始错误", async () => {
    const service = enabled();
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ Response: { Error: { Message: "sensitive provider detail" } } })));
    const result = await service.send("13800000000", "合同审批", "项目经理");
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it("网络超时不重试、不报告失败已确认或成功", async () => {
    const service = enabled();
    const send = jest.spyOn(global, "fetch").mockRejectedValue(new Error("network interrupted"));
    expect((await service.send("13800000000", "合同审批", "项目经理")).status).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

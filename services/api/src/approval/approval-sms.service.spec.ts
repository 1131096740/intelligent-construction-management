import { approvalDutyAbsoluteTarget, companyTransferDutyTarget } from "./approval-duty-sms-intent";
import { ApprovalSmsService } from "./approval-sms.service";

describe("短信服务边界（不连接真实短信服务）", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });
  function enabled() {
    delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ID;
    delete process.env.APPROVAL_SMS_WEB_ORIGIN;
    Object.assign(process.env, {
      APPROVAL_SMS_ENABLED: "true", APPROVAL_SMS_SECRET_ID: "test-only-id", APPROVAL_SMS_SECRET_KEY: "test-only-key",
      APPROVAL_SMS_APP_ID: "test-app", APPROVAL_SMS_SIGN_NAME: "本地测试", APPROVAL_SMS_TEMPLATE_ID: "test-template", APPROVAL_SMS_GENERIC_TEMPLATE_ID: "generic-test-template", APPROVAL_SMS_REGION: "ap-guangzhou"
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
    expect(JSON.parse(String(input?.body))).toMatchObject({ PhoneNumberSet: ["+8613800000000"], TemplateId: "generic-test-template", TemplateParamSet: [] });
    expect(input?.redirect).toBe("error");
  });
  const detailed = {
    businessLabel: "费用待办", dutyName: "登记实际付款", businessCode: "BX-1",
    scopeName: "合成项目", initiatorName: "经办人", subject: "合成报销", participants: ["收款人", "发起人"],
    amountText: "待确定", totalText: "10.00 元", details: ["材料 6 元", "运费 4 元"],
    targetPath: "/费用与报销/claim-1",
  };

  it.each([false, true])("通用待办模板忽略全部业务字段及旧富模板开关 (%s)", async oldRichEnabled => {
    const service = enabled();
    if (oldRichEnabled) Object.assign(process.env, {
      APPROVAL_SMS_RICH_TEMPLATE_ENABLED: "true", APPROVAL_SMS_RICH_TEMPLATE_ID: "rich-test-template",
      APPROVAL_SMS_WEB_ORIGIN: "https://old.example.test"
    });
    const fetch = jest.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify({Response: {}})));
    await service.send("13800000000", detailed.businessLabel, detailed.dutyName, detailed.businessCode);
    await service.sendDutyIntent("13800000000", detailed);
    await service.sendDutyIntent("13800000000", {...detailed, targetPath: "https://unexpected.example.test/private"});
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, input] of fetch.mock.calls) {
      expect(JSON.parse(String(input?.body))).toEqual({
        PhoneNumberSet: ["+8613800000000"], SmsSdkAppId: "test-app", SignName: "本地测试",
        TemplateId: "generic-test-template", TemplateParamSet: []
      });
    }
  });

  it.each(["", "test-template", "rich-test-template"])("缺少通用模板或复用旧模板均不发请求 (%s)", async id => {
    const service = enabled();
    process.env.APPROVAL_SMS_GENERIC_TEMPLATE_ID = id;
    process.env.APPROVAL_SMS_RICH_TEMPLATE_ID = "rich-test-template";
    const fetch = jest.spyOn(global, "fetch").mockRejectedValue(new Error("should never send"));
    expect(service.available()).toBe(false);
    await expect(service.send("13800000000")).resolves.toMatchObject({status: "failed"});
    await expect(service.sendDutyIntent("13800000000", detailed)).resolves.toMatchObject({status: "failed"});
    expect(fetch).not.toHaveBeenCalled();
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

it("互转短信仅接受单一合法单号直达", () => {
  const origin="https://sms.example.test";
  const path=companyTransferDutyTarget("transfer-001");
  expect(approvalDutyAbsoluteTarget(origin,path)).toBe(new URL(path,origin).href);
  for (const invalid of [path+"&extra=1",path+"#fragment",companyTransferDutyTarget("a/b"),companyTransferDutyTarget("")]) {
    expect(approvalDutyAbsoluteTarget(origin,invalid)).toBeNull();
  }
});

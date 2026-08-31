import { BadRequestException } from "@nestjs/common";

import { createApiValidationPipe } from "../validation/api-validation";
import {
  CreateFundExecutionCaseDto,
  CreateFundExecutionReversalCaseDto,
  UpdateFundExecutionCaseDto,
  UpdateFundExecutionReversalCaseDto
} from "./fund-execution.dto";

describe("资金执行公开写入 DTO", () => {
  const pipe = createApiValidationPipe();

  async function transform<T>(metatype: new () => T, value: unknown) {
    return pipe.transform(value, {
      type: "body",
      metatype,
      data: ""
    });
  }

  it("创建案件只接收银行候选 selectionRef、业务原因和幂等键", async () => {
    await expect(
      transform(CreateFundExecutionCaseDto, {
        observationSelectionRef: "fobs1.expiry.signature",
        reason: "登记一笔未归类的实际出账",
        idempotencyKey: "11111111-1111-4111-8111-111111111111"
      })
    ).resolves.toMatchObject({
      observationSelectionRef: "fobs1.expiry.signature",
      reason: "登记一笔未归类的实际出账"
    });

    await expect(
      transform(CreateFundExecutionCaseDto, {
        observationSelectionRef: "fobs1.expiry.signature",
        reason: "登记一笔未归类的实际出账",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        observationId: "client-must-not-send-technical-id",
        actualAccountHolderCompanyId: "client-must-not-override-holder"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("resolution 的每条分类行只能携带逐轴业务 selectionRef", async () => {
    const valid = {
      expectedRevision: 2,
      reason: "补充四轴正式分类",
      selections: [
        { selectionRef: "faxis1.payable.signature" },
        { selectionRef: "faxis1.project-fund.signature" },
        { selectionRef: "faxis1.relationship.signature" },
        { selectionRef: "faxis1.operating.signature" }
      ],
      idempotencyKey: "22222222-2222-4222-8222-222222222222"
    };

    await expect(transform(UpdateFundExecutionCaseDto, valid)).resolves.toMatchObject(
      valid
    );
    await expect(
      transform(UpdateFundExecutionCaseDto, {
        ...valid,
        selections: [
          ...valid.selections.slice(0, 3),
          {
            selectionRef: "faxis1.operating.signature",
            axis: "operating",
            projectId: "client-must-not-send-project-id",
            consequenceType: "operating_impact_entry"
          }
        ]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("反向案件不接受任何分类选择", async () => {
    const valid = {
      targetSelectionRef: "frev1.original-business.signature",
      observationSelectionRef: "fobs1.reverse-bank-transaction.signature",
      reason: "银行退款，完整反转原资金执行",
      idempotencyKey: "33333333-3333-4333-8333-333333333333"
    };
    await expect(
      transform(CreateFundExecutionReversalCaseDto, valid)
    ).resolves.toMatchObject(valid);
    await expect(
      transform(CreateFundExecutionReversalCaseDto, {
        ...valid,
        selections: [{ selectionRef: "faxis1.must-not-be-accepted.signature" }]
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    const update = {
      expectedRevision: 2,
      reason: "补充退款原因，不改变原四轴分类",
      idempotencyKey: "44444444-4444-4444-8444-444444444444"
    };
    await expect(
      transform(UpdateFundExecutionReversalCaseDto, update)
    ).resolves.toMatchObject(update);
    await expect(
      transform(UpdateFundExecutionReversalCaseDto, {
        ...update,
        selections: [{ selectionRef: "faxis1.must-not-be-accepted.signature" }]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import { SpotProcurementController } from "./spot-procurement.controller";

const realFormDraft = {
  projectId: "project-1",
  code: "LXCG-001",
  applicationDepartment: "工程部",
  applicationName: "杨帅",
  requestedArrivalAt: "2026-07-20T00:00:00.000Z",
  reason: "新运粮河分洪工程现场需补充免烧砖",
  note: "优先送至北门",
  lines: [
    {
      materialName: "免烧砖",
      specification: "240×115×53",
      unit: "块",
      quantity: "1200",
      note: "二次结构"
    }
  ],
  attachments: []
};

describe("SpotProcurementController real-form input", () => {
  it("accepts the A4 application facts and rejects supplier, price, money, and invoice facts", async () => {
    const pipe = createApiValidationPipe();
    await expect(
      pipe.transform(realFormDraft, {
        type: "body",
        metatype: CreateSpotProcurementDto,
        data: undefined
      })
    ).resolves.toEqual(realFormDraft);

    await expect(
      pipe.transform(
        {
          ...realFormDraft,
          supplierName: "不应在采购申请填写的商户",
          totalAmountCents: "10000",
          lines: [
            {
              ...realFormDraft.lines[0],
              unitPrice: "3.5",
              invoiceMode: "invoice"
            }
          ]
        },
        {
          type: "body",
          metatype: CreateSpotProcurementDto,
          data: undefined
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("only creates the procurement application through the public controller", () => {
    const applications = {
      createDraft: jest.fn()
    };
    const controller = new SpotProcurementController(
      applications as never,
      {} as never,
      {} as never
    );

    controller.create({ id: "material-1" } as never, realFormDraft);

    expect(applications.createDraft).toHaveBeenCalledWith(
      "material-1",
      realFormDraft
    );
  });
});

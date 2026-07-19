import "reflect-metadata";
import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import { AbandonSpotProcurementDraftDto } from "./dto/abandon-spot-procurement-draft.dto";
import { SpotProcurementController } from "./spot-procurement.controller";

const realFormDraft = {
  projectId: "project-1",
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
  it("exposes semantic parent-draft abandonment under the existing material create permission", async () => {
    const target = SpotProcurementController.prototype.abandonDraft as unknown as object;
    expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(":procurementId/abandonment");
    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
      "spot_procurement.create"
    );

    const pipe = createApiValidationPipe();
    await expect(
      pipe.transform(
        { action: "abandon_application", reason: "现场需求已取消" },
        { type: "body", metatype: AbandonSpotProcurementDraftDto }
      )
    ).resolves.toEqual({
      action: "abandon_application",
      reason: "现场需求已取消"
    });
    await expect(
      pipe.transform(
        { action: "physical_delete", reason: "删除" },
        { type: "body", metatype: AbandonSpotProcurementDraftDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it("exposes abnormal termination as separate request and finance-confirmation actions", () => {
    const expectations = [
      [
        "requestAbnormalTermination",
        RequestMethod.POST,
        ":procurementId/abnormal-termination",
        "spot_procurement.abnormal_termination.request"
      ],
      [
        "confirmAbnormalTermination",
        RequestMethod.POST,
        ":procurementId/abnormal-termination/confirmation",
        "spot_procurement.abnormal_termination.confirm"
      ]
    ] as const;

    for (const [method, requestMethod, path, action] of expectations) {
      const target = SpotProcurementController.prototype[
        method
      ] as unknown as object;
      expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(requestMethod);
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
        action
      );
    }
  });

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
          code: "LXCG-20260719-001",
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

  it("exposes the scoped project options before the procurement id route", () => {
    const reads = { createProjectOptions: jest.fn() };
    const controller = new SpotProcurementController(
      {} as never,
      reads as never,
      {} as never
    );

    controller.createProjectOptions({ id: "material-1" } as never);

    expect(reads.createProjectOptions).toHaveBeenCalledWith("material-1");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        SpotProcurementController.prototype.createProjectOptions
      )
    ).toBe("create-project-options");
  });
});

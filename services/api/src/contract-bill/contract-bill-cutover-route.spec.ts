import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { ContractBillController } from "./contract-bill.controller";
import { ContractBillExcelController } from "./contract-bill-excel.controller";
import { ContractBillExcelService } from "./contract-bill-excel.service";
import { ContractBillService } from "./contract-bill.service";

describe("合同工作台切换：普通 bill 写入永久 tombstone", () => {
  let app: INestApplication | undefined;
  const previousMode = process.env.CONTRACT_CUTOVER_MODE;
  const billWrites = {
    addRow: jest.fn(),
    updateRow: jest.fn(),
    deleteRow: jest.fn(),
    reorderRows: jest.fn(),
    replaceRows: jest.fn(),
    cancelRemainder: jest.fn().mockResolvedValue({ rows: [] })
  };
  const excelWrites = { previewImport: jest.fn(), applyImport: jest.fn() };
  const ordinaryBillWrites = [
    {
      label: "新增行",
      method: "POST",
      path: "/contract-bills/bill-1/rows",
      body: "{}",
      write: billWrites.addRow
    },
    {
      label: "更新行",
      method: "PATCH",
      path: "/contract-bills/bill-1/rows/row-1",
      body: "{}",
      write: billWrites.updateRow
    },
    {
      label: "删除行",
      method: "DELETE",
      path: "/contract-bills/bill-1/rows/row-1",
      body: "{}",
      write: billWrites.deleteRow
    },
    {
      label: "排序",
      method: "POST",
      path: "/contract-bills/bill-1/rows/reorder",
      body: "{}",
      write: billWrites.reorderRows
    },
    {
      label: "整表替换",
      method: "PUT",
      path: "/contract-bills/bill-1/rows",
      body: "{}",
      write: billWrites.replaceRows
    },
    {
      label: "Excel 导入预览",
      method: "POST",
      path: "/contract-bills/bill-1/excel-imports",
      body: "{}",
      write: excelWrites.previewImport
    },
    {
      label: "Excel 导入应用",
      method: "POST",
      path: "/contract-bill-imports/import-1/apply",
      body: undefined,
      write: excelWrites.applyImport
    }
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractBillController, ContractBillExcelController],
      providers: [
        { provide: ContractBillService, useValue: billWrites },
        { provide: ContractBillExcelService, useValue: excelWrites }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new ContractCutoverGuard(new Reflector()));
    app.use((
      request: { user?: unknown },
      _response: unknown,
      next: () => void
    ) => {
      request.user = {
        id: "bill-tombstone-route-owner",
        name: "普通 bill 写入 tombstone 路由测试用户",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.CONTRACT_CUTOVER_MODE;
    else process.env.CONTRACT_CUTOVER_MODE = previousMode;
    if (app) await app.close();
  });

  it.each(
    ordinaryBillWrites.flatMap((ordinaryBillWrite) =>
      ["release-a", "maintenance", "release-b-maintenance", "release-b"].map(
        (mode) => ({ ...ordinaryBillWrite, mode })
      )
    )
  )(
    "在 $mode 下普通 bill $label 永久返回 410 且不调用业务写入",
    async ({ mode, method, path, body, write }) => {
      process.env.CONTRACT_CUTOVER_MODE = mode;

      const response = await fetch(`${await app!.getUrl()}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        statusCode: 410,
        code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
      });
      expect(write).not.toHaveBeenCalled();
    }
  );

  it("在 release-b 下保留受治理的 bill remainder cancellation 命令", async () => {
    process.env.CONTRACT_CUTOVER_MODE = "release-b";
    const body = {
      expectedBillRevision: 7,
      expectedDraftRevision: 12,
      expectedOccupancyToken: "a".repeat(64),
      reason: "现场范围核减"
    };

    const response = await fetch(
      `${await app!.getUrl()}/contract-bills/bill-1/rows/row-1/remainder-cancellation`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-contract-draft-lease": "lease-token"
        },
        body: JSON.stringify(body)
      }
    );

    expect(response.status).toBe(201);
    expect(billWrites.cancelRemainder).toHaveBeenCalledWith(
      "bill-1",
      "row-1",
      "bill-tombstone-route-owner",
      "lease-token",
      body
    );
  });
});

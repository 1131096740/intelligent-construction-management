import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FileService } from "../file/file.service";
import { FundAccountAdvanceController } from "../fund-account/fund-account-advance.controller";
import { FundAccountAdvanceService } from "../fund-account/fund-account-advance.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";

describe("项目垫资额度历史入口", () => {
  let app: INestApplication;
  const history = { rows: [{ id: "quota-1", status: "approval_pending" }] };
  const projects = {
    requestProjectFinancingQuota: jest.fn().mockResolvedValue({}),
    getProjectFinancingQuotaWorkbench: jest.fn().mockResolvedValue(history),
    reviewProjectFinancingQuota: jest.fn().mockResolvedValue({}),
    terminateProjectFinancingQuota: jest.fn().mockResolvedValue({})
  };
  const files = { uploadPrivateFile: jest.fn().mockResolvedValue({}) };
  const advanceReceipt = { id: "advance-1", amountYuan: "5.0001" };
  const advances = { register: jest.fn().mockResolvedValue(advanceReceipt) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectController, FundAccountAdvanceController],
      providers: [
        { provide: ProjectService, useValue: projects },
        { provide: FileService, useValue: files },
        { provide: FundAccountAdvanceService, useValue: advances }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "finance-director" };
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => { await app?.close(); });

  async function request(suffix = "", body?: BodyInit) {
    return fetch(`${await app.getUrl()}/projects/project-1/financing-quotas${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : {
        body,
        ...(typeof body === "string" ? { headers: { "content-type": "application/json" } } : {})
      })
    });
  }

  it("对新申请和专用上传返回 410，且不进入写入处理", async () => {
    const multipart = new FormData();
    multipart.set("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "quota.pdf");
    const create = await request("", JSON.stringify({ amountCents: "100" }));
    const upload = await request("/file-uploads", multipart);
    expect([create.status, upload.status]).toEqual([410, 410]);
    for (const response of [create, upload]) {
      expect(await response.json()).toMatchObject({ statusCode: 410, code: "OLD_WRITE_ENTRY_RETIRED" });
    }
    expect(projects.requestProjectFinancingQuota).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("保留历史查询与存量审批和终止入口", async () => {
    const read = await request();
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(history);
    expect((await request("/quota-1/approval", "{}")).status).toBe(201);
    expect((await request("/quota-1/termination", "{}")).status).toBe(201);
    expect(projects.getProjectFinancingQuotaWorkbench).toHaveBeenCalledWith("project-1", "finance-director");
    expect(projects.reviewProjectFinancingQuota).toHaveBeenCalledWith("project-1", "quota-1", "finance-director", {});
    expect(projects.terminateProjectFinancingQuota).toHaveBeenCalledWith("project-1", "quota-1", "finance-director", {});
  });

  it("保留无需额度申请的实际垫资登记入口", async () => {
    const input = {
      projectId: "project-1", scopeKey: "company:company-1", expectedRegistrationId: "registration-1",
      contributorKind: "person", contributorName: "测试出资人", amountYuan: "5.0001",
      receivedOn: "2026-11-27", evidenceReference: "合成到账凭据", idempotencyKey: "advance-001"
    };
    const result = await fetch(`${await app.getUrl()}/fund-account-advance-receipts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual(advanceReceipt);
    expect(advances.register).toHaveBeenCalledWith("finance-director", input);
  });
});

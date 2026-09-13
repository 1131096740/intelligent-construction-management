import { Readable } from "node:stream";

import { BadRequestException, type INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { OperatingProjectionExportDto } from "./dto/operating-projection-export.dto";
import { OperatingProjectionService } from "./operating-projection.service";

import {
  asOfQuery,
  OperatingProjectionController
} from "./operating-projection.controller";

describe("OperatingProjectionController query", () => {
  it("exposes the sensitive export only as a POST action", () => {
    expect(Reflect.getMetadata(
      METHOD_METADATA,
      OperatingProjectionController.prototype.export
    )).toBe(RequestMethod.POST);
  });

  it("keeps aggregate reads on overview positions and gates every detail/export entry to finance", () => {
    for (const method of ["projectDetails", "companyDetails", "asOfDetails", "export"] as const) {
      expect(Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        OperatingProjectionController.prototype[method]
      )).toEqual(["finance_staff", "finance_director"]);
    }
    for (const method of ["project", "company", "asOf"] as const) {
      expect(Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        OperatingProjectionController.prototype[method]
      )).toBeUndefined();
    }
  });

  it("exposes project, company, as-of, and export through the same authenticated service", async () => {
    const projections = {
      getProjectView: jest.fn().mockResolvedValue({ scope: { kind: "project" } }),
      getCompanyView: jest.fn().mockResolvedValue({ scope: { kind: "company" } }),
      getAsOfView: jest.fn().mockResolvedValue({ scope: { kind: "projects" } }),
      getProjectDetailPage: jest.fn().mockResolvedValue({ items: [] }),
      getCompanyDetailPage: jest.fn().mockResolvedValue({ items: [] }),
      getAsOfDetailPage: jest.fn().mockResolvedValue({ items: [] }),
      exportView: jest.fn().mockResolvedValue({
        fileName: "经营投影.csv",
        contentType: "text/csv; charset=utf-8",
        stream: Readable.from([])
      })
    };
    const controller = new OperatingProjectionController(projections as never);
    const user = { id: "user-1" } as never;

    await controller.project(user, "project-1", {
      asOf: "2026-09-05",
      sourceType: "owner_settlement"
    });
    await controller.company(user, "company-1", { asOf: "2026-09-05" });
    await controller.asOf(user, {
      scopeKind: "projects",
      projectIds: "project-1,project-2",
      costCategoryCode: "project_management"
    });
    await controller.projectDetails(user, "project-1", {
      asOf: "2026-09-05",
      pageSize: "25"
    });
    await controller.companyDetails(user, "company-1", {
      asOf: "2026-09-05",
      cursor: "cursor-1"
    });
    await controller.asOfDetails(user, {
      scopeKind: "projects",
      projectIds: "project-1,project-2",
      pageSize: "50"
    });
    await controller.export(user, {
      scopeKind: "project",
      projectId: "project-1",
      asOf: "2026-09-05",
      confirmationPassword: "current-password"
    });

    expect(projections.getProjectView).toHaveBeenCalledWith("user-1", {
      projectId: "project-1",
      asOf: "2026-09-05",
      constructionEnterpriseId: undefined,
      companyEntityId: undefined,
      counterpartyId: undefined,
      costCategoryCode: undefined,
      sourceType: "owner_settlement"
    });
    expect(projections.getCompanyView).toHaveBeenCalledWith("user-1", {
      companyEntityId: "company-1",
      asOf: "2026-09-05",
      constructionEnterpriseId: undefined,
      counterpartyId: undefined,
      costCategoryCode: undefined,
      sourceType: undefined
    });
    expect(projections.getAsOfView).toHaveBeenCalledWith("user-1", expect.objectContaining({
      scopeKind: "projects",
      projectIds: ["project-1", "project-2"],
      costCategoryCode: "project_management"
    }));
    expect(projections.getProjectDetailPage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      projectId: "project-1",
      asOf: "2026-09-05",
      pageSize: "25"
    }));
    expect(projections.getCompanyDetailPage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      companyEntityId: "company-1",
      cursor: "cursor-1"
    }));
    expect(projections.getAsOfDetailPage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      scopeKind: "projects",
      projectIds: "project-1,project-2",
      pageSize: "50"
    }));
    expect(projections.exportView).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        scopeKind: "project",
        projectId: "project-1",
        asOf: "2026-09-05"
      }),
      "current-password"
    );
  });

  it("fails closed instead of defaulting an absent or unknown scope", () => {
    expect(() => asOfQuery({})).toThrow(BadRequestException);
    expect(() => asOfQuery({ scopeKind: "unknown" })).toThrow(BadRequestException);
  });

  it("normalizes explicit project sets without expanding an empty request", () => {
    expect(asOfQuery({
      scopeKind: "projects",
      projectIds: " project-1,project-2, "
    })).toEqual(expect.objectContaining({
      scopeKind: "projects",
      projectIds: ["project-1", "project-2"]
    }));
    expect(asOfQuery({ scopeKind: "projects", projectIds: "" }).projectIds)
      .toEqual([]);
  });

  it.each([
    ["projectIds", []],
    ["projectId", 1],
    ["companyEntityId", {}],
    ["asOf", false],
    ["constructionEnterpriseId", []],
    ["counterpartyId", null],
    ["costCategoryCode", 1],
    ["sourceType", {}]
  ])("rejects a non-string export %s before calling the service", async (field, value) => {
    await expect(createApiValidationPipe().transform({
      scopeKind: "project",
      projectId: "project-1",
      confirmationPassword: "current-password",
      [field]: value
    }, {
      type: "body",
      metatype: OperatingProjectionExportDto
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts the unchanged valid export JSON contract", async () => {
    await expect(createApiValidationPipe().transform({
      scopeKind: "projects",
      projectIds: "project-1,project-2",
      sourceType: "owner_settlement",
      confirmationPassword: "current-password"
    }, {
      type: "body",
      metatype: OperatingProjectionExportDto
    })).resolves.toEqual(expect.objectContaining({
      scopeKind: "projects",
      projectIds: "project-1,project-2"
    }));
  });
});

describe("OperatingProjectionController real HTTP query validation", () => {
  let app: INestApplication;
  const projections = {
    getProjectView: jest.fn().mockResolvedValue({}),
    getCompanyView: jest.fn().mockResolvedValue({}),
    getAsOfView: jest.fn().mockResolvedValue({}),
    getProjectDetailPage: jest.fn().mockResolvedValue({ items: [] }),
    getCompanyDetailPage: jest.fn().mockResolvedValue({ items: [] }),
    getAsOfDetailPage: jest.fn().mockResolvedValue({ items: [] }),
    exportView: jest.fn()
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OperatingProjectionController],
      providers: [{ provide: OperatingProjectionService, useValue: projections }]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = { id: "finance-query-user", name: "财务经办", phone: null };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const method of Object.values(projections)) {
      if (jest.isMockFunction(method)) method.mockClear();
    }
  });

  it.each([
    ["project aggregate", "/operating-projections/project/project-1?sourceType=a&sourceType=b", "getProjectView"],
    ["project detail", "/operating-projections/project/project-1/details?sourceType=a&sourceType=b", "getProjectDetailPage"],
    ["company aggregate", "/operating-projections/company/company-1?sourceType=a&sourceType=b", "getCompanyView"],
    ["company detail", "/operating-projections/company/company-1/details?sourceType=a&sourceType=b", "getCompanyDetailPage"],
    ["as-of aggregate", "/operating-projections/as-of?scopeKind=projects&sourceType=a&sourceType=b", "getAsOfView"],
    ["as-of detail", "/operating-projections/as-of/details?scopeKind=projects&sourceType=a&sourceType=b", "getAsOfDetailPage"]
  ])("rejects duplicate-key arrays on %s before the service", async (_label, path, method) => {
    const response = await fetch(`${await app.getUrl()}${path}`);

    expect(response.status).toBe(400);
    expect(projections[method as keyof typeof projections]).not.toHaveBeenCalled();
  });

  it("enforces frozen 256/2048 limits and rejects unknown query fields", async () => {
    const base = `${await app.getUrl()}/operating-projections`;
    expect((await fetch(`${base}/project/project-1/details?sourceType=${"s".repeat(256)}`)).status)
      .toBe(200);
    expect((await fetch(`${base}/project/project-1/details?sourceType=${"s".repeat(257)}`)).status)
      .toBe(400);
    expect((await fetch(`${base}/company/company-1/details?cursor=${"c".repeat(2_048)}`)).status)
      .toBe(200);
    expect((await fetch(`${base}/company/company-1/details?cursor=${"c".repeat(2_049)}`)).status)
      .toBe(400);
    expect((await fetch(`${base}/as-of/details?scopeKind=projects&projectIds=${"p".repeat(2_048)}`)).status)
      .toBe(200);
    expect((await fetch(`${base}/as-of/details?scopeKind=projects&projectIds=${"p".repeat(2_049)}`)).status)
      .toBe(400);
    expect((await fetch(`${base}/project/project-1?unknownField=blocked`)).status).toBe(400);
  });

  it("preserves every legal detail query field as a validated string", async () => {
    const query = new URLSearchParams({
      asOf: "2026-09-05",
      constructionEnterpriseId: "affiliate-1",
      companyEntityId: "company-1",
      counterpartyId: "owner-1",
      costCategoryCode: "project_management",
      sourceType: "owner_settlement",
      cursor: "cursor-1",
      pageSize: "25"
    });
    const response = await fetch(
      `${await app.getUrl()}/operating-projections/project/project-1/details?${query}`
    );

    expect(response.status).toBe(200);
    expect(projections.getProjectDetailPage).toHaveBeenCalledWith(
      "finance-query-user",
      expect.objectContaining({
        projectId: "project-1",
        asOf: "2026-09-05",
        constructionEnterpriseId: "affiliate-1",
        companyEntityId: "company-1",
        counterpartyId: "owner-1",
        costCategoryCode: "project_management",
        sourceType: "owner_settlement",
        cursor: "cursor-1",
        pageSize: "25"
      })
    );
  });
});

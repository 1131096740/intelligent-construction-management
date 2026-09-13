import { Readable } from "node:stream";

import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { OperatingProjectionExportDto } from "./dto/operating-projection-export.dto";

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
      pageSize: 25
    }));
    expect(projections.getCompanyDetailPage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      companyEntityId: "company-1",
      cursor: "cursor-1"
    }));
    expect(projections.getAsOfDetailPage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      scopeKind: "projects",
      projectIds: ["project-1", "project-2"],
      pageSize: 50
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

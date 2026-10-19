import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GeneralProcurementDraftDto } from "../general-procurement/general-procurement.dto";
import { ProjectRosterChangeDto } from "../organization/dto/project-roster-change.dto";

// Shape validation accepts persisted string IDs; existence and scope remain service checks.
describe.each([GeneralProcurementDraftDto, ProjectRosterChangeDto])("历史项目标识 %p", (Dto) => {
  it.each(["legacy-project-01", "d9e6e614-50bb-46a6-b36f-f430ec0a284e"])("接受原主键 %s", async (projectId) => {
    const errors = await validate(plainToInstance(Dto as typeof GeneralProcurementDraftDto, { projectId }));
    expect(errors.filter(error => error.property === "projectId")).toEqual([]);
  });
  it.each([undefined, null, "", "   ", 123, {}, "a".repeat(129)])("拒绝无效值 %p", async (projectId) => {
    const errors = await validate(plainToInstance(Dto as typeof GeneralProcurementDraftDto, { projectId }));
    expect(errors.some(error => error.property === "projectId")).toBe(true);
  });
});

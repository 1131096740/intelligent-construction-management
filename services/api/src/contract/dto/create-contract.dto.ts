/** Minimal payload to seed a workbench draft from a published business template. */
export interface CreateContractDraftDto {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
}

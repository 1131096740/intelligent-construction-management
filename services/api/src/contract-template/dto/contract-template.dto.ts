import type { ContractTemplateSchema } from "@jiangkong/shared-domain";

export interface CreateBusinessTemplateDto {
  code: string;
  name: string;
  contractTypeKey: string;
  schema: ContractTemplateSchema;
}

export interface UpdateBusinessTemplateVersionDto {
  schema: ContractTemplateSchema;
  changeSummary?: string;
}

export interface PublishTemplateVersionDto {
  changeSummary: string;
}

export interface CreateStandardClauseDto {
  code: string;
  category: string;
  name: string;
  title: string;
  content: unknown;
}

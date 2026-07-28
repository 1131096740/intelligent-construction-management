import { IsObject, IsOptional } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export type BusinessPartyAttachmentCategory =
  | "business_license"
  | "bank_account"
  | "legal_id"
  | "authorization"
  | "qualification"
  | "other";

export interface BusinessPartySnapshotDto {
  name: string;
  unifiedSocialCreditCode?: string;
  legalRepresentative?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  attachments: Array<{
    category: BusinessPartyAttachmentCategory;
    fileId: string;
    name: string;
    validUntil?: string;
  }>;
}

export interface CreateBusinessPartyDto extends BusinessPartySnapshotDto {}

export interface AddContractPartyDto {
  roleKey:
    | "party_a"
    | "party_b"
    | "party_c"
    | "guarantor"
    | "consortium_member"
    | "other";
  businessPartyVersionId?: string;
  snapshot?: BusinessPartySnapshotDto;
}

export class SaveContractDraftPartyDto {
  @IsRequiredText({
    requiredMessage: "合同主体位置不能为空",
    typeMessage: "合同主体位置必须是文字",
    blankMessage: "合同主体位置不能为空白"
  })
  roleKey!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "合同主体顺序必须是整数",
    rangeMessage: "合同主体顺序必须大于等于 0"
  })
  displayOrder!: number;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "主体版本编号不能为空",
    typeMessage: "主体版本编号必须是文字",
    blankMessage: "主体版本编号不能为空白"
  })
  businessPartyVersionId?: string;

  @IsObject({ message: "合同主体快照必须是对象" })
  snapshot!: Record<string, unknown>;
}

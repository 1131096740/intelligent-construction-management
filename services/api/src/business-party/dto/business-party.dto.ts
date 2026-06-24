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

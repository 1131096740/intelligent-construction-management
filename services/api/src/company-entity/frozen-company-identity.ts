import { ConflictException } from "@nestjs/common";

type CompanyReference = Readonly<{
  companyEntityId: string | null;
  nameSnapshot?: string | null;
  creditCodeSnapshot?: string | null;
}>;
type CompanyVersion = Readonly<{
  companyEntityId: string;
  name: string;
  unifiedSocialCreditCode: string | null;
  isActive: boolean;
}>;

/** Only server-loaded immutable references may use this continuation check.
 * Directory inactivity never authorizes a new selection or replaces account verification. */
export function assertFrozenCompanyIdentity(reference: CompanyReference, version: CompanyVersion | null) {
  if (!reference.companyEntityId?.trim() || !reference.nameSnapshot?.trim() ||
      !reference.creditCodeSnapshot?.trim() || !version?.isActive ||
      version.companyEntityId !== reference.companyEntityId ||
      version.name !== reference.nameSnapshot ||
      version.unifiedSocialCreditCode !== reference.creditCodeSnapshot) {
    throw new ConflictException("原单公司主体的冻结依据缺失或不一致，请联系合同主管核实");
  }
}

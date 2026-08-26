import type { BusinessAction } from "@jiangkong/shared-domain";

export interface CreateApprovalDelegationDto {
  toUserId: string;
  startsAt: string;
  endsAt: string;
  actionKey?: BusinessAction;
  resourceType?: string;
  resourceId?: string;
}

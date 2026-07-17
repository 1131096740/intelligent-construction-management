import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import type {
  ContractAuthorizationSide,
  SetContractAuthorizationPayload
} from "../../../api/contract-workbench.api";

export type StagedAuthorizationAssociation = {
  fileId: string;
  fileName: string;
  contractVersionId: string;
  grantorName: string;
  agentName: string;
  scopeSummary: string;
};

type AssociationRequest = (
  contractVersionId: string,
  payload: SetContractAuthorizationPayload
) => Promise<unknown>;

export function associateStagedAuthorization(
  side: ContractAuthorizationSide,
  current: ContractWorkbenchReadModel,
  staged: StagedAuthorizationAssociation,
  request: AssociationRequest
) {
  if (staged.contractVersionId !== current.version.id) {
    throw new Error("该授权文件属于另一份合同草稿，不能关联到当前合同。");
  }
  return request(staged.contractVersionId, {
    side,
    expectedRevision: current.version.draftRevision,
    required: true,
    upload: {
      fileId: staged.fileId,
      grantorName: staged.grantorName,
      agentName: staged.agentName,
      scopeSummary: staged.scopeSummary
    }
  });
}

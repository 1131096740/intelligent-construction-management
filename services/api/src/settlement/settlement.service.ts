import { Injectable } from "@nestjs/common";
import {
  canCreateSettlementFromContractStatus,
  ContractVersionStatus
} from "@jiangkong/shared-domain";

@Injectable()
export class SettlementService {
  assertContractVersionEffective(status: ContractVersionStatus): void {
    if (!canCreateSettlementFromContractStatus(status)) {
      throw new Error("Cannot create settlement from a non-effective contract version");
    }
  }
}

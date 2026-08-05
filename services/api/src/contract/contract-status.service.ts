import { Injectable } from "@nestjs/common";
import type { ContractVersionStatus } from "@jiangkong/shared-domain";

const ALLOWED: Record<ContractVersionStatus, ContractVersionStatus[]> = {
  draft: ["in_approval", "voided"],
  in_approval: ["approval_rejected", "approved_pending_seal"],
  approval_rejected: ["draft", "voided"],
  approved_pending_seal: ["in_seal"],
  in_seal: ["seal_approved_pending_archive"],
  seal_approved_pending_archive: ["pending_archive_confirm"],
  pending_archive_confirm: ["effective", "seal_approved_pending_archive"],
  effective: ["superseded", "voided"],
  // 已替代版本仍是后续版本的直接历史基版；保持终态才能稳定追溯历史引用。
  superseded: [],
  voided: [],
  abandoned: [],
  deleting: []
};

@Injectable()
export class ContractStatusService {
  canTransition(from: ContractVersionStatus, to: ContractVersionStatus): boolean {
    return ALLOWED[from].includes(to);
  }

  assertTransition(from: ContractVersionStatus, to: ContractVersionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid contract status transition: ${from} -> ${to}`);
    }
  }
}

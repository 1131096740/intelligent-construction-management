import { Injectable } from "@nestjs/common";
import type { ApprovalNodeMode, RoleKey } from "@jiangkong/shared-domain";

export interface FlowNodeInput {
  name: string;
  mode: ApprovalNodeMode;
  roleKeys: RoleKey[];
  minAmountCents?: bigint;
  maxAmountCents?: bigint;
}

export interface FrozenNode {
  name: string;
  mode: ApprovalNodeMode;
  roleKeys: RoleKey[];
}

@Injectable()
export class ApprovalFreezeService {
  freeze(nodes: FlowNodeInput[], amountCents: bigint): FrozenNode[] {
    return nodes
      .filter((node) => {
        if (node.minAmountCents !== undefined && amountCents < node.minAmountCents) {
          return false;
        }
        if (node.maxAmountCents !== undefined && amountCents > node.maxAmountCents) {
          return false;
        }
        return true;
      })
      .map((node) => ({
        name: node.name,
        mode: node.mode,
        roleKeys: [...node.roleKeys]
      }));
  }
}

import type { Prisma } from "@prisma/client";
import { SETTLEMENT_BASIC_ENTRY_POLICY } from "../settlement/settlement-business-entry-policy";
import { SETTLEMENT_LINE_ENTRY_POLICY } from "../settlement/settlement-line-business-entry-policy";
import { SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY } from "../settlement/settlement-line-attachment-business-entry-policy";
import { PAYMENT_FINANCE_ENTRY_POLICY } from "../payment/payment-business-entry-policy";
import { PAYMENT_REQUEST_ENTRY_POLICY } from "../payment/payment-request-business-entry-policy";
import { PAYMENT_APPROVAL_AMOUNT_ENTRY_POLICY } from "../payment/payment-approval-amount-business-entry-policy";
import { CONTRACT_BASIC_ENTRY_POLICY, CONTRACT_TEMPLATE_ENTRY_POLICY, CONTRACT_BILL_ENTRY_POLICY, CONTRACT_SETTLEMENT_MODE_ENTRY_POLICY, CONTRACT_COMMERCIAL_ENTRY_POLICY, CONTRACT_PARTY_ENTRY_POLICY, CONTRACT_PAYMENT_TERMS_ENTRY_POLICY, CONTRACT_PAYMENT_STAGE_ENTRY_POLICY } from "../contract-workbench/contract-business-entry-policy";
import {
  BUSINESS_ACTIONS,
  type BusinessAction,
  type BusinessEntrySceneDefinition,
  type BusinessEntryOperation,
  type BusinessEntrySubmissionTarget,
  type RoleKey
} from "@jiangkong/shared-domain";

export const BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY = Symbol(
  "BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY"
);

export interface BusinessEntryOwnershipRecord {
  readonly projectId: string;
}

export interface BusinessEntryTransactionResolverContext {
  readonly tx: Prisma.TransactionClient;
  readonly sceneKey: string;
  readonly target: Extract<BusinessEntrySubmissionTarget, { projectId: string }>;
  readonly actorUserId: string;
  readonly operation: Extract<BusinessEntryOperation, "edit" | "import">;
  readonly action: BusinessAction;
  readonly values: Readonly<Record<string, unknown>>;
}

export type BusinessEntryOwnershipResolver = (
  context: BusinessEntryTransactionResolverContext
) => Promise<readonly BusinessEntryOwnershipRecord[]>;

export type BusinessEntryDomainAuthorizationResolver = (
  context: BusinessEntryTransactionResolverContext
) => Promise<readonly RoleKey[]>;

export interface BusinessEntryTransactionScenePolicy {
  readonly sceneKey: string;
  readonly targetKind: "project_owned_entity";
  readonly entityType: string;
  readonly action: BusinessAction;
  readonly resolveOwnership: BusinessEntryOwnershipResolver;
  readonly resolveAuthorization: BusinessEntryDomainAuthorizationResolver;
  readonly resolveDefinition?: (context: BusinessEntryTransactionResolverContext) => Promise<BusinessEntrySceneDefinition>;
}

function freezePolicy(
  policy: BusinessEntryTransactionScenePolicy
): BusinessEntryTransactionScenePolicy {
  return Object.freeze({ ...policy });
}

export class BusinessEntryTransactionSceneRegistry {
  private readonly policies: ReadonlyMap<string, BusinessEntryTransactionScenePolicy>;

  constructor(policies: readonly BusinessEntryTransactionScenePolicy[]) {
    const policyByScene = new Map<string, BusinessEntryTransactionScenePolicy>();
    for (const policy of policies) {
      if (!policy.sceneKey.trim()) {
        throw new Error("事务业务场景键未登记");
      }
      if (policyByScene.has(policy.sceneKey)) {
        throw new Error(`事务业务场景授权契约重复：${policy.sceneKey}`);
      }
      if (policy.targetKind !== "project_owned_entity") {
        throw new Error(`事务业务场景目标种类未登记：${policy.sceneKey}`);
      }
      if (!policy.entityType.trim()) {
        throw new Error(`事务业务场景目标类型未登记：${policy.sceneKey}`);
      }
      if (!BUSINESS_ACTIONS.includes(policy.action)) {
        throw new Error(`事务业务场景动作权限未登记：${policy.sceneKey}`);
      }
      if (typeof policy.resolveOwnership !== "function") {
        throw new Error(`事务业务场景缺少归属解析器：${policy.sceneKey}`);
      }
      if (typeof policy.resolveAuthorization !== "function") {
        throw new Error(`事务业务场景缺少领域授权解析器：${policy.sceneKey}`);
      }
      policyByScene.set(policy.sceneKey, freezePolicy(policy));
    }
    this.policies = policyByScene;
  }

  get(sceneKey: string): BusinessEntryTransactionScenePolicy {
    const policy = this.policies.get(sceneKey);
    if (!policy) throw new Error(`事务业务场景未登记：${sceneKey}`);
    return policy;
  }
}

export function createBusinessEntryTransactionSceneRegistry(
  policies: readonly BusinessEntryTransactionScenePolicy[]
) {
  return new BusinessEntryTransactionSceneRegistry(policies);
}

export const BUSINESS_ENTRY_TRANSACTION_SCENE_POLICIES = Object.freeze(
  [CONTRACT_BASIC_ENTRY_POLICY, CONTRACT_TEMPLATE_ENTRY_POLICY, CONTRACT_BILL_ENTRY_POLICY, CONTRACT_SETTLEMENT_MODE_ENTRY_POLICY, CONTRACT_COMMERCIAL_ENTRY_POLICY, CONTRACT_PARTY_ENTRY_POLICY, CONTRACT_PAYMENT_TERMS_ENTRY_POLICY, CONTRACT_PAYMENT_STAGE_ENTRY_POLICY, PAYMENT_FINANCE_ENTRY_POLICY, PAYMENT_REQUEST_ENTRY_POLICY, PAYMENT_APPROVAL_AMOUNT_ENTRY_POLICY, SETTLEMENT_BASIC_ENTRY_POLICY, SETTLEMENT_LINE_ENTRY_POLICY, SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY] as readonly BusinessEntryTransactionScenePolicy[]
);

export const BUSINESS_ENTRY_TRANSACTION_REGISTRY =
  createBusinessEntryTransactionSceneRegistry(BUSINESS_ENTRY_TRANSACTION_SCENE_POLICIES);

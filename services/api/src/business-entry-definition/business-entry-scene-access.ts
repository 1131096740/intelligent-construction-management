import {
  BUSINESS_ACTIONS,
  ROLE_KEYS,
  type BusinessAction,
  type BusinessEntryOperation,
  type BusinessEntrySceneDefinition,
  type BusinessEntrySubmissionTarget,
  type RoleKey
} from "@jiangkong/shared-domain";
import type { PrismaService } from "../database/prisma.service";

export const BUSINESS_ENTRY_SCENE_ACCESS_REGISTRY = Symbol(
  "BUSINESS_ENTRY_SCENE_ACCESS_REGISTRY"
);

export type BusinessEntryTargetScope = "project" | "global";
export type BusinessEntryRoleScope = "global" | "effective" | "project";

export interface BusinessEntryGlobalTargetResolverContext {
  readonly target: BusinessEntrySubmissionTarget;
  readonly actorUserId: string;
  readonly operation: BusinessEntryOperation;
  readonly scene: string;
  readonly scope: BusinessEntryTargetScope;
  readonly prisma: PrismaService;
}

export type BusinessEntryGlobalTargetResolver = (
  context: BusinessEntryGlobalTargetResolverContext
) => Promise<boolean>;

export type BusinessEntryScenePermission =
  | {
      readonly kind: "business_action";
      readonly action: BusinessAction;
      readonly roleScope: BusinessEntryRoleScope;
    }
  | {
      readonly kind: "role_keys";
      readonly roleKeys: readonly RoleKey[];
      readonly roleScope: BusinessEntryRoleScope;
    }
  | {
      readonly kind: "authenticated_self";
      readonly roleScope: "global";
    };

export interface BusinessEntrySceneAccessPolicy {
  readonly sceneKey: string;
  readonly target: {
    readonly scope: BusinessEntryTargetScope;
    readonly entityType: string;
    readonly resolve?: BusinessEntryGlobalTargetResolver;
  };
  readonly permission: BusinessEntryScenePermission;
}

function freezePolicy(
  policy: BusinessEntrySceneAccessPolicy
): BusinessEntrySceneAccessPolicy {
  const permission = policy.permission.kind === "role_keys"
    ? Object.freeze({
        ...policy.permission,
        roleKeys: Object.freeze([...policy.permission.roleKeys])
      })
    : Object.freeze({ ...policy.permission });
  return Object.freeze({
    sceneKey: policy.sceneKey,
    target: Object.freeze({ ...policy.target }),
    permission
  });
}

export class BusinessEntrySceneAccessRegistry {
  private readonly policies: ReadonlyMap<string, BusinessEntrySceneAccessPolicy>;

  constructor(
    definitions: readonly BusinessEntrySceneDefinition[],
    policies: readonly BusinessEntrySceneAccessPolicy[]
  ) {
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const policyByKey = new Map<string, BusinessEntrySceneAccessPolicy>();

    for (const policy of policies) {
      const definition = definitionByKey.get(policy.sceneKey);
      if (!definition) {
        throw new Error(`业务场景授权契约引用未注册场景：${policy.sceneKey}`);
      }
      if (policyByKey.has(policy.sceneKey)) {
        throw new Error(`业务场景授权契约重复：${policy.sceneKey}`);
      }
      if (policy.target.scope !== "project" && policy.target.scope !== "global") {
        throw new Error(`业务场景目标范围未登记：${policy.sceneKey}`);
      }
      if (
        policy.permission.kind !== "business_action" &&
        policy.permission.kind !== "role_keys" &&
        policy.permission.kind !== "authenticated_self"
      ) {
        throw new Error(`业务场景权限类型未登记：${policy.sceneKey}`);
      }
      if (
        !policy.target.entityType.trim() ||
        policy.target.entityType !== definition.entityType
      ) {
        throw new Error(`业务场景目标类型与定义不一致：${policy.sceneKey}`);
      }
      if (policy.target.scope === "global" && typeof policy.target.resolve !== "function") {
        throw new Error(`全局业务场景缺少目标解析器：${policy.sceneKey}`);
      }
      if (
        !["global", "effective", "project"].includes(policy.permission.roleScope) ||
        (policy.target.scope === "global" && policy.permission.roleScope !== "global") ||
        (policy.target.scope === "project" && policy.permission.roleScope === "global") ||
        (policy.permission.kind === "authenticated_self" && policy.target.scope !== "global")
      ) {
        throw new Error(`业务场景目标范围与岗位范围不兼容：${policy.sceneKey}`);
      }
      if (
        policy.permission.kind === "business_action" &&
        !BUSINESS_ACTIONS.includes(policy.permission.action)
      ) {
        throw new Error(`业务场景动作权限未登记：${policy.sceneKey}`);
      }
      if (
        policy.permission.kind === "role_keys" &&
        (
          policy.permission.roleKeys.length === 0 ||
          policy.permission.roleKeys.some((roleKey) => !ROLE_KEYS.includes(roleKey))
        )
      ) {
        throw new Error(`业务场景岗位权限未登记：${policy.sceneKey}`);
      }
      if (policy.permission.kind === "authenticated_self" && !policy.target.resolve) {
        throw new Error(`本人业务场景缺少目标解析器：${policy.sceneKey}`);
      }
      policyByKey.set(policy.sceneKey, freezePolicy(policy));
    }

    for (const definition of definitions) {
      if (!policyByKey.has(definition.key)) {
        throw new Error(`业务场景缺少授权契约：${definition.key}`);
      }
    }

    this.policies = policyByKey;
  }

  get(sceneKey: string): BusinessEntrySceneAccessPolicy {
    const policy = this.policies.get(sceneKey);
    if (!policy) throw new Error(`业务场景缺少授权契约：${sceneKey}`);
    return policy;
  }
}

export function createBusinessEntrySceneAccessRegistry(
  definitions: readonly BusinessEntrySceneDefinition[],
  policies: readonly BusinessEntrySceneAccessPolicy[]
) {
  return new BusinessEntrySceneAccessRegistry(definitions, policies);
}

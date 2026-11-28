export type Current261LifecycleCaseKey = `${"inside" | "outside" | "upward"}:${"material_purchase" | "equipment_rental" | "labor_subcontract" | "professional_subcontract" | "other"}`;
export interface Current261LifecycleCase {
 readonly key: Current261LifecycleCaseKey;
 readonly relationship: "inside" | "outside" | "upward";
 readonly contractTypeKey: "material_purchase" | "equipment_rental" | "labor_subcontract" | "professional_subcontract" | "other";
 readonly parallelRouteKey: string;
 readonly billAlias: string | null;
 readonly approvalDuties: readonly { readonly source: string; readonly roleKeys: readonly string[] }[];
 readonly operating: false;
 readonly storage: "LOCAL_ONLY";
 readonly executionAllowed: false;
 readonly nativeAdmission: false;
 readonly full394Accepted: false;
}
export function current261LifecycleCase(key: string): Current261LifecycleCase;
export function current261LifecycleCases(): readonly Current261LifecycleCase[];

export function current261LifecycleCaseFromFixture(fixture: unknown): Current261LifecycleCase;

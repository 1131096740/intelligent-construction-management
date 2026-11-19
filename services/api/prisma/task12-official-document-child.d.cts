export interface OfficialChildScope { checkMaterials(): void; remainingTotalMilliseconds(): number }
export function createOfficialDocumentChildBudget(scope: OfficialChildScope, milliseconds: number, started?: number): {
  remaining(): number;
  run<T>(operation: (remainingMilliseconds: number) => Promise<T>): Promise<T>;
};
export function attachPostcheck(primary: unknown, secondary: unknown): unknown;

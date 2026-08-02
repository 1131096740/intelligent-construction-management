import { SetMetadata } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

export const REQUIRED_POSITIONS_KEY = "requiredPositions";
export const ANY_PROJECT_POSITION_SCOPE_KEY = "anyProjectPositionScope";

export const RequirePositions = (...positions: RoleKey[]) =>
  SetMetadata(REQUIRED_POSITIONS_KEY, positions);

export const UseAnyProjectPositionScope = () =>
  SetMetadata(ANY_PROJECT_POSITION_SCOPE_KEY, true);

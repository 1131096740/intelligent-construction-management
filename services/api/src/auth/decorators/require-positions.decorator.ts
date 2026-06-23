import { SetMetadata } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

export const REQUIRED_POSITIONS_KEY = "requiredPositions";

export const RequirePositions = (...positions: RoleKey[]) =>
  SetMetadata(REQUIRED_POSITIONS_KEY, positions);

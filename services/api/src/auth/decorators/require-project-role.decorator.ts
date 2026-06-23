import { SetMetadata } from "@nestjs/common";
import type { BusinessAction } from "@jiangkong/shared-domain";

export const REQUIRED_PROJECT_ACTION_KEY = "requiredProjectAction";

export const RequireProjectRole = (action: BusinessAction) =>
  SetMetadata(REQUIRED_PROJECT_ACTION_KEY, action);

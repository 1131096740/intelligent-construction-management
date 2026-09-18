import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { BusinessEntryValidationResult } from "@jiangkong/shared-domain";
import { UpdateMyProfileDto } from "../auth/dto/update-my-profile.dto";

/** Account fields keep the auth DTO's exact Unicode and phone rules. */
export function validateUserSelfProfile(result: BusinessEntryValidationResult): BusinessEntryValidationResult {
  if (!result.valid) return result;
  const account = plainToInstance(UpdateMyProfileDto, {
    name: result.values.name,
    phone: result.values.phone
  });
  // Password confirmation remains exclusively at PATCH /auth/profile.
  const errors = validateSync(account)
    .filter((error) => error.property === "name" || error.property === "phone")
    .flatMap((error) => Object.values(error.constraints ?? {}).map((message) => ({
      code: "invalid_format" as const, fieldKey: error.property, message
    })));
  return { ...result, valid: errors.length === 0, errors };
}

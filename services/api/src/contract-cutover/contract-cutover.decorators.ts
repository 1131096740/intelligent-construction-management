import { applyDecorators, SetMetadata } from "@nestjs/common";

export const CONTRACT_CUTOVER_SURFACE_KEY = "contract_cutover_surface";
export const CONTRACT_CUTOVER_LEGACY_WRITE_KEY =
  "contract_cutover_legacy_write";

export function ContractCutoverSurface() {
  return SetMetadata(CONTRACT_CUTOVER_SURFACE_KEY, true);
}

export function ContractCutoverLegacyWrite() {
  return applyDecorators(
    ContractCutoverSurface(),
    SetMetadata(CONTRACT_CUTOVER_LEGACY_WRITE_KEY, true)
  );
}

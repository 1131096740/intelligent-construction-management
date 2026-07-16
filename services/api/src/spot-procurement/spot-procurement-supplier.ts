import { BadRequestException } from "@nestjs/common";
import {
  collapseUnicodeWhitespace,
  trimUnicodeWhitespace
} from "../validation/unicode-whitespace";

export function normalizeSupplierName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestException("供应商名称必须是文字");
  }
  const normalized = collapseUnicodeWhitespace(value);
  if (!normalized) {
    throw new BadRequestException("供应商名称不能为空");
  }
  return normalized;
}

export function supplierKey(input: {
  supplierPartyId?: string | null;
  supplierName: unknown;
}): string {
  const partyId =
    typeof input.supplierPartyId === "string"
      ? trimUnicodeWhitespace(input.supplierPartyId)
      : "";
  if (partyId) {
    return `party:${partyId}`;
  }
  return `name:${normalizeSupplierName(input.supplierName)}`;
}

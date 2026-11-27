import { BadRequestException } from "@nestjs/common";
import { normalizeExpenseQuantity } from "@jiangkong/shared-domain";

export function parseExpenseQuantity(input: string | undefined | null): string | null {
  try {
    return normalizeExpenseQuantity(input);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
}

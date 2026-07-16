import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  collapseUnicodeWhitespace,
  isUnicodeBlank
} from "../validation/unicode-whitespace";
import type { CreateVatRateOptionDto } from "./dto/create-vat-rate-option.dto";
import type { UpdateVatRateOptionDto } from "./dto/update-vat-rate-option.dto";

const ORDINARY_DECIMAL = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;

type VatRateOptionRow = {
  id: string;
  rateValue: Prisma.Decimal;
  label: string;
  enabled: boolean;
  sortOrder: number;
};

type VatRateOptionLookup = {
  vatRateOption: {
    findUnique(args: {
      where: { id: string };
    }): Promise<VatRateOptionRow | null>;
  };
};

@Injectable()
export class VatRateOptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listEnabled() {
    const options = await this.prisma.vatRateOption.findMany({
      where: { enabled: true },
      orderBy: [
        { sortOrder: "asc" },
        { rateValue: "asc" },
        { label: "asc" },
        { id: "asc" }
      ]
    });
    return options.map((option) => this.readModel(option));
  }

  async create(actorUserId: string, input: CreateVatRateOptionDto) {
    const rateValue = this.rateValue(input.rateValue);
    const label = this.label(input.label);
    const sortOrder = this.sortOrder(input.sortOrder);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const option = await tx.vatRateOption.create({
          data: {
            rateValue,
            label,
            sortOrder,
            createdByUserId: actorUserId
          }
        });
        const result = this.readModel(option);
        await this.audit.record(tx, {
          actorUserId,
          action: "invoice.vat_rate.create",
          businessType: "vat_rate_option",
          businessId: option.id,
          metadata: this.auditMetadata(result)
        });
        return result;
      });
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  async update(
    optionId: string,
    actorUserId: string,
    input: UpdateVatRateOptionDto
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException("请至少填写一项税率调整内容");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.vatRateOption.findUnique({
          where: { id: optionId }
        });
        if (!existing) {
          throw new NotFoundException("税率选项不存在");
        }

        const data: Prisma.VatRateOptionUpdateInput = {};
        if (input.rateValue !== undefined) {
          data.rateValue = this.rateValue(input.rateValue);
        }
        if (input.label !== undefined) {
          data.label = this.label(input.label);
        }
        if (input.enabled !== undefined) {
          if (typeof input.enabled !== "boolean") {
            throw new BadRequestException("税率启用状态必须是布尔值");
          }
          data.enabled = input.enabled;
        }
        if (input.sortOrder !== undefined) {
          data.sortOrder = this.sortOrder(input.sortOrder);
        }

        const option = await tx.vatRateOption.update({
          where: { id: optionId },
          data
        });
        const result = this.readModel(option);
        await this.audit.record(tx, {
          actorUserId,
          action:
            existing.enabled && input.enabled === false
              ? "invoice.vat_rate.disable"
              : "invoice.vat_rate.update",
          businessType: "vat_rate_option",
          businessId: option.id,
          metadata: this.auditMetadata(result)
        });
        return result;
      });
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  async requireEnabledOption(
    optionId: string,
    client: VatRateOptionLookup = this.prisma
  ) {
    const option = await client.vatRateOption.findUnique({
      where: { id: optionId }
    });
    if (!option) {
      throw new NotFoundException("税率选项不存在");
    }
    if (!option.enabled) {
      throw new BadRequestException("税率选项已停用，不能用于新的采购草稿");
    }
    return this.readModel(option);
  }

  private rateValue(value: unknown): Prisma.Decimal {
    if (typeof value !== "string") {
      throw new BadRequestException("税率必须是普通十进制字符串");
    }
    const match = ORDINARY_DECIMAL.exec(value);
    if (!match) {
      throw new BadRequestException(
        "税率必须是 0 到 100 之间、最多 6 位小数的普通十进制字符串"
      );
    }
    const integerDigits = value.split(".", 1)[0].length;
    const decimal = new Prisma.Decimal(value);
    if (
      integerDigits > 3 ||
      decimal.lessThan(0) ||
      decimal.greaterThan(100)
    ) {
      throw new BadRequestException("税率必须在 0 到 100 之间");
    }
    return decimal;
  }

  private label(value: unknown): string {
    if (typeof value !== "string" || isUnicodeBlank(value)) {
      throw new BadRequestException("税率标签不能为空白");
    }
    return collapseUnicodeWhitespace(value);
  }

  private sortOrder(value: unknown): number {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > 2_147_483_647
    ) {
      throw new BadRequestException("税率排序必须是正整数");
    }
    return value;
  }

  private readModel(option: VatRateOptionRow) {
    return {
      id: option.id,
      rateValue: option.rateValue.toString(),
      label: option.label,
      enabled: option.enabled,
      sortOrder: option.sortOrder
    };
  }

  private auditMetadata(option: ReturnType<VatRateOptionService["readModel"]>) {
    return {
      rateValue: option.rateValue,
      label: option.label,
      enabled: option.enabled,
      sortOrder: option.sortOrder
    };
  }

  private throwWriteError(error: unknown): never {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "P2002") {
      throw new ConflictException("相同税率数值和标签的选项已存在");
    }
    if (code === "P2034") {
      throw new ConflictException("税率配置已变化，请刷新后重试");
    }
    throw error;
  }
}

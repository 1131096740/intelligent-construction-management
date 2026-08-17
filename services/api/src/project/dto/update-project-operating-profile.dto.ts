import { IsDateString, IsIn, IsOptional } from "class-validator";
import { PROJECT_OPERATING_TAKEOVER_STATUSES } from "@jiangkong/shared-domain";

export class UpdateProjectOperatingProfileDto {
  @IsOptional()
  @IsDateString({ strict: true }, { message: "经营账生效日格式不正确" })
  operatingLedgerEffectiveDate?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: "经营接管完成日格式不正确" })
  takeoverCompletedDate?: string | null;

  @IsOptional()
  @IsIn(PROJECT_OPERATING_TAKEOVER_STATUSES, { message: "经营接管状态不受支持，请重新选择" })
  takeoverStatus?: string;
}

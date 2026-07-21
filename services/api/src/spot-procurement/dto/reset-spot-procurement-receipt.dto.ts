import { IsInt, Min } from "class-validator";

export class ResetSpotProcurementReceiptDto {
  @IsInt({ message: "收货修订号必须是整数" })
  @Min(1, { message: "收货修订号不正确，请刷新后重试" })
  expectedRevision!: number;
}

import { IsBoolean, IsInt, IsUUID, Matches, Min } from "class-validator";

export class ConfirmContractSealV2Dto {
  @IsUUID("4", { message: "盖章任务的审批轮次不正确，请刷新后重试" })
  expectedApprovalInstanceId!: string;

  @IsUUID("4", { message: "盖章任务不正确，请刷新后重试" })
  expectedSealTaskId!: string;

  @IsInt({ message: "正文修订不正确，请刷新后重试" })
  @Min(1, { message: "正文修订必须大于0，请刷新后重试" })
  documentContentRevision!: number;

  @Matches(/^[a-f0-9]{64}$/u, { message: "正文校验信息不正确，请刷新后重试" })
  documentContentFingerprint!: string;

  @IsBoolean({ message: "请确认线下盖章已完成" })
  confirmed!: boolean;
}

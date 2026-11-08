import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsInt, IsUUID, Matches, Min } from "class-validator";

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

export class ArchiveSignedContractV2Dto {
  @IsUUID("4")
  expectedApprovalInstanceId!: string;
  @IsUUID("4")
  expectedSealTaskId!: string;
  @IsInt()
  @Min(1)
  documentContentRevision!: number;
  @Matches(/^[a-f0-9]{64}$/u)
  documentContentFingerprint!: string;
  @IsInt()
  @Equals(2, { message: "请使用当前合同归档协议" })
  archiveProtocolVersion!: 2;

  @Equals("generated_approval", { message: "当前入口仅接收本轮审批生成的合同原件" })
  archiveSource!: "generated_approval";

  @IsUUID("4", { message: "本次归档标识不正确，请刷新后重试" })
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1, { message: "请上传双方签章PDF原件" })
  @ArrayMaxSize(20, { message: "每次最多上传20件归档原件" })
  @ArrayUnique({ message: "归档原件不能重复" })
  @IsUUID("4", { each: true, message: "归档文件标识不正确" })
  fileIds!: string[];

  @Equals(true, { message: "请核对原件与本轮合同内容一致" })
  confirmedMatchingSignedDocument!: true;
}

/** Only the exact pre-DML busy branch, after TX exit and a fresh unknown key. */
export interface ContractArchiveBindingBusyResponse {
  statusCode: 409;
  error: "Conflict";
  code: "CONTRACT_ARCHIVE_BINDING_BUSY";
  attemptOutcome: "not_applied";
  message: string;
}

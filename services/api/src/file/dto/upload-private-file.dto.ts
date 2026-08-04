import { IsOptional, IsUUID } from "class-validator";

export class UploadPrivateFileDto {
  @IsOptional()
  @IsUUID("4", { message: "文件上传幂等键必须是 UUID" })
  idempotencyKey?: string;
}

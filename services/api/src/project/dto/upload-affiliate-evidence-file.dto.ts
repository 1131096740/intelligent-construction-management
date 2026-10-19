import { IsOptional, IsString } from "class-validator";
import { UploadPrivateFileDto } from "../../file/dto/upload-private-file.dto";

export class UploadAffiliateEvidenceFileDto extends UploadPrivateFileDto {
  @IsOptional()
  @IsString({ message: "请选择有效的业务类型" })
  businessType?: string;
}

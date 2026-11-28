import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class CreateFilePackageDto {
  @IsArray({ message: "请选择要打包下载的资料" })
  @ArrayNotEmpty({ message: "请选择要打包下载的资料" })
  @ArrayMaxSize(50, { message: "单次最多打包 50 份资料，请减少选择后重试" })
  @IsString({ each: true, message: "资料标识必须是文字" })
  fileIds!: string[];
}

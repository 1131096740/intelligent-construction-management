import { IsIn } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export const RECEIPT_PHOTO_SOURCES = ["camera", "album"] as const;
export const RECEIPT_PHOTO_CATEGORIES = [
  "material_scene",
  "delivery_note"
] as const;

export type ReceiptPhotoSource =
  (typeof RECEIPT_PHOTO_SOURCES)[number];
export type ReceiptPhotoCategory =
  (typeof RECEIPT_PHOTO_CATEGORIES)[number];

export class AttachReceiptPhotoDto {
  @IsRequiredText({
    requiredMessage: "请选择收货原图",
    typeMessage: "收货原图编号必须是文字",
    blankMessage: "请选择收货原图"
  })
  originalFileId!: string;

  @IsIn(RECEIPT_PHOTO_SOURCES, {
    message: "收货照片来源不正确"
  })
  source!: ReceiptPhotoSource;

  @IsIn(RECEIPT_PHOTO_CATEGORIES, {
    message: "收货照片分类不正确"
  })
  category!: ReceiptPhotoCategory;

  @IsOptionalNonBlankText({
    typeMessage: "收货照片备注必须是文字",
    blankMessage: "收货照片备注不能为空白"
  })
  note?: string;

  @IsOptionalNonBlankText({
    typeMessage: "补充照片原因必须是文字",
    blankMessage: "补充照片原因不能为空白"
  })
  appendReason?: string;
}

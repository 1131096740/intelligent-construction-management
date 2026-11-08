import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { readLayoutSourcePositions } from "../contract-template/layout-field-mapping";
import { extractContractDocx } from "./contract-docx-extractor";
import { renderContractDocx } from "./contract-docx-renderer";
import type { ContractDocumentRenderInput } from "./contract-document.types";
import { canonicalContractPlaceholder, CONTRACT_VALUE_PLACEHOLDER_ALIASES, isContractBillReadonlyRowPlaceholder } from "./contract-placeholder-registry";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MARKER = "jg-contract-body:";
export const CONTRACT_BODY_MONEY_SEMANTICS_VERSION = "contract-money-v1";

export const REVIEWED_LABOR_SOURCE_SHA256 = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";
export const REVIEWED_LABOR_TAX_BINDING_VERSION = "reviewed-labor-tax-v1";
export const REVIEWED_LABOR_TYPOGRAPHY_VERSION = "reviewed-labor-primary-roles-v1";
export const CONTRACT_BODY_RENDER_PROFILE_KEY = "documentRenderProfile";
export const REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION = "reviewed-material-signature-date-v1";
export const REVIEWED_ORIGINAL_MECHANICAL_SOURCE_SHA256 = "9139d5eb2905cb659e90c00f053c8b17c40d265bca5c660da5d2d8e1028d4c32";
export const REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION = "reviewed-original-mechanical-page-number-v1";
const REVIEWED_ORIGINAL_MECHANICAL_FOOTER_SHA256 = "fcdffa218f593eeeb844929a7ad82b8d58c7356c4aa0a4bae1f133698b2a7097";

/** The immutable master binds the relationship, styles, section geometry and field container. */
export function assertReviewedOriginalMechanicalPageSource(source: Buffer): void {
  if (createHash("sha256").update(source).digest("hex") !== REVIEWED_ORIGINAL_MECHANICAL_SOURCE_SHA256) {
    throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  }
  extractContractDocx(source); // Existing bounded archive/XML qualification, including the exact footer.
  const footer = new PizZip(source).file("word/footer1.xml");
  if (!footer || createHash("sha256").update(footer.asNodeBuffer()).digest("hex") !== REVIEWED_ORIGINAL_MECHANICAL_FOOTER_SHA256) {
    throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  }
}

/** Only this field container changes; all main-body plans and other ZIP members retain their bytes. */
function prepareReviewedOriginalMechanicalPage(zip: ReturnType<typeof sourceParagraphs>["zip"]): void {
  const footer = zip.file("word/footer1.xml");
  if (!footer || createHash("sha256").update(footer.asNodeBuffer()).digest("hex") !== REVIEWED_ORIGINAL_MECHANICAL_FOOTER_SHA256) {
    throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  }
  const document = xml(footer.asText()), root = document.documentElement;
  if (!root) throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  const paragraphs = direct(root, "p"), boxes = Array.from(root.getElementsByTagNameNS(W, "txbxContent"));
  if (root.namespaceURI !== W || root.localName !== "ftr" || paragraphs.length !== 1 || boxes.length !== 2) {
    throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  }
  const field = direct(boxes[0], "p")[0], paragraph = paragraphs[0];
  const pPr = direct(paragraph, "pPr")[0];
  // Source style14 fixes 9pt; left is (9866twip text width - 2880twip box width)/2.
  // Zero textbox inset is preserved. This is a versioned position, not a measured Word bounding box.
  const indent = document.createElementNS(W, "w:ind"); indent.setAttributeNS(W, "w:left", "3493");
  pPr.appendChild(indent);
  const alignment = document.createElementNS(W, "w:jc"); alignment.setAttributeNS(W, "w:val", "left");
  pPr.appendChild(alignment);
  const runs = direct(field, "r").map(run => run.cloneNode(true));
  for (const child of Array.from(paragraph.childNodes)) if (child !== pPr) paragraph.removeChild(child);
  for (const run of runs) paragraph.appendChild(run);
  zip.file("word/footer1.xml", new XMLSerializer().serializeToString(document));
}
const REVIEWED_LABOR_TAX_SENTENCE = "本合同采用以下第   （2）   项计价方式，乙方提供 R增值税专用发票/ □增值税普通发票，税率  3   %。";

export const REVIEWED_MATERIAL_SOURCE_SHA256 = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
export const REVIEWED_MATERIAL_TYPOGRAPHY_VERSION = "reviewed-material-two-roles-v1";
export const REVIEWED_MATERIAL_TYPOGRAPHY_V2_VERSION = "reviewed-material-primary-secondary-roles-v2";
export const REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION = "reviewed-material-primary-secondary-body25-v3";
export const REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION = "reviewed-material-primary-secondary-body25-v4";
export const REVIEWED_MECHANICAL_SOURCE_SHA256 = "b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89";
export const REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION = "reviewed-mechanical-primary-secondary-roles-v1";
export const REVIEWED_GENERIC_SOURCE_SHA256 = "ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d";
export const REVIEWED_GENERIC_TYPOGRAPHY_VERSION = "reviewed-generic-primary-roles-v1";
export type ReviewedTypographyVersion = typeof REVIEWED_MATERIAL_TYPOGRAPHY_VERSION | typeof REVIEWED_MATERIAL_TYPOGRAPHY_V2_VERSION | typeof REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION | typeof REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION | typeof REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION | typeof REVIEWED_LABOR_TYPOGRAPHY_VERSION | typeof REVIEWED_GENERIC_TYPOGRAPHY_VERSION;
export function isReviewedTypographyVersion(value: unknown): value is ReviewedTypographyVersion {
  return typeof value === "string" && Object.hasOwn(REVIEWED_TYPOGRAPHY_POLICIES, value);
}
/** Internal renderer provenance only; never accepted from a draft/client DTO. Ordinals count direct body w:p only. */
export interface ContractBodyLineBoxScopeDraft {
  version: 1;
  typographyVersion: typeof REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION;
  sourceSha256: string;
  paragraphs: Array<{ ordinal: number; positionId: string; textSha256: string }>;
}
export interface ContractBodyLineBoxScope extends ContractBodyLineBoxScopeDraft { docxSha256: string }

/** Rebind renderer-owned positions only against the final upload/converter bytes; never search by user text. */
export function finalizeContractBodyLineBoxScope(bytes: Buffer, draft: ContractBodyLineBoxScopeDraft): ContractBodyLineBoxScope {
  const invalid = () => { throw new BadRequestException("合同正文纸面范围已变化，请保留当前正文后重新生成"); };
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).length !== 4 ||
    Object.keys(draft).some(key => !["version", "typographyVersion", "sourceSha256", "paragraphs"].includes(key)) ||
    draft.version !== 1 || draft.typographyVersion !== REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION || draft.sourceSha256 !== REVIEWED_MATERIAL_SOURCE_SHA256 ||
    !Array.isArray(draft.paragraphs) || draft.paragraphs.length > 654) return invalid();
  extractContractDocx(bytes); // Existing archive/XML limits also apply before this final-byte read.
  const zip = new PizZip(bytes), part = zip.file("word/document.xml");
  if (!part) return invalid();
  const content = part.asText();
  if (/<!DOCTYPE|<!ENTITY/iu.test(content)) return invalid();
  const document = xml(content), bodies = Array.from(document.getElementsByTagNameNS(W, "body"));
  if (bodies.length !== 1) return invalid();
  const paragraphs = direct(bodies[0], "p"), positions = new Set<string>();
  let previous = -1;
  const entries = draft.paragraphs.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 3 ||
      Object.keys(entry).some(key => !["ordinal", "positionId", "textSha256"].includes(key)) ||
      !Number.isSafeInteger(entry.ordinal) || entry.ordinal < 0 || entry.ordinal <= previous || entry.ordinal >= paragraphs.length ||
      typeof entry.positionId !== "string" || !/^(?:[a-f0-9]{64}|added:[A-Za-z0-9_-]{1,64})$/u.test(entry.positionId) || positions.has(entry.positionId) ||
      typeof entry.textSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.textSha256) ||
      createHash("sha256").update(textOf(paragraphs[entry.ordinal])).digest("hex") !== entry.textSha256) return invalid();
    positions.add(entry.positionId); previous = entry.ordinal;
    return { ordinal: entry.ordinal, positionId: entry.positionId, textSha256: entry.textSha256 };
  });
  return { version: 1, typographyVersion: REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, sourceSha256: REVIEWED_MATERIAL_SOURCE_SHA256,
    paragraphs: entries, docxSha256: createHash("sha256").update(bytes).digest("hex") };
}
export interface ContractBodyRenderProfile {
  reviewedLaborTaxBindingVersion?: typeof REVIEWED_LABOR_TAX_BINDING_VERSION;
  typographyVersion?: ReviewedTypographyVersion;
  signatureDateVersion?: typeof REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION;
  pageNumberVersion?: typeof REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION;
}

/** Server-owned persisted axes; absence means historical rendering. */
export function readContractBodyRenderProfile(draftData: unknown): ContractBodyRenderProfile | undefined {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData) || !Object.hasOwn(draftData, CONTRACT_BODY_RENDER_PROFILE_KEY)) return undefined;
  const value = (draftData as Record<string, unknown>)[CONTRACT_BODY_RENDER_PROFILE_KEY];
  const invalid = () => { throw new BadRequestException("合同文书呈现版本无法核对，请联系管理员处理"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const profile = value as Record<string, unknown>;
  if (Object.hasOwn(profile, "pageNumberVersion")) {
    if (Object.keys(profile).length !== 1 || profile.pageNumberVersion !== REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION) return invalid();
    return { pageNumberVersion: REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION };
  }
  const hasLaborTypography = Object.hasOwn(profile, "typographyVersion") && profile.typographyVersion === REVIEWED_LABOR_TYPOGRAPHY_VERSION;
  const hasSignatureDate = Object.hasOwn(profile, "signatureDateVersion");
  if (Object.keys(profile).length !== (hasLaborTypography ? 2 : 1) + (hasSignatureDate ? 1 : 0) ||
    (hasSignatureDate && (profile.signatureDateVersion !== REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION || profile.typographyVersion !== REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION)) ||
    (hasLaborTypography && !Object.hasOwn(profile, "reviewedLaborTaxBindingVersion")) || Object.keys(profile).some(key => !["reviewedLaborTaxBindingVersion", "typographyVersion", "signatureDateVersion"].includes(key)) ||
    (Object.hasOwn(profile, "reviewedLaborTaxBindingVersion") && profile.reviewedLaborTaxBindingVersion !== REVIEWED_LABOR_TAX_BINDING_VERSION) ||
    (Object.hasOwn(profile, "typographyVersion") && !isReviewedTypographyVersion(profile.typographyVersion))) return invalid();
  return {
    ...(Object.hasOwn(profile, "reviewedLaborTaxBindingVersion") ? { reviewedLaborTaxBindingVersion: REVIEWED_LABOR_TAX_BINDING_VERSION } : {}),
    ...(Object.hasOwn(profile, "typographyVersion") && isReviewedTypographyVersion(profile.typographyVersion) ? { typographyVersion: profile.typographyVersion } : {}),
    ...(hasSignatureDate ? { signatureDateVersion: REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION } : {})
  };
}

// This version is deliberately only these two roles in this immutable source.
// Full source identity, opaque positions, original text and ordered main-body
// context are independent of rendered/user-edited text and existing typography.
const REVIEWED_MATERIAL_ROLE_CONTEXT = [
  { id: "fe8a01bb7008d14107fd6abe3584dee8f92c5544c883bbd85c67e4dcadd4a17c", text: "{合同名称}" },
  { id: "d5d1d8f550508c3fcf432409853bb8c9a9e8b18490a0d79f11f19e2d872a664e", text: "合同编号：{草稿编号}" },
  { id: "73b02dab33ada19795e0b869bc30dc935069a06e3fdc153515149a106b8a65ed", text: "签订日期：" },
  { id: "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", text: "{合同名称}", family: "方正小标宋简体", sizePt: 22 },
  { id: "79a1751d0a82c9a7ef86c0a54731b5e03252b7c7c1ee72fa477d2cbd269b0490", text: "买方：{甲方名称}   " },
  { id: "431dbe2475eb5bad22244a93ad5072324f064e76e219effd9b78d4b3533b008b", text: "卖方：{乙方名称}       " },
  { id: "44c7d1eb0aadd363a9d5749eab000e83ef8b34e08d4c3ee2817c37886885530a", text: "经买卖双方共同协商，根据《中华人民共和国民法典》及相关法律法规，遵循平等、自愿、公开和诚实信用的原则，双方就{项目名称}买卖其他消耗材事项签订本合同。" },
  { id: "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72", text: "第一条  货物名称、规格型号、数量、价格等", family: "黑体", sizePt: 14 }
] as const;

// V2 keeps the original two-role policy immutable and adds only these26
// reviewed source roles in original main-contract order. No user-text inference.
const REVIEWED_MATERIAL_PRIMARY_SECONDARY_ROLE_CONTEXT = [
  ...REVIEWED_MATERIAL_ROLE_CONTEXT,
  { id: "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522", text: "3.合同履行过程中风险处置办法", family: "楷体_GB2312", sizePt: 14 },
  { id: "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120", text: "第二条  质量技术标准及相关要求", family: "黑体", sizePt: 14 },
  { id: "039bb580de810755a55899ee448ff7640b3799cfe619ce0e0c82d2b3ada831bf", text: "第三条  交货时间、方式及供货期间", family: "黑体", sizePt: 14 },
  { id: "3e8a650210ab5f8b52981a421514a6a5a78798ad9e81273da0719a1c71377d72", text: "第四条  货物的包装标准和包装物的提供与回收", family: "黑体", sizePt: 14 },
  { id: "9064f42005092444fed3adda9c53cddc3ca84692909d94cb507c42c81acb55ed", text: "第五条  验收", family: "黑体", sizePt: 14 },
  { id: "ac328837c96accb7aa3ff7db00b7bd5223aa77b6a84e4793abcb0d9a176b3624", text: "2.数量验收", family: "楷体_GB2312", sizePt: 14 },
  { id: "de98f02131af525488a5d73adc8b5265dd27d5d150ab923c85be438b215de38a", text: "3.质量验收", family: "楷体_GB2312", sizePt: 14 },
  { id: "19d6291bf8a6d3c14d54a89f30c950adcf15a12764690ca459c65f53ef3eb075", text: "第六条  货款的对账与结算", family: "黑体", sizePt: 14 },
  { id: "a0f5a2e8f22c196835b7d085893c7d47523fdb72475fa3cd4101d06f0698fbe3", text: "第七条 发票有关事项", family: "黑体", sizePt: 14 },
  { id: "6be1a8bfe0211957fc11a8861ae6d8ec35d589a78056d57e5ea78c3544116e0d", text: "2.增值税发票开具时间和类型的要求：", family: "楷体_GB2312", sizePt: 14 },
  { id: "58ff088727aa74cd1bb34b02c2033a4ae30acbd278505946b15aab0ef3bd2352", text: "第八条  货款的支付", family: "黑体", sizePt: 14 },
  { id: "a17506241d1a2cb53df88aefc5cecdf926f2e2d55d1f2a4dc96e71afecd9c986", text: "第九条  质量保证期", family: "黑体", sizePt: 14 },
  { id: "aa99e0cb52e990b1edf2e042229abc99afc7a1bece3057bd90cd13f9fcf4b26e", text: "第十条  相关服务", family: "黑体", sizePt: 14 },
  { id: "1b3553e4c646773f99f4a4983be098d476045104186bfdfb95a6f06bf15ac4c0", text: "第十一条  履约担保", family: "黑体", sizePt: 14 },
  { id: "8d356cdc5ebfbb141351410cfbf8c96216214cbe87e7ea82bea57066a9891902", text: "第十二条  环境保护及安全要求", family: "黑体", sizePt: 14 },
  { id: "bf25bcd6c599decc20c375ae45aecc75bd5a73e5ab7174ca93bf1fdfa8a75470", text: "第十三条  廉洁条款", family: "黑体", sizePt: 14 },
  { id: "4541bd2de1e5b14bb00626ee5e13bb7d9a153ce9747c476a6cc876d0acac46d5", text: "第十四条  双方的权利和义务", family: "黑体", sizePt: 14 },
  { id: "44d0ab6686fd7717df52502628343e16a7d907b3c3ed3cf172fad0a9c43d8d54", text: "(一) 买方的权利和义务", family: "楷体_GB2312", sizePt: 14 },
  { id: "59c0e04d0d5b8eb4190bcf282128d1e5bcf839fcf7580a4a09387f5d57e8763d", text: "(二) 卖方的权利和义务", family: "楷体_GB2312", sizePt: 14 },
  { id: "1d0ac78debd74f3cf2357007d8268d754fe4041d64a521b07dec5519f2139989", text: "第十五条  违约责任", family: "黑体", sizePt: 14 },
  { id: "d1540407cb236b11a00d3ba56a3cf03c014c2071ec34600ead2cead537910f04", text: "第十六条  保密", family: "黑体", sizePt: 14 },
  { id: "9dccecdf0a84fd400b8a35dc8ea32c50e74641fced9f0ad15d9798392ec340a7", text: "第十七条  不可抗力", family: "黑体", sizePt: 14 },
  { id: "b7d7e75afe728e71dd0deb3f77094c83befb99b73229beba8c71670667ddceb0", text: "第十八条  争议的解决", family: "黑体", sizePt: 14 },
  { id: "47ed4b1e12d481f93d46b90f4680d85c23335d96bd18824547e4760127b63bd4", text: "第十九条  合同生效、合同的终止与解除", family: "黑体", sizePt: 14 },
  { id: "ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", text: "第二十条  工作联络", family: "黑体", sizePt: 14 },
  { id: "8612ac838c3965a150d63f65bdc87b3b758ec008b63567c13f48a2b4dca61fb9", text: "第二十一条  其他约定事项", family: "黑体", sizePt: 14 },
] as const;

// Mechanical V1 changes only the sixteen reviewed main-contract source roles.
// Titles, ordinary clauses and preamble are frozen context/preservation anchors.
const REVIEWED_MECHANICAL_ROLE_CONTEXT = [
  { id: "da073e3f72746be7b95298f1594eaedebc92cdd4e1dbad46fc73d2931521fd3e", text: "{合同名称}" },
  { id: "3d174053a7c524ba9716b6916362904c1f595ed6d4f8ad298babd15103243e30", text: "{合同名称}" },
  { id: "e1d8e9935847b24feb9e8062d50aa7001859cec29186dae615a82bf800acac87", text: "甲方因工程施工需要租赁乙方的机械设备，根据《中华人民共和国民法典》及相关法律法规，为明确双方的权利和义务，经双方协商，特订立本合同，以便共同遵守。" },
  { id: "f9107b6301d17d122b98d12829efdf5386e93f1fec03943739af80900acff5d4", text: "第一条  租赁机械设备名称、规格型号、数量及金额", family: "黑体", sizePt: 14 },
  { id: "1b8aa65a7d1d9cc8a447a00b08d0e8729437f1067e41b26057cb8659bc1fa179", text: "2.本合同租赁数量、合同总价均为暂估，最终按甲方实际租赁使用并经双方签字确认的结算数据为准。乙方自愿承担合同签订量未发生部分的风险，乙方不得以任何形式要求甲方承担合同签订量未发生部分的费用或损失。" },
  { id: "86d314a4f9e34ad25c76840fbe3939ec0074f590230275ec68deddc82c8d65c6", text: "第二条  合同期限", family: "黑体", sizePt: 14 },
  { id: "4449c493564d28170aebaac4d3cc771ecf4b0d72621b02da1cb30b5b1b6ed7a7", text: "2.具体设备租赁期限的计算", family: "楷体_GB2312", sizePt: 14 },
  { id: "813509044676597fb723ae8e7357dac08f021c2fdd5e5f7a55b01805fb01862c", text: "第三条  机械设备进出场交接与验收", family: "黑体", sizePt: 14 },
  { id: "ac06fbd385147ed2afae2ecfe88058c4c12c45ed1fbca5a16de6b3ddc5a105c7", text: "第四条  租金及对账结算方式", family: "黑体", sizePt: 14 },
  { id: "4e85b82638e7dd7442754215be67c564d7bcad81f321f18b518e8706b3ecc58e", text: "第五条  发票有关事项", family: "黑体", sizePt: 14 },
  { id: "16ff51af4b144df540844176ad48f4aea1e06ed9aebbf507fa8fe06ef8373fbb", text: "2.甲乙双方开票信息", family: "楷体_GB2312", sizePt: 14 },
  { id: "7f477fa87eb18d3c9bab6e313be451389bd7e19049b403b34f36d35963b0e427", text: "3.增值税发票开具时间和类型的要求：", family: "楷体_GB2312", sizePt: 14 },
  { id: "973595d2ec2ae3a8d9e4f2638a6d38a00aa1b9f7892c936cddf42054749456e8", text: "4.增值税专用发票丢失的补救措施：若甲方今后发生丢失增值税专用发票发票联或抵扣联的情况,则乙方必须向甲方提供该增值税专用发票记账联复印件等资料。 " },
  { id: "c042e59248c1f302ec460b871d7bcc0f25324a0af88669d62a4a9e331b230e99", text: "第六条  支付", family: "黑体", sizePt: 14 },
  { id: "8e5bb377a1e3cec95ab62d941f22efda0069874a4dca118f17302414dd7fb5b9", text: "第七条  双方权利义务", family: "黑体", sizePt: 14 },
  { id: "21801ba254f09589258e22a7e79f2bc9d5f04b6f50bdc73c0f0688973a0ec934", text: "第八条  违约责任", family: "黑体", sizePt: 14 },
  { id: "5cb5a320f36340e15d8c2cf630aab69a65cd0d6abbb6be4787106abc65bbfa50", text: "第九条  保密", family: "黑体", sizePt: 14 },
  { id: "cb5d1f5ccb347f7bfd08be380763c01f307a95ddc7b8103f09cf0d9d4aba43cc", text: "第十条  不可抗力", family: "黑体", sizePt: 14 },
  { id: "22a4a1a16b8b7b2fd153598eb544d881d7f64ad42f577aca14b8b5774890db53", text: "第十一条  争议的解决", family: "黑体", sizePt: 14 },
  { id: "c5fc94628a78370da09383aa2b4391b2f816c7e479afcce2e6fcd3bc16f43ccc", text: "第十二条  合同生效、合同的终止与解除", family: "黑体", sizePt: 14 },
  { id: "76a1a804213c721a7060a9bf6532b0caa61e02b7839a0129cc1388ede86519e2", text: "第十三条  其他", family: "黑体", sizePt: 14 },
] as const;

// Labor V1 changes only the seventeen reviewed main-contract primary roles.
// Titles, ordinary clause and the existing tax sentence are unformatted context.
const REVIEWED_LABOR_PRIMARY_ROLE_CONTEXT = [
  { id: "a6903774adc2a3d687c925c686d1ffb0e91635048d73d3aaf1ea98bb300f8e71", text: "{合同名称}" },
  { id: "28baeddd5d79e521017069ee8a329c587e25f599f634fdd9be65c2dd09b67e4f", text: "{合同名称}" },
  { id: "fa570038683fa0c63594718acb646cdc426ed0a072b790300f8546e3b2498d1b", text: "一、工程概况", family: "黑体", sizePt: 14 },
  { id: "deba9a9078640497b6bfb3c568201e7b5d74c2bfbd9f7f13d8cadbf883dda60c", text: "二、承包范围及方式", family: "黑体", sizePt: 14 },
  { id: "60228df3c5dbbf85ea7e72f68af9d04fde32a4cf8f33bf78101592bbc4c09d75", text: "三、质量标准", family: "黑体", sizePt: 14 },
  { id: "7274c1b0037b62bba350e6e3bbd47f7f072a8d4440e9c59bec03c31ed5465b18", text: "四、材料使用要求", family: "黑体", sizePt: 14 },
  { id: "f34d084771055c549d87f85f04ee7346c6942d5c6faa779d88239b7c37c854ef", text: "材料的使用必须按设计要求，根据设计进行放样开割，材料损耗不能超出定额含量，如超出定额含量，超耗部分的材料费由乙方承担。" },
  { id: "64d6496ed66486e574a4e5f5937095789d53e82d5fab2177907f8aa64d2c351c", text: "五、工程变更", family: "黑体", sizePt: 14 },
  { id: "3fb813481ab7565959d4aebac37d980f551be1634e02518953509fc1fd0ff470", text: "六、开工、竣工日期及质量要求", family: "黑体", sizePt: 14 },
  { id: "07d72637563ca4c8bdd59136de9037eb7ccbc89dba7666435875179c9743dd18", text: "七、合同价款", family: "黑体", sizePt: 14 },
  { id: "298826034afdc7bb047479758631c74f5207b80b57b9e83858e8d9fa20032453", text: REVIEWED_LABOR_TAX_SENTENCE },
  { id: "0a6cc0dd9535d04f1d964bb2866f2e64d04ab857eb52e42ceea5f77a77b0784d", text: "八、付款方式", family: "黑体", sizePt: 14 },
  { id: "035e12c43037c92ed60043c8922423f53183b5aed8f75b7ad4be98db5da4bc58", text: "九、成品保护", family: "黑体", sizePt: 14 },
  { id: "548a81aafee2cf4a8ce71ea31019f01f3a5cc7eaadc07c128088fe8957649bcc", text: "十、乙方承诺", family: "黑体", sizePt: 14 },
  { id: "01fb1fa59e5cb324b2e6a4f91bebd5b10f462618461b556404f5270c4311774b", text: "十一、甲方的权利和义务", family: "黑体", sizePt: 14 },
  { id: "9fa32fadba4b782d825f611b486733af2cc51be7673f3bf84bde1d50923f8ebb", text: "十二、乙方的权利和义务", family: "黑体", sizePt: 14 },
  { id: "d57483c87c6c94eec12eee8a75cc81a34e70d51d5d1fd811430e8719f9690adb", text: "十三、安全与文明施工", family: "黑体", sizePt: 14 },
  { id: "59ebc939f3ce0cc7640368feb60644b215a4efc860e58301e207bf596d793cd7", text: "十四、劳务分包作业安全与环境保护", family: "黑体", sizePt: 14 },
  { id: "47bebaad8f57ead55ef90a873fd71d0bb4dda77e1cdc91781eb38a8478369f30", text: "十五、违约责任", family: "黑体", sizePt: 14 },
  { id: "54b3781e7aa5f0d32079ba6b4461601356359dc7c2adaa4030b4a8a8469416c3", text: "十六、争议解决办法", family: "黑体", sizePt: 14 },
  { id: "b8d1f2882e5cdbd3073a48670b6eb0b6e6477c2ecbe8d67c4b578e9ba17ffb5f", text: "十七、其他", family: "黑体", sizePt: 14 },
] as const;

// Generic V1 changes only the five reviewed main-contract primary roles.
// Both contract titles, ordinary placeholders and the signature-page label stay unformatted context.
const REVIEWED_GENERIC_PRIMARY_ROLE_CONTEXT = [
  {id: "9746a6ed14ac6fea5d17b670c0a63fc4a1e1eb292b2a4fff89018b0064ba200e", text: "{合同名称}"},
  {id: "47a51f568907b470b8a31536fdd818d953a0a58c9c97095e26ca8233bf16e82a", text: "通用合同"},
  {id: "67089b82ee8f3c6da3a1f876a8234c9f2e782df8f935c9fb6b334ac5db4a305d", text: "第一条 业务内容", family: "黑体", sizePt: 14},
  {id: "a68458b8bb2658aaffe03c6263e4b233f861912c8db3b8b2facc177b2f718ae0", text: "{业务摘要}"},
  {id: "08ea54da480ec8176891ed1b631dfcd65ffa2b67d6f66eb38211fb90ad7e0a62", text: "第二条 价款及结算", family: "黑体", sizePt: 14},
  {id: "85096cbbff9f9a9b5391c22e7b2fbd01f48dadde9967e1a1f4ef487a1bb680ad", text: "合同金额为{合同金额大写}，结算周期为{结算周期}，付款比例为{付款比例}%。"},
  {id: "935aa8f8b6e9e47025251c001edf411d12234f02e881c0388569ba5dc03a9af4", text: "第三条 付款条款", family: "黑体", sizePt: 14},
  {id: "bc5f416b751fa032875c85d84d4500140a190ed423b2312aac626a91a4335351", text: "{付款条款}"},
  {id: "e5274f3269b37cc955d7eabbad7dcdb9d4585fb3c7d9f12b0fb6a8d88da995b8", text: "第四条 特别约定", family: "黑体", sizePt: 14},
  {id: "dca22b0216c1b1a140f462c0585bf33131e586a5f963e0f5bd3a1830cdffc564", text: "{特别约定}"},
  {id: "12f6a33727bd5b4cb679989d17d0d7de466bf3ce3dcbdcdfbdf5c50f6146bb4b", text: "第五条 合同清单", family: "黑体", sizePt: 14},
  {id: "f3185df482bbf40c5b438e954a68e6f22c4fa0dfd9aa389e85536eb501ac927d", text: "签章页"},
] as const;

// Immutable44be main-body scope: global source paragraph index, opaque source ID and complete original text.
// Cover, bill-loop controls/cells, signature cells and source blank controls are deliberately absent.
const REVIEWED_MATERIAL_MAIN_BODY_SPACING_CONTEXT = [
  [26, "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", "{合同名称}"],
  [28, "79a1751d0a82c9a7ef86c0a54731b5e03252b7c7c1ee72fa477d2cbd269b0490", "买方：{甲方名称}   "],
  [29, "431dbe2475eb5bad22244a93ad5072324f064e76e219effd9b78d4b3533b008b", "卖方：{乙方名称}       "],
  [30, "44c7d1eb0aadd363a9d5749eab000e83ef8b34e08d4c3ee2817c37886885530a", "经买卖双方共同协商，根据《中华人民共和国民法典》及相关法律法规，遵循平等、自愿、公开和诚实信用的原则，双方就{项目名称}买卖其他消耗材事项签订本合同。"],
  [31, "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72", "第一条  货物名称、规格型号、数量、价格等"],
  [50, "aaf2d332db692ae6a5dac7bf93627e44d3ce8cfccf46167fda970974b27ec436", "1.本合同暂定总价（含税）：{合同金额大写}。适用税率：{税率}%。"],
  [51, "1effe94f5d3806f8196c84327e1d3cfb78f32617db7ea9d0216933674478f9c7", "2.本合同的数量为暂估，以实际交货并经验收合格的数量为准，当合同执行数量不能达到合同签订量时，以合同执行数量结算，卖方自愿承担合同签订量未发生部分的风险。"],
  [52, "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522", "3.合同履行过程中风险处置办法"],
  [53, "32767112a0ce3a421e2effc60979f7478f576a07006c02385c336712bcef3afd", "（1）此合同单价为固定单价，不因市场价格波动和供应数量变化而做调整。"],
  [54, "9d29284a0bfd6179e69d449e7b1961f19218aee7433b8602f076b2db68a4be37", "（2）当市场价格波动在±5%以内时，单价不作调整，由卖方承担或受益；当市场价格波动超过±5%时，双方另行协商签订补充协议。"],
  [55, "0c51f67b5b926f358bd564ca438a2a00e852308e69ec96bfdcf159beca00e218", "（3）其他 ：     /     。"],
  [56, "9ae9934ff6f56c739a574b7a698482ebe0ef2817a9dd4582a2afb223b0d68321", "本合同采用  （1）  条执行。 "],
  [57, "0c7811d6781c57854c790e57e91a832dc64cd225ad6f86ca6fc95015c1b9bf32", "4.本合同单价为综合单价，包含货物的出厂价、运输费、包装费、运杂费、装卸费、服务费、损耗、保险、利润等到达买方指定地点交付前的所有费用。"],
  [59, "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120", "第二条  质量技术标准及相关要求"],
  [60, "cb7ea4a6ea66c056c42de7a9af44effb033b52f9a012df17c3ba54f0d64372cf", "卖方所供货物必须符合的质量技术标准及相关要求为：{质量标准}。"],
  [61, "039bb580de810755a55899ee448ff7640b3799cfe619ce0e0c82d2b3ada831bf", "第三条  交货时间、方式及供货期间"],
  [62, "1cb6fca93d124a9ecff9c53fd0142b159f33c69f6846414d3128a9e42f269e73", "1.交货方式：卖方送货。"],
  [63, "6cd4338310aaf37c804f182a2a17c2ba98af3e2e5e1ac9d145e90244acf5d2e9", "2.运输方式及费用：由卖方负责运输，运至买方指定交货地点，卖方应自行选择适宜的运输工具及线路安排货物的运输，运输费由卖方承担，有关费用已包含在合同单价中。"],
  [64, "eddce3c3ad83b9ad8afb63871b192ae322348fdfea99edef6d0fdd1958b37d21", "3.交货地点：{交货地点}。"],
  [65, "7ce9f25637711b6dbc82a78417a48efde69eb4c25b0e95ff467d4a5447af1dac", "4.卸货：货到指定交货地点由卖方进行卸货，合同单价中已包含此卸货费用。卸货堆放按买方要求执行。"],
  [66, "63b8718366d2a07e79358c44f47545df23c2330071f751828f98c96f7aa031e7", "5.供货期间：{交货期限}。"],
  [67, "8caefbe82c68cbd87400f11922fd05252bc1efc6606b78a1cde1b7cf8ae7fcc6", "6.交货时间：具体供货计划及时间以买方通知为准；买方需提前  3日向卖方提交《材料批次需求计划表》（附件2）；卖方收到买方的供货计划通知后，登录微信小程序“建投供应商门户”中确认发货数量，并根据买方的供货确认单要求 2日内将货物送到买方指定交货地点。"],
  [68, "f26a569b8bf62353534a9ef66e42186b0fed4c8c076c7ed9e62c5bc8ab79febb", "7.货物交付给买方之前包括运输、灭失、损毁在内的所有风险均由卖方承担。"],
  [69, "3e8a650210ab5f8b52981a421514a6a5a78798ad9e81273da0719a1c71377d72", "第四条  货物的包装标准和包装物的提供与回收"],
  [70, "1fd014dedf30894338f5d656019408a5c7db89f0010939e5a2a5cc76c602e28b", "1.卖方货物的包装标准应符合国家及行业的标准。货物的包装物由卖方负责提供，买方负责回收和处置。包装物费用如合同中没有特殊说明，不得向买方另外收取。卖方如果对包装物回收有特殊要求的，应在合同中明确，否则买方有权自行处置，包装物如需回收，由卖方负责回收并承担费用。"],
  [71, "d125754b3deef289353dd076a807c4b695245a1949133988d708952e05b03ea2", "2.包装应适应运输、装卸、防潮、防晒、防锈、防腐蚀、防震动等需要，确保货物安全无损运抵合同交货地点。"],
  [72, "9064f42005092444fed3adda9c53cddc3ca84692909d94cb507c42c81acb55ed", "第五条  验收"],
  [73, "b1b4d398b6de87bd3a6a7b29a0b6d08ddcee600782ca3fcd44cfd143bee8e17d", "1.货物发出前卖方应根据国家现行相关标准及合同要求对货物进行全面检验，检验合格后方可发货，并向买方出具相应的发货凭证、检验及质量证明等资料作为交货的初步依据，未按买方要求提交资料或提交资料与所供货物不相符的买方有权拒绝收货或拒付货款，造成的一切损失由卖方承担。"],
  [74, "ac328837c96accb7aa3ff7db00b7bd5223aa77b6a84e4793abcb0d9a176b3624", "2.数量验收"],
  [75, "27c799de098362e7729209dc6da6cc4907ded5ee8d580b35ea7ec541319a7ff0", "（1）计量方式： 点数、过磅、量方 。"],
  [76, "bf8ce46baf485a9e051dcf59c61f9a1e277c5bdacb24ddc8d4aba2e2a6ccbbdd", "（2）买方对验收数量存在异议的应及时通知卖方，如卖方人员未在24小时以内到现场清点注明实际到货数量，或者未与买方共同选择第三方复磅的，以买方确认的实收数量为准进行验收。"],
  [77, "de98f02131af525488a5d73adc8b5265dd27d5d150ab923c85be438b215de38a", "3.质量验收"],
  [78, "45d7a092477ede1777a67147bdaa92d117e8adfea1058d9054ce54d1ea9803e2", "（1）验收应依据相应的标准和技术规范进行，质量验收以检验及质量证明资料为依据，并由买方对货物按照规定复检。货物的检验必须符合国家、行业现行标准规范。"],
  [79, "4d69687c418ead2eea45a50828a2d79d50a38f8cbeaa4eb60d7f173ba4675b1c", "（2）买方复检以买方及工程建设相关方认可的试验室检测结果为准，复检存在质量异议的，买方向卖方提出异议和处理意见，对质量有争议的货物进行封存、不得使用，卖方在接到买方异议后，应在 3 日内按照买方要求负责处理，否则即视为违约，买方有权自行处理，造成的损失由卖方自行承担。"],
  [80, "55a1b44a2b51729ce53b65fd2537186b20374c2c47a69f62b38965a3c94eb607", "（3）卖方对买方复检结果有异议的，由双方共同对存在异议的货物现场进行见证取样后送第三方进行终检，以第三方进行终检的应选择具有法定资质的检测机构进行，终检结果对各方均有约束力；若非卖方供货质量问题，第三方终检费用由买方承担；若为卖方供货质量问题，第三终检费用及造成的一切损失由卖方承担。"],
  [81, "a0f32cd1925295bb18d07ae096690e6826b44f2784529cb911452c5e6659eb8f", "4.如验收不符合合同要求或经检验货物质量不合格，卖方必须无条件接受退货处理，在限定的时间内重新发运符合要求的合格货物，并承担由此发生的所有费用。"],
  [82, "019eceabc15761845db572636401d0c4f7a53c570f1a0e9b9da7db5f4caef887", "5.货物验收须经本合同买方书面授权验收人员签字确认，且验收的效力不等同于每次货物结算，结算以本合同约定的结算条款为准。"],
  [83, "c304458c5b6370945c073459328e6fb96b6c7470abbfc4d88af49110035cc7e1", "6.买方对货物的验收，并不视为免除卖方对货物质量和技术应负的责任。"],
  [84, "19d6291bf8a6d3c14d54a89f30c950adcf15a12764690ca459c65f53ef3eb075", "第六条  货款的对账与结算"],
  [85, "197542092b970525a15d25bb6db169c527d3c1b94dcc1ad95680595c106d7e34", "1.结算方式：{结算方式}。"],
  [86, "6bd1e1d4e59ca7fa63b6655dfddc81921c3cc944ce5b09563313882d2b1e0a8c", "3.货物的结算须经本合同双方书面授权结算人员签字，且经本合同买方内部结算程序确认，否则不作为支付依据。若指定结算人员发生变更，应及时书面通知对方。"],
  [87, "949e3a799b304e747af4890355d0ca1a5b3419ed543b5c915b60419d35843e32", "4.过程结算中，买方以双方签署的书面过程结算单作为过程付款依据，无书面过程结算单的，买方不予付款。"],
  [88, "27f4e50d43820ae3e3813f3335a85143dbde31fda70521ffa5be2e0a8fafbe90", "5.本合同过程中办理的过程结算单、对账单及任务书均不作为买卖双方结算的依据，仅作为过程支付进度款/材料款的参考。最终结算单应在合同履约完成后30日内办理完成。最终结算单须由卖方法定代表人或授权代表人签字并盖章，最后经买方物资部负责人签字确认，否则不作为本合同最终结算依据。"],
  [89, "cdf75c63c8c9aef0eb71ba8cff41b17ea00c36095267fe03012a25d59000d65d", "6.卖方未在约定期限内与买方办理最终结算单的，买方视为卖方知悉并认可将卖方截止退场后30天的累计收款数作为卖方的最终结算金额，由此造成的后果由卖方承担。"],
  [90, "ed1c4dae970bc5e54565252af8870fc600f06f9a5c8bf0e2dd3ed7f8e9da5f2d", "7.买方与建设单位的结算结果与卖方无关，不作为卖方与买方结算的依据。 "],
  [91, "a0f5a2e8f22c196835b7d085893c7d47523fdb72475fa3cd4101d06f0698fbe3", "第七条 发票有关事项"],
  [92, "f3d1db644cc6e0da0f1120775662aaaf05f5194b83a26e35c2215de003779c64", "1.本合同计税方式：   a  。"],
  [93, "4e1c8d9470a0a74c238e5ebb03769b2ccf2e621074903af814475074aac13eb7", "a.一般计税项目；b.简易计税项目"],
  [94, "6be1a8bfe0211957fc11a8861ae6d8ec35d589a78056d57e5ea78c3544116e0d", "2.增值税发票开具时间和类型的要求："],
  [95, "b671d05d10f7fefc5951b0f45a091de689f10aa5af52b6d60fe8b981709cac0a", "（1）增值税发票开具时间：卖方应在与买方办理完对账结算,并接到买方通知后，在30天内向买方提供增值税发票及发票真伪查验单以便买方办理付款手续。增值税专用发票抵扣联不可折叠，不能污损，密码区不能出格、压线，盖章不能压住发票金额，字迹清晰。如卖方未向买方提供发票，买方有权停止支付货款，卖方不得以任何理由索取欠款赔偿。"],
  [96, "019411da046e524ec40a6dc0a8fa9cd4e196c087cfed9cf1cc6444dcf88baa3f", "（2）本合同增值税发票开具的类型：  b   。"],
  [97, "695c2b74a41b68e204506c2a2d3748d9b824a58ebd95da8a7e4e56e8a162b85c", "a税局代开；b自行开具"],
  [98, "cfa864f5a668943aa3ecd1f821d224acb2674457cee55d20a4a4fe74f67deb82", "（3）本合同增值税发票开具的票制：  a   。"],
  [99, "c182e3aa6d647ff9489db0921000ad9545e8b391d4dedd6d0bde309374410b36", "a.一票制；b.两票制"],
  [100, "df95846576c61524721e504ad152e2443f2c9dead93cfa3d991f9eab823b1c3e", "（4）卖方提供的票据类型：    a   。"],
  [101, "1f67eb32db4886bad989de493f9075555f77bbd6357de74a37362bc2335e0b95", "a.增值税专用发票（税率为  /  %）；b.增值税普通发票（税率为  1  %）"],
  [102, "0da291f6b0ed93bac18ab63bd6e8d4d23105911f197a8bdf5c04c9ef481c87f7", "（5）买方不接受卖方提供开票日期超 30  天的增值税专用发票。"],
  [103, "77815ccbc432c2dce43ea698afb20935dfabbf21cb064509bc351afd51ee720a", "4.若卖方提供增值税发票开具的货物数量为一批，必须同时提供防伪税控系统开具的《销售货物或者提供应税劳务清单》，并加盖财务专用章或发票专用章。"],
  [104, "19d19f7bd96a4e831b092331e6849e265b5a4fbc18ed92214c6dc8ac68b48722", "5.增值税专用发票丢失的补救措施：若买方发生丢失增值税专用发票发票联或抵扣联的情况,则卖方必须向买方提供该增值税专用发票记账联复印件等资料。 "],
  [105, "e76ea29ea3104117f34a138084476b55b2c88edf0020d0c396c5dabd50281b92", "6.卖方提供的发票不符合买方要求，买方有权拒绝支付货款，直至卖方开具合法有效的发票给买方为止，且因此产生的迟延支付不视为买方违约。卖方不向买方开具符合法律规定发票的，应承担包括但不限于税款、滞纳金、罚款等相关损失的赔偿责任。"],
  [106, "7f9a3913e129179625ebb152021f5b0b10ff1cabee30d50ec370628604c2bb8b", "7.如卖方不能出具发票，买方有权代开，卖方须配合提供代开所需资料，代开产生的费用卖方同意在结算价款中扣减。"],
  [107, "2c826e852d602325aa2ff9c9a2de9002c5b32f34da29569f542ab095b4ed2cbf", "8.卖方所提供的发票必须与签订合同名称一致。若卖方债务重组、工商注销，卖方应提供相关资料。如因卖方的原因导致买方无法付款，由此产生的经济、法律责任由卖方承担。"],
  [108, "ceecc16852ac1d0b47b4a95b36af279e7f12309ec679d564876eca7f1a68d083", "9.特别约定：由于国家政策的调整引起的合同相关要件的变更，将以国家政策为准，以适用国家政策规定。"],
  [110, "58ff088727aa74cd1bb34b02c2033a4ae30acbd278505946b15aab0ef3bd2352", "第八条  货款的支付"],
  [111, "0a52c280717930457fa3b5db8e263959596589ba4356e287ebf4ac0aa9572b60", "1.货款支付：买方依据双方共同核对签字且经买方内部结算程序确认的结算单及相关结算资料及对应开具的发票向卖方付款，发票不得单独作为结算依据。"],
  [112, "44323bfb6bf12871e5fc5ac6a37641a249f02d0fada679193030ef1e7ac823c7", "2.预付款：  /  。"],
  [113, "0c839cb398517db0cf9bb9c37b11eb4383bb5edd81d3a0a488cfebf3d1a9b6e4", "付款：{付款条款}"],
  [114, "4c075f6fcba73ce0b64f9446fdf861b6dad6b4d6505cad62059e3cb06db9bf1a", "4.本合同价款以人民币支付，买方以网银、转账支票、银行承兑汇票、商业承兑汇票、信用证、供应链等方式支付货款，卖方须积极配合提供银行相关资料。若支付银行承兑汇票的，则贴息费由  /  方承担；若支付商业承兑汇票的，则贴息费由  /  方承担。"],
  [115, "5974aaffecfdc48cfbf5860bea3dbc3fbb05532cfb2711183d72213077281877", "5.款项支付至合同约定的收款账户，收款账户名称必须与合同卖方名称一致。"],
  [116, "47e8c9d61530eb0b0f01c069039d5e72767840d5011fc6823254660071972b3a", "6.买卖双方共同承担建设方资金支付风险，若建设方对买方的款项延期支付，则卖方同意本合同项下所有相应款项向后推延至买方收到建设方工程款，在此延迟支付期限内不视为买方违约且不计算逾期资金费用，卖方不得以此为由中断本项目的货物供应。"],
  [117, "cf399631f75a00982d8b4470713ea667127dec856592651bff83cb578e798032", "7.卖方须保证专款专用，买方有权监督卖方的资金使用。"],
  [118, "a17506241d1a2cb53df88aefc5cecdf926f2e2d55d1f2a4dc96e71afecd9c986", "第九条  质量保证期"],
  [119, "e9750c2088c86e0c836732c4a2d3c22391247eab2be904f54b392f6b9a79704f", "1.货物的质量保证期为  一年                      。"],
  [120, "ca76a1e01c5dd49e4c5ba4fcd40feee93901e26644b7de75452308604f581fa9", "2.非买方原因货物在质量保证期内如破损、变质或被发现存在任何质量问题，卖方应负责对货物进行修补和退换，并承担由此造成的一切损失。更换的货物的质量保证期应重新计算。"],
  [121, "73f214e6073fd1a737e25c94b3c4c09670d717b346248f51cbd91430f176a972", "3.在质量保证期内，如果卖方未能按合同规定履行义务，买方有权从质量保证金中取得补偿，如因卖方违约质保金被买方扣除，卖方须在被扣除后的7日内将质保金补足到与原金额一致，如卖方不补齐的，买方有权在结算款中扣除。"],
  [122, "aa99e0cb52e990b1edf2e042229abc99afc7a1bece3057bd90cd13f9fcf4b26e", "第十条  相关服务"],
  [123, "3590f75838618f03b810d4a0c363676acd82020751e97af128706c7667a7a98c", "1.相关服务是指卖方应提供的与货物有关的辅助服务，包括但不限于解决货物存在的数量及质量问题，以及为买方检验、使用和修补货物进行的技术指导、培训、协助等。买方要求卖方派专业技术人员到施工现场进行相关服务的，卖方需24小时内到现场进行指导。"],
  [124, "a7a419eac94aff9b13b76917119665d581423dbac1b4e08d362862014875156c", "2.卖方提供合同约定的相关服务所发生的费用已包含在合同单价中。"],
  [125, "7f0d726cb8f91a58e32ecbe40427f0032602444590ff2aa52b44f86d85918798", "3.卖方应配备充足的技术人员，并根据买方要求，通过进行电话联系或派遣技术熟练、称职的技术人员到施工场地为买方提供服务。如果卖方技术人员不合格，买方有权要求卖方撤换，因撤换而产生的费用应由卖方承担。"],
  [126, "9a4dd4b94ff91a8ffd1db6d32a18cbc29bbe5387c39f4bbe0937a30acfd1bc28", "4.买方应免费为卖方技术人员提供工作条件及便利，包括但不限于必要的技术资料及出入许可等。卖方技术人员的交通、食宿费用由卖方承担。"],
  [127, "1b3553e4c646773f99f4a4983be098d476045104186bfdfb95a6f06bf15ac4c0", "第十一条  履约担保"],
  [128, "e023101a406fcbf76f49b76dd24e7166e681d6016dd717e66d2f2136a33a41eb", "1.卖方不需要向买方提供履约担保。需要提供的，履约担保的形式：        /     ；履约担保的金额：           /           。"],
  [129, "3624d27c586728cb677687dfa6f51359406e1d5b0442ed0bf96722da17abf701", "2.履约担保的退还：        /             。"],
  [130, "8d356cdc5ebfbb141351410cfbf8c96216214cbe87e7ea82bea57066a9891902", "第十二条  环境保护及安全要求"],
  [131, "e8b8fb8d8d1547529ff535be95f7ff16939fc3602708774fcac722e740895074", "1.卖方所供货物运输车辆在运输过程中，必须自觉遵守交通规则，严格按照道路交通管理部门规定的限高、限重标准运输供货，不得给沿线道路、临时道路或其他设施造成影响。在货物装卸、运输中应做相应的环保措施，应符合国家环保要求，对货物装卸、运输途中所发生的一切安全事故、环境污染或使第三方受到影响，均由卖方自行解决，并承担相应的责任和经济损失。"],
  [132, "ad8f70463268c3f048f664392e048c2ac1d54a0b51df0cda543bba6f58e239d4", "2.卖方运输车辆及人员进入买方施工作业现场，必须遵守买方现场相关的安全制度，服从现场管理人员的指挥，遵守买方现场文明工地等有关管理制度。对不听从买方管理的人员、车辆，买方有权清理出场。由此造成的全部损失由卖方承担责任。"],
  [133, "d77d9339e2aabfd8d78bddf9e95caa7c7a19d8b63aa7612752c33875b89004ea", "3.卖方必须对自身出入工地现场的人员进行安全交底，自行配备合格的安全帽和必要的防护用具，在现场因卖方过错造成的人员伤害和财产损失由卖方承担。若卖方车辆在场内外运输及卸车过程中造成买方或第三者人员伤亡或财产损失，卖方承担相应责任。"],
  [134, "af6c147c1072b33614675f968841ca2d2e2d6c48f63c0d01e57125caa2ea2ea6", " 4.若所运输物品需要覆盖或密封时，卖方应按国家规定做好车辆及物品的防护措施，进出工地车辆不得污染路面，车辆离开工地时要进行清洗，否则造成污染或其他责任由卖方全部承担。"],
  [135, "298638d8f1c292f771cc8a58b5f7f7c571ed54c05e7951186fe7b60c090a4e69", " 5.卖方运送车辆进、出施工现场要服从现场管理人员指挥，车辆驾乘人员应正确佩戴安全帽，注意行驶安全，配合现场管理人员进行材料堆码，保持现场整洁。若因卖方责任发生安全事故，由卖方承担责任及损失。"],
  [136, "b9566e48f41d4e2f99d23ed0ad2526cb63e48f1382fff2e70396478e88ac193d", "6.材料进场后，因卖方供应材料存在隐蔽质量瑕疵引发的安全生产事故，由卖方承担责任及损失。卖方不得以买方已签收或在收货后未提出异议为由而拒绝承担相应的责任。"],
  [137, "bf25bcd6c599decc20c375ae45aecc75bd5a73e5ab7174ca93bf1fdfa8a75470", "第十三条  廉洁条款"],
  [138, "6a72972f29022414ff66c4a73898b14ee12858e959690c8c5d0922d74b2a8ea3", "1.双方的业务活动坚持公开、公正、诚信、透明的原则(法律认定的商业秘密和合同文件另有规定除外)，不得损害国家和集体利益，发现对方有违反廉洁规定的行为时，有义务提醒并有权利制止。"],
  [139, "db5d71c050a27a32e03c344ffae771a0d7ea0949fc3a1e79704e1ff848e9e30c", "2.严禁买方人员以任何方式明示、暗示卖方请吃、请喝、收受卖方礼金、礼品或接受卖方提供的其他私人便利或利益。"],
  [140, "8968895e514b9b2dbdef768438fcdd33ad6d1eea54ef4f35c2de66b366a0c8d4", "3.严禁卖方以任何方式向买方人员提供私人便利、行贿或进行非正常商务宴请。"],
  [141, "83d59eb52c32699fa63475d380aac6eb0c17e0eafe7411b51456fc07dbe930bf", "4.若卖方违背上述规定且经买方法人单位或其上级纪委监察机关查实认定，或国家司法机关立案查处，视为卖方违约，卖方承担暂定合同总价的10%的违约金，违约金及卖方因违背廉洁规定行为所取得的不当利益一并在结算中扣除。"],
  [142, "4541bd2de1e5b14bb00626ee5e13bb7d9a153ce9747c476a6cc876d0acac46d5", "第十四条  双方的权利和义务"],
  [143, "44d0ab6686fd7717df52502628343e16a7d907b3c3ed3cf172fad0a9c43d8d54", "(一) 买方的权利和义务"],
  [144, "2653c48f52fcd99a008eccc43e8d2659d6fee9ee419234a6d230cc9b84cba30e", "1.买方负责提供供货计划和准确的交货地点，应在进货前将货物批次计划提供给卖方，并将变更及时通知卖方。"],
  [145, "4806ab7ac4cc5be1d70566ea14a5c63faf34831b38171a3a8e9de42b7a89e110", "2.买方应按合同约定支付货款。"],
  [146, "1db40a2f5bf8d02f55091f141abeaf0db1cff574447ddbee3c3733746f3cf98f", "3.买方不得无故拒绝接收供货计划范围内的物品。"],
  [147, "2f1e270cc88862ba3df9d9c30244ffcee47ddfef7e4caf0bd89b6069942a62fd", "4.买方应按合同约定对货物进行检验和验收。"],
  [148, "52aa6887ad565313ea22bea214026bb964451ba9dbfdd9d53c4af7402f5bbf86", "5.买方有权拒收卖方未按合同规定时间和要求、未提供材料出厂检验合格证书或技术资料的货物，并按卖方不能交货处理。"],
  [149, "f70d27b13659ddacb8da87c57bba27f13ae0e454f65d901541ab193ffce2e983", "6.买方有权对存在质量问题的货物进行复检，并在收到复检报告后5个工作日内向卖方书面提出异议。"],
  [150, "4b81538108b44fafd753ebd9fd3b976ca361a92e3d9fa91cc6ec26a3596b88e6", "7.本合同约定的其他权利义务。 "],
  [151, "59c0e04d0d5b8eb4190bcf282128d1e5bcf839fcf7580a4a09387f5d57e8763d", "(二) 卖方的权利和义务"],
  [152, "9cf14e4b5ec22f8c90e65b81f56bd0e94a2a2549570024d68e00e39fee2aceb5", "1.卖方应在规定的时间内，准确无误地将货物送至买方指定送货地点，并提供货物相应的检验报告、质量证明资料等，同时配合买方验收，共同做好签认记录。"],
  [153, "1d2214e0ff2e2a5d46fbfd656137d67e9e7271cb3ec40785a1e053553255cb79", "2.卖方应做好所供货物进场工作，保证顺利卸货退场，确保供货正常进行。"],
  [154, "179701f7f2d28f734c4caf738fea0567cd1aa8dbb56442881be88a90decbb907", "3.卖方有义务协助买方调剂非卖方原因造成的卖方所供应的多余货物。"],
  [155, "3d8853ea37f626f9862fb0cfbf020bbac67d296841610d145064d0e572e091ed", "4.卖方保证其具有完全的能力履行本合同项下的全部义务。"],
  [156, "c7fe57e31d0c2f2b38de4ce758993ffcea6417e2782bdd9fb8398d0ca20df277", "5.卖方保证其所提供的货物及对合同的履行符合所有应适用的法律、行政法规、地方性法规、自治条例和单行条例、规章及其他规范性文件的强制性规定。"],
  [157, "2e70fdb2c86efb9466edce736a00207c3650b17b38be054add282538ddbed5f2", "6.卖方保证货物符合合同约定的规格、质量标准，并且全新、完整，能够安全使用。"],
  [158, "120da67ce58934073e269d5c1c8e8d6cb0904a78bfcb6ce46f05e79172534436", "7.卖方保证，卖方所提供的资料完整、清晰、准确且真实有效，符合合同约定并且能够满足买方使用货物的需要。"],
  [159, "93eaaca60163c8adcd89fb02244550bc9f68de5d26eea8fd773354e2fc8d152a", "8.卖方保证，在货物使用寿命期内，如果卖方发现货物存在足以危及人身、财产安全的缺陷，卖方应及时通知买方并及时采取修补、更换等措施消除缺陷。"],
  [160, "b9a88f3c53b3a985eb67d80d50289614580e078b2d3c4a71f58f2248c58d6550", "9.卖方在接到买方提出的书面异议后，应在2天内负责处理。否则，即视为卖方默认买方提出的异议和处理意见，所发生的一切费用和损失由卖方承担。"],
  [161, "59148173f9965b7717607ff78f48688f463356d3081a0885c7314bd6c5161780", "10.卖方保质保量提供服务，所供货物质量符合国家标准及相关规定。"],
  [162, "f384e6e3540b55f3b6efb74d4512748b2852b372a027c0e9265e8c45578f250b", "11.卖方应在规定的时间内，准确无误地将货物送至买方指定送货地点，并提供货物相应的检验报告、质量证明资料等，同时配合买方验收，共同做好签认记录。"],
  [163, "aff7adbbb40c8ccecaaa6712a8b95a6d72b1182b3804a63fdf86705398a6cc48", "12.因卖方违反本合同约定造成买方受到相关部门处罚或者对任何第三方承担责任的，卖方应当赔偿因此给买方造成的全部损失。"],
  [164, "e5508e8bf4c11ff6199445650302ebbc789bd189e29c429d914e24cb16e7e1ab", "13.卖方违约的，除向买方承担本合同第十五条约定的违约责任外，还应赔偿买方的一切损失包括但不限于买方为主张合法权益而产生的律师费、保全费和鉴定费等。"],
  [165, "ce035d2ac1a285ba1ab1ca8821c2529e56d4c65b2a1d007694456948982c9794", "14.卖方应按合同约定提供技术咨询指导。"],
  [166, "0164011bbe1d2e4dad1439d0f666062f2d9789c25e89a6b3fc4571727f4119f2", "15.施工过程中，买方与建设单位办理签证及工程结算等相关资料时，卖方有义务配合。"],
  [167, "be39c87ed5bcf7199b704bb9ecca49f61aa01628c25b866ddcc5033915d4b451", "16.本合同约定的其他权利义务。  "],
  [168, "1d0ac78debd74f3cf2357007d8268d754fe4041d64a521b07dec5519f2139989", "第十五条  违约责任"],
  [169, "2fc2a09be01712729089910636396dbca8bc29ebf23c77919bd1e6f5e51e41d9", "1.不符合本合同约定情形或未经卖方书面同意的，在已发货条件下买方中途退货、变更交货期、拒绝验收或接收货物，视为买方违约，如对卖方造成实际损失的，应向卖方支付对应批次货物价值10%的违约金。"],
  [170, "58afed9c2605263bac0346ff73d720f1751c6da4e139e46b6f82d624a5eb63e7", "2.卖方原因导致供货质量不合格、未按约定的数量、时间、地点交货，买方可以采用其认为适当的条件和方法向其他供货商采购货物，因此产生的超合同价格差及给买方造成的其他损失由卖方承担。"],
  [171, "dab3e4ed2ddf92ad21ff3867370e8397f73d68861e9dc3445a391a23191acd49", "3.卖方原因导致未按合同对应条款交付货物的，买方有权从履约担保、质量保证金或货款中扣除对应批次货物价值10%的延误违约金，同时买方有权要求卖方承担由此给买方造成的全部经济损失。"],
  [172, "112f9be250e0deb3d1ae9287125bb26e7e1c12dd72ca2993ff9f4b5423a5a917", "4.卖方违反本合同“第一条”约定发生供货数量问题，买方有权按抽查数量不足之日前所有未复查（已处罚数量不重复计入）货物供应量乘以误差率在结算中扣除，并由卖方承担复查费用和支付本批次货款10%的违约金。"],
  [173, "4ddf4fdce35254cae89f996faf4524089f58c3ffb4218a39cc20a1468c293510", "5.在合同执行过程中买方若发现卖方弄虚作假、采用欺骗手法虚增数量或以次充好的情况，均视为卖方违约，买方有权解除合同并可要求卖方赔偿由此产生的所有损失。"],
  [174, "998a3553ef61f59beea5dade9447369df0d85d7f82e439c7e756b08ef850ba79", "6.买方不定期对卖方提供的货物抽样送第三方检测，若由于卖方原因导致供应的货物造成工程验收不合格或买方工程无法竣工，一切损失由卖方承担并负责赔偿。买方有权从应支付货款、履约保证金、质量保证金中扣除卖方违约金以及给买方造成的损失。"],
  [175, "b254478fd3408c87aa732a4fe8886f4184417f325fae889cbf85a939eeb4f961", "7.卖方保证提供的货物、服务及资料不侵犯任何第三方知识产权和其他任何权利。任何第三方提出侵权指控时，卖方负责与第三方交涉并承担一切可能发生的经济上、法律上的责任，由此给买方带来损失的，卖方无条件予以赔偿。"],
  [176, "5cb213dd24e78bc83b3341c51be22a31cf1ee096c5725d48b871abb2eec7ee66", "8.若卖方违反本合同“第二条”约定发生供货质量问题，应向买方支付该批次结算金额30%的违约金。"],
  [177, "0b99a051ab7a63792d935176005831b3a796346255b25a0ea425b8e16f5ed835", "9.若卖方未能提供合同约定的技术咨询指导服务导致项目出现损失的，卖方向买方支付该批合同结算金额5%的违约金。"],
  [178, "8cafa1c8c733492abdf7043304704ae0c03de352b2fd45eea22017127e526ef1", "10.本合同约定的违约金不足以弥补买方损失的（包括但不限于：工期损失、另行采购的差价、律师费、诉讼费、保全费等），卖方还应承担损失赔偿责任。"],
  [179, "194528caef0abf02aed2731ef6f75cfc8dc23be8f4696ab8cba06f93f1b69e80", "11.确因买方原因未能按合同约定向卖方支付款项的，卖方自动放弃对资金占用费用及利息等费用的主张。若该条款违反法律强制性规定的，则双方同意按合同订立时银行间同业拆借中心公布的1年期LPR贷款市场报价利率计算，且逾期利息总额最高不超过逾期付款总金额 1 %。"],
  [180, "d1540407cb236b11a00d3ba56a3cf03c014c2071ec34600ead2cead537910f04", "第十六条  保密"],
  [181, "ffcb1a05aaa7e8b03279fa39644b8b71a0681e9f76c856df86f7bdd961358261", "合同双方应对因履行合同而取得的另一方当事人的信息、资料等予以保密。未经另一方当事人书面同意，任何一方均不得为与履行合同无关的目的使用或向第三方披露另一方当事人提供的信息、资料。"],
  [182, "9dccecdf0a84fd400b8a35dc8ea32c50e74641fced9f0ad15d9798392ec340a7", "第十七条  不可抗力"],
  [183, "19ac4c4ba3ed6ab2496f60103edaa37faa3bb2a4bc14fcb725c2d0fe3804c512", "任何一方由于不可抗力的原因不能履行合同时，应及时通知对方，以减轻可能给对方造成的损失。遭受不可抗力的一方可以延期履行、部分履行或者不履行合同，并根据情况可部分或全部免予承担违约责任。若一方因未得到及时通知而导致损失增加的，则受损方可就增加部分的损失向另一方要求相应的赔偿。一方迟延履行后发生不可抗力的，不免除其违约责任。"],
  [184, "b7d7e75afe728e71dd0deb3f77094c83befb99b73229beba8c71670667ddceb0", "第十八条  争议的解决"],
  [185, "c504fdf29ec25d7550409f8eac18229377b2412ca4c3ae31ffb2e11a16cf5f1a", "因本合同引起的或与本合同有关的任何争议，双方可通过友好协商解决。友好协商解决不成的，任何一方均可向合同签订地人民法院提起诉讼。"],
  [186, "47ed4b1e12d481f93d46b90f4680d85c23335d96bd18824547e4760127b63bd4", "第十九条  合同生效、合同的终止与解除"],
  [187, "f66a8f79a7880779af3e8b3251300efe2ebfb2e7bc380427eea6f283e32eaf84", "1.本合同应在双方法定代表人或其委托代理人签字并加盖法人公章或合同专用章（不含部门章、直管部（分公司）章、项目部章等公司分支机构印章）后生效。"],
  [188, "148df8301263c500e283015f1326f16e82bf539b2fb902f98af8330fed590837", "2.当合同各方完成了合同中规定的责任和义务，合同终止。"],
  [189, "5a37f4701558eac3aaadb631d989b73996b1130dcf363b6cca837eb57f9be25b", "3.一方迟延履行超过30日或者有其他违约行为致使不能实现合同目的的，守约方有权解除合同，并追究违约责任，合同自解除通知到达对方之日起解除。"],
  [190, "8b3e06845787bae91c7b40de0630b7e3819c1f145c5afebe931f133b89533514", "4.若合同双方协商同意，合同可以在任何条件下终止与解除。"],
  [191, "ea167c28c6a36eae4b6029c2e16d643c12b2623b16b7064afe5d59cf74c1742d", "5.合同终止与解除后，双方应遵循诚实信用原则，履行通知、协助、保密义务，双方未履行完毕的义务不因合同的终止与解除而丧失或减损，负有义务一方仍应如约履行。"],
  [192, "ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", "第二十条  工作联络"],
  [193, "463ab1e5ff371f1eb9cf8636c0e3cdf9a11e929e439a57cc07f0df5ffeb251f1", "1.买卖双方应就合同履行中有关的事项及时进行联络，重要事项应通过书面形式进行联络。"],
  [194, "78794bb119e7439510ea23f117cc494318f0dd5730b6d7caa4c444a6fc2d7361", "2.书面形式指合同文件、信件和数据电文（包括传真、电子数据交换和电子邮件）等可以有形地表现所载内容的形式。"],
  [195, "7551ee090ac74d72775135f4316553b4d0a353c2dccfd369ef996be28bcbf85d", "3.双方工作联络方式及相关资料送达的约定，以书面形式告知对方。工作联络方式包括联系人、联系地址、联系方式等。相关资料包括但不限于计划、订单、价格确认单、结算单、发票、合同、通知、函件等文件的签收和送达，以及就合同发生争议进入诉讼程序后相关法律文书的送达。以上约定发生变更时应当在48小时内以书面方式履行通知义务。"],
  [196, "8612ac838c3965a150d63f65bdc87b3b758ec008b63567c13f48a2b4dca61fb9", "第二十一条  其他约定事项"],
  [197, "6867b2d92d432608135dc95f00707d1f68afcb3033b4d44ccdc1d6a2f6dff9ac", "1.未经对方当事人书面同意，合同任何一方均不得转让其在本合同项下的权利义务。"],
  [198, "70147f2a457586859f2163d1e4ae6f3e4e2951d627f034dc5ab1f9a5c519a386", "2.本合同中除签约双方法定代表人或委托代理人的签名以外，手写的内容均为无效条款，对签约双方不具有法律效力。"],
  [199, "5bace7b20494e62add8b9ef609e6e4ffb9fd27bdb80521337a1b0475387a630a", "3.买、卖双方对本合同的条款已充分阅读，完全理解每一条款的真实意思表示，同意签订并遵守本合同的全部约定。"],
  [202, "6a489eef6545ee8efd56b598ed45f87718dce1106b9c3e67222607f9cc8c0fc4", "6.本合同一式 肆 份，买方 叁 份，卖方 壹 份，每份具有同等法律效力。"],
] as const;

const REVIEWED_TYPOGRAPHY_POLICIES = {
  [REVIEWED_MATERIAL_TYPOGRAPHY_VERSION]: { sourceSha256: REVIEWED_MATERIAL_SOURCE_SHA256, context: REVIEWED_MATERIAL_ROLE_CONTEXT },
  [REVIEWED_MATERIAL_TYPOGRAPHY_V2_VERSION]: { sourceSha256: REVIEWED_MATERIAL_SOURCE_SHA256, context: REVIEWED_MATERIAL_PRIMARY_SECONDARY_ROLE_CONTEXT },
  [REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION]: { sourceSha256: REVIEWED_MATERIAL_SOURCE_SHA256, context: REVIEWED_MATERIAL_PRIMARY_SECONDARY_ROLE_CONTEXT },
  [REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION]: { sourceSha256: REVIEWED_MATERIAL_SOURCE_SHA256, context: REVIEWED_MATERIAL_PRIMARY_SECONDARY_ROLE_CONTEXT },
  [REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION]: { sourceSha256: REVIEWED_MECHANICAL_SOURCE_SHA256, context: REVIEWED_MECHANICAL_ROLE_CONTEXT },
  [REVIEWED_LABOR_TYPOGRAPHY_VERSION]: { sourceSha256: REVIEWED_LABOR_SOURCE_SHA256, context: REVIEWED_LABOR_PRIMARY_ROLE_CONTEXT },
  [REVIEWED_GENERIC_TYPOGRAPHY_VERSION]: { sourceSha256: REVIEWED_GENERIC_SOURCE_SHA256, context: REVIEWED_GENERIC_PRIMARY_ROLE_CONTEXT }
} as const;

function reviewedTypographyPolicy(version: unknown) {
  if (!isReviewedTypographyVersion(version)) throw new BadRequestException("合同正文字体呈现版本无法核对，请联系管理员处理");
  return REVIEWED_TYPOGRAPHY_POLICIES[version];
}

export function reviewedTypographySourceSha256(version: unknown) {
  return reviewedTypographyPolicy(version).sourceSha256;
}

export function assertReviewedTypographySource(source: Buffer, version: ReviewedTypographyVersion | undefined) {
  const parsed = readLayoutSourcePositions(source);
  if (parsed.sourceSha256 !== reviewedTypographySourceSha256(version)) throw new BadRequestException("合同正文字体呈现版本无法核对，请联系管理员处理");
  const zip = new PizZip(source);
  const document = xml(zip.file("word/document.xml")!.asText());
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, "p"));
  let previous = -1;
  for (const anchor of reviewedTypographyPolicy(version).context) {
    const matches = parsed.positions.filter(position => position.part === "word/document.xml" && position.positionId === anchor.id && position.text === anchor.text);
    const position = matches[0];
    const paragraph = position && paragraphs[position.paragraphIndex];
    if (matches.length !== 1 || position.paragraphIndex <= previous || !paragraph || textOf(paragraph) !== anchor.text ||
      paragraph.parentNode?.nodeType !== 1 || (paragraph.parentNode as Element).namespaceURI !== W || (paragraph.parentNode as Element).localName !== "body") {
      throw new BadRequestException("合同正文字体呈现版本无法核对，请联系管理员处理");
    }
    previous = position.paragraphIndex;
  }
  if (version === REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION || version === REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION) for (const [index, id, originalText] of REVIEWED_MATERIAL_MAIN_BODY_SPACING_CONTEXT) {
    const matches = parsed.positions.filter(position => position.part === "word/document.xml" && position.paragraphIndex === index && position.positionId === id && position.text === originalText);
    const paragraph = paragraphs[index];
    if (matches.length !== 1 || !paragraph || textOf(paragraph) !== originalText || paragraph.parentNode?.nodeType !== 1 ||
      (paragraph.parentNode as Element).namespaceURI !== W || (paragraph.parentNode as Element).localName !== "body") {
      throw new BadRequestException("合同正文纸面版本无法核对，请联系管理员处理");
    }
  }
}

export const CONTRACT_BODY_TABLE_LAYOUT_V1 = "body-bill-loop-v1";
export const CONTRACT_BODY_TABLE_LAYOUT_VERSION = "body-bill-loop-v2";
export type ContractBodyTableLayoutVersion = typeof CONTRACT_BODY_TABLE_LAYOUT_V1 | typeof CONTRACT_BODY_TABLE_LAYOUT_VERSION;
export function isContractBodyTableLayoutVersion(value: unknown): value is ContractBodyTableLayoutVersion {
  return value === CONTRACT_BODY_TABLE_LAYOUT_V1 || value === CONTRACT_BODY_TABLE_LAYOUT_VERSION;
}

export interface ContractBodyParagraphFormat {
  fontFamily?: string;
  fontSizePt?: number;
  align: string;
  bold?: boolean;
}

export interface ContractBodyParagraph {
  id: string;
  kind: "paragraph";
  text: string;
  editable: boolean;
  format: ContractBodyParagraphFormat;
  blankFields: string[];
}

export type ContractBodyFlow = { kind: "paragraph"; paragraphId: string } | {
  kind: "table";
  columns: number[];
  rows: Array<{ repeatHeader: boolean; cells: Array<{ paragraphIds: string[]; columnSpan: number; verticalMerge: string | null; flow: ContractBodyFlow[] }> }>;
};

export interface ContractBodyEditPlan {
  protocolVersion: 1;
  layoutTemplateVersionId: string;
  sourceSha256: string;
  edits: Array<{ positionId: string; text: string }>;
  additions?: Array<{ id: string; afterPositionId: string; text: string }>;
  deletedPositionIds?: string[];
  paragraphOrder?: string[];
}

function xml(xmlText: string): Document {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xmlText)) throw new BadRequestException("合同正文结构无法安全读取");
  try {
    return new DOMParser({ onError: () => { throw new Error("invalid XML"); } }).parseFromString(xmlText, "application/xml");
  } catch { throw new BadRequestException("合同正文结构无法安全读取"); }
}

function textOf(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagNameNS(W, "t")).map(node => node.textContent ?? "").join("");
}

/** Change only an explicit source range; every run/paragraph property stays in place. */
function replaceParagraphRange(paragraph: Element, start: number, end: number, replacement: string) {
  const texts = Array.from(paragraph.getElementsByTagNameNS(W, "t"));
  let offset = 0;
  let inserted = false;
  for (const node of texts) {
    const value = node.textContent ?? "";
    const nodeStart = offset;
    offset += value.length;
    if (offset <= start || nodeStart >= end) continue;
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(value.length, end - nodeStart);
    node.textContent = value.slice(0, from) + (inserted ? "" : replacement) + value.slice(to);
    node.setAttribute("xml:space", "preserve");
    inserted = true;
  }
}

function invalidXmlText(text: string) {
  return Array.from(text).some(character => {
    const code = character.codePointAt(0)!;
    return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff;
  });
}

function placeholderTags(text: string) {
  return Array.from(text.matchAll(/\{([^{}]+)\}/gu), match => match[1].trim());
}

function controlledPlaceholder(tag: string) {
  const key = canonicalContractPlaceholder(tag);
  return /^(?:contract\.|party\.|document\.|bill\.)/u.test(key) ||
    ["field.projectName", "field.counterpartyName", "field.taxRatePercent", "field.invoiceType", "clause.payment.text"].includes(key) || isContractBillReadonlyRowPlaceholder(tag);
}

function blankFields(text: string) {
  return [...new Set(Array.from(text.matchAll(/【待补充：([^】]+)】/gu), match => match[1]))];
}

function direct(element: Element, name: string) {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === name);
}

/** Only visible runs of qualified original source-role paragraphs; no style/global edits. */
function applyReviewedRoleFont(paragraph: Element, document: Document, family: string, sizePt: number) {
  for (const run of Array.from(paragraph.getElementsByTagNameNS(W, "r"))) {
    if (!textOf(run).length) continue;
    let properties = direct(run, "rPr")[0];
    if (!properties) { properties = document.createElementNS(W, "w:rPr"); run.insertBefore(properties, run.firstChild); }
    const setProperty = (name: string) => {
      let property = direct(properties, name)[0];
      if (!property) { property = document.createElementNS(W, "w:" + name); properties.appendChild(property); }
      return property;
    };
    const fonts = setProperty("rFonts");
    for (const theme of ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]) fonts.removeAttributeNS(W, theme);
    fonts.setAttributeNS(W, "w:eastAsia", family);
    for (const name of ["ascii", "hAnsi", "cs"]) fonts.setAttributeNS(W, "w:" + name, "Times New Roman");
    for (const name of ["sz", "szCs"]) setProperty(name).setAttributeNS(W, "w:val", String(sizePt * 2));
  }
}

/** V3 direct paragraph spacing only; source styles, fonts, numbering and other pPr stay intact. */
function applyReviewedMaterialBodySpacing(paragraph: Element, document: Document) {
  const invalid = () => { throw new BadRequestException("合同正文纸面格式无法核对，请联系管理员处理"); };
  const properties = direct(paragraph, "pPr");
  if (properties.length > 1) return invalid();
  const pPr = properties[0] ?? document.createElementNS(W, "w:pPr");
  if (!properties.length) paragraph.insertBefore(pPr, paragraph.firstChild);
  const property = (name: string, following: readonly string[]) => {
    const matches = direct(pPr, name);
    if (matches.length > 1) return invalid();
    if (matches[0]) return matches[0];
    const created = document.createElementNS(W, "w:" + name);
    const next = Array.from(pPr.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === W && following.some(name => name === (node as Element).localName));
    pPr.insertBefore(created, next ?? null);
    return created;
  };
  const afterSpacing = ["ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const spacing = property("spacing", afterSpacing);
  for (const [name, value] of Object.entries({ line: "500", lineRule: "exact", before: "0", after: "0", beforeLines: "0", afterLines: "0", beforeAutospacing: "0", afterAutospacing: "0" })) {
    spacing.setAttributeNS(W, "w:" + name, value);
  }
  property("contextualSpacing", afterSpacing.slice(2)).setAttributeNS(W, "w:val", "0");
}

function replaceParagraphText(paragraph: Element, value: string, document: Document) {
  const properties = direct(paragraph, "pPr")[0];
  const runProperties = paragraph.getElementsByTagNameNS(W, "rPr").item(0)?.cloneNode(true);
  while (paragraph.firstChild) paragraph.removeChild(paragraph.firstChild);
  if (properties) paragraph.appendChild(properties);
  const run = document.createElementNS(W, "w:r");
  if (runProperties) run.appendChild(runProperties);
  const text = document.createElementNS(W, "w:t");
  text.setAttribute("xml:space", "preserve");
  text.appendChild(document.createTextNode(value));
  run.appendChild(text);
  paragraph.appendChild(run);
}

function paragraphFormat(paragraph: Element, styles: Document | undefined): ContractBodyParagraphFormat {
  const layers: Element[] = [];
  const defaults = styles?.getElementsByTagNameNS(W, "rPrDefault").item(0)?.getElementsByTagNameNS(W, "rPr").item(0);
  if (defaults) layers.push(defaults);
  const defaultParagraph = styles?.getElementsByTagNameNS(W, "pPrDefault").item(0)?.getElementsByTagNameNS(W, "pPr").item(0);
  if (defaultParagraph) layers.push(defaultParagraph);
  const paragraphProperties = direct(paragraph, "pPr")[0];
  const styleId = paragraphProperties && direct(paragraphProperties, "pStyle")[0]?.getAttributeNS(W, "val");
  const seen = new Set<string>();
  const chain: Element[] = [];
  let current = styleId || "Normal";
  while (current && !seen.has(current)) {
    seen.add(current);
    const style = Array.from(styles?.getElementsByTagNameNS(W, "style") ?? []).find(style => style.getAttributeNS(W, "styleId") === current);
    if (!style) break;
    chain.unshift(style);
    current = direct(style, "basedOn")[0]?.getAttributeNS(W, "val") ?? "";
  }
  layers.push(...chain);
  if (paragraphProperties) layers.push(paragraphProperties);
  const run = Array.from(paragraph.getElementsByTagNameNS(W, "r")).find(run => textOf(run).length > 0) ?? paragraph.getElementsByTagNameNS(W, "r").item(0);
  if (run) layers.push(run);
  const format: ContractBodyParagraphFormat = { align: "left" };
  for (const layer of layers) {
    const properties = layer.localName === "pPr" ? layer : direct(layer, "pPr")[0];
    const runProperties = layer.localName === "rPr" ? layer : direct(layer, "rPr")[0];
    const align = properties && direct(properties, "jc")[0]?.getAttributeNS(W, "val");
    if (align) format.align = ["both", "distribute"].includes(align) ? "justify" : align === "end" ? "right" : align === "start" ? "left" : align;
    if (!runProperties) continue;
    const fonts = direct(runProperties, "rFonts")[0];
    const family = fonts?.getAttributeNS(W, "eastAsia") || fonts?.getAttributeNS(W, "ascii");
    if (family) format.fontFamily = family;
    const size = direct(runProperties, "sz")[0]?.getAttributeNS(W, "val");
    if (size && Number.isFinite(Number(size)) && Number(size) > 0) format.fontSizePt = Number(size) / 2;
    const bold = direct(runProperties, "b")[0];
    if (bold) format.bold = !["0", "false", "off"].includes(bold.getAttributeNS(W, "val") ?? "1");
  }
  return format;
}

function bodyFlow(parent: Element, ids: WeakMap<Element, string>, depth = 0): ContractBodyFlow[] {
  if (depth > 64) throw new BadRequestException("合同正文结构层次过深，请核对原文件");
  return Array.from(parent.childNodes).flatMap((node): ContractBodyFlow[] => {
    if (node.nodeType !== 1) return [];
    const element = node as Element;
    if (element.namespaceURI !== W) return [];
    if (element.localName === "p") {
      const id = ids.get(element);
      return id ? [{ kind: "paragraph", paragraphId: id }] : [];
    }
    if (element.localName === "tbl") {
      const grid = direct(element, "tblGrid")[0];
      return [{ kind: "table", columns: grid ? direct(grid, "gridCol").map(column => Number(column.getAttributeNS(W, "w") ?? "0")) : [],
        rows: direct(element, "tr").map(row => ({
          repeatHeader: Boolean(direct(row, "trPr")[0]?.getElementsByTagNameNS(W, "tblHeader").length),
          cells: direct(row, "tc").map(cell => {
            const properties = direct(cell, "tcPr")[0];
            const merge = properties && direct(properties, "vMerge")[0];
            return { paragraphIds: Array.from(cell.getElementsByTagNameNS(W, "p")).map(paragraph => ids.get(paragraph)).filter((id): id is string => Boolean(id)),
              columnSpan: Number(properties && direct(properties, "gridSpan")[0]?.getAttributeNS(W, "val") || "1"),
              verticalMerge: merge ? merge.getAttributeNS(W, "val") || "continue" : null,
              flow: bodyFlow(cell, ids, depth + 1) };
          })
        })) }];
    }
    return bodyFlow(element, ids, depth + 1);
  });
}

function sourceParagraphs(source: Buffer, mapped: Buffer, reviewedLaborTaxBindingVersion?: typeof REVIEWED_LABOR_TAX_BINDING_VERSION) {
  const parsed = readLayoutSourcePositions(source);
  const zip = new PizZip(mapped);
  const document = xml(zip.file("word/document.xml")!.asText());
  const positions = new Map(parsed.positions.filter(position => position.part === "word/document.xml").map(position => [position.paragraphIndex, position]));
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, "p")).map((paragraph, index) => {
    const sourceText = positions.get(index)?.text ?? textOf(paragraph);
    let editable = !placeholderTags(textOf(paragraph)).some(controlledPlaceholder) && !["drawing", "pict", "fldChar", "instrText"].some(name => paragraph.getElementsByTagNameNS(W, name).length);
    for (let parent = paragraph.parentNode; parent && parent !== document; parent = parent.parentNode) {
      if (parent.nodeType === 1 && (parent as Element).namespaceURI === W && (parent as Element).localName === "tbl" && /\{[#/]/u.test(textOf(parent as Element))) editable = false;
    }
    if (reviewedLaborTaxBindingVersion === REVIEWED_LABOR_TAX_BINDING_VERSION && parsed.sourceSha256 === REVIEWED_LABOR_SOURCE_SHA256 && sourceText === REVIEWED_LABOR_TAX_SENTENCE) editable = false;
    return { id: positions.get(index)?.positionId ?? createHash("sha256").update(JSON.stringify([parsed.sourceSha256, index])).digest("hex"),
      sourceText, paragraph, editable };
  });
  return { sourceSha256: parsed.sourceSha256, zip, document, paragraphs };
}

function ordinaryParagraphGroups(model: ReturnType<typeof sourceParagraphs>) {
  const groups: Array<typeof model.paragraphs> = [];
  let current: typeof model.paragraphs = [];
  const body = model.document.getElementsByTagNameNS(W, "body").item(0);
  for (const node of Array.from(body?.childNodes ?? [])) {
    if (node.nodeType !== 1) continue;
    const item = model.paragraphs.find(item => item.paragraph === node);
    if (item?.editable) current.push(item);
    else if (current.length) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  return groups;
}

export function normalizeContractBodyPlan(value: unknown, source: Buffer, mapped: Buffer, layoutTemplateVersionId: string, reviewedLaborTaxBindingVersion?: typeof REVIEWED_LABOR_TAX_BINDING_VERSION): ContractBodyEditPlan {
  const model = sourceParagraphs(source, mapped, reviewedLaborTaxBindingVersion);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("合同正文保存内容不正确");
  const input = value as Record<string, unknown>;
  if (input.protocolVersion !== 1 || input.layoutTemplateVersionId !== layoutTemplateVersionId || input.sourceSha256 !== model.sourceSha256) throw new ConflictException("正文所用模板已变化，请保留当前内容并刷新后核对");
  if (Object.keys(input).some(key => !["protocolVersion", "layoutTemplateVersionId", "sourceSha256", "edits", "additions", "deletedPositionIds", "paragraphOrder"].includes(key)) || !Array.isArray(input.edits) || input.edits.length > 3_000) throw new BadRequestException("合同正文编辑内容不正确");
  if (input.deletedPositionIds !== undefined && (!Array.isArray(input.deletedPositionIds) || input.deletedPositionIds.length > 3_000)) throw new BadRequestException("删除条款内容不正确");
  const deletedPositionIds = ((input.deletedPositionIds ?? []) as unknown[]).map(id => {
    const position = model.paragraphs.find(paragraph => paragraph.id === id);
    if (!position?.editable) throw new BadRequestException("关键资料及清单位置不能删除，请返回填写页修改");
    return position.id;
  });
  if (new Set(deletedPositionIds).size !== deletedPositionIds.length) throw new BadRequestException("删除条款位置重复");
  deletedPositionIds.sort();
  const groups = ordinaryParagraphGroups(model).map(group => group.filter(item => !deletedPositionIds.includes(item.id)).map(item => item.id));
  const defaultOrder = groups.flat();
  const paragraphOrder = input.paragraphOrder === undefined ? defaultOrder : input.paragraphOrder;
  if (!Array.isArray(paragraphOrder) || paragraphOrder.length !== defaultOrder.length || new Set(paragraphOrder).size !== defaultOrder.length || paragraphOrder.some(id => typeof id !== "string")) throw new BadRequestException("普通条款排序内容不正确");
  let offset = 0;
  for (const group of groups) {
    if (paragraphOrder.slice(offset, offset + group.length).some(id => !group.includes(id as string))) throw new BadRequestException("普通条款只能在同一正文区段内排序，关键资料、清单和签署位置保持不变");
    offset += group.length;
  }
  const ids = new Set<string>();
  let characters = 0;
  const edits = input.edits.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("合同正文编辑内容不正确");
    const edit = value as Record<string, unknown>;
    const position = model.paragraphs.find(paragraph => paragraph.id === edit.positionId);
    if (!position || !position.editable) throw new BadRequestException("该位置由填写资料自动同步，请返回填写页修改，不能在正文另改关键资料");
    if (deletedPositionIds.includes(position.id) || ids.has(position.id) || Object.keys(edit).some(key => !["positionId", "text"].includes(key)) || typeof edit.text !== "string" || edit.text.length > 20_000 || invalidXmlText(edit.text)) throw new BadRequestException("合同正文条款内容不正确");
    characters += edit.text.length;
    if (characters > 500_000) throw new BadRequestException("合同正文内容过长，请分段核对");
    ids.add(position.id);
    return { positionId: position.id, text: edit.text };
  });
  if (input.additions !== undefined && (!Array.isArray(input.additions) || input.additions.length > 500)) throw new BadRequestException("新增条款内容不正确");
  const additionIds = new Set<string>();
  const additions = ((input.additions ?? []) as unknown[]).map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("新增条款内容不正确");
    const addition = value as Record<string, unknown>;
    const anchor = model.paragraphs.find(paragraph => paragraph.id === addition.afterPositionId);
    if (!anchor || deletedPositionIds.includes(anchor.id) || anchor.paragraph.parentNode?.nodeType !== 1 || (anchor.paragraph.parentNode as Element).localName !== "body") throw new BadRequestException("请选择正文段落后的插入位置，清单和签署表格保持原结构");
    if (Object.keys(addition).some(key => !["id", "afterPositionId", "text"].includes(key)) || typeof addition.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(addition.id) || additionIds.has(addition.id) || typeof addition.text !== "string" || addition.text.length > 20_000 || invalidXmlText(addition.text)) throw new BadRequestException("新增条款内容不正确");
    characters += addition.text.length;
    if (characters > 500_000) throw new BadRequestException("合同正文内容过长，请分段核对");
    additionIds.add(addition.id);
    return { id: addition.id, afterPositionId: anchor.id, text: addition.text };
  }).sort((left, right) => model.paragraphs.findIndex(paragraph => paragraph.id === left.afterPositionId) - model.paragraphs.findIndex(paragraph => paragraph.id === right.afterPositionId));
  return { protocolVersion: 1, layoutTemplateVersionId, sourceSha256: model.sourceSha256, edits, ...(additions.length ? { additions } : {}), ...(deletedPositionIds.length ? { deletedPositionIds } : {}),
    ...(paragraphOrder.join() === defaultOrder.join() ? {} : { paragraphOrder: paragraphOrder as string[] }) };
}

/** Lossless upgrade of legacy ordering metadata, never of edited tax text.
 * The old model must accept the whole plan first. Only an unmoved tax anchor's
 * redundant order member is removed; all other order/edits/additions survive.
 */
export function upgradeReviewedLaborTaxPlan(value: unknown, source: Buffer, mapped: Buffer, layoutTemplateVersionId: string): ContractBodyEditPlan {
  const old = normalizeContractBodyPlan(value, source, mapped, layoutTemplateVersionId);
  const model = sourceParagraphs(source, mapped);
  if (model.sourceSha256 !== REVIEWED_LABOR_SOURCE_SHA256) throw new ConflictException("正文所用模板已变化，请保留当前内容并刷新后核对");
  const positions = model.paragraphs.filter(item => item.sourceText === REVIEWED_LABOR_TAX_SENTENCE);
  if (positions.length !== 1) throw new BadRequestException("合同模板税率位置已变化，请核对后再保存");
  const taxId = positions[0].id;
  const cannotUpgrade = () => { throw new ConflictException("历史正文的税率位置已有手工修改或跨段排序，请先保留草稿并核对；如需覆盖，请确认重新生成正文"); };
  if (old.edits.some(edit => edit.positionId === taxId) || old.deletedPositionIds?.includes(taxId)) return cannotUpgrade();
  if (!old.paragraphOrder) return normalizeContractBodyPlan(old, source, mapped, layoutTemplateVersionId, REVIEWED_LABOR_TAX_BINDING_VERSION);
  const groups = ordinaryParagraphGroups(model).map(group => group.filter(item => !old.deletedPositionIds?.includes(item.id)).map(item => item.id));
  const group = groups.find(ids => ids.includes(taxId));
  if (!group) return cannotUpgrade();
  const sourceTaxIndex = group.indexOf(taxId);
  const sourceBefore = new Set(group.slice(0, sourceTaxIndex));
  const sourceAfter = new Set(group.slice(sourceTaxIndex + 1));
  const groupOrder = old.paragraphOrder.filter(id => group.includes(id));
  const orderedTaxIndex = groupOrder.indexOf(taxId);
  const sameMembers = (ids: string[], expected: Set<string>) => ids.length === expected.size && ids.every(id => expected.has(id));
  if (orderedTaxIndex < 0 || !sameMembers(groupOrder.slice(0, orderedTaxIndex), sourceBefore) ||
    !sameMembers(groupOrder.slice(orderedTaxIndex + 1), sourceAfter)) return cannotUpgrade();
  // No edits/deletions/additions are removed or retargeted. In particular,
  // additions anchored at taxId keep that same source ID for normal validation.
  const migrated = { ...old, paragraphOrder: old.paragraphOrder.filter(id => id !== taxId) };
  return normalizeContractBodyPlan(migrated, source, mapped, layoutTemplateVersionId, REVIEWED_LABOR_TAX_BINDING_VERSION);
}

/** Temporary OOXML controls identify source paragraphs across rendered bill loops.
 * They never become user text or exported metadata; original formatting stays in place.
 */
export function renderContractBody(source: Buffer, mapped: Buffer, input: ContractDocumentRenderInput, requiredKeys: readonly string[], layoutTemplateVersionId: string, rawPlan?: unknown, options: { allowBlankWatermark?: boolean; tableLayoutVersion?: ContractBodyTableLayoutVersion; typographyVersion?: ReviewedTypographyVersion; signatureDateVersion?: typeof REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION; pageNumberVersion?: typeof REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION } = {}) {
  const values = { ...input.values };
  const hasReviewedTaxVersion = Object.hasOwn(values, "contract.reviewedLaborTaxBindingVersion");
  const reviewedLaborTaxBindingVersion = hasReviewedTaxVersion ? values["contract.reviewedLaborTaxBindingVersion"] : undefined;
  if (hasReviewedTaxVersion && (reviewedLaborTaxBindingVersion !== REVIEWED_LABOR_TAX_BINDING_VERSION ||
    createHash("sha256").update(source).digest("hex") !== REVIEWED_LABOR_SOURCE_SHA256 ||
    values["contract.renderSemanticVersion"] !== CONTRACT_BODY_MONEY_SEMANTICS_VERSION ||
    !["tax_inclusive", "tax_exclusive"].includes(values["contract.amountBasis"] as string) ||
    typeof values["contract.taxRateLabel"] !== "string" || !/^(?:待补充|\d+(?:\.\d+)?%)$/u.test(values["contract.taxRateLabel"] as string))) {
    throw new BadRequestException("合同正文税率呈现版本无法核对，请联系管理员处理");
  }
  const hasTypographyVersion = Object.hasOwn(values, "contract.typographyVersion");
  const hasTypographyOption = Object.hasOwn(options, "typographyVersion");
  if ((hasTypographyVersion || hasTypographyOption) && (!hasTypographyVersion || !hasTypographyOption ||
    !isReviewedTypographyVersion(values["contract.typographyVersion"]) || options.typographyVersion !== values["contract.typographyVersion"] ||
    (values["contract.typographyVersion"] === REVIEWED_LABOR_TYPOGRAPHY_VERSION ? !hasReviewedTaxVersion : hasReviewedTaxVersion) ||
    (Object.hasOwn(values, "contract.renderSemanticVersion") && values["contract.renderSemanticVersion"] !== CONTRACT_BODY_MONEY_SEMANTICS_VERSION))) {
    throw new BadRequestException("合同正文字体呈现版本无法核对，请联系管理员处理");
  }
  if (hasTypographyVersion) assertReviewedTypographySource(source, options.typographyVersion);
  const binding = reviewedLaborTaxBindingVersion as typeof REVIEWED_LABOR_TAX_BINDING_VERSION | undefined;
  const hasDateValue = Object.hasOwn(values, "contract.signatureDateVersion");
  const hasDateOption = Object.hasOwn(options, "signatureDateVersion");
  if ((hasDateValue || hasDateOption) && (!hasDateValue || !hasDateOption ||
    values["contract.signatureDateVersion"] !== REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION || options.signatureDateVersion !== REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION ||
    options.typographyVersion !== REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION || createHash("sha256").update(source).digest("hex") !== REVIEWED_MATERIAL_SOURCE_SHA256)) {
    throw new BadRequestException("合同签署日期呈现版本无法核对，请联系管理员处理");
  }
  const hasPageValue = Object.hasOwn(values, "contract.pageNumberVersion");
  const hasPageOption = Object.hasOwn(options, "pageNumberVersion");
  if ((hasPageValue || hasPageOption) && (!hasPageValue || !hasPageOption ||
    values["contract.pageNumberVersion"] !== REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION || options.pageNumberVersion !== REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION ||
    hasTypographyVersion || hasTypographyOption || hasDateValue || hasDateOption || hasReviewedTaxVersion ||
    values["contract.renderSemanticVersion"] !== CONTRACT_BODY_MONEY_SEMANTICS_VERSION)) {
    throw new BadRequestException("合同页码呈现版本无法核对，请联系管理员处理");
  }
  if (hasPageValue) assertReviewedOriginalMechanicalPageSource(source);
  const model = sourceParagraphs(source, mapped, binding);
  if (hasPageValue) prepareReviewedOriginalMechanicalPage(model.zip);
  if (hasDateValue) {
    // Only the two source-qualified, truly empty party-cell paragraphs. Insert
    // defaults before the existing edit/delete plan so user text always wins.
    const table = model.document.getElementsByTagNameNS(W, "tbl").item(1);
    const rows = table ? direct(table, "tr") : [], cells = rows.length === 1 ? direct(rows[0], "tc") : [];
    const expectedIds = ["be6d8bf0f1e5172844c287c65d2f53f404b033dd67611442873a02d5a37a312e", "f20c09d2043ff82ab2e75bd5cce357c5c2a7dc7885246d96872c54245e699d2f"];
    if (cells.length !== 2) throw new BadRequestException("合同签署日期呈现版本无法核对，请联系管理员处理");
    for (let i = 0; i < cells.length; i++) {
      const paragraphs = direct(cells[i], "p"), slot = paragraphs[5];
      const original = model.paragraphs.find(item => item.id === expectedIds[i]);
      if (paragraphs.length !== 7 || !slot || original?.paragraph !== slot || slot.childNodes.length !== 0) {
        throw new BadRequestException("合同签署日期呈现版本无法核对，请联系管理员处理");
      }
      replaceParagraphText(slot, "签署日期：　年　月　日", model.document);
    }
  }
  const plan = rawPlan === undefined ? undefined : normalizeContractBodyPlan(rawPlan, source, mapped, layoutTemplateVersionId, binding);
  const groups = ordinaryParagraphGroups(model);
  let orderOffset = 0;
  const paragraphGroups = groups.map(group => {
    const available = group.filter(item => !plan?.deletedPositionIds?.includes(item.id));
    const order = plan?.paragraphOrder?.slice(orderOffset, orderOffset + available.length) ?? available.map(item => item.id);
    orderOffset += available.length;
    const after = group[group.length - 1].paragraph.nextSibling;
    for (const id of order) {
      const paragraph = group.find(item => item.id === id)!.paragraph;
      paragraph.parentNode!.insertBefore(paragraph, after);
    }
    return order;
  }).filter(group => group.length > 0);
  // A reviewed source sentence states a specific amount basis. Adapt that one
  // sentence, not arbitrary Chinese labels or user clauses. Old queued snapshots
  // lack the protected basis key and retain their original rendering semantics.
  const basis = values["contract.amountBasis"];
  if (values["contract.renderSemanticVersion"] === CONTRACT_BODY_MONEY_SEMANTICS_VERSION &&
    model.sourceSha256 === "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd" &&
    (basis === "tax_exclusive" || basis === "tax_inclusive")) {
    const original = "1.本合同暂定总价（含税）：{合同金额大写}。适用税率：{税率}%。";
    const item = model.paragraphs.find(paragraph => paragraph.sourceText === original);
    if (item) {
      const text = textOf(item.paragraph);
      const match = /^1\.本合同暂定总价（含税）：(\{[^{}]+\})。适用税率：(\{[^{}]+\}%)。$/u.exec(text);
      if (match) {
        const ranges = [
          { start: text.indexOf(match[1]), end: text.indexOf(match[1]) + match[1].length,
            replacement: basis === "tax_exclusive" ? "{contract.taxExclusiveAmountUppercase}" : "{contract.taxInclusiveAmountUppercase}" },
          { start: text.lastIndexOf(match[2]), end: text.lastIndexOf(match[2]) + match[2].length, replacement: "{contract.taxRateLabel}" },
          ...(basis === "tax_exclusive" ? [{ start: text.indexOf("（含税）"), end: text.indexOf("（含税）") + "（含税）".length, replacement: "（不含税）" }] : [])
        ];
        for (const range of ranges.sort((left, right) => right.start - left.start)) replaceParagraphRange(item.paragraph, range.start, range.end, range.replacement);
      }
    }
  }
  if (binding === REVIEWED_LABOR_TAX_BINDING_VERSION) {
    const item = model.paragraphs.find(paragraph => paragraph.sourceText === REVIEWED_LABOR_TAX_SENTENCE);
    if (!item || textOf(item.paragraph) !== REVIEWED_LABOR_TAX_SENTENCE) throw new BadRequestException("合同模板税率位置已变化，请核对后再保存");
    // Only the reviewed literal rate and its percent sign. Invoice choices and
    // every paragraph/run property remain untouched; unknown stays 待补充.
    replaceParagraphRange(item.paragraph, REVIEWED_LABOR_TAX_SENTENCE.lastIndexOf("3"),
      REVIEWED_LABOR_TAX_SENTENCE.lastIndexOf("%") + 1, "{contract.taxRateLabel}");
  }
  for (const item of model.paragraphs.filter(paragraph => paragraph.editable)) {
    for (const tag of placeholderTags(textOf(item.paragraph))) {
      const key = canonicalContractPlaceholder(tag);
      if (tag.startsWith("#") || tag.startsWith("/") || controlledPlaceholder(tag)) continue;
      const value = values[key] ?? values[tag];
      const label = Object.entries(CONTRACT_VALUE_PLACEHOLDER_ALIASES).find(([, field]) => field === key)?.[0] ?? (/^[A-Za-z][A-Za-z0-9_.]*$/u.test(tag) ? "正文空位" : tag);
      if (value === undefined || value === null || value === "") values[key] = `【待补充：${label}】`;
    }
  }
  const billBoundaryIds = new Set<string>();
  const billBoundaryStack: Array<{ id: string; key: string; paragraph: Element }> = [];
  for (const item of model.paragraphs) {
    const match = /^\{([#/])\s*([^{}]+)\}$/u.exec(item.sourceText.trim());
    if (!match) continue;
    const key = canonicalContractPlaceholder(match[2]);
    // A name prefix is not proof of a collection: scalar/unknown conditions
    // keep their old tracking. Only a matched, same-container array pair qualifies.
    if (!key.startsWith("bill.") || !Array.isArray(input.values[key])) continue;
    if (match[1] === "#") billBoundaryStack.push({ id: item.id, key, paragraph: item.paragraph });
    else {
      const opening = billBoundaryStack.at(-1);
      if (!opening || opening.key !== key || opening.paragraph.parentNode !== item.paragraph.parentNode) continue;
      billBoundaryStack.pop();
      billBoundaryIds.add(opening.id);
      billBoundaryIds.add(item.id);
    }
  }
  // Accepted legacy plans may anchor text to an otherwise invisible loop marker.
  // Preserve their exact wrapping/order rather than losing or relocating the text.
  const hasBoundaryAddition = plan?.additions?.some(addition => billBoundaryIds.has(addition.afterPositionId));
  for (const item of model.paragraphs) {
    if (isContractBodyTableLayoutVersion(options.tableLayoutVersion) && !hasBoundaryAddition && billBoundaryIds.has(item.id)) continue;
    const wrapper = model.document.createElementNS(W, "w:sdt");
    const properties = model.document.createElementNS(W, "w:sdtPr");
    const tag = model.document.createElementNS(W, "w:tag");
    tag.setAttributeNS(W, "w:val", MARKER + item.id);
    properties.appendChild(tag);
    wrapper.appendChild(properties);
    const content = model.document.createElementNS(W, "w:sdtContent");
    wrapper.appendChild(content);
    item.paragraph.parentNode!.replaceChild(wrapper, item.paragraph);
    content.appendChild(item.paragraph);
  }
  model.zip.file("word/document.xml", new XMLSerializer().serializeToString(model.document));
  const rendered = renderContractDocx(model.zip.generate({ type: "nodebuffer" }), { values }, requiredKeys, options);
  const zip = new PizZip(rendered);
  const document = xml(zip.file("word/document.xml")!.asText());
  const stylesPart = zip.file("word/styles.xml");
  const styles = stylesPart ? xml(stylesPart.asText()) : undefined;
  const ids = new WeakMap<Element, string>();
  const occurrences = new Map<string, number>();
  const controls = Array.from(document.getElementsByTagNameNS(W, "sdt")).filter(control => (control.getElementsByTagNameNS(W, "tag").item(0)?.getAttributeNS(W, "val") ?? "").startsWith(MARKER));
  let additionNumber = 0;
  const blocks: ContractBodyParagraph[] = controls.flatMap(control => {
    const id = (control.getElementsByTagNameNS(W, "tag").item(0)!.getAttributeNS(W, "val") ?? "").slice(MARKER.length);
    const item = model.paragraphs.find(paragraph => paragraph.id === id);
    const paragraph = control.getElementsByTagNameNS(W, "p").item(0);
    if (!item || !paragraph) throw new BadRequestException("合同正文位置已变化，请重新核对模板");
    if (plan?.deletedPositionIds?.includes(id)) { control.parentNode!.removeChild(control); return []; }
    const edit = plan?.edits.find(edit => edit.positionId === id);
    if (edit) replaceParagraphText(paragraph, edit.text, document);
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    const renderedId = occurrence ? `${id}:${occurrence}` : id;
    ids.set(paragraph, renderedId);
    const block = { id: renderedId, kind: "paragraph" as const, text: textOf(paragraph), editable: item.editable, format: paragraphFormat(paragraph, styles), blankFields: blankFields(textOf(paragraph)) };
    control.parentNode!.replaceChild(paragraph, control);
    const addedBlocks: ContractBodyParagraph[] = [];
    let cursor = paragraph;
    for (const addition of plan?.additions?.filter(addition => addition.afterPositionId === id) ?? []) {
      const addedParagraph = paragraph.cloneNode(true) as Element;
      replaceParagraphText(addedParagraph, `补充条款${++additionNumber}：${addition.text}`, document);
      const addedId = `added:${addition.id}`;
      ids.set(addedParagraph, addedId);
      cursor.parentNode!.insertBefore(addedParagraph, cursor.nextSibling);
      cursor = addedParagraph;
      addedBlocks.push({ id: addedId, kind: "paragraph", text: textOf(addedParagraph), editable: true, format: paragraphFormat(addedParagraph, styles), blankFields: blankFields(textOf(addedParagraph)) });
    }
    return [block, ...addedBlocks];
  });
  for (const paragraph of Array.from(document.getElementsByTagNameNS(W, "p"))) {
    if (ids.has(paragraph)) continue;
    const id = `generated:${blocks.length}`;
    ids.set(paragraph, id);
    blocks.push({ id, kind: "paragraph", text: textOf(paragraph), editable: false, format: paragraphFormat(paragraph, styles), blankFields: blankFields(textOf(paragraph)) });
  }
  if (hasTypographyVersion) {
    // After additions are cloned: newly added ordinary paragraphs retain their
    // previous formatting; only surviving original source-role IDs are changed.
    for (const role of reviewedTypographyPolicy(options.typographyVersion).context) {
      if (!("family" in role)) continue;
      const targets = Array.from(document.getElementsByTagNameNS(W, "p")).filter(paragraph => ids.get(paragraph) === role.id);
      if (targets.length > 1 || (!targets.length && !plan?.deletedPositionIds?.includes(role.id))) throw new BadRequestException("合同正文字体呈现版本无法核对，请联系管理员处理");
      for (const paragraph of targets) {
        applyReviewedRoleFont(paragraph, document, role.family, role.sizePt);
        const block = blocks.find(block => block.id === role.id)!;
        block.format = paragraphFormat(paragraph, styles);
      }
    }
  }
  const body = document.getElementsByTagNameNS(W, "body").item(0);
  if (!body) throw new BadRequestException("合同正文缺少主体内容");
  let lineBoxScope: ContractBodyLineBoxScopeDraft | undefined;
  if (options.typographyVersion === REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION || options.typographyVersion === REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION) {
    const originalBodyIds = new Set<string>(REVIEWED_MATERIAL_MAIN_BODY_SPACING_CONTEXT.map(([, id]) => id));
    const targets = new Set([...originalBodyIds].filter(id => !plan?.deletedPositionIds?.includes(id)));
    for (const addition of plan?.additions ?? []) if (originalBodyIds.has(addition.afterPositionId)) targets.add("added:" + addition.id);
    const seen = new Set<string>();
    for (const paragraph of Array.from(document.getElementsByTagNameNS(W, "p"))) {
      const id = ids.get(paragraph);
      if (!id || !targets.has(id)) continue;
      if (paragraph.parentNode !== body || seen.has(id)) throw new BadRequestException("合同正文纸面位置无法核对，请保留当前正文后重新读取");
      applyReviewedMaterialBodySpacing(paragraph, document);
      seen.add(id);
    }
    if (seen.size !== targets.size) throw new BadRequestException("合同正文纸面位置已变化，请保留当前正文后重新读取");
    if (options.typographyVersion === REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION) {
      const paragraphs = direct(body, "p").flatMap((paragraph, ordinal) => {
        const positionId = ids.get(paragraph);
        return positionId && targets.has(positionId) ? [{ ordinal, positionId, textSha256: createHash("sha256").update(textOf(paragraph)).digest("hex") }] : [];
      });
      if (paragraphs.length !== targets.size || paragraphs.length > 654) throw new BadRequestException("合同正文纸面范围无法核对，请保留当前正文后重新读取");
      lineBoxScope = { version: 1, typographyVersion: REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, sourceSha256: model.sourceSha256, paragraphs };
    }
  }
  const flow = bodyFlow(body, ids);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return { docx: zip.generate({ type: "nodebuffer" }), sourceSha256: model.sourceSha256, blocks, flow, paragraphGroups, ...(lineBoxScope ? { lineBoxScope } : {}) };
}

/** New v2 final Word only: retain logical margins and add equivalent aliases.
 * The same returned bytes are uploaded and rendered; historical jobs never enter.
 */
export function prepareContractBodyTableMargins(docx: Buffer, version?: ContractBodyTableLayoutVersion): Buffer {
  if (version !== CONTRACT_BODY_TABLE_LAYOUT_VERSION) return docx;
  const unsupported = () => { throw new BadRequestException("合同模板的表格边距设置暂不支持，请核对模板后再生成"); };
  const zip = new PizZip(docx);
  const main = zip.file("word/document.xml");
  if (!main) return unsupported();
  const document = xml(main.asText());
  const body = document.getElementsByTagNameNS(W, "body").item(0);
  if (!body) return unsupported();
  const stylePart = zip.file("word/styles.xml");
  const styles = stylePart ? xml(stylePart.asText()) : undefined;
  const tableStyles = Array.from(styles?.getElementsByTagNameNS(W, "style") ?? []).filter(style => style.getAttributeNS(W, "type") === "table");
  const enabled = (element: Element) => {
    const value = element.getAttributeNS(W, "val");
    if (!value || ["1", "true", "on"].includes(value)) return true;
    if (["0", "false", "off"].includes(value)) return false;
    return unsupported();
  };
  const logical = (element: Element) => ["start", "end"].some(name => Array.from(element.getElementsByTagNameNS(W, name)).some(node =>
    ["tblCellMar", "tcMar"].includes((node.parentNode as Element | null)?.localName ?? "")));
  const uncertainStyles = new Set<Element>();
  const styleChain = (table: Element): Element[] => {
    const references = direct(direct(table, "tblPr")[0] ?? table, "tblStyle");
    if (references.length > 1) uncertainStyles.add(table);
    const lookup = (id: string | null) => {
      const matches = id ? tableStyles.filter(style => style.getAttributeNS(W, "styleId") === id) : [];
      if (matches.length !== 1) uncertainStyles.add(table);
      return matches;
    };
    const roots = references.length ? references.flatMap(reference => lookup(reference.getAttributeNS(W, "val"))) :
      tableStyles.filter(style => style.hasAttributeNS(W, "default") && !["0", "false", "off"].includes(style.getAttributeNS(W, "default") ?? ""));
    if (!references.length && roots.length > 1) uncertainStyles.add(table);
    const result: Element[] = [], pending = [...roots];
    while (pending.length) {
      const current = pending.shift()!;
      if (result.includes(current)) { uncertainStyles.add(table); continue; }
      result.push(current);
      if (!current.getAttributeNS(W, "styleId")) uncertainStyles.add(table);
      if (tableStyles.filter(style => style.getAttributeNS(W, "styleId") === current.getAttributeNS(W, "styleId")).length !== 1) uncertainStyles.add(table);
      if (current.hasAttributeNS(W, "default") && !["0", "false", "off", "1", "true", "on"].includes(current.getAttributeNS(W, "default") ?? "")) uncertainStyles.add(table);
      const base = direct(current, "basedOn");
      if (base.length > 1) uncertainStyles.add(table);
      for (const reference of base) pending.push(...lookup(reference.getAttributeNS(W, "val")));
    }
    return result;
  };
  const sectionFor = (table: Element): Element | undefined => {
    let current: Element | undefined = table;
    while (current) {
      if (current.localName === "sectPr") return current;
      if (current.localName === "p") {
        const properties = direct(current, "pPr")[0];
        const section = properties && direct(properties, "sectPr")[0];
        if (section) return section;
      }
      current = current.nextSibling as Element | undefined;
    }
    return undefined;
  };
  const hasDirection = (element: Element) => ["bidi", "bidiVisual"].some(name =>
    Array.from(element.getElementsByTagNameNS(W, name)).some(enabled));
  let changed = false;
  for (const table of Array.from(document.getElementsByTagNameNS(W, "tbl"))) {
    const chain = styleChain(table);
    if (!logical(table) && !chain.some(logical)) continue;
    if (uncertainStyles.has(table)) return unsupported();
    if (table.parentNode !== body || table.getElementsByTagNameNS(W, "tbl").length) return unsupported();
    const properties = direct(table, "tblPr");
    const margins = properties[0] ? direct(properties[0], "tblCellMar") : [];
    if (properties.length !== 1 || margins.length !== 1) return unsupported();
    const global = margins[0];
    // CT_TblCellMar is a sequence: top,left,start,bottom,right,end.
    // Retain existing children; an invalid original order is unsupported.
    const marginOrder = ["top", "left", "start", "bottom", "right", "end"];
    let previousRank = -1;
    for (const child of Array.from(global.childNodes).filter((node): node is Element => node.nodeType === 1)) {
      const rank = child.namespaceURI === W ? marginOrder.indexOf(child.localName ?? "") : -1;
      if (rank < 0 || rank <= previousRank) return unsupported();
      previousRank = rank;
    }
    // Only direct global logical margins are supported. Row/cell legacy108 is
    // deliberately left untouched, while logical overrides need their own proof.
    for (const name of ["start", "end"]) for (const node of Array.from(table.getElementsByTagNameNS(W, name))) {
      if (["tblCellMar", "tcMar"].includes((node.parentNode as Element | null)?.localName ?? "") && node.parentNode !== global) return unsupported();
    }
    if (chain.some(style => style.getElementsByTagNameNS(W, "tblCellMar").length || style.getElementsByTagNameNS(W, "tcMar").length || hasDirection(style))) return unsupported();
    const section = sectionFor(table);
    if (!section || hasDirection(table) || direct(section, "bidi").some(enabled)) return unsupported();
    if (["tblPrChange", "trPrChange", "tcPrChange"].some(name => table.getElementsByTagNameNS(W, name).length) || direct(section, "sectPrChange").length) return unsupported();
    for (const [name, alias] of [["start", "left"], ["end", "right"]]) {
      const source = direct(global, name), existing = direct(global, alias);
      if (source.length !== 1 || existing.length > 1) return unsupported();
      const width = source[0].getAttributeNS(W, "w") ?? "";
      const valid = (node: Element) => node.getAttributeNS(W, "type") === "dxa" &&
        /^\d+$/u.test(node.getAttributeNS(W, "w") ?? "") && Number.isSafeInteger(Number(node.getAttributeNS(W, "w"))) &&
        Array.from(node.attributes).every(attribute => attribute.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
          (attribute.namespaceURI === W && ["w", "type"].includes(attribute.localName ?? "")));
      if (!valid(source[0]) || (existing[0] && (!valid(existing[0]) || Number(existing[0].getAttributeNS(W, "w")) !== Number(width)))) return unsupported();
      if (!existing.length) {
        const value = document.createElementNS(W, `${global.prefix || "w"}:${alias}`);
        value.setAttributeNS(W, `${global.prefix || "w"}:w`, width);
        value.setAttributeNS(W, `${global.prefix || "w"}:type`, "dxa");
        global.insertBefore(value, source[0]);
        changed = true;
      }
    }
  }
  // Only referenced headers/footers are active. Dormant parts and unrelated
  // styled/RTL tables with no logical margin requirement are not export gates.
  const relationshipsPart = zip.file("word/_rels/document.xml.rels");
  const relationships = relationshipsPart ? xml(relationshipsPart.asText()) : undefined;
  for (const name of ["headerReference", "footerReference"]) for (const reference of Array.from(document.getElementsByTagNameNS(W, name))) {
    const id = reference.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relationship = Array.from(relationships?.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship") ?? []).find(node => node.getAttribute("Id") === id);
    if (!relationship || relationship.getAttribute("TargetMode") === "External") continue;
    const target = relationship.getAttribute("Target") ?? "";
    if (!/^[A-Za-z0-9_./-]+$/u.test(target) || target.startsWith("//")) continue;
    const targetSegments = target.split("/");
    if (target.startsWith("/")) targetSegments.shift();
    const partSegments = target.startsWith("/") ? [] : ["word"];
    if (["", ".", ".."].includes(targetSegments.at(-1) ?? "")) return unsupported();
    for (const segment of targetSegments) {
      if (segment === ".") continue;
      if (!segment) return unsupported();
      if (segment === "..") {
        if (!partSegments.length) return unsupported();
        partSegments.pop();
      } else partSegments.push(segment);
    }
    const part = zip.file(partSegments.join("/"));
    if (!part) continue;
    const header = xml(part.asText());
    for (const table of Array.from(header.getElementsByTagNameNS(W, "tbl"))) if (logical(table) || styleChain(table).some(logical)) return unsupported();
  }
  if (!changed) return docx;
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return zip.generate({ type: "nodebuffer" });
}

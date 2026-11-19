import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const legacyRuntimePath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/runtime-manifest.json";
const legacyRuntimeSha = "200e2a3be3008e0b9c9c2bca1579024fd1df93d3616613c7fd834c38dd49080a";
const legacyLockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const runtimePath = "/private/tmp/jg-382-material-body25-v4-r2-runtime-20261107/runtime-manifest.json";
const inspectionPath = "/private/tmp/jg-382-material-body25-v4-r2-runtime-20261107/inspection-manifest.json";
const runtimeSha = "a48b4092bf77ad89a26c083162904ab9562f52a9171eb6c57dc12228e2c30aba";
const inspectionSha = "12903034b24d53b502179a4574b7ffddf48c127edb2aafc5b02476e9c125f185";
const lockSha = "6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128";
const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";

const title = "材料主次条款A2026合同";
const articleText = "第一条  货物名称、规格型号、数量、价格等";
const totalLiteral = "1.本合同暂定总价（含税）：人民币陆元伍角。适用税率：0%。";

// Independent canonical source audit8a39415c; no production role/version constants.
const roleExpectations = [
  {"paragraphIndex": 26, "id": "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", "originalText": "{合同名称}", "publicText": "材料主次条款A2026合同", "fontFamily": "方正小标宋简体", "fontSizePt": 22},
  {"paragraphIndex": 31, "id": "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72", "originalText": "第一条  货物名称、规格型号、数量、价格等", "publicText": "第一条  货物名称、规格型号、数量、价格等", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 52, "id": "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522", "originalText": "3.合同履行过程中风险处置办法", "publicText": "3.合同履行过程中风险处置办法", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 59, "id": "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120", "originalText": "第二条  质量技术标准及相关要求", "publicText": "第二条  质量技术标准及相关要求", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 61, "id": "039bb580de810755a55899ee448ff7640b3799cfe619ce0e0c82d2b3ada831bf", "originalText": "第三条  交货时间、方式及供货期间", "publicText": "第三条  交货时间、方式及供货期间", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 69, "id": "3e8a650210ab5f8b52981a421514a6a5a78798ad9e81273da0719a1c71377d72", "originalText": "第四条  货物的包装标准和包装物的提供与回收", "publicText": "第四条  货物的包装标准和包装物的提供与回收", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 72, "id": "9064f42005092444fed3adda9c53cddc3ca84692909d94cb507c42c81acb55ed", "originalText": "第五条  验收", "publicText": "第五条  验收", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 74, "id": "ac328837c96accb7aa3ff7db00b7bd5223aa77b6a84e4793abcb0d9a176b3624", "originalText": "2.数量验收", "publicText": "2.数量验收", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 77, "id": "de98f02131af525488a5d73adc8b5265dd27d5d150ab923c85be438b215de38a", "originalText": "3.质量验收", "publicText": "3.质量验收", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 84, "id": "19d6291bf8a6d3c14d54a89f30c950adcf15a12764690ca459c65f53ef3eb075", "originalText": "第六条  货款的对账与结算", "publicText": "第六条  货款的对账与结算", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 91, "id": "a0f5a2e8f22c196835b7d085893c7d47523fdb72475fa3cd4101d06f0698fbe3", "originalText": "第七条 发票有关事项", "publicText": "第七条 发票有关事项", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 94, "id": "6be1a8bfe0211957fc11a8861ae6d8ec35d589a78056d57e5ea78c3544116e0d", "originalText": "2.增值税发票开具时间和类型的要求：", "publicText": "2.增值税发票开具时间和类型的要求：", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 110, "id": "58ff088727aa74cd1bb34b02c2033a4ae30acbd278505946b15aab0ef3bd2352", "originalText": "第八条  货款的支付", "publicText": "第八条  货款的支付", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 118, "id": "a17506241d1a2cb53df88aefc5cecdf926f2e2d55d1f2a4dc96e71afecd9c986", "originalText": "第九条  质量保证期", "publicText": "第九条  质量保证期", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 122, "id": "aa99e0cb52e990b1edf2e042229abc99afc7a1bece3057bd90cd13f9fcf4b26e", "originalText": "第十条  相关服务", "publicText": "第十条  相关服务", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 127, "id": "1b3553e4c646773f99f4a4983be098d476045104186bfdfb95a6f06bf15ac4c0", "originalText": "第十一条  履约担保", "publicText": "第十一条  履约担保", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 130, "id": "8d356cdc5ebfbb141351410cfbf8c96216214cbe87e7ea82bea57066a9891902", "originalText": "第十二条  环境保护及安全要求", "publicText": "第十二条  环境保护及安全要求", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 137, "id": "bf25bcd6c599decc20c375ae45aecc75bd5a73e5ab7174ca93bf1fdfa8a75470", "originalText": "第十三条  廉洁条款", "publicText": "第十三条  廉洁条款", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 142, "id": "4541bd2de1e5b14bb00626ee5e13bb7d9a153ce9747c476a6cc876d0acac46d5", "originalText": "第十四条  双方的权利和义务", "publicText": "第十四条  双方的权利和义务", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 143, "id": "44d0ab6686fd7717df52502628343e16a7d907b3c3ed3cf172fad0a9c43d8d54", "originalText": "(一) 买方的权利和义务", "publicText": "(一) 买方的权利和义务", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 151, "id": "59c0e04d0d5b8eb4190bcf282128d1e5bcf839fcf7580a4a09387f5d57e8763d", "originalText": "(二) 卖方的权利和义务", "publicText": "(二) 卖方的权利和义务", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 168, "id": "1d0ac78debd74f3cf2357007d8268d754fe4041d64a521b07dec5519f2139989", "originalText": "第十五条  违约责任", "publicText": "第十五条  违约责任", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 180, "id": "d1540407cb236b11a00d3ba56a3cf03c014c2071ec34600ead2cead537910f04", "originalText": "第十六条  保密", "publicText": "第十六条  保密", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 182, "id": "9dccecdf0a84fd400b8a35dc8ea32c50e74641fced9f0ad15d9798392ec340a7", "originalText": "第十七条  不可抗力", "publicText": "第十七条  不可抗力", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 184, "id": "b7d7e75afe728e71dd0deb3f77094c83befb99b73229beba8c71670667ddceb0", "originalText": "第十八条  争议的解决", "publicText": "第十八条  争议的解决", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 186, "id": "47ed4b1e12d481f93d46b90f4680d85c23335d96bd18824547e4760127b63bd4", "originalText": "第十九条  合同生效、合同的终止与解除", "publicText": "第十九条  合同生效、合同的终止与解除", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 192, "id": "ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", "originalText": "第二十条  工作联络", "publicText": "第二十条  工作联络", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 196, "id": "8612ac838c3965a150d63f65bdc87b3b758ec008b63567c13f48a2b4dca61fb9", "originalText": "第二十一条  其他约定事项", "publicText": "第二十一条  其他约定事项", "fontFamily": "黑体", "fontSizePt": 14},
] as const;
const unclassifiedControls = [
  {"paragraphIndex": 104, "id": "19d19f7bd96a4e831b092331e6849e265b5a4fbc18ed92214c6dc8ac68b48722", "text": "5.增值税专用发票丢失的补救措施：若买方发生丢失增值税专用发票发票联或抵扣联的情况,则卖方必须向买方提供该增值税专用发票记账联复印件等资料。 ", "fontFamily": "仿宋_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 108, "id": "ceecc16852ac1d0b47b4a95b36af279e7f12309ec679d564876eca7f1a68d083", "text": "9.特别约定：由于国家政策的调整引起的合同相关要件的变更，将以国家政策为准，以适用国家政策规定。", "fontFamily": "仿宋_GB2312", "fontSizePt": 14},
] as const;
const ordinarySource = {"id": "83d59eb52c32699fa63475d380aac6eb0c17e0eafe7411b51456fc07dbe930bf", "text": "4.若卖方违背上述规定且经买方法人单位或其上级纪委监察机关查实认定，或国家司法机关立案查处，视为卖方违约，卖方承担暂定合同总价的10%的违约金，违约金及卖方因违背廉洁规定行为所取得的不当利益一并在结算中扣除。", "expectedFamily": "仿宋_GB2312", "expectedSizePt": 14} as const;
// Independent44be source partition1dc28a50 and literal inputf1fcb8ee; not derived from production formatter.
const mainBodySource = [
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
const excludedSourceIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 58, 109, 200, 201, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220] as const;
const spacingAdditions = [
  {
    "id": "body-spacing-one",
    "afterPositionId": "1effe94f5d3806f8196c84327e1d3cfb78f32617db7ea9d0216933674478f9c7",
    "text": "双方另行确认本批材料交付前应共同核对运输批次、现场接收人员和进场资料；货物到场后依照原合同约定办理数量核验、质量检查及书面交接，发现差异应当记录具体项目并及时通知对方；所有补充记录均随本次合同正文保留，未经双方确认不得替代原合同约定。",
    "expectedPublicText": "补充条款1：双方另行确认本批材料交付前应共同核对运输批次、现场接收人员和进场资料；货物到场后依照原合同约定办理数量核验、质量检查及书面交接，发现差异应当记录具体项目并及时通知对方；所有补充记录均随本次合同正文保留，未经双方确认不得替代原合同约定。"
  },
  {
    "id": "body-spacing-two",
    "afterPositionId": "1effe94f5d3806f8196c84327e1d3cfb78f32617db7ea9d0216933674478f9c7",
    "text": "本补充条款仅用于约定现场协同程序：送货人员到场后应核实接收区域与交接信息，双方逐项记录实际到货品种、规格、数量及资料完整情况；对需要复核的事项保留原始记录，确认结果通过双方约定方式反馈，不以未确认口头说明变更原合同的价格、税率或付款条件。",
    "expectedPublicText": "补充条款2：本补充条款仅用于约定现场协同程序：送货人员到场后应核实接收区域与交接信息，双方逐项记录实际到货品种、规格、数量及资料完整情况；对需要复核的事项保留原始记录，确认结果通过双方约定方式反馈，不以未确认口头说明变更原合同的价格、税率或付款条件。"
  }
] as const;
const spacingAnchor = {"globalIndex": 51, "part": "word/document.xml", "text": "2.本合同的数量为暂估，以实际交货并经验收合格的数量为准，当合同执行数量不能达到合同签订量时，以合同执行数量结算，卖方自愿承担合同签订量未发生部分的风险。", "id": "1effe94f5d3806f8196c84327e1d3cfb78f32617db7ea9d0216933674478f9c7", "domain": "MAIN_CONTRACT_BODY", "pPrXml": "<ns0:pPr xmlns:ns0=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><ns0:spacing ns0:before=\"0\" ns0:after=\"0\" ns0:line=\"500\" ns0:lineRule=\"exact\" /><ns0:ind ns0:firstLine=\"480\" ns0:firstLineChars=\"200\" /><ns0:rPr><ns0:rFonts ns0:ascii=\"Times New Roman\" ns0:hAnsi=\"Times New Roman\" ns0:eastAsia=\"仿宋_GB2312\" ns0:cs=\"Times New Roman\" /><ns0:sz ns0:val=\"28\" /><ns0:szCs ns0:val=\"28\" /><ns0:highlight ns0:val=\"none\" /></ns0:rPr></ns0:pPr>"} as const;

type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string };

describe("task10 material full main-body Word spacing and adjacent added paragraphs in one actual pair", () => {
  it("qualifies all154 source body positions and two adjacent additions, first checking p52 effective25pt and zero paragraph spacing", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("材料154正文与两相邻新增段25磅属性实际检查需要原锁定物理环境");
    const repository = await task10HttpRepository(__dirname);
    expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(legacyRuntimePath);
    expect(process.env.CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
    expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
    expect(sha(await readFile(legacyRuntimePath))).toBe(legacyRuntimeSha);
    expect(sha(await readFile(runtimePath))).toBe(runtimeSha); expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(legacyLockSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock-material-body25-v4.json")))).toBe(lockSha);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-body-spacing-export-"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
    const beforeScratch = await readdir(runtime.scratchDirectory);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      const rows = [{ clientRowKey: "v2-full-role-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const factSave = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(factSave.status === 200 ? "OK" : await factSave.text()).toBe("OK");
      const firstResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(firstResponse.status).toBe(200);
      const before = await firstResponse.json() as PublicBody;
      const ordered = before.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => before.blocks.find(block => block.id === node.paragraphId)!);
      expect(ordered.every(Boolean)).toBe(true);
      const titles = ordered.filter(block => block.text === "上游新建当前合同名称"); expect(titles).toHaveLength(2);
      const [cover, bodyTitle] = titles; const coverAt = ordered.indexOf(cover), titleAt = ordered.indexOf(bodyTitle);
      expect(coverAt).toBeLessThan(titleAt);
      expect(ordered.slice(coverAt + 1, titleAt).some(block => block.text.startsWith("合同编号："))).toBe(true);
      expect(ordered.slice(coverAt + 1, titleAt).some(block => block.text.startsWith("签订日期："))).toBe(true);
      const articles = ordered.filter(block => block.text === articleText); expect(articles).toHaveLength(1);
      const article = articles[0]; expect(titleAt).toBeLessThan(ordered.indexOf(article));
      expect(ordered.slice(titleAt + 1, ordered.indexOf(article)).some(block => block.text.trim() === "买方：当前单甲方")).toBe(true);
      expect(ordered.slice(titleAt + 1, ordered.indexOf(article)).some(block => block.text.trim() === "卖方：当前单乙方")).toBe(true);
      expect([cover.id, bodyTitle.id, article.id]).toEqual(["fe8a01bb7008d14107fd6abe3584dee8f92c5544c883bbd85c67e4dcadd4a17c", "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72"]);
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背")); expect(ordinary).toBeDefined();
      expect(ordinary).toMatchObject({ id: ordinarySource.id, text: ordinarySource.text, editable: true });
      const manualText = ordinarySource.text + "双方人工补充约定应当保留。";
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json(); expect(current.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // All fact setup is public. The traced save omits the server-owned profile.
      const draftData: Record<string, unknown> = { ...current.version.draftData, contractName: title,
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
          edits: [{ positionId: ordinary!.id, text: manualText }],
          additions: spacingAdditions.map(({ id, afterPositionId, text }) => ({ id, afterPositionId, text })) } };
      delete draftData.documentRenderProfile;
      expect(Object.hasOwn(draftData, "documentRenderProfile")).toBe(false);
      const aggregateInput = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData,
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      };
      await writeFile(join(directory, "public-save-without-profile.json"), JSON.stringify(aggregateInput, null, 2));
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(aggregateInput) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200); const wb = await wbResponse.json();
      expect(wb.version).toMatchObject({ amountYuan: "6.5000", numericProtocolVersion: 2, taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" },
        draftData: { contractName: title } });
      const typographyVersion: unknown = wb.version.draftData.documentRenderProfile?.typographyVersion;
      expect(typeof typographyVersion).toBe("string"); expect(typographyVersion).toMatch(/^[a-z0-9-]+$/u);
      const serverRenderProfile = wb.version.draftData.documentRenderProfile;
      expect(Object.hasOwn(draftData, "documentRenderProfile")).toBe(false);
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.version.documentContentFingerprint).not.toBe(current.version.documentContentFingerprint);
      expect(wb.bills).toHaveLength(1); expect(wb.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(1); expect(wb.bills[0].rows[0]).toMatchObject({ itemName: "正文清单钢材", quantity: "2", unit: "吨", unitPrice: "3.25", taxRatePercent: "0", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200); const body = await bodyResponse.json() as PublicBody;
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      const addedIds = spacingAdditions.map(addition => "added:" + addition.id);
      for (const addition of spacingAdditions) expect(body.blocks.find(block => block.id === "added:" + addition.id)).toMatchObject({
        text: addition.expectedPublicText, editable: true, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 }
      });
      const boundedReferences = (flow: ContractBodyFlow[], blocks: ContractBodyParagraph[]) => {
        expect(flow.filter(node => node.kind === "table")).toHaveLength(2);
        const references: Array<{ address: string; id: string }> = [];
        for (const [topIndex, node] of flow.entries()) {
          if (node.kind === "paragraph") references.push({ address: `top:${topIndex}`, id: node.paragraphId });
          else for (const [rowIndex, row] of node.rows.entries()) for (const [cellIndex, cell] of row.cells.entries()) {
            expect(cell.flow.every(child => child.kind === "paragraph")).toBe(true);
            const cellParagraphs = cell.flow.map(child => { if (child.kind !== "paragraph") throw new Error("Unsupported nested table in material spacing fixture"); return child.paragraphId; });
            expect(cell.paragraphIds).toEqual(cellParagraphs);
            for (const [paragraphIndex, id] of cellParagraphs.entries()) references.push({ address: `top:${topIndex}/row:${rowIndex}/cell:${cellIndex}/paragraph:${paragraphIndex}`, id });
          }
        }
        expect(new Set(blocks.map(block => block.id)).size).toBe(blocks.length);
        expect(new Set(references.map(reference => reference.id)).size).toBe(references.length);
        expect(references.map(reference => reference.id).sort()).toEqual(blocks.map(block => block.id).sort());
        return references;
      };
      const beforeReferences = boundedReferences(before.flow, before.blocks);
      boundedReferences(body.flow, body.blocks); // Full current snapshot, including both additions, has no orphan or unreferenced block.
      const withoutAddedFlow = body.flow.filter(node => !(node.kind === "paragraph" && addedIds.includes(node.paragraphId)));
      expect(body.flow.length - withoutAddedFlow.length).toBe(2);
      const afterReferences = boundedReferences(withoutAddedFlow, body.blocks.filter(block => !addedIds.includes(block.id)));
      expect(afterReferences.map(reference => reference.address)).toEqual(beforeReferences.map(reference => reference.address));
      const aliases = new Map<string, string>();
      for (const [index, reference] of beforeReferences.entries()) {
        const next = afterReferences[index];
        const originalBlock = before.blocks.find(block => block.id === reference.id)!;
        const actualBlock = body.blocks.find(block => block.id === next.id)!;
        if (/^generated:\d+$/u.test(reference.id)) {
          expect(next.id).toMatch(/^generated:\d+$/u);
          for (const block of [originalBlock, actualBlock]) {
            expect(block).toMatchObject({ kind: "paragraph", editable: false, blankFields: [] }); expect(block.text.trim()).toBe("");
          }
          expect({ ...actualBlock, id: originalBlock.id }).toEqual(originalBlock);
          expect(addedIds.includes(next.id)).toBe(false); aliases.set(reference.id, next.id);
        } else expect(next.id).toBe(reference.id); // Every original/duplicate source ID, including the manual-edit anchor, stays exact.
      }
      expect(new Set(aliases.values()).size).toBe(aliases.size);
      const mappedId = (id: string) => aliases.get(id) ?? id;
      expect(new Set(before.blocks.map(block => mappedId(block.id))).size).toBe(before.blocks.length);
      const expectedBlocks = before.blocks.flatMap(block => [
        { ...block, id: mappedId(block.id), text: block.id === ordinarySource.id ? manualText : block.id === cover.id || block.id === bodyTitle.id ? title : block.text },
        ...(block.id === spacingAnchor.id ? spacingAdditions.map(addition => body.blocks.find(value => value.id === "added:" + addition.id)!) : [])
      ]);
      expect(body.blocks).toEqual(expectedBlocks);
      const expectedFlow = before.flow.map(node => node.kind === "paragraph" ? { ...node, paragraphId: mappedId(node.paragraphId) } : {
        ...node, rows: node.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, paragraphIds: cell.paragraphIds.map(mappedId),
          flow: cell.flow.map(child => { if (child.kind !== "paragraph") throw new Error("Unsupported nested table in material spacing fixture"); return { ...child, paragraphId: mappedId(child.paragraphId) }; }) })) }))
      });
      const sourceAnchorFlow = expectedFlow.flatMap((node, index) => node.kind === "paragraph" && node.paragraphId === spacingAnchor.id ? [index] : []);
      expect(sourceAnchorFlow).toHaveLength(1);
      expectedFlow.splice(sourceAnchorFlow[0] + 1, 0, ...addedIds.map(paragraphId => ({ kind: "paragraph" as const, paragraphId })));
      expect(body.flow).toEqual(expectedFlow);
      await writeFile(join(directory, "public-qualified-temporary-ids.json"), JSON.stringify({ beforeReferences, afterReferences,
        aliases: Array.from(aliases, ([oldId, newId]) => ({ oldId, newId })),
        scope: "Complete bounded flow addresses, full payload and every reference preserved. No crossrevision generated ordinal promise or source identity inferred from ordinal." }, null, 2));
      const stableBodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(stableBodyResponse.status).toBe(200);
      expect(await stableBodyResponse.json()).toEqual(body); // No same-revision temporary-ID relaxation.
      const bodyTopIds = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      const publicMainBodies = mainBodySource.map(([globalIndex, id, originalText]) => {
        const originalBlock = before.blocks.filter(block => block.id === id); expect(originalBlock).toHaveLength(1);
        const actualBlock = body.blocks.filter(block => block.id === id); expect(actualBlock).toHaveLength(1);
        expect(bodyTopIds.filter(value => value === id)).toHaveLength(1);
        expect(actualBlock[0].text).toBe(id === ordinarySource.id ? manualText : globalIndex === 26 ? title : originalBlock[0].text);
        return { globalIndex, id, originalText, expectedText: actualBlock[0].text };
      });
      expect(publicMainBodies).toHaveLength(154);
      expect(publicMainBodies.map(position => bodyTopIds.indexOf(position.id))).toEqual(publicMainBodies.map(position => bodyTopIds.indexOf(position.id)).slice().sort((a, b) => a - b));
      await writeFile(join(directory, "public-workbench.json"), JSON.stringify(wb, null, 2));
      await writeFile(join(directory, "public-spacing-input.json"), JSON.stringify({ sourceSha256: sourceSha, mainBodySource, excludedSourceIndices, spacingAnchor,
        spacingAdditions, publicMainBodies, manualText, serverRenderProfile, normativeSpacing: { line: 500, lineRule: "exact", before: 0, after: 0 },
        scope: "DOCX effective parameters only; PDF net-baseline and physical font program proof are separate" }, null, 2));
      expect(body.blocks.find(block => block.id === ordinary!.id)).toMatchObject({ text: manualText, editable: true });
      for (const [id, text, family, size] of [[cover.id, title, "方正小标宋简体", 22], [bodyTitle.id, title, "方正小标宋简体", 22], [article.id, articleText, "黑体", 14]] as const)
        expect(body.blocks.find(block => block.id === id)).toMatchObject({ text, format: { fontFamily: family, fontSizePt: size } });
      expect(roleExpectations).toHaveLength(28);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(28);
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({
        id: role.id, text: role.publicText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt }
      });
      for (const control of unclassifiedControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({
        text: control.text, format: { fontFamily: control.fontFamily, fontSizePt: control.fontSizePt }
      });
      const roleIds = new Set<string>(roleExpectations.map(role => role.id));
      expect(body.blocks.filter(block => !roleIds.has(block.id) && !addedIds.includes(block.id)).map(block => [block.id, block.format])).toEqual(
        before.blocks.filter(block => !roleIds.has(block.id)).map(block => [mappedId(block.id), block.format]));
      await writeFile(join(directory, "public-spacing-saved-facts.json"), JSON.stringify({ wb, body, roleExpectations,
        profileOmittedFromTracedSave: !Object.hasOwn(draftData, "documentRenderProfile"), exportOrNativeYet: false }, null, 2));
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table"); expect(tables.map(table => table.rows.length)).toEqual([2, 1]);
      const sameResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(sameResponse.status).toBe(200);
      expect((await sameResponse.json()).version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(body, null, 2));
      await writeFile(join(directory, "normative-role-context.json"), JSON.stringify({ sourceSha256: sourceSha, title,
        typographyVersion, roleExpectations, unclassifiedControls, coverId: cover.id, ordinaryId: ordinary!.id,
        manualText, totalLiteral, expectedLatin: "Times New Roman", actualPairPaths: {
          docx: join(directory, "actual.docx"), pdf: join(directory, "actual.pdf") },
        limits: ["Word28 role/rPr/pPr proof first", "PDF28 program/GID/outline/size association is a separate observer"] }, null, 2));
      const documentsBefore = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(documentsBefore.status).toBe(200); expect(await documentsBefore.json()).toEqual([]);
      const asRunPaths = ["services/api/src/contract-template/task10-http-repository.test-support.ts", "services/api/src/contract-template/task10-material-body-spacing-export.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/task10-material-primary-secondary-roles.http.spec.ts", "services/api/src/contract-template/task09-draft-template.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-workbench/contract-workbench.service.ts", "services/api/src/contract-template/template-pdf-physical.test-support.ts", "services/api/test-support/inspect-contract-pdf-physical.py"];
      await writeFile(join(directory, "as-run-source-pins.json"), JSON.stringify(await Promise.all(asRunPaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      upload.mockClear();
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK"); const generation = await queued.json();
      expect(generation).toMatchObject({ status: "queued", documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const list = async () => { const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return await response.json(); };
      const frozen = { purpose: "draft", layoutTemplateVersionId: layout.id, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { sourceSha256: sourceSha, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", typographyVersion, signatureDateVersion: "reviewed-material-signature-date-v1", pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha },
          renderInput: { values: { "contract.typographyVersion": typographyVersion, "contract.signatureDateVersion": "reviewed-material-signature-date-v1", "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.taxRateLabel": "0%", "contract.amountBasis": "tax_inclusive", "contract.taxInclusiveAmount": "6.5000", "contract.taxExclusiveAmount": "6.5000", "contract.taxAmount": "0.0000" } } } };
      const queuedDocument = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(queuedDocument).toMatchObject({ ...frozen, status: "queued" });
      // Exact public tuple, independent of the service's private key helper.
      const queuedKeyTuple = [draft.version.id, body.documentContentRevision, wb.version.documentContentFingerprint, layout.id, "draft", [],
        "contract-body-docx4j-v1", lockSha, "contract-money-v1", "body-bill-loop-v2", typographyVersion, "reviewed-material-signature-date-v1"];
      expect(queuedDocument.idempotencyKey).toBe(sha(JSON.stringify(queuedKeyTuple)));
      await writeFile(join(directory, "public-spacing-queued-key.json"), JSON.stringify({ queuedKeyTuple, queuedDocument }, null, 2));
      const workerStarted = performance.now(); let workerOverBudget = false;
      const timer = setTimeout(() => { workerOverBudget = true; }, 130_000);
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { clearTimeout(timer); await writeFile(join(directory, "worker-budget.json"), JSON.stringify({ elapsedMs: performance.now() - workerStarted, budgetMs: 130_000, ownedOperationSettled: true })); }
      expect(workerOverBudget).toBe(false); expect(performance.now() - workerStarted).toBeLessThanOrEqual(130_000);
      const output = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(output).toMatchObject({ ...frozen, status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      expect(output.idempotencyKey).toBe(queuedDocument.idempotencyKey);
      expect(output.inputSnapshot.inspection.runtime).toMatchObject({ engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const scratch = (await readdir(runtime.scratchDirectory)).filter(name => !beforeScratch.includes(name)); expect(scratch).toHaveLength(1);
      const completed = JSON.parse(await readFile(join(runtime.scratchDirectory, scratch[0], "completed.json"), "utf8"));
      expect(completed).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const rawPdf = join(runtime.scratchDirectory, scratch[0], "output.pdf"); expect((await stat(rawPdf)).size).toBeLessThanOrEqual(100_000_000); expect(sha(await readFile(rawPdf))).toBe(completed.pdfSha256);
      await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(completed, null, 2));
      const files = {} as Record<"docx" | "pdf", Buffer>;
      for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const capability = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket-capability`, { headers: draft.headers }); expect(capability.status).toBe(200);
        expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
        const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "材料154正文与两相邻新增段25磅属性当前草稿双格式及原条款核验" }) }); expect(ticket.status).toBe(201);
        const { downloadUrl } = await ticket.json(); expect(downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u); const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(downloaded.status).toBe(200);
        files[format] = Buffer.from(await downloaded.arrayBuffer()); await writeFile(join(directory, "actual." + format), files[format]);
      }
      expect(sha(files.docx)).toBe(output.inputSnapshot.inspection.runtime.exportedDocxSha256); expect(sha(files.pdf)).toBe(output.inputSnapshot.inspection.runtime.exportedPdfSha256);
      expect(files.pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(files.pdf.length).toBeLessThanOrEqual(100_000_000);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ sourceSha256: sourceSha, generation, output,
        docxSha256: sha(files.docx), pdfSha256: sha(files.pdf), verdict: "PENDING", legalSigningAcceptance: false }, null, 2));

      const zip = new PizZip(files.docx), original = new PizZip(source); const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml"); const word = parse(zip.file("word/document.xml")!.asText()), sourceWord = parse(original.file("word/document.xml")!.asText());
      const textOf = (element: Element) => Array.from(element.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("");
      const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")), sourceParagraphs = Array.from(sourceWord.getElementsByTagNameNS(ns, "p"));
      const texts = paragraphs.map(textOf), sourceTexts = sourceParagraphs.map(textOf), compact = (s: string) => s.replace(/\s/gu, "");
      expect(texts).toContain(totalLiteral); expect(texts).toContain(manualText); expect(texts.filter(text => text === title)).toHaveLength(2);
      for (const text of sourceTexts.filter(text => text.trim() && !/[{}]/u.test(text) && text !== ordinary!.text)) expect(texts).toContain(text);
      const titleParagraphs = paragraphs.filter(p => textOf(p) === title); expect(titleParagraphs).toHaveLength(2);
      const sourceTitles = sourceParagraphs.filter(p => textOf(p) === "{合同名称}"); expect(sourceTitles).toHaveLength(2);
      const articleParagraphs = paragraphs.filter(p => textOf(p) === articleText); expect(articleParagraphs).toHaveLength(1);
      const sourceArticles = sourceParagraphs.filter(p => textOf(p) === articleText); expect(sourceArticles).toHaveLength(1);
      // Source order identifies cover then body title; no observed font chooses roles.
      expect(paragraphs.indexOf(titleParagraphs[0])).toBeLessThan(paragraphs.indexOf(titleParagraphs[1]));
      expect(paragraphs.indexOf(titleParagraphs[1])).toBeLessThan(paragraphs.indexOf(articleParagraphs[0]));
      const direct = (parent: Element, name: string) => Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === ns && (node as Element).localName === name);
      const serialized = (element: Element) => new XMLSerializer().serializeToString(element);
      const sourceBody = sourceWord.getElementsByTagNameNS(ns, "body")[0];
      const actualBody = word.getElementsByTagNameNS(ns, "body")[0];
      const publicParagraphs = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph")
        .map(node => body.blocks.find(block => block.id === node.paragraphId)!);
      expect(publicParagraphs.every(Boolean)).toBe(true);
      const actualTop = direct(actualBody, "p").filter(paragraph => textOf(paragraph).trim().length > 0);
      const meaningfulPublic = publicParagraphs.filter(block => block.text.trim().length > 0);
      // Exact complete top-level sequence disambiguates repeated literals by public identity and source order, not font/size.
      expect(actualTop.map(textOf)).toEqual(meaningfulPublic.map(block => block.text));
      const wordForPublicId = (id: string) => {
        const indices = meaningfulPublic.flatMap((block, index) => block.id === id ? [index] : []); expect(indices).toHaveLength(1);
        return actualTop[indices[0]];
      };
      expect(sourceParagraphs).toHaveLength(221);
      expect([...mainBodySource.map(([index]) => index), ...excludedSourceIndices].sort((a, b) => a - b)).toEqual(Array.from({ length: 221 }, (_, index) => index));
      const sourceWordPositions = mainBodySource.map(([index, id, originalText]) => {
        const originalParagraph = sourceParagraphs[index]; expect(originalParagraph.parentNode).toBe(sourceBody);
        expect(textOf(originalParagraph)).toBe(originalText); expect(sha(JSON.stringify([sourceSha, "word/document.xml", index, originalText]))).toBe(id);
        const paragraph = wordForPublicId(id); expect(paragraph.parentNode).toBe(actualBody);
        return { index, id, originalText, actualText: textOf(paragraph), actualIndex: paragraphs.indexOf(paragraph) };
      });
      const addedWord = spacingAdditions.map(addition => wordForPublicId("added:" + addition.id));
      const actualChildren = direct(actualBody, "p"); const anchorWord = wordForPublicId(spacingAnchor.id);
      expect(addedWord.map(textOf)).toEqual(spacingAdditions.map(addition => addition.expectedPublicText));
      const bodyElements = Array.from(actualBody.childNodes).filter((node): node is Element => node.nodeType === 1);
      expect(bodyElements[bodyElements.indexOf(anchorWord) + 1]).toBe(addedWord[0]); expect(bodyElements[bodyElements.indexOf(addedWord[0]) + 1]).toBe(addedWord[1]);
      expect(actualChildren.indexOf(addedWord[1])).toBe(actualChildren.indexOf(addedWord[0]) + 1);
      for (const paragraph of addedWord) for (const name of ["br", "pageBreakBefore", "sectPr", "drawing", "fldChar", "instrText"]) expect(paragraph.getElementsByTagNameNS(ns, name).length).toBe(0);
      const styles = parse(zip.file("word/styles.xml")!.asText());
      const spacingProperties = ["line", "lineRule", "before", "after", "beforeLines", "afterLines", "beforeAutospacing", "afterAutospacing"] as const;
      const spacingDefaults = { line: "240", lineRule: "auto", before: "0", after: "0", beforeLines: "0", afterLines: "0", beforeAutospacing: "0", afterAutospacing: "0" };
      // A property resolver, not a rendering oracle. Unknown style ancestry never falls back to Normal.
      const effectiveSpacing = (paragraph: Element, styleDocument = styles) => {
        const declarations: Array<{ owner: string; pPr: Element }> = [];
        const pPrs = direct(paragraph, "pPr"); expect(pPrs.length).toBeLessThanOrEqual(1);
        if (pPrs[0]) declarations.push({ owner: "direct", pPr: pPrs[0] });
        const styleElements = Array.from(styleDocument.getElementsByTagNameNS(ns, "style")).filter(style => style.getAttributeNS(ns, "type") === "paragraph");
        const defaultStyles = styleElements.filter(style => {
          const flag = style.getAttributeNS(ns, "default");
          if (flag === null) return false;
          if (!flag.length) throw new Error("Unresolved empty default-style flag");
          return ["1", "true", "on"].includes(flag);
        });
        const pStyle = pPrs[0] ? direct(pPrs[0], "pStyle") : []; expect(pStyle.length).toBeLessThanOrEqual(1);
        let styleId = pStyle[0]?.getAttributeNS(ns, "val"); let unknown: string | null = null;
        if (!styleId) { if (defaultStyles.length > 1) unknown = "ambiguous default paragraph style"; else styleId = defaultStyles[0]?.getAttributeNS(ns, "styleId"); }
        const seen = new Set<string>();
        while (styleId && !unknown) {
          if (seen.has(styleId)) { unknown = "cyclic style " + styleId; break; } seen.add(styleId);
          const matches = styleElements.filter(style => style.getAttributeNS(ns, "styleId") === styleId);
          if (matches.length !== 1) { unknown = "missing or ambiguous style " + styleId; break; }
          const stylePPr = direct(matches[0], "pPr"); expect(stylePPr.length).toBeLessThanOrEqual(1);
          if (stylePPr[0]) declarations.push({ owner: "style:" + styleId, pPr: stylePPr[0] });
          const basedOn = direct(matches[0], "basedOn"); expect(basedOn.length).toBeLessThanOrEqual(1); styleId = basedOn[0]?.getAttributeNS(ns, "val");
        }
        const defaults = Array.from(styleDocument.getElementsByTagNameNS(ns, "docDefaults")); expect(defaults.length).toBeLessThanOrEqual(1);
        if (defaults[0]) { const pPrDefault = direct(defaults[0], "pPrDefault"); expect(pPrDefault.length).toBeLessThanOrEqual(1);
          const defaultsPPr = pPrDefault[0] ? direct(pPrDefault[0], "pPr") : []; expect(defaultsPPr.length).toBeLessThanOrEqual(1);
          if (defaultsPPr[0] && !unknown) declarations.push({ owner: "docDefaults", pPr: defaultsPPr[0] }); }
        const completeZeroNumPr = (numPr: Element) => {
          const attributes = (element: Element) => Array.from(element.attributes).filter(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/");
          const children = Array.from(numPr.childNodes).filter((node): node is Element => node.nodeType === 1);
          const ilvl = direct(numPr, "ilvl"), numId = direct(numPr, "numId");
          const zero = (element: Element) => attributes(element).length === 1 && attributes(element)[0].namespaceURI === ns &&
            attributes(element)[0].localName === "val" && attributes(element)[0].value === "0" && !element.childNodes.length;
          return attributes(numPr).length === 0 && children.length === 2 && ilvl.length === 1 && numId.length === 1 &&
            children[0] === ilvl[0] && children[1] === numId[0] && zero(ilvl[0]) && zero(numId[0]) &&
            !Array.from(numPr.childNodes).some(node => node.nodeType !== 1 && Boolean(node.nodeValue?.trim()));
        };
        // The first (most-specific) complete zero disables numbering; ancestor active numbering is then irrelevant.
        // It does not resolve missing/cyclic style ancestry or tracked paragraph properties.
        const numberingDeclaration = declarations.find(({ pPr }) => direct(pPr, "numPr").length > 0);
        const numbering = { status: "NONE", owner: null as string | null };
        if (numberingDeclaration) {
          const definitions = direct(numberingDeclaration.pPr, "numPr"); numbering.owner = numberingDeclaration.owner;
          numbering.status = definitions.length === 1 && completeZeroNumPr(definitions[0]) ? "NUMBERING_DISABLED" : "UNKNOWN";
        }
        const trackedPPr = declarations.some(({ pPr }) => direct(pPr, "pPrChange").length > 0);
        if (numbering.status === "UNKNOWN") unknown ??= "unsupported nonzero, partial or changed numbering";
        if (trackedPPr) unknown ??= "tracked pPr";
        const result: Record<string, { value: string | null; owner: string }> = {};
        for (const property of spacingProperties) {
          for (const declaration of declarations) { const spacing = direct(declaration.pPr, "spacing"); expect(spacing.length).toBeLessThanOrEqual(1);
            if (spacing[0]?.hasAttributeNS(ns, property)) { result[property] = { value: spacing[0].getAttributeNS(ns, property), owner: declaration.owner }; break; } }
          result[property] ??= { value: unknown ? null : spacingDefaults[property], owner: unknown ?? "OOXML-default" };
        }
        for (const declaration of declarations) { const contextual = direct(declaration.pPr, "contextualSpacing"); expect(contextual.length).toBeLessThanOrEqual(1);
          if (contextual[0]) {
            expect(Array.from(contextual[0].attributes).filter(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/").map(attribute => [attribute.namespaceURI, attribute.localName])).toEqual(
              contextual[0].hasAttributeNS(ns, "val") ? [[ns, "val"]] : []);
            expect(Array.from(contextual[0].childNodes).some(node => node.nodeType === 1 || Boolean(node.nodeValue?.trim()))).toBe(false);
            result.contextualSpacing = { value: contextual[0].hasAttributeNS(ns, "val") ? contextual[0].getAttributeNS(ns, "val") : "1", owner: declaration.owner }; break;
          } }
        result.contextualSpacing ??= { value: unknown ? null : "0", owner: unknown ?? "OOXML-default" };
        return { chainUnknown: unknown, numbering, trackedPPr, declarations: declarations.map(declaration => declaration.owner), parameters: result };
      };
      const assertNormativeSpacing = (paragraph: Element) => {
        const effective = effectiveSpacing(paragraph);
        // Parameter values stay distinct from contextual/max-spacing suppression and PDF net-baseline observations.
        expect(effective.numbering.status).not.toBe("UNKNOWN"); expect(effective.trackedPPr).toBe(false);
        const p = effective.parameters;
        expect({ line: p.line.value, lineRule: p.lineRule.value, before: p.before.value, after: p.after.value }).toEqual({ line: "500", lineRule: "exact", before: "0", after: "0" });
        expect([p.beforeLines.value, p.afterLines.value]).toEqual(["0", "0"]);
        for (const name of ["beforeAutospacing", "afterAutospacing"]) expect(["0", "false", "off"]).toContain(p[name].value);
        expect(["0", "false", "off", "1", "true", "on"]).toContain(p.contextualSpacing.value);
        return effective;
      };
      const sourceStyles = parse(original.file("word/styles.xml")!.asText());
      const canonicalXml = (element: Element): unknown => [element.namespaceURI, element.localName,
        Array.from(element.attributes).filter(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/")
          .map(attribute => [attribute.namespaceURI ?? "", attribute.localName, attribute.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        Array.from(element.childNodes).flatMap(node => node.nodeType === 1 ? [canonicalXml(node as Element)] :
          (node.nodeType === 3 || node.nodeType === 4) && node.nodeValue?.trim() ? [["text", node.nodeValue]] : [])];
      const styleElements = (document: typeof styles) => Array.from(document.getElementsByTagNameNS(ns, "style"));
      const styleIds = (document: typeof styles) => styleElements(document).map(style => style.getAttributeNS(ns, "styleId"));
      // Narrow support: existing styles only. New/missing style2 also has excluded-source users, so cannot be safely filled in here.
      expect(new Set(styleIds(sourceStyles)).size).toBe(styleIds(sourceStyles).length);
      expect(styleIds(styles)).toEqual(styleIds(sourceStyles));
      const stripStyleSpacing = (styleRoot: Element) => {
        const copy = styleRoot.cloneNode(true) as Element;
        for (const style of Array.from(copy.getElementsByTagNameNS(ns, "style"))) for (const pPr of direct(style, "pPr")) {
          for (const spacing of direct(pPr, "spacing")) {
            for (const key of spacingProperties) spacing.removeAttributeNS(ns, key);
            if (!Array.from(spacing.attributes).some(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/") && !spacing.childNodes.length) pPr.removeChild(spacing);
          }
          for (const contextual of direct(pPr, "contextualSpacing")) {
            expect(Array.from(contextual.attributes).filter(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/").map(attribute => [attribute.namespaceURI, attribute.localName])).toEqual(
              contextual.hasAttributeNS(ns, "val") ? [[ns, "val"]] : []);
            expect(contextual.childNodes.length).toBe(0); pPr.removeChild(contextual);
          }
          if (!pPr.childNodes.length && !Array.from(pPr.attributes).some(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/")) style.removeChild(pPr);
        }
        return copy;
      };
      // Attribute/namespace semantics, not byte or prefix equality; defaults/font/other XML stay exact.
      const actualStylesRoot = styles.documentElement, originalStylesRoot = sourceStyles.documentElement;
      if (!actualStylesRoot || !originalStylesRoot) throw new Error("Unresolved missing source or actual styles root");
      expect(canonicalXml(stripStyleSpacing(actualStylesRoot))).toEqual(canonicalXml(stripStyleSpacing(originalStylesRoot)));
      const changedStyles = styleElements(styles).flatMap((style, index) => {
        const id = style.getAttributeNS(ns, "styleId");
        if (!id?.length) throw new Error("Unresolved missing or empty paragraph style identifier");
        return JSON.stringify(canonicalXml(style)) === JSON.stringify(canonicalXml(styleElements(sourceStyles)[index])) ? [] : [id];
      });
      const usage = (paragraph: Element, document: typeof styles) => effectiveSpacing(paragraph, document).declarations.filter(declaration => declaration.startsWith("style:")).map(declaration => declaration.slice(6));
      const styleUsage = changedStyles.map(id => ({ id,
        sourceUsers: sourceParagraphs.flatMap((paragraph, index) => usage(paragraph, sourceStyles).includes(id) ? [index] : []),
        actualUsers: paragraphs.flatMap((paragraph, index) => usage(paragraph, styles).includes(id) ? [index] : []) }));
      // Align all source body elements, including blank controls. Exactly the two known bill-loop markers disappear;
      // each actual table owns one exact empty post-table separator, never a fuzzy generated-ID filter.
      const originalChildren = Array.from(sourceBody.childNodes).filter((node): node is Element => node.nodeType === 1);
      const loopControls = [sourceParagraphs[32], sourceParagraphs[49]];
      expect(loopControls.map(textOf)).toEqual(["{#材料清单}", "{/材料清单}"]);
      const actualTableElements = direct(actualBody, "tbl"); expect(actualTableElements).toHaveLength(2);
      const actualSyntheticSeparators = actualTableElements.map(table => {
        const next = bodyElements[bodyElements.indexOf(table) + 1]; expect(next).toBeDefined();
        expect([next.namespaceURI, next.localName, next.attributes.length, next.childNodes.length]).toEqual([ns, "p", 0, 0]); return next;
      });
      expect(new Set(actualSyntheticSeparators).size).toBe(2);
      const retainedActualElements = bodyElements.filter(element => !addedWord.includes(element) && !actualSyntheticSeparators.includes(element));
      const retainedSourceElements = originalChildren.filter(element => !loopControls.includes(element));
      expect(retainedActualElements.map(element => [element.namespaceURI, element.localName])).toEqual(retainedSourceElements.map(element => [element.namespaceURI, element.localName]));
      const actualForSource = new Map<Element, Element>();
      for (const [index, element] of retainedSourceElements.entries()) {
        const actualElement = retainedActualElements[index];
        if (element.localName === "p") actualForSource.set(element, actualElement);
        if (element.localName === "tbl") {
          const sourceTableParagraphs = Array.from(element.getElementsByTagNameNS(ns, "p")), actualTableParagraphs = Array.from(actualElement.getElementsByTagNameNS(ns, "p"));
          expect(actualTableParagraphs).toHaveLength(sourceTableParagraphs.length);
          for (const [paragraphIndex, paragraph] of sourceTableParagraphs.entries()) actualForSource.set(paragraph, actualTableParagraphs[paragraphIndex]);
        }
      }
      for (const [index, id] of mainBodySource) expect(actualForSource.get(sourceParagraphs[index])).toBe(wordForPublicId(id));
      const preservedNonTargets = excludedSourceIndices.map(index => {
        const sourceParagraph = sourceParagraphs[index]; const sourceEffective = effectiveSpacing(sourceParagraph, sourceStyles);
        if (loopControls.includes(sourceParagraph)) return { sourceIndex: index, kind: "known-removed-bill-loop-control", sourceEffective, actualEffective: null };
        const actualParagraph = actualForSource.get(sourceParagraph); expect(actualParagraph).toBeDefined();
        expect(direct(actualParagraph!, "pPr").map(canonicalXml)).toEqual(direct(sourceParagraph, "pPr").map(canonicalXml));
        const actualEffective = effectiveSpacing(actualParagraph!);
        // Unknown-to-known is forbidden; unchanged missing style chains stay explicitly UNKNOWN, not a numeric preservation claim.
        expect(actualEffective).toEqual(sourceEffective);
        return { sourceIndex: index, actualIndex: paragraphs.indexOf(actualParagraph!), kind: Object.values(sourceEffective.parameters).some(parameter => parameter.value === null) ? "structurally-preserved-effective-UNKNOWN" : "known-effective-preserved", sourceEffective, actualEffective };
      });
      expect(preservedNonTargets).toHaveLength(67);
      await writeFile(join(directory, "styles-and-nontarget-preservation.json"), JSON.stringify({ changedStyles, styleUsage, preservedNonTargets,
        exactPostTableSeparators: actualSyntheticSeparators.map(paragraph => ({ actualIndex: paragraphs.indexOf(paragraph), effective: effectiveSpacing(paragraph) })),
        limitations: ["Missing source styles2/3 remain UNKNOWN wherever not fully overridden", "No new styles or arbitrary numbering/style transformations supported"] }, null, 2));
      await writeFile(join(directory, "word-spacing-association-before-norm.json"), JSON.stringify({ sourceWordPositions,
        publicParagraphSequence: meaningfulPublic.map(block => ({ id: block.id, text: block.text })), actualTopParagraphs: actualTop.map(textOf),
        additions: spacingAdditions.map((addition, index) => ({ ...addition, actualIndex: paragraphs.indexOf(addedWord[index]) })),
        firstP52EffectiveBeforeAssertion: effectiveSpacing(wordForPublicId("7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522")) }, null, 2));
      // First normative assertion: source p52. A missing style reports unresolved effective attributes, never a PDF non25pt finding.
      assertNormativeSpacing(wordForPublicId("7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522"));
      const spacingFacts = mainBodySource.map(([index, id]) => ({ sourceIndex: index, id, actualIndex: paragraphs.indexOf(wordForPublicId(id)), ...assertNormativeSpacing(wordForPublicId(id)) }));
      const additionSpacingFacts = addedWord.map((paragraph, index) => ({ id: "added:" + spacingAdditions[index].id, actualIndex: paragraphs.indexOf(paragraph), ...assertNormativeSpacing(paragraph) }));
      expect(spacingFacts).toHaveLength(154); expect(additionSpacingFacts).toHaveLength(2);
      await writeFile(join(directory, "word-spacing-qualified-facts.json"), JSON.stringify({ spacingFacts, additionSpacingFacts,
        normativeSpacing: { line: 500, lineRule: "exact", before: 0, after: 0 }, PDFNetGeometryProved: false }, null, 2));
      // Cover's meaningful source paragraphs remain outside the25pt domain. Loop controls and table paragraphs have separate structural checks.
      for (const index of excludedSourceIndices.filter(index => index <= 25)) {
        const originalParagraph = sourceParagraphs[index]; const text = textOf(originalParagraph); if (!text.trim()) continue;
        const id = sha(JSON.stringify([sourceSha, "word/document.xml", index, text]));
        expect(direct(wordForPublicId(id), "pPr").map(serialized)).toEqual(direct(originalParagraph, "pPr").map(serialized));
      }
      const withoutSpacing = (paragraph: Element) => direct(paragraph, "pPr").map(properties => {
        const copy = properties.cloneNode(true) as Element;
        for (const spacing of direct(copy, "spacing").concat(direct(copy, "contextualSpacing"))) copy.removeChild(spacing);
        return serialized(copy);
      });
      for (const [index, id] of mainBodySource) expect(withoutSpacing(wordForPublicId(id))).toEqual(withoutSpacing(sourceParagraphs[index]));
      const visibleRuns = (paragraph: Element) => Array.from(paragraph.getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length > 0);
      // Ignore exactly the version-owned font/size fields; all other source rPr remains.
      const preservedRunProperties = (run: Element) => {
        const properties = direct(run, "rPr")[0];
        if (!properties) return [];
        const copy = properties.cloneNode(true) as Element;
        for (const property of direct(copy, "sz").concat(direct(copy, "szCs"))) copy.removeChild(property);
        for (const fonts of direct(copy, "rFonts")) {
          for (const key of ["eastAsia", "ascii", "hAnsi", "cs", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]) fonts.removeAttributeNS(ns, key);
          if (!fonts.attributes.length) copy.removeChild(fonts);
        }
        return Array.from(copy.childNodes).filter((node): node is Element => node.nodeType === 1).map(serialized);
      };
      const assertVisibleRunFont = (paragraph: Element, family: string, sizePt: number) => {
        const runs = visibleRuns(paragraph); expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) {
          const properties = direct(run, "rPr"); expect(properties).toHaveLength(1);
          const fonts = direct(properties[0], "rFonts"); expect(fonts).toHaveLength(1);
          expect(fonts[0].getAttributeNS(ns, "eastAsia")).toBe(family);
          expect(["ascii", "hAnsi", "cs"].map(key => fonts[0].getAttributeNS(ns, key))).toEqual(["Times New Roman", "Times New Roman", "Times New Roman"]);
          for (const theme of ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]) expect(fonts[0].hasAttributeNS(ns, theme)).toBe(false);
          for (const name of ["sz", "szCs"]) { const sizes = direct(properties[0], name); expect(sizes).toHaveLength(1); expect(sizes[0].getAttributeNS(ns, "val")).toBe(String(sizePt * 2)); }
        }
      };
      const wordRoleFacts = roleExpectations.map(role => {
        const originalParagraph = sourceParagraphs[role.paragraphIndex];
        expect(originalParagraph).toBeDefined(); expect(textOf(originalParagraph)).toBe(role.originalText);
        expect(originalParagraph.parentNode).toBe(sourceBody);
        expect(sha(JSON.stringify([sourceSha, "word/document.xml", role.paragraphIndex, role.originalText]))).toBe(role.id);
        // All headings are unique fulltext anchors. The duplicate contract title
        // is disambiguated by the already-checked source cover/body order/context.
        const matches = paragraphs.filter(paragraph => textOf(paragraph) === role.publicText);
        expect(matches).toHaveLength(role.paragraphIndex === 26 ? 2 : 1);
        const paragraph = role.paragraphIndex === 26 ? titleParagraphs[1] : matches[0];
        expect(paragraph.parentNode).toBe(actualBody);
        expect(withoutSpacing(paragraph)).toEqual(withoutSpacing(originalParagraph));
        assertVisibleRunFont(paragraph, role.fontFamily, role.fontSizePt);
        expect(visibleRuns(paragraph).map(preservedRunProperties)).toEqual(visibleRuns(originalParagraph).map(preservedRunProperties));
        return { id: role.id, originalText: role.originalText, expectedText: role.publicText,
          paragraphIndex: paragraphs.indexOf(paragraph), sourceParagraphIndex: role.paragraphIndex,
          expectedEastAsia: role.fontFamily, expectedSizePt: role.fontSizePt,
          sourcePPr: direct(originalParagraph, "pPr").map(serialized), actualPPr: direct(paragraph, "pPr").map(serialized),
          actualVisibleRuns: visibleRuns(paragraph).map(run => ({ text: textOf(run), rPr: direct(run, "rPr").map(serialized) })) };
      });
      expect(wordRoleFacts.map(fact => fact.paragraphIndex)).toEqual(wordRoleFacts.map(fact => fact.paragraphIndex).slice().sort((a, b) => a - b));
      expect(new Set(wordRoleFacts.map(fact => fact.paragraphIndex)).size).toBe(28);
      for (const control of unclassifiedControls) {
        const originalParagraph = sourceParagraphs[control.paragraphIndex];
        expect(textOf(originalParagraph)).toBe(control.text);
        expect(sha(JSON.stringify([sourceSha, "word/document.xml", control.paragraphIndex, control.text]))).toBe(control.id);
        const matches = paragraphs.filter(paragraph => textOf(paragraph) === control.text); expect(matches).toHaveLength(1);
        expect(withoutSpacing(matches[0])).toEqual(withoutSpacing(originalParagraph));
        expect(visibleRuns(matches[0]).map(run => direct(run, "rPr").map(serialized))).toEqual(visibleRuns(originalParagraph).map(run => direct(run, "rPr").map(serialized)));
        assertVisibleRunFont(matches[0], control.fontFamily, control.fontSizePt);
      }
      const sourceOrdinaryMatches = sourceParagraphs.filter(paragraph => textOf(paragraph) === ordinarySource.text);
      expect(sourceOrdinaryMatches).toHaveLength(1);
      const originalOrdinary = sourceOrdinaryMatches[0];
      expect(originalOrdinary.parentNode).toBe(sourceBody);
      expect(sha(JSON.stringify([sourceSha, "word/document.xml", sourceParagraphs.indexOf(originalOrdinary), ordinarySource.text]))).toBe(ordinarySource.id);
      const actualOrdinary = paragraphs.filter(paragraph => textOf(paragraph) === manualText);
      expect(actualOrdinary).toHaveLength(1);
      expect(withoutSpacing(actualOrdinary[0])).toEqual(withoutSpacing(originalOrdinary));
      assertVisibleRunFont(actualOrdinary[0], "仿宋_GB2312", 14);
      expect(direct(titleParagraphs[0], "pPr").map(serialized)).toEqual(direct(sourceTitles[0], "pPr").map(serialized));
      assertVisibleRunFont(titleParagraphs[0], "方正小标宋简体", 22);
      await writeFile(join(directory, "word28-source-qualified-facts.json"), JSON.stringify({ sourceSha256: sourceSha, typographyVersion,
        sourceRoleAuditSHA: "8a39415c1d0e3210d3d2418dcf7c77717ab4723e212ea282c299bf8d850b29eb",
        wordRoleFacts, ordinarySourceText: ordinary!.text, manualText, unclassifiedControls,
        wordMainParagraphs: texts, sourceMainParagraphs: sourceTexts }, null, 2));
      // Cover is a preservation control, separate from the two changed roles.
      expect(Array.from(titleParagraphs[0].getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length).map(run => direct(run, "rPr").map(serialized))).toEqual(
        Array.from(sourceTitles[0].getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length).map(run => direct(run, "rPr").map(serialized)));
      const wordTables = Array.from(word.getElementsByTagNameNS(ns, "tbl")); expect(wordTables).toHaveLength(2);
      expect(wordTables.map(table => Array.from(table.getElementsByTagNameNS(ns, "gridCol")).map(col => Number(col.getAttributeNS(ns, "w"))))).toEqual([[510, 1276, 1106, 680, 765, 1446, 510, 2211], [4252, 4252]]);
      const sourceTables = Array.from(sourceWord.getElementsByTagNameNS(ns, "tbl")); expect(sourceTables).toHaveLength(2);
      for (const [index, table] of wordTables.entries()) expect(Array.from(table.getElementsByTagNameNS(ns, "p")).map(paragraph => direct(paragraph, "pPr").map(serialized))).toEqual(
        Array.from(sourceTables[index].getElementsByTagNameNS(ns, "p")).map(paragraph => direct(paragraph, "pPr").map(serialized)));
      const materialRows = Array.from(wordTables[0].getElementsByTagNameNS(ns, "tr")); expect(materialRows).toHaveLength(2);
      expect(Array.from(materialRows[1].getElementsByTagNameNS(ns, "tc")).map(textOf)).toEqual(["", "正文清单钢材", "", "吨", "2", "3.25", "0%", "6.5000"]);
      const signatureRows = Array.from(wordTables[1].getElementsByTagNameNS(ns, "tr")); expect(signatureRows).toHaveLength(1);
      const signatureCells = Array.from(signatureRows[0].getElementsByTagNameNS(ns, "tc")); expect(signatureCells).toHaveLength(2);
      expect(signatureCells.map(textOf)).toEqual(["买方（章）：当前单甲方法定代表人或委托代理人：联系电话： 签署日期：　年　月　日地址：", "卖方（章）：当前单乙方法定代表人或委托代理人：联系电话：签署日期：　年　月　日地址："]);
      for (const table of wordTables) { expect(table.getElementsByTagNameNS(ns, "tblHeader").length).toBe(0); for (const row of Array.from(table.getElementsByTagNameNS(ns, "tr"))) expect(row.getElementsByTagNameNS(ns, "cantSplit").length).toBe(1); }
      expect(Object.values(zip.files).filter(part => !part.dir).map(part => part.name).sort()).toEqual(Object.values(original.files).filter(part => !part.dir).map(part => part.name).sort());
      expect(zip.file("word/header1.xml")!.asText()).toContain("草稿");
      const bound = new Set(["word/document.xml", "word/styles.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const part of Object.values(original.files).filter(part => !part.dir && !bound.has(part.name))) {
        const actual = zip.file(part.name)!.asNodeBuffer(), originalBytes = part.asNodeBuffer();
        if (part.name === "[Content_Types].xml") expect(actual).toEqual(Buffer.from(originalBytes.toString("utf8").replace(/\r\n/g, "\n"))); else expect(actual).toEqual(originalBytes);
      }
      inspectActualTemplatePdf(files.docx, files.pdf, "task10-material-body-spacing-current-draft", output.inputSnapshot.inspection.runtime);
      const script = `import pymupdf,sys,json

def text(span):
    return ''.join(chr(c[0]) for c in span['chars'])

d = pymupdf.open(sys.argv[1])
pages = []
for p in d:
    spans = p.get_texttrace()
    projected, pairs = [], []
    i = 0
    while i < len(spans):
        a = spans[i]
        b = spans[i + 1] if i + 1 < len(spans) else None
        # Official get_texttrace2Tr representation: one fill+stroke drawing.
        # No text-only/bbox tolerance/global dedup/visibility filtering.
        same_draw = (b is not None and a['type'] == 0 and b['type'] == 1
            and b['seqno'] == a['seqno'] + 1 and a['opacity'] > 0 and b['opacity'] > 0
            and a.keys() == b.keys()
            and all(a[key] == b[key] for key in a if key not in ('type', 'seqno')))
        projected.append(text(a))
        if same_draw:
            pairs.append({'sourceIndices': [i, i + 1], 'fill': a, 'stroke': b})
            i += 2
        else:
            i += 1
    pages.append({'page': p.number + 1, 'width': p.rect.width, 'height': p.rect.height,
        'drawnText': ''.join(projected), 'rawDrawnText': ''.join(text(s) for s in spans),
        'rawSpans': spans, 'fillStrokePairs': pairs})
out = {'pageCount': len(d), 'pages': pages}
with open(sys.argv[2], 'x') as stream:
    json.dump(out, stream, ensure_ascii=False, indent=2)
# Full raw evidence stays in the owned artifact; bounded stdout contains only
# the text used by the original public-pair assertions, never a changed expected.
print(json.dumps({'pageCount': len(d), 'pages': [{'drawnText': p['drawnText']} for p in pages]}, ensure_ascii=False))`;
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawn = compact(actual.pages.map(page => page.drawnText).join(""));

      for (const literal of [title, articleText, totalLiteral, manualText, ...spacingAdditions.map(addition => addition.expectedPublicText), "买方：当前单甲方", "卖方：当前单乙方", "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "正文清单钢材", "6.5000", "草稿",
        ...roleExpectations.map(role => role.publicText), ...unclassifiedControls.map(control => control.text)]) expect(drawn).toContain(compact(literal));
      // Diagnostic paragraph coverage is raw evidence, not a general paragraph-to-
      // ink/occlusion theorem. Page breaks/headers may interleave long paragraphs.
      await writeFile(join(directory, "pdf-word-text-diagnostics.json"), JSON.stringify({ sourceSha256: sourceSha,
        exportedDocxSha256: sha(files.docx), exportedPdfSha256: sha(files.pdf), pageCount: actual.pageCount,
        roleTextPresence: roleExpectations.map(role => ({ id: role.id, text: role.publicText, present: drawn.includes(compact(role.publicText)) })),
        wordParagraphs: texts.filter(text => text.trim()).map(text => ({ text, contiguousInProjectedDrawing: drawn.includes(compact(text)) })),
        limits: ["strict-glyph helper + required text checks only", "No full28 font-program/GID/outline/physical-size association yet", "No full occlusion/visibility theorem", "One bill row, not45-row long-table acceptance"] }, null, 2));
      expect(drawn.split(title)).toHaveLength(3); expect(drawn.split("正文清单钢材")).toHaveLength(2);
      expect(upload.mock.calls).toHaveLength(2); expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [i, format] of [[0, "docx"], [1, "pdf"]] as const) expect(sha(upload.mock.calls[i][0].buffer)).toBe(sha(files[format]));
      const finalWbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(finalWbResponse.status).toBe(200);
      const finalWb = await finalWbResponse.json();
      expect(finalWb.version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision,
        documentContentFingerprint: wb.version.documentContentFingerprint, draftData: wb.version.draftData });
      expect((await list()).find((row: { id: string }) => row.id === generation.generationId)).toMatchObject({ ...frozen, status: "success", idempotencyKey: queuedDocument.idempotencyKey, docxFileId: output.docxFileId, pdfFileId: output.pdfFileId });
      await writeFile(join(directory, "public-after-worker.json"), JSON.stringify(finalWb, null, 2));
      expect(sha(await readFile(sourcePath))).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "PUBLIC_PAIR_WORD154_PLUS2_SPACING_WORD28_AND_EXISTING_GLYPH_GATES_GREEN", pageCount: actual.pageCount,
        remaining: ["independent full28 PDF used-font/program/GID/outline/size observer must review this exact pair", "independent adjacent-paragraph full-paint font and PDF net25pt geometry observer must inspect this exact pair", "general paragraph-to-ink visibility/occlusion association", "45-row table pagination/geometry", "signature physical geometry and native Word pagination", "formal adoption/non-draft signing"] }, null, 2));
      console.info("材料154正文与两相邻新增段25磅属性实际双格式证据：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("材料154正文与两相邻新增段25磅属性实际检查失败，证据 " + directory, { cause }); }
    finally {
      upload.mockRestore(); const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 400_000);
});

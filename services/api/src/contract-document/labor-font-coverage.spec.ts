import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLaborNameFontCoverage, LABOR_FONT_CHECK_ERROR, LABOR_NAME_GLYPH_ERROR, LABOR_BANK_GLYPH_ERROR } from "./labor-font-coverage";
import { contractBodyPdfRuntimeLockFingerprint, convertContractBodyDocxToPdf } from "./contract-body-pdf-converter";

const font=readFileSync(join(__dirname,"../../assets/fonts/NotoSansSC-Regular.otf"));

it("accepts ordinary Chinese company names covered by both test font roles",()=>{
  expect(()=>assertLaborNameFontCoverage(["虚构甲方建设有限公司","虚构乙方工程有限公司"],font,font)).not.toThrow();
});

it.each(["虚构𠮷公司","虚构😀公司"])("rejects a name containing an unsupported glyph without exposing it",name=>{
  try { assertLaborNameFontCoverage([name,"虚构乙方"],font,font); throw new Error("expected rejection"); }
  catch(error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(LABOR_NAME_GLYPH_ERROR);
    expect((error as Error).message).not.toContain(name);
  }
});

it("fails closed with a safe message if font parsing is unavailable",()=>{
  expect(()=>assertLaborNameFontCoverage(["虚构甲方","虚构乙方"],Buffer.from("invalid"),font)).toThrow(LABOR_FONT_CHECK_ERROR);
});

it("rejects unsupported bank glyphs without exposing the supplied value",()=>{
  expect(()=>assertLaborNameFontCoverage(["虚构甲方","虚构乙方"],font,font,["虚构银行😀"])).toThrow(LABOR_BANK_GLYPH_ERROR);
  expect(()=>assertLaborNameFontCoverage(["虚构甲方","虚构乙方"],font,font,["虚构银行"])).not.toThrow();
});

it("fails safely for a labor job when the verified runtime is unavailable, preserving the other path",async()=>{
  const previous=process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
  delete process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
  try {
    const lock=await contractBodyPdfRuntimeLockFingerprint();
    await expect(convertContractBodyDocxToPdf(Buffer.from("inert"),lock,{laborPartyNames:["", "虚构乙方"]})).rejects.toThrow(LABOR_FONT_CHECK_ERROR);
    await expect(convertContractBodyDocxToPdf(Buffer.from("inert"),lock,{laborPartyNames:[]})).rejects.toThrow(LABOR_FONT_CHECK_ERROR);
    await expect(convertContractBodyDocxToPdf(Buffer.from("inert"),lock,{laborPartyNames:["虚构甲方","虚构乙方"]})).rejects.toThrow(LABOR_FONT_CHECK_ERROR);
    await expect(convertContractBodyDocxToPdf(Buffer.from("inert"),lock)).rejects.toThrow("合同正文转换运行环境未就绪");
  } finally {
    if(previous===undefined) delete process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    else process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST=previous;
  }
});

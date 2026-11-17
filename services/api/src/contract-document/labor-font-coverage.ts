import PDFDocument = require("pdfkit");

export const LABOR_NAME_GLYPH_ERROR = "合同主体名称包含当前文书字体无法显示的文字，请联系合同管理员处理；草稿内容已保留";
export const LABOR_FONT_CHECK_ERROR = "合同主体名称字体无法核验，请联系管理员处理；草稿内容已保留";
export const LABOR_BANK_GLYPH_ERROR = "合同银行资料包含当前文书字体无法显示的文字，请联系合同管理员处理；草稿内容已保留";

/** Checks cmap coverage only; this does not certify shaping or physical pagination. */
export function assertLaborNameFontCoverage(names:readonly string[],fangsong:Buffer,times:Buffer,bankValues:readonly string[]=[]):void {
  const documents:PDFKit.PDFDocument[]=[];
  try {
    const check=(bytes:Buffer)=>{
      const document=new PDFDocument({autoFirstPage:false});documents.push(document);document.font(bytes);
      const font=(document as unknown as {_font?:{font?:{hasGlyphForCodePoint?:(code:number)=>boolean}}})._font?.font;
      if(!font||typeof font.hasGlyphForCodePoint!=="function") throw new Error(LABOR_FONT_CHECK_ERROR);
      return (code:number)=>font.hasGlyphForCodePoint!(code);
    };
    const han=check(fangsong),latin=check(times);
    for(const [value,isBank] of [...names.map(value=>[value,false] as const),...bankValues.map(value=>[value,true] as const)]) for(const character of value) {
      const code=character.codePointAt(0)!;
      const eastAsian=(code>=0x3000&&code<=0x9fff)||(code>=0xf900&&code<=0xfaff)||(code>=0xff00&&code<=0xffef)||(code>=0x20000&&code<=0x2fa1f);
      if(!han(code)||(!eastAsian&&!latin(code))) throw new Error(isBank?LABOR_BANK_GLYPH_ERROR:LABOR_NAME_GLYPH_ERROR);
    }
  } catch(error) {
    if(error instanceof Error&&[LABOR_NAME_GLYPH_ERROR,LABOR_BANK_GLYPH_ERROR].includes(error.message)) throw error;
    throw new Error(LABOR_FONT_CHECK_ERROR);
  } finally {
    for(const document of documents) document.destroy();
  }
}

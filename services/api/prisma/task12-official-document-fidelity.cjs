'use strict';
const fail=()=>{throw Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_FIDELITY'),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});};
const need=value=>{if(!value)fail();};
const compact=text=>text.replace(/\s/gu,'');
const required=Object.freeze(['隔离工具资格材料合同','虚构甲方公司','虚构乙方公司','壹佰壹拾叁元整','资格样张材料','买方','卖方']);
/** Independent literal acceptance policy for the fixed fictional material case.
 * A machine pass still cannot approve exact pagination or activate runtime use. */
function physical(report,expectedPdfSha256){
 need(report&&report.version===1&&report.pdfSha256===expectedPdfSha256&&/^[a-f0-9]{64}$/u.test(expectedPdfSha256));
 need(Number.isInteger(report.pageCount)&&report.pageCount>=1&&report.pageCount<=100&&Array.isArray(report.pages)&&report.pages.length===report.pageCount&&report.pages.every(page=>typeof page==='string')&&report.pages.join('').length<=500000);
 const text=compact(report.pages.join(''));need(required.every(value=>text.includes(value)));
 need(report.a4Portrait===true&&['outOfPageGlyphs','unembeddedFonts','badGlyphs','substitutionFonts'].every(key=>report[key]===0)&&Number.isInteger(report.paintedChineseGlyphs)&&report.paintedChineseGlyphs>0);
 return text;
}
function pagination(report){
 need(report.pages.every((page,index)=>{
  const labels=compact(page).match(/第[^第页]*页\/共[^第页]*页/gu)??[];
  return labels.length===1&&labels[0]==='第'+(index+1)+'页/共'+report.pageCount+'页';
 }));
}
function validateOfficialDocumentFidelity(report,expectedPdfSha256){
 physical(report,expectedPdfSha256);pagination(report);
 const anchor=report.bodyAnchor;
 need(anchor?.matches===1&&Array.isArray(anchor.lineSpacings)&&anchor.lineSpacings.length>0&&anchor.lineSpacings.every(value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value-25)<=0.15));
 need(Array.isArray(anchor.fontSizes)&&anchor.fontSizes.length>0&&anchor.fontSizes.every(value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value-14)<=0.1));
 need(Array.isArray(anchor.fontFamilies)&&anchor.fontFamilies.length>0&&anchor.fontFamilies.every(value=>value==='fangsonggb2312'));
 need(report.pages.slice(-2).some(page=>['买方','卖方','虚构甲方公司','虚构乙方公司'].every(value=>compact(page).includes(value))));
 need(Array.isArray(report.failures)&&report.failures.length===0);
 return Object.freeze({status:'MACHINE_FIDELITY_PASSED_PHYSICAL_REVIEW_PENDING',pdfSha256:expectedPdfSha256,pageCount:report.pageCount,runtimeAuthority:false,exactPaginationReviewed:false});
}
function validateOfficialOfficeFidelity(report,expectedPdfSha256){
 physical(report,expectedPdfSha256);pagination(report);
 need(report.pages.slice(-2).some(page=>['买方','卖方','虚构甲方公司','虚构乙方公司'].every(value=>compact(page).includes(value))));
 need(Array.isArray(report.failures)&&report.failures.length===0);
 return Object.freeze({status:'OFFICE_TRANSPORT_PASSED_PHYSICAL_REVIEW_PENDING',pdfSha256:expectedPdfSha256,pageCount:report.pageCount,body25LayoutQualified:false,runtimeAuthority:false});
}
function validateOfficialMergedFidelity(report,body,attachment,expectedPdfSha256){
 validateOfficialDocumentFidelity(body,body.pdfSha256);validateOfficialOfficeFidelity(attachment,attachment.pdfSha256);
 physical(report,expectedPdfSha256);
 need(report.pageCount===body.pageCount+attachment.pageCount&&report.pages.every((page,index)=>compact(page)===compact([...body.pages,...attachment.pages][index])));
 need(Array.isArray(report.failures)&&report.failures.length===0);
 return Object.freeze({status:'NORMALIZE_MERGE_PASSED_PHYSICAL_REVIEW_PENDING',pdfSha256:expectedPdfSha256,pageCount:report.pageCount,runtimeAuthority:false});
}
module.exports=Object.freeze({validateOfficialDocumentFidelity,validateOfficialOfficeFidelity,validateOfficialMergedFidelity});

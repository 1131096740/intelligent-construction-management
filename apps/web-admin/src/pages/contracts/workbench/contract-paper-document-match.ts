interface PaperIdentity {
  layoutTemplateVersionId:string;
  documentContentRevision:number;
  sourceSha256:string;
  mechanicalContactLayoutVersion:string|null;
}
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));

/** Match the saved content and the server-selected presentation version. */
export function matchingPaperDocuments(documents:ReadonlyArray<unknown>,context:PaperIdentity,fingerprint:string):Record<string,unknown>[] {
  return documents.filter((item):item is Record<string,unknown>=>isRecord(item)&&
    typeof item.id==="string"&&Boolean(item.id)&&item.purpose==="draft"&&item.layoutTemplateVersionId===context.layoutTemplateVersionId&&
    item.documentContentRevision===context.documentContentRevision&&item.documentContentFingerprint===fingerprint&&
    isRecord(item.inputSnapshot)&&isRecord(item.inputSnapshot.bodyDocument)&&item.inputSnapshot.bodyDocument.sourceSha256===context.sourceSha256&&
    (item.inputSnapshot.mechanicalContactLayoutVersion??null)===context.mechanicalContactLayoutVersion);
}

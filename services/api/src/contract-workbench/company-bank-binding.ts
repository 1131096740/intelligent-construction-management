export const COMPANY_BANK_BINDING_GATE = "built-in-company-bank-binding-v1:";
import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";

const fields=["openingBank","bankAccount","paymentBank","paymentAccount"] as const;
export type CompanyBankBinding = {protocolVersion:1;companyEntityId:string;companyEntityVersionNo:number;companyEntityVersionId:string;values:Record<(typeof fields)[number],string>};
type CompanySelection = {id:string;versionId:string;versionNo:number};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const fail=():never=>{throw new ConflictException("我方银行资料与所选公司版本不一致，请保留原值并重新核对归属。");};

/** Persist stale values without assigning them to a newly selected company. */
export function normalizeCompanyBankBinding(value:unknown,previous:unknown,company:CompanySelection|null):CompanyBankBinding|undefined {
 if(value===undefined) return previous===undefined?undefined:normalizeCompanyBankBinding(previous,previous,company);
 if(!object(value)||value.protocolVersion!==1||typeof value.companyEntityId!=="string"||!value.companyEntityId||!Number.isInteger(value.companyEntityVersionNo)||!object(value.values)||Object.keys(value).some(key=>!["protocolVersion","companyEntityId","companyEntityVersionNo","companyEntityVersionId","values"].includes(key))||Object.keys(value.values).some(key=>!fields.includes(key as typeof fields[number])))return fail();
 const record=value.values;const values={} as CompanyBankBinding["values"];
 for(const field of fields){if(typeof record[field]!=="string")return fail();values[field]=record[field] as string;}
 if(isDeepStrictEqual(value,previous)){
  if(typeof value.companyEntityVersionId!=="string"||!value.companyEntityVersionId)return fail();
  return value as unknown as CompanyBankBinding;
 }
 if(!company||value.companyEntityId!==company.id||value.companyEntityVersionNo!==company.versionNo||(value.companyEntityVersionId!==undefined&&value.companyEntityVersionId!==company.versionId))return fail();
 return {protocolVersion:1,companyEntityId:company.id,companyEntityVersionNo:company.versionNo,companyEntityVersionId:company.versionId,values};
}

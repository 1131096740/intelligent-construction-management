import type { Prisma } from "@prisma/client";
import { CONTRACT_RELATIONSHIP_LABELS, downstreamContractRelationship } from "@jiangkong/shared-domain";
/** 仅补充已授权结果的说明，不独立扩大可见范围。所有主体来自业务绑定版本。 */
export async function addContractRelationshipSummaries<T extends {businessType?:string;businessId?:string;contractRelationshipLabel?:string;signingParty?:string;accountingEffect?:string}>(tx:Pick<Prisma.TransactionClient,"contract"|"contractVersion"|"settlement"|"paymentRequest"|"contractTakeover">,items:T[]) {
 const ids=(types:string[])=>[...new Set(items.filter(i=>i.businessId&&types.includes(i.businessType??"")).map(i=>i.businessId!))];
 const [settlements,payments,takeovers]=await Promise.all([
  ids(["settlement"]).length?tx.settlement.findMany({where:{id:{in:ids(["settlement"])}},select:{id:true,contractVersionId:true}}):[],
  ids(["payment_request"]).length?tx.paymentRequest.findMany({where:{id:{in:ids(["payment_request"])}},select:{id:true,contractVersionId:true}}):[],
  ids(["contract_takeover"]).length?tx.contractTakeover.findMany({where:{id:{in:ids(["contract_takeover"])}},select:{id:true,contractVersionId:true}}):[]
 ]);
 const linked=new Map<string,string>([...settlements.map(r=>[`settlement:${r.id}`,r.contractVersionId] as const),...payments.map(r=>[`payment_request:${r.id}`,r.contractVersionId] as const),...takeovers.map(r=>[`contract_takeover:${r.id}`,r.contractVersionId] as const)]);
 const versionIds=[...ids(["contract_version"]),...linked.values()];
 const contractIds=ids(["contract"]);
 const versions=versionIds.length||contractIds.length?await tx.contractVersion.findMany({where:{OR:[{id:{in:versionIds}},{contractId:{in:contractIds}}]},orderBy:{versionNo:"desc"}}):[];
 for(const item of items){
  const version=versions.find(v=>item.businessType==="contract"?v.contractId===item.businessId:v.id===(item.businessType==="contract_version"?item.businessId:linked.get(`${item.businessType}:${item.businessId}`)));
  const isContract=["contract","contract_version","contract_takeover","settlement","payment_request"].includes(item.businessType??"");
  if(!isContract){if(item.contractRelationshipLabel)continue;item.contractRelationshipLabel="无合同业务";continue;}
  item.contractRelationshipLabel=CONTRACT_RELATIONSHIP_LABELS[downstreamContractRelationship(version??{})];
  item.signingParty=version?.signingSubjectType==="affiliate"?version.affiliateNameSnapshot??"待核对施工企业":version?.companyEntityNameSnapshot??"待核对签约主体";
  item.accountingEffect=item.businessType==="payment_request"?"审批额度不等于实付；按原债务核销，付款不新增成本":item.businessType==="settlement"?"确认履约成本及应付；不按合同总额重复计入":"合同承诺；待生效不计入有效金额";
 }
 return items;
}

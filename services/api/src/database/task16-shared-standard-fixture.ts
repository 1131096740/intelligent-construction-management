import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createCashFixtureDocument } from "./registered-payment-public-cash-document";
import type { RegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";

/** The 00 authority prefix marks fictional fixture data; the final character
 * satisfies the application's checksum validator, not real registration. */
export function syntheticCreditCode(runId:string,index:0|1):string {
 if(!/^[a-f0-9]{12}$/u.test(runId)||(index!==0&&index!==1))throw new Error("TASK398_SYNTHETIC_CREDIT_INPUT");
 const alphabet="0123456789ABCDEFGHJKLMNPQRTUWXY",weights=[1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28];
 const body=`00${runId.toUpperCase()}00${index}`;
 const sum=[...body].reduce((total,char,position)=>total+alphabet.indexOf(char)*weights[position],0);
 return body+alphabet[(31-sum%31)%31];
}

/** Synthetic predecessor facts for the isolated standard PG test. Approval,
 * signatures, openings and payments are deliberately left to public HTTP. */
export async function seedSharedPaymentPredecessors(owner:PrismaClient,plan:RegisteredPgFixturePlan,actors:{financeHash:string;keeperHash:string;directorHash:string},storageRoot:string, textAgreement=false) {
 const ids=plan.ids,keeper=randomUUID(),director=randomUUID(),document=await createCashFixtureDocument(storageRoot,plan.runId);
 const instant=new Date(`${plan.openingDate}T00:00:00.000Z`),companyAName=`合成甲公司${plan.runId}`,companyBName=`合成乙公司${plan.runId}`;
 const keeperPhone=`198${plan.phone.slice(3)}`,directorPhone=`197${plan.phone.slice(3)}`;
 document.verify();
 await owner.$transaction(async tx=>{
  for(const [id,phone,name,passwordHash,role] of [[ids.actor,plan.phone,"合成财务",actors.financeHash,"finance_staff"],[keeper,keeperPhone,"合成综合主管",actors.keeperHash,"comprehensive_director"],[director,directorPhone,"合成财务主管",actors.directorHash,"finance_director"]]){
   await tx.user.create({data:{id,phone,name,passwordHash,isActive:true,mustChangePassword:false}});
   const position=await tx.position.upsert({where:{key:role},create:{key:role,name:role},update:{}});
   await tx.userPosition.create({data:{userId:id,positionId:position.id,projectId:null}});
  }
  const a=await tx.companyEntity.create({data:{id:ids.companyA,name:companyAName,unifiedSocialCreditCode:syntheticCreditCode(plan.runId,0),dataStatus:"complete",currentVersionNo:1,isActive:true}});
  const b=await tx.companyEntity.create({data:{id:ids.companyB,name:companyBName,unifiedSocialCreditCode:syntheticCreditCode(plan.runId,1),dataStatus:"complete",currentVersionNo:1,isActive:true}});
  for(const [id,company] of [[ids.companyVersionA,a],[ids.companyVersionB,b]] as const)await tx.companyEntityVersion.create({data:{id,companyEntityId:company.id,versionNo:1,name:company.name,unifiedSocialCreditCode:company.unifiedSocialCreditCode,isActive:true,action:"create",actorUserId:ids.actor}});
  const partyName=`虚构施工企业${plan.runId}`;
  await tx.businessParty.create({data:{id:ids.constructionEnterpriseParty,type:"organization",name:partyName,normalizedName:partyName,status:"active",createdByUserId:ids.actor}});
  await tx.businessPartyVersion.create({data:{id:ids.constructionEnterpriseVersion,businessPartyId:ids.constructionEnterpriseParty,versionNo:1,snapshot:{type:"organization",name:partyName,attachments:[]},createdByUserId:ids.actor}});
  await tx.project.create({data:{id:ids.project,code:`T16-${plan.runId}-P`,name:"合成项目",isActive:true,operatingLedgerEffectiveDate:null}});
  await tx.projectAffiliateAssignment.create({data:{id:ids.constructionEnterpriseAssignment,projectId:ids.project,businessPartyId:ids.constructionEnterpriseParty,businessPartyVersionId:ids.constructionEnterpriseVersion,affiliateNameSnapshot:partyName,affiliateCreditCodeSnapshot:null,effectiveFrom:instant,changeReason:"隔离合成前置",assignedByUserId:ids.actor}});
  await tx.projectParticipatingCompany.create({data:{projectId:ids.project,companyEntityId:a.id,companyEntityVersionId:ids.companyVersionA,companyNameSnapshot:a.name,companyCreditCodeSnapshot:a.unifiedSocialCreditCode,effectiveFrom:instant,changeReason:"隔离合成前置",addedByUserId:ids.actor}});
  await tx.project.update({where:{id:ids.project},data:{operatingLedgerEffectiveDate:instant}});
  await tx.projectMember.create({data:{projectId:ids.project,userId:ids.actor,positionKey:"finance_staff"}});
  await tx.contract.create({data:{id:ids.contract,projectId:ids.project,code:`T16-${plan.runId}-HT`,name:textAgreement?"合成服务合同":"合成材料合同",counterparty:"虚构供应商",contractTypeKey:textAgreement?"other":"material_purchase",companyEntityId:a.id,companyEntityName:a.name,ownerUserId:ids.actor}});
  await tx.contractVersion.create({data:{id:ids.version,contractId:ids.contract,versionNo:1,changeType:"original",status:"effective",effectiveAt:instant,amountCents:textAgreement?0n:10000n,
    ...(textAgreement?{numericProtocolVersion:2,amountLimitType:"unlimited",pricingNature:"framework",
      settlementMode:"direct_payment",settlementModeSource:"contract_director",settlementModeConfirmedByUserId:director,
      settlementModeConfirmedAt:instant}:{}),signingSubjectType:"our_company",companyEntityIdSnapshot:a.id,companyEntityVersionId:ids.companyVersionA,companyEntityNameSnapshot:a.name,companyEntityCreditCodeSnapshot:a.unifiedSocialCreditCode,draftData:{},templateSnapshot:{},clauseSnapshot:{}}});
  await tx.paymentTermsVersion.create({data:{id:ids.terms,contractId:ids.contract,contractVersionId:ids.version,versionNo:1,status:"effective",originalText:textAgreement?"按确认的实际服务付款":"按已确认结算分次付款"}});
  if(!textAgreement)await tx.settlement.create({data:{id:ids.settlement,projectId:ids.project,contractId:ids.contract,contractVersionId:ids.version,paymentTermsVersionId:ids.terms,code:`T16-${plan.runId}-JS`,periodLabel:"合成第一期",status:"effective",createdAt:instant,amountCents:10000n,payableAmountCents:10000n,paidAmountCents:0n}});
  await tx.paymentRequest.create({data:{id:ids.payment,projectId:ids.project,settlementId:textAgreement?null:ids.settlement,sourceType:textAgreement?"contract_due":"settlement",
    ...(textAgreement?{contractDueBasis:"text_agreement_v1",paymentMatter:"虚构服务",amountCalculationExplanation:"按已核对工单金额"}:{}),contractId:ids.contract,contractVersionId:ids.version,paymentTermsVersionId:ids.terms,code:`T16-${plan.runId}-FK`,status:"approval_pending",requestedAmountCents:10000n,approvedAmountCents:null,paidAmountCents:0n,paymentSubjectType:"our_company"}});
  await tx.approvalInstance.create({data:{id:ids.approvedRound,flowType:"payment.approve",businessType:"payment_request",businessId:ids.payment,status:"in_progress",currentNodeIndex:0,applicantUserId:ids.actor,frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:[director]},candidateUserIds:[director]}]}});
  const supplierId=randomUUID(),supplierVersionId=randomUUID(),fileId=randomUUID(),supplierName=`虚构供应商${plan.runId}`;
  await tx.businessParty.create({data:{id:supplierId,type:"organization",name:supplierName,normalizedName:supplierName,status:"active",createdByUserId:ids.actor}});
  await tx.businessPartyVersion.create({data:{id:supplierVersionId,businessPartyId:supplierId,versionNo:1,snapshot:{type:"organization",name:supplierName,attachments:[]},createdByUserId:ids.actor}});
  await tx.contractPartySnapshot.create({data:{contractVersionId:ids.version,roleKey:"party_b",displayOrder:0,businessPartyVersionId:supplierVersionId,snapshot:{name:supplierName}}});
  if(!textAgreement)await tx.fileObject.create({data:{id:fileId,bucket:"private-local",objectKey:document.objectKey,originalName:"虚构结算凭证.pdf",mimeType:"application/pdf",sizeBytes:document.sizeBytes,uploadedByUserId:ids.actor,contentSha256:document.contentSha256}});
  if(!textAgreement)await tx.settlementArchiveFile.create({data:{settlementId:ids.settlement,fileId,uploadedByUserId:ids.actor,confirmedByUserId:ids.actor,confirmedAt:instant,status:"confirmed"}});
 },{isolationLevel:"Serializable"});
 document.verify();
 return {keeper,director,keeperPhone,directorPhone,document};
}

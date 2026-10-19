import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
export async function controlledDownstreamParty(tx:Prisma.TransactionClient,id:string,name:string){
 const version=await tx.businessPartyVersion.findUnique({where:{id}});
 const party=version?await tx.businessParty.findUnique({where:{id:version.businessPartyId}}):null;
 const snapshot=version?.snapshot as Record<string,unknown>|undefined;
 const frozenName=typeof snapshot?.name==="string"?snapshot.name:null;
 const credit=typeof snapshot?.unifiedSocialCreditCode==="string"?snapshot.unifiedSocialCreditCode:null;
 if(!party||party.status!=="active"||!frozenName||frozenName!==name)throw new BadRequestException("请选择有效合作单位档案版本；相对方名称须与该版本一致");
 const own=await tx.companyEntityVersion.findFirst({where:{OR:[{name:frozenName},...(credit?[{unifiedSocialCreditCode:credit}]:[])]},select:{id:true}});
 if(own)throw new BadRequestException("该受控主体属于我方公司，应办理对上合同或主体例外核对，不能作为表外下游");
 return {id:version!.id,name:frozenName};
}

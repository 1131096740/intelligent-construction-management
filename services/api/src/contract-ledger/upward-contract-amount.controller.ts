import { Body,Controller,Get,Param,Post,Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { UpwardContractAmountService,type PrepareUpwardAmount } from "./upward-contract-amount.service";
@Controller("upward-contract-amount-revisions")
export class UpwardContractAmountController {
 constructor(private readonly service:UpwardContractAmountService){}
 @Get() list(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.service.list(user.id,projectId);}
 @Post() prepare(@CurrentUser() user:AuthenticatedUser,@Body() input:PrepareUpwardAmount){return this.service.prepare(user.id,input);}
 @Post(":id/decision") decide(@CurrentUser() user:AuthenticatedUser,@Param("id") id:string,@Body() input:{decision:"confirm"|"return";confirmationPassword:string}){return this.service.decide(user.id,id,input);}
}

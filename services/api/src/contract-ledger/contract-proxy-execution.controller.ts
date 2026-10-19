import { Body,Controller,Get,Param,Post,Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractProxyExecutionService,type PrepareProxyExecution } from "./contract-proxy-execution.service";
@Controller("contract-proxy-executions")
export class ContractProxyExecutionController {
 constructor(private readonly service:ContractProxyExecutionService){}
 @Get("bank-options") bankOptions(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.service.bankOptions(user.id,projectId);}
 @Get() list(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.service.list(user.id,projectId);}
 @Post() prepare(@CurrentUser() user:AuthenticatedUser,@Body() input:PrepareProxyExecution){return this.service.prepare(user.id,input);}
 @Post(":id/decision") decide(@CurrentUser() user:AuthenticatedUser,@Param("id") id:string,@Body() input:{decision:"confirm"|"return";confirmationPassword:string}){return this.service.decide(user.id,id,input);}
}

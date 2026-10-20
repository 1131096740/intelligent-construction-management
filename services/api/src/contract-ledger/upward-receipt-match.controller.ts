import {Body,Controller,Get,Param,Post,Query} from "@nestjs/common";
import {CurrentUser} from "../auth/decorators/current-user.decorator";
import type {AuthenticatedUser} from "../auth/auth.types";
import {UpwardReceiptMatchService,type PrepareReceiptMatch} from "./upward-receipt-match.service";
@Controller("upward-receipt-matches")
export class UpwardReceiptMatchController {
 constructor(private readonly service:UpwardReceiptMatchService){}
 @Get() list(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.service.list(user.id,projectId);}
 @Post() prepare(@CurrentUser() user:AuthenticatedUser,@Body() input:PrepareReceiptMatch){return this.service.prepare(user.id,input);}
 @Post(":id/decision") decide(@CurrentUser() user:AuthenticatedUser,@Param("id") id:string,@Body() input:{decision:"confirm"|"return";confirmationPassword:string}){return this.service.decide(user.id,id,input);}
}

import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessEntryTransactionModule } from "../business-entry-definition/business-entry-transaction.module";
import { FileModule } from "../file/file.module";
import { FundAccountModule } from "../fund-account/fund-account.module";
import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { PaymentAmountService } from "../payment/payment-amount.service";
import { PaymentController } from "../payment/payment.controller";
import { PaymentReadService } from "../payment/payment-read.service";
import { PaymentRequestService } from "../payment/payment-request.service";
import { REGISTERED_PAYMENT_IMPACT_READER } from "../payment/registered-payment-impact-reader";
import { RegisteredPaymentExecutionController } from "../payment/registered-payment-execution.controller";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "../payment/registered-payment-notification.service";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { DatabaseModule } from "./database.module";
import { Task16RegistrationErrorFilter } from "./task16-registration-error-diagnostic";
import { ServiceUnavailableException } from "@nestjs/common";

// This composition is not an admission or a runner. A dedicated caller must
// install the ingress fence before init and seal/qualify every provider.
@Module({
 imports:[DatabaseModule,AuthModule,AuditModule,FileModule,FundAccountModule,OperatingLedgerModule,ProjectFundingModule,BusinessEntryTransactionModule],
 controllers:[RegisteredPaymentExecutionController,PaymentController,MeController],
 providers:[PaymentAmountService,PaymentRequestService,PaymentReadService,RegisteredPaymentExecutionService,RegisteredPaymentNotificationService,ApprovalSmsService,MeService,Task16RegistrationErrorFilter,
  {provide:APP_FILTER,useExisting:Task16RegistrationErrorFilter},{provide:REGISTERED_PAYMENT_IMPACT_READER,useValue:()=>{throw new ServiceUnavailableException("暂时无法核对实付影响，请稍后查询");}}]
})
export class Task16SharedPaymentApplicationModule {}

// path is the framework pathname, not the original URL; query authorization
// (including the download token) belongs to the request fence/controller.
// List endpoints rely on the isolated database and actual role authorization.
type Task16SharedScope={paymentId:string;executionIds:readonly string[];resultKeys:readonly string[];fileIds:readonly string[]};
export function task16SharedPaymentRouteAllowed(method:string,path:string,scope:Task16SharedScope):boolean {
 if(path.includes("?")||path.includes("#"))return false;
 const id=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
 if(!scope||!id.test(scope.paymentId)||![...scope.executionIds,...scope.resultKeys,...scope.fileIds].every(value=>id.test(value)))return false;
 if(method==="GET")return ["/payment-executions/notifications","/payment-executions/work-items","/payment-executions/recorded-items","/me/work-items","/fund-accounts",`/payment-executions/${scope.paymentId}/registration-options`,...scope.executionIds.map(value=>`/payment-executions/${value}/voucher-ticket`),...scope.resultKeys.map(value=>`/payment-executions/results/${value}`),...scope.fileIds.map(value=>`/files/${value}/download`)].includes(path);
 if(method==="POST")return ["/auth/login","/fund-accounts/openings","/me/signature/canvas",`/payments/${scope.paymentId}/approval`,`/payment-executions/${scope.paymentId}/registrations`,...scope.executionIds.flatMap(value=>[`/payment-executions/${value}/voucher`,`/payment-executions/${value}/voucher-file-uploads`])].includes(path);
 return false;
}

// The ticket is the exact server-issued URL retained by the caller for this
// run. Signature validation and authorization remain the file controller's.
export function task16SharedPaymentRequestAllowed(method:string,raw:string,scope:Task16SharedScope,ticket?:string):boolean {
 if(typeof raw!=="string"||!raw.startsWith("/")||raw.startsWith("//")||raw.includes("#"))return false;
 let url:URL;try{url=new URL(raw,"http://127.0.0.1:1025");}catch{return false;}
 if(url.origin!=="http://127.0.0.1:1025"||raw.split("?")[0]!==url.pathname||!task16SharedPaymentRouteAllowed(method,url.pathname,scope))return false;
 if(!url.search)return !raw.includes("?");
 return method==="GET"&&raw===ticket&&scope.fileIds.some(id=>url.pathname===`/files/${id}/download`);
}

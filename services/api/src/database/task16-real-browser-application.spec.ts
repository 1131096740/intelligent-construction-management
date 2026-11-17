import { Test } from "@nestjs/testing";
import { ProjectController } from "../project/project.controller";
import { ContractRelationshipLedgerController } from "../contract-ledger/contract-relationship-ledger.controller";
import { RegisteredPaymentExecutionController } from "../payment/registered-payment-execution.controller";
import { PrismaService } from "./prisma.service";
import { Task16RealBrowserModule } from "./task16-real-browser-application";

it("assembles the real page controllers under the same test-only module",async()=>{
 const module=await Test.createTestingModule({imports:[Task16RealBrowserModule]}).overrideProvider(PrismaService).useValue({}).compile();
 try{expect(module.get(ProjectController)).toBeInstanceOf(ProjectController);expect(module.get(ContractRelationshipLedgerController)).toBeInstanceOf(ContractRelationshipLedgerController);expect(module.get(RegisteredPaymentExecutionController)).toBeInstanceOf(RegisteredPaymentExecutionController);}
 finally{await module.close();}
});

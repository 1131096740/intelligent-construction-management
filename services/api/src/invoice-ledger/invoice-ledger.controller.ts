import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { CreateInvoiceExceptionConfirmationDto } from "./dto/create-invoice-exception-confirmation.dto";
import { CreateNoInvoiceConfirmationDto } from "./dto/create-no-invoice-confirmation.dto";
import { CreateProcurementInvoiceDto } from "./dto/create-procurement-invoice.dto";
import { CreateInvoiceClearingAllocationDto } from "./dto/create-invoice-clearing-allocation.dto";
import { CreateGlobalInvoiceDto } from "./dto/create-global-invoice.dto";
import { CreateRedGlobalInvoiceDto } from "./dto/create-red-global-invoice.dto";
import { CreateReissueGlobalInvoiceDto } from "./dto/create-reissue-global-invoice.dto";
import { VoidGlobalInvoiceDto } from "./dto/void-global-invoice.dto";
import { ReverseInvoiceAllocationDto } from "./dto/reverse-invoice-allocation.dto";
import { ReverseInvoiceClearingAllocationDto } from "./dto/reverse-invoice-clearing-allocation.dto";
import { ReviewInvoiceExceptionConfirmationDto } from "./dto/review-invoice-exception-confirmation.dto";
import { ReviewNoInvoiceConfirmationDto } from "./dto/review-no-invoice-confirmation.dto";
import { InvoiceLedgerService } from "./invoice-ledger.service";

@Controller()
export class InvoiceLedgerController {
  constructor(private readonly invoices: InvoiceLedgerService) {}

  @Get("global-invoices/capabilities")
  globalInvoiceCapabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.invoices.globalInvoiceCapabilities(user.id);
  }

  @Get("global-invoices")
  @RequirePositions("finance_staff", "finance_director")
  listGlobalInvoices(@CurrentUser() user: AuthenticatedUser) {
    return this.invoices.listGlobalInvoices(user.id);
  }

  @Post("spot-procurements/:procurementId/invoices")
  @RequireProjectRole("spot_procurement.invoice.manage")
  createProcurementInvoice(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProcurementInvoiceDto
  ) {
    return this.invoices.createProcurementInvoice(
      procurementId,
      user.id,
      body
    );
  }

  @Post("global-invoices")
  @RequirePositions("finance_staff", "finance_director")
  createGlobalInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateGlobalInvoiceDto
  ) {
    return this.invoices.createGlobalInvoice(user.id, body);
  }

  @Post("global-invoices/red")
  @RequirePositions("finance_director")
  createRedGlobalInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateRedGlobalInvoiceDto
  ) {
    return this.invoices.createRedGlobalInvoice(user.id, body);
  }

  @Post("global-invoices/reissue")
  @RequirePositions("finance_director")
  createReissueGlobalInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReissueGlobalInvoiceDto
  ) {
    return this.invoices.createReissueGlobalInvoice(user.id, body);
  }

  @Post("global-invoices/:invoiceRecordId/void")
  @RequirePositions("finance_director")
  voidGlobalInvoice(
    @Param("invoiceRecordId") invoiceRecordId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidGlobalInvoiceDto
  ) {
    return this.invoices.voidGlobalInvoice(invoiceRecordId, user.id, body);
  }

  @Post("invoice-clearing-allocations")
  @RequireProjectRole("clearing.confirm")
  createClearingAllocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateInvoiceClearingAllocationDto
  ) {
    return this.invoices.createClearingAllocation(user.id, body);
  }

  @Post("invoice-clearing-allocations/:clearingAllocationId/reversal")
  @RequireProjectRole("clearing.confirm")
  reverseClearingAllocation(
    @Param("clearingAllocationId") clearingAllocationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReverseInvoiceClearingAllocationDto
  ) {
    return this.invoices.reverseClearingAllocation(clearingAllocationId, user.id, body);
  }

  @Post("invoice-allocations/:allocationId/reversal")
  @RequireProjectRole("spot_procurement.invoice.manage")
  reverseAllocation(
    @Param("allocationId") allocationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReverseInvoiceAllocationDto
  ) {
    return this.invoices.reverseAllocation(allocationId, user.id, body);
  }

  @Post("spot-procurements/:procurementId/no-invoice-confirmations")
  @RequireProjectRole("spot_procurement.invoice.manage")
  createNoInvoiceConfirmation(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateNoInvoiceConfirmationDto
  ) {
    return this.invoices.createNoInvoiceConfirmation(
      procurementId,
      user.id,
      body
    );
  }

  @Post(
    "spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review"
  )
  @RequireProjectRole("spot_procurement.invoice_exception.confirm")
  reviewNoInvoiceConfirmation(
    @Param("procurementId") procurementId: string,
    @Param("confirmationId") confirmationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewNoInvoiceConfirmationDto
  ) {
    return this.invoices.reviewNoInvoiceConfirmation(
      procurementId,
      confirmationId,
      user.id,
      body
    );
  }

  @Post("spot-procurements/:procurementId/invoice-exceptions")
  @RequireProjectRole("spot_procurement.invoice.manage")
  createInvoiceException(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateInvoiceExceptionConfirmationDto
  ) {
    return this.invoices.createInvoiceException(
      procurementId,
      user.id,
      body
    );
  }

  @Post(
    "spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review"
  )
  @RequireProjectRole("spot_procurement.invoice_exception.confirm")
  reviewInvoiceException(
    @Param("procurementId") procurementId: string,
    @Param("exceptionId") exceptionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewInvoiceExceptionConfirmationDto
  ) {
    return this.invoices.reviewInvoiceException(
      procurementId,
      exceptionId,
      user.id,
      body
    );
  }
}

import { Body, Controller, Delete, Param, Patch, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractBillService } from "./contract-bill.service";
import type {
  ReorderBillRowsDto,
  ReplaceBillRowsDto,
  SaveBillRowDto
} from "./dto/contract-bill.dto";

@Controller("contract-bills")
export class ContractBillController {
  constructor(private readonly bills: ContractBillService) {}

  @Post(":billId/rows")
  addRow(
    @Param("billId") billId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveBillRowDto
  ) {
    return this.bills.addRow(billId, user.id, body);
  }

  @Patch(":billId/rows/:rowKey")
  updateRow(
    @Param("billId") billId: string,
    @Param("rowKey") rowKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveBillRowDto
  ) {
    return this.bills.updateRow(billId, rowKey, user.id, body);
  }

  @Delete(":billId/rows/:rowKey")
  deleteRow(
    @Param("billId") billId: string,
    @Param("rowKey") rowKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { expectedBillRevision: number }
  ) {
    return this.bills.deleteRow(
      billId,
      rowKey,
      user.id,
      body.expectedBillRevision
    );
  }

  @Post(":billId/rows/reorder")
  reorderRows(
    @Param("billId") billId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReorderBillRowsDto
  ) {
    return this.bills.reorderRows(billId, user.id, body);
  }

  @Put(":billId/rows")
  replaceRows(
    @Param("billId") billId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReplaceBillRowsDto
  ) {
    return this.bills.replaceRows(billId, user.id, body);
  }
}

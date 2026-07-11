import { Controller, Get } from "@nestjs/common";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { OrganizationService } from "./organization.service";

@Controller("organization")
@RequirePositions("super_admin")
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get("directory")
  directory() {
    return this.organization.getDirectory();
  }
}

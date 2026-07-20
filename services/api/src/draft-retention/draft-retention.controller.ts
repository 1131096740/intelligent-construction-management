import { Body, Controller, Get, Post } from "@nestjs/common";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { DraftRetentionService } from "./draft-retention.service";
import { PreviewDraftRetentionDto } from "./dto/preview-draft-retention.dto";

@Controller("draft-retention")
@RequirePositions("super_admin")
export class DraftRetentionController {
  constructor(private readonly retention: DraftRetentionService) {}

  @Get("preview")
  preview() {
    return this.retention.preview();
  }

  @Post("controlled-entry")
  controlledEntry(@Body() body: PreviewDraftRetentionDto) {
    return this.retention.controlledEntry(body.mode);
  }
}

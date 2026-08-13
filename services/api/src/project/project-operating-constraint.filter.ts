import { ArgumentsHost, BadRequestException, Catch } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { projectOperatingConstraintMessage } from "./project-operating-constraint";

@Catch()
export class ProjectOperatingConstraintFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    const message = projectOperatingConstraintMessage(exception);
    super.catch(message ? new BadRequestException(message) : exception, host);
  }
}

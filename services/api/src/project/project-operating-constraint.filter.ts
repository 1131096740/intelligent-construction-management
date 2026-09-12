import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import {
  isPostgresSerializationFailure,
  projectOperatingConstraintMessage
} from "./project-operating-constraint";

@Catch()
export class ProjectOperatingConstraintFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    const message = projectOperatingConstraintMessage(exception);
    const mappedException = message
      ? new BadRequestException(message)
      : isPostgresSerializationFailure(exception)
        ? new ConflictException("数据已被并发更新，请重新读取后重试")
        : exception;
    super.catch(mappedException, host);
  }
}

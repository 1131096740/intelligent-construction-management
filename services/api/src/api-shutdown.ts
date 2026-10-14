import type { INestApplicationContext } from "@nestjs/common";

export function configureApiShutdown(
  app: Pick<INestApplicationContext, "enableShutdownHooks">
) {
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
}

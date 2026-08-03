import { NestFactory } from "@nestjs/core";
import { apiJsonReplacer } from "./api-json-replacer";
import { listenApi } from "./api-listen";
import { configureApiSecurity } from "./api-security";
import { AppModule } from "./app.module";
import { createApiValidationPipe } from "./validation/api-validation";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApiSecurity(app);
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? [],
    credentials: true
  });
  app.useGlobalPipes(createApiValidationPipe());
  await listenApi(app, Number(process.env.PORT ?? 3000), process.env.HOST);
}

void bootstrap();

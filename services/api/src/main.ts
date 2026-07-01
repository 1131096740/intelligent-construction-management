import { NestFactory } from "@nestjs/core";
import { apiJsonReplacer } from "./api-json-replacer";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? [],
    credentials: true
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();

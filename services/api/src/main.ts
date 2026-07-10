import { NestFactory } from "@nestjs/core";
import { apiJsonReplacer } from "./api-json-replacer";
import { listenApi } from "./api-listen";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? [],
    credentials: true
  });
  await listenApi(app, Number(process.env.PORT ?? 3000), process.env.HOST);
}

void bootstrap();

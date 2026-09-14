import { BadRequestException, type INestApplication } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import type { ExpressAdapter } from "@nestjs/platform-express";

/** Install before Nest's default JSON parser so duplicate export keys cannot become last-wins. */
export function configureProjectionExportJson(app: INestApplication): void {
  (app.getHttpAdapter() as ExpressAdapter).useBodyParser("json", false, {
    verify: (request: IncomingMessage, _response: unknown, buffer: Buffer, encoding: string) => {
      const path = request.url?.split("?")[0]?.replace(/\/$/, "").toLowerCase();
      if (path !== "/operating-projections/export" || request.method !== "POST") return;
      if (encoding !== "utf-8") throw new BadRequestException("导出请求必须使用 UTF-8");
      const text = buffer.toString("utf8");
      const keys = new Set<string>();
      let depth = 0;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
          const start = index++;
          while (index < text.length) {
            if (text[index] === "\\") index += 2;
            else if (text[index] === '"') break;
            else index += 1;
          }
          let next = index + 1;
          while (/\s/.test(text[next] ?? "") && next < text.length) next += 1;
          if (depth === 1 && text[next] === ":") {
            const key = JSON.parse(text.slice(start, index + 1)) as string;
            if (keys.has(key)) throw new BadRequestException("导出请求包含重复字段");
            keys.add(key);
          }
        } else if (char === "{" || char === "[") depth += 1;
        else if (char === "}" || char === "]") depth -= 1;
      }
    }
  });
}

import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  RETIRED_WRITE_ENTRIES,
  RetiredWriteEntryGuard
} from "./retired-write-entry.guard";

type RouteUsageManifest = {
  routes: Array<{
    method: string;
    controller: string;
    handler: string;
    usage: string;
  }>;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function manifestRetiredWriteKeys() {
  const path = resolve(
    process.cwd(),
    "../../docs/product/manifests/route-usage.json"
  );
  const manifest = JSON.parse(
    readFileSync(path, "utf8")
  ) as RouteUsageManifest;

  return manifest.routes
    .filter(
      (route) =>
        route.usage === "exit_candidate" &&
        !SAFE_METHODS.has(route.method)
    )
    .map((route) => `${route.controller}.${route.handler}`)
    .sort();
}

function contextFor(input: {
  controller: string;
  handler: string;
  method?: string;
}): ExecutionContext {
  const controller = { [input.controller]: class {} }[input.controller];
  const handler = { [input.handler]: function () {} }[input.handler];

  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ method: input.method ?? "POST" })
    })
  } as unknown as ExecutionContext;
}

describe("POL-19E retired write entry guard", () => {
  it("covers every non-read-only exit candidate without an extra tombstone", () => {
    expect(
      RETIRED_WRITE_ENTRIES.map(
        (entry) => `${entry.controller}.${entry.handler}`
      ).sort()
    ).toEqual(manifestRetiredWriteKeys());
  });

  it("returns a permanent Chinese 410 for an old write and leaves reads/current writes alone", () => {
    const guard = new RetiredWriteEntryGuard();
    const retired = RETIRED_WRITE_ENTRIES[0];
    expect(retired).toBeDefined();

    try {
      guard.canActivate(
        contextFor({
          controller: retired!.controller,
          handler: retired!.handler,
          method: "POST"
        })
      );
      throw new Error("expected retired write entry to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(410);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({
          statusCode: 410,
          code: "OLD_WRITE_ENTRY_RETIRED",
          message: "该旧办理入口已停止使用，请返回当前业务页面办理"
        })
      );
    }

    expect(
      guard.canActivate(
        contextFor({
          controller: retired!.controller,
          handler: retired!.handler,
          method: "GET"
        })
      )
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          controller: "CurrentController",
          handler: "submit",
          method: "POST"
        })
      )
    ).toBe(true);
  });
});

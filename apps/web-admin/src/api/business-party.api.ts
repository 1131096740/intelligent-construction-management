import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type { BusinessPartyCreatePayload } from "../pages/business-parties/business-party-create-flow";

export class BusinessPartyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "BusinessPartyApiError";
  }
}

async function readError(response: Response, fallback: string) {
  let detail = "";
  let code: string | undefined;
  try {
    const body = await response.clone().json() as { message?: unknown; code?: unknown };
    detail = Array.isArray(body.message)
      ? body.message.join("；")
      : typeof body.message === "string" ? body.message : "";
    code = typeof body.code === "string" ? body.code : undefined;
  } catch {
    detail = "";
  }
  return new BusinessPartyApiError(
    formatApiErrorMessage(detail, response.status, fallback),
    response.status,
    code
  );
}

export async function createBusinessPartyWithIntent(
  payload: BusinessPartyCreatePayload,
  options: {
    onRequestSent?: () => void;
    beforeRequest?: PromiseLike<unknown>;
  } = {}
) {
  if (options.beforeRequest) await options.beforeRequest;
  const request = apiFetch("/business-parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      target: payload.target,
      definitionKey: payload.definitionKey,
      definitionVersion: payload.definitionVersion,
      idempotencyKey: payload.idempotencyKey,
      values: payload.values
      })
    }, { retryUnauthorized: false });
  options.onRequestSent?.();
  const response = await request;
  if (!response.ok) throw await readError(response, "创建合作单位失败");
  return response.json();
}

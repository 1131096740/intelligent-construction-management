"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

// The COS adapter signs the lower-case query name. This transport preserves
// that signature while sending COS's versionId wire spelling. One invocation
// may issue at most one exact DELETE; uncertain outcomes remain uncertain.
function createOneShotVersionDeleteFetch(target, request = fetch) {
  const reject = () => { throw new Error("DELETE_TRANSPORT_BOUNDARY"); };
  if (!target || typeof request !== "function" ||
      typeof target.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{2,127}$/u.test(target.bucket) ||
      typeof target.region !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(target.region) ||
      typeof target.objectKey !== "string" || !target.objectKey ||
      typeof target.versionId !== "string" || !target.versionId) reject();
  const host = `${target.bucket}.cos.${target.region}.myqcloud.com`;
  let attempted = false;
  return async (input, init) => {
    if (attempted) reject();
    attempted = true;
    let url;
    let pathname;
    let headers;
    try {
      url = new URL(input);
      pathname = decodeURIComponent(url.pathname);
      headers = new Headers(init?.headers);
    } catch { reject(); }
    if (url.protocol !== "https:" || url.host !== host || url.username || url.password || url.hash ||
        pathname !== `/${target.objectKey}` || init?.method !== "DELETE" || init?.body != null ||
        !headers.get("Authorization") || headers.get("Host") !== host ||
        [...url.searchParams].length !== 1 ||
        !["versionid", "versionId"].includes([...url.searchParams.keys()][0]) ||
        [...url.searchParams.values()][0] !== target.versionId) reject();
    if (url.searchParams.has("versionid")) {
      url.searchParams.delete("versionid");
      url.searchParams.set("versionId", target.versionId);
    }
    const response = await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
    response?.body?.cancel().catch(() => undefined);
    if (response?.status !== 204) throw new Error("DELETE_NOT_CONFIRMED");
    return new Response(null, { status: 204 });
  };
}

module.exports = { createOneShotVersionDeleteFetch };

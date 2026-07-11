export interface ApiListenTarget {
  listen(port: number, host?: string): Promise<unknown>;
}

export async function listenApi(
  app: ApiListenTarget,
  port: number,
  rawHost?: string
): Promise<void> {
  const host = rawHost?.trim() || "127.0.0.1";
  await app.listen(port, host);
}

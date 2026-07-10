export interface ApiListenTarget {
  listen(port: number, host?: string): Promise<unknown>;
}

export async function listenApi(
  app: ApiListenTarget,
  port: number,
  rawHost?: string
): Promise<void> {
  const host = rawHost?.trim();
  if (host) {
    await app.listen(port, host);
    return;
  }
  await app.listen(port);
}

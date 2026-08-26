export interface ApiRequestFailure {
  path: string;
  error: unknown;
}

type ApiRequestFailureSubscriber = (failure: ApiRequestFailure) => void;

const subscribers = new Set<ApiRequestFailureSubscriber>();

export function publishApiRequestFailure(path: string, error: unknown) {
  for (const subscriber of subscribers) {
    subscriber({ path, error });
  }
}

export function subscribeApiRequestFailure(
  subscriber: ApiRequestFailureSubscriber
) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

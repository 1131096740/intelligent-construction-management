type NavigablePage<Response> = {
  goto: (url: string) => Promise<Response>;
};

const WEBKIT_INTERNAL_NAVIGATION_ERROR = "WebKit encountered an internal error";

export async function gotoWithSingleWebKitInternalErrorRetry<Response>(
  page: NavigablePage<Response>,
  url: string
): Promise<Response> {
  try {
    return await page.goto(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(WEBKIT_INTERNAL_NAVIGATION_ERROR)) {
      throw error;
    }
    return page.goto(url);
  }
}

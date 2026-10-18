import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  if (request.method === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );
  responseHeaders.set("content-type", "text/html; charset=utf-8");
  return new Response(body, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}

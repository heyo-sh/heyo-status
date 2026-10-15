import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import "@heyo-sh/heyo-status/theme/status.css";

export async function loader() {
  const { statusPage } = await import("../heyo-status.config");
  return { mode: statusPage.mode };
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Applies the configured or remembered colour mode before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: statusThemeBootstrapScript(undefined, data?.mode),
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

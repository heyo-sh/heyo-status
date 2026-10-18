import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { D1Database } from "@heyo-sh/heyo-status/deployments/cloudflare";
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
import "./styles/status.css";

type CloudflareArgs = {
  context: { cloudflare: { env: { DB: D1Database } } };
};

export async function loader({ context }: CloudflareArgs) {
  (
    globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
  ).HEYO_STATUS_D1 = context.cloudflare.env.DB;
  const { statusPage } = await import("../heyo-status.config");
  return { mode: statusPage.mode };
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <Meta />
        <Links />
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

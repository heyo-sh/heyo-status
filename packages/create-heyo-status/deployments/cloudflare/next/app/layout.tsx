import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@heyo-sh/heyo-status/theme/status.css";
import "../styles/status.css";

import { requestStatusPage } from "../cloudflare-status-page";

export async function generateMetadata(): Promise<Metadata> {
  const statusPage = await requestStatusPage();
  return { title: statusPage.title, description: statusPage.description };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const statusPage = await requestStatusPage();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: statusThemeBootstrapScript(undefined, statusPage.mode),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@heyo-sh/heyo-status/theme/status.css";

import { requestStatusPage } from "../heyo-status.config";

export async function generateMetadata(): Promise<Metadata> {
  const page = await requestStatusPage();
  return { title: page.title, description: page.description };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const page = await requestStatusPage();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the configured or remembered colour mode before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: statusThemeBootstrapScript(undefined, page.mode),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

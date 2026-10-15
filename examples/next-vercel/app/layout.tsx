import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@heyo-sh/heyo-status/theme/status.css";

import { statusPage } from "../heyo-status.config";

export const metadata: Metadata = {
  title: statusPage.title,
  description: statusPage.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the configured or remembered colour mode before first paint. */}
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

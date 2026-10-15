import { statusThemeBootstrapScript } from "@heyo-sh/heyo-status/theme/script";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@heyo-sh/heyo-status/theme/status.css";
import "../styles/status.css";

export async function generateMetadata(): Promise<Metadata> {
  const { statusPage } = await import("../heyo-status.config");
  return { title: statusPage.title, description: statusPage.description };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Loaded lazily for the same reason as the page: the embedded database
  // adapter must stay off the client and off Next's static analysis path.
  const { statusPage } = await import("../heyo-status.config");

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

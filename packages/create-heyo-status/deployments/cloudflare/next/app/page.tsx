import { StatusPage } from "@heyo-sh/heyo-status/ui";

import { requestStatusPage } from "../cloudflare-status-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const statusPage = await requestStatusPage();
  const snapshot = await statusPage.api.getSnapshot();
  return (
    <StatusPage
      basePath={statusPage.basePath}
      branding={statusPage.branding}
      colors={statusPage.colors}
      metrics={statusPage.metrics}
      mode={statusPage.mode}
      snapshot={snapshot}
      subscribersEnabled={statusPage.subscribers.enabled}
      subscriberMethods={statusPage.subscribers.methods}
      theme={statusPage.theme}
      title={statusPage.title}
    />
  );
}

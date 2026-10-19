import { StatusPage } from "@heyo-sh/heyo-status/ui";

import { requestStatusPage } from "../heyo-status.config";

export const dynamic = "force-dynamic";

export default async function Page() {
  const page = await requestStatusPage();
  return (
    <StatusPage
      basePath={page.basePath}
      branding={page.branding}
      colors={page.colors}
      metrics={page.metrics}
      mode={page.mode}
      incidentsEnabled={page.incidents.enabled}
      maintenanceEnabled={page.maintenance.enabled}
      snapshot={await page.api.getSnapshot()}
      subscribersEnabled={page.subscribers.enabled}
      subscriberMethods={page.subscribers.methods}
      theme={page.theme}
      title={page.title}
    />
  );
}

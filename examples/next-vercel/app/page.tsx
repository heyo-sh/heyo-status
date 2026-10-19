import { StatusPage } from "@heyo-sh/heyo-status/ui";
import { statusPage } from "../heyo-status.config";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await statusPage.api.getSnapshot();
  return (
    <StatusPage
      basePath={statusPage.basePath}
      branding={statusPage.branding}
      colors={statusPage.colors}
      metrics={statusPage.metrics}
      mode={statusPage.mode}
      incidentsEnabled={statusPage.incidents.enabled}
      maintenanceEnabled={statusPage.maintenance.enabled}
      snapshot={snapshot}
      subscribersEnabled={statusPage.subscribers.enabled}
      subscriberMethods={statusPage.subscribers.methods}
      theme={statusPage.theme}
      title={statusPage.title}
    />
  );
}

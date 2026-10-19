import { StatusPage } from "@heyo-sh/heyo-status/ui";

export async function loader() {
  const { statusPage } = await import("../../heyo-status.config");
  return {
    basePath: statusPage.basePath,
    branding: statusPage.branding,
    description: statusPage.description,
    colors: statusPage.colors,
    metrics: statusPage.metrics,
    mode: statusPage.mode,
    incidentsEnabled: statusPage.incidents.enabled,
    maintenanceEnabled: statusPage.maintenance.enabled,
    snapshot: await statusPage.api.getSnapshot(),
    subscribersEnabled: statusPage.subscribers.enabled,
    subscriberMethods: statusPage.subscribers.methods,
    theme: statusPage.theme,
    title: statusPage.title,
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  return [
    { title: data?.title ?? "Heyo Status" },
    { name: "description", content: data?.description ?? "Service status" },
  ];
}

export default function Index({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  return (
    <StatusPage
      basePath={loaderData.basePath}
      branding={loaderData.branding}
      colors={loaderData.colors}
      metrics={loaderData.metrics}
      mode={loaderData.mode}
      incidentsEnabled={loaderData.incidentsEnabled}
      maintenanceEnabled={loaderData.maintenanceEnabled}
      snapshot={loaderData.snapshot}
      subscribersEnabled={loaderData.subscribersEnabled}
      subscriberMethods={loaderData.subscriberMethods}
      theme={loaderData.theme}
      title={loaderData.title}
    />
  );
}

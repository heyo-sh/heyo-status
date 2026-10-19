import { StatusPage } from "@heyo-sh/heyo-status/ui";

import type { CloudflareRouteArgs } from "../../heyo-status.config";

export async function loader({ context }: CloudflareRouteArgs) {
  const { statusPage } = await import("../../heyo-status.config");
  const page = statusPage(context.cloudflare.env);
  return {
    basePath: page.basePath,
    branding: page.branding,
    description: page.description,
    colors: page.colors,
    metrics: page.metrics,
    mode: page.mode,
    incidentsEnabled: page.incidents.enabled,
    maintenanceEnabled: page.maintenance.enabled,
    snapshot: await page.api.getSnapshot(),
    subscribersEnabled: page.subscribers.enabled,
    subscriberMethods: page.subscribers.methods,
    theme: page.theme,
    title: page.title,
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

import { isPublicIncident } from "./incident-visibility";
import type { Incident, StatusPageConfig } from "./types";

/** Produces a standards-compliant RSS 2.0 feed for the public incident history. */
export function createRssFeed(
  config: StatusPageConfig,
  incidents: readonly Incident[],
  origin: string,
): string {
  const pageUrl = publicPageUrl(config, origin);
  const feedUrl = feedSelfUrl(config, origin, "rss.xml");
  const publicIncidents = incidents.filter((incident) =>
    isPublicIncident(config, incident),
  );
  const latest = latestIncidentDate(publicIncidents);
  const items = publicIncidents
    .map((incident) => {
      const link = incidentUrl(pageUrl, incident.id);
      return [
        "<item>",
        `<title>${escapeXml(incident.title)} (${escapeXml(incident.status)})</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="false">${escapeXml(`heyo-status:incident:${incident.id}`)}</guid>`,
        `<pubDate>${incident.updatedAt.toUTCString()}</pubDate>`,
        `<description>${escapeXml(incidentDescription(incident))}</description>`,
        "</item>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(`${config.title} incidents`)}</title>`,
    `<link>${escapeXml(pageUrl)}</link>`,
    // Feed validators require a self reference; it must point at the mounted
    // route, not at the site root.
    `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `<description>${escapeXml(config.description)}</description>`,
    `<lastBuildDate>${latest.toUTCString()}</lastBuildDate>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");
}

/** Produces the Atom equivalent of {@link createRssFeed}. */
export function createAtomFeed(
  config: StatusPageConfig,
  incidents: readonly Incident[],
  origin: string,
): string {
  const pageUrl = publicPageUrl(config, origin);
  const feedUrl = feedSelfUrl(config, origin, "atom.xml");
  const publicIncidents = incidents.filter((incident) =>
    isPublicIncident(config, incident),
  );
  const latest = latestIncidentDate(publicIncidents);
  const entries = publicIncidents
    .map((incident) => {
      const link = incidentUrl(pageUrl, incident.id);
      return [
        "<entry>",
        `<id>${escapeXml(`urn:heyo-status:incident:${incident.id}`)}</id>`,
        `<title>${escapeXml(`${incident.title} (${incident.status})`)}</title>`,
        `<link href="${escapeXml(link)}"/>`,
        `<published>${incident.createdAt.toISOString()}</published>`,
        `<updated>${incident.updatedAt.toISOString()}</updated>`,
        `<summary type="text">${escapeXml(incidentDescription(incident))}</summary>`,
        "</entry>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<id>${escapeXml(feedUrl)}</id>`,
    `<title>${escapeXml(`${config.title} incidents`)}</title>`,
    `<subtitle>${escapeXml(config.description)}</subtitle>`,
    `<link href="${escapeXml(pageUrl)}"/>`,
    `<link rel="self" href="${escapeXml(feedUrl)}"/>`,
    `<updated>${latest.toISOString()}</updated>`,
    entries,
    "</feed>",
  ].join("");
}

function publicPageUrl(config: StatusPageConfig, origin: string): string {
  return config.siteUrl ?? origin.replace(/\/$/, "");
}

/** Feeds are served by the catch-all route, so self links include `basePath`. */
function feedSelfUrl(
  config: StatusPageConfig,
  origin: string,
  file: string,
): string {
  const base = (config.siteUrl ?? origin).replace(/\/$/, "");
  return `${base}${config.basePath}/${file}`;
}

function incidentUrl(pageUrl: string, id: string): string {
  return `${pageUrl.replace(/\/$/, "")}/#incident-${encodeURIComponent(id)}`;
}

function latestIncidentDate(incidents: readonly Incident[]): Date {
  const latest = incidents.reduce<Date | undefined>(
    (current, incident) =>
      !current || incident.updatedAt.getTime() > current.getTime()
        ? incident.updatedAt
        : current,
    undefined,
  );
  return latest ? new Date(latest) : new Date();
}

function incidentDescription(incident: Incident): string {
  const latest = incident.updates.at(-1);
  const monitors =
    incident.affectedMonitors.length > 0
      ? ` Affected monitors: ${incident.affectedMonitors.join(", ")}.`
      : "";
  return `${latest?.message ?? `Incident status: ${incident.status}.`}${monitors}`;
}

/** Escapes text and removes characters that XML 1.0 cannot represent. */
function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&apos;";
        default:
          return character;
      }
    });
}

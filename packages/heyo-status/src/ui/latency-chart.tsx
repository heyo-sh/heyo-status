import { cn } from "@heyo-sh/heyo-ui";

import type { LatencySample } from "../types";

export interface LatencyChartProps {
  /** Latency buckets ordered oldest to newest. */
  samples: LatencySample[];
  monitorName: string;
  label?: string;
  className?: string;
}

const viewWidth = 100;
const viewHeight = 24;
/** Keeps the extremes off the edges so a peak is still a visible line. */
const verticalPadding = 2;
/**
 * Diameter of the newest-sample marker, in CSS pixels. It is a stroke width
 * rather than a radius because only the stroke can opt out of the viewBox
 * scaling; see the marker below.
 */
const markerDiameter = 3.5;

/**
 * A minimal, axis-free latency sparkline.
 *
 * heyo-ui deliberately ships no chart, and this needs none: it is pure SVG, so
 * it renders during SSR, and each bucket carries a native `<title>`, which
 * keeps the exact reading available without any client JavaScript. Only its
 * colours come from the design system.
 *
 * Two details are load-bearing. The horizontal axis is time, not the position
 * in the array, because empty buckets are omitted from the series rather than
 * reported as zero latency — spacing them evenly drew an hour-long gap as if
 * it were the same five minutes as every other step. And the box is stretched
 * to the card width with `preserveAspectRatio="none"`, so anything whose shape
 * matters has to be drawn with a stroke and `non-scaling-stroke`: a geometric
 * circle is scaled on both axes independently and comes out as a flat ellipse.
 */
export function LatencyChart({
  samples,
  monitorName,
  label = "Latency trend",
  className,
}: LatencyChartProps) {
  if (samples.length < 2) return null;

  const latencies = samples.map((sample) => sample.latencyMs);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const average = Math.round(
    latencies.reduce((total, latency) => total + latency, 0) / latencies.length,
  );
  const points = plotPoints(samples, min, max);
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const first = points[0]!;
  const last = points.at(-1)!;
  const area = `${first.x},${viewHeight} ${line} ${last.x},${viewHeight}`;

  return (
    <figure className={cn("m-0 flex flex-col gap-1.5", className)}>
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-heyo-subtle">
        <span>{label}</span>
        <span className="tabular-nums">
          {min === max ? `${max} ms` : `${min}–${max} ms · avg ${average} ms`}
        </span>
      </figcaption>
      <svg
        aria-label={`${monitorName} latency trend: minimum ${min} ms, average ${average} ms, maximum ${max} ms`}
        className="h-10 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      >
        <polygon className="fill-heyo-brand/8" points={area} />
        <polyline
          className="fill-none stroke-heyo-brand"
          points={line}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
        {/*
         * The newest reading, drawn as a zero-length stroke with a round cap:
         * a dot the renderer sizes in CSS pixels, which stays a circle however
         * wide the card is. A `<circle>` here is scaled by the viewBox and
         * renders as an ellipse several times wider than it is tall.
         */}
        <line
          className="stroke-heyo-brand"
          strokeLinecap="round"
          strokeWidth={markerDiameter}
          vectorEffect="non-scaling-stroke"
          x1={last.x}
          x2={last.x}
          y1={last.y}
          y2={last.y}
        />
        {hoverBands(points).map((band) => (
          <rect
            className="fill-transparent hover:fill-heyo-brand/10"
            height={viewHeight}
            key={band.sample.key}
            width={band.width}
            x={band.x}
            y={0}
          >
            <title>{`${band.sample.label}: ${band.sample.latencyMs} ms (${band.sample.totalChecks} ${band.sample.totalChecks === 1 ? "check" : "checks"})`}</title>
          </rect>
        ))}
      </svg>
    </figure>
  );
}

interface PlottedPoint {
  sample: LatencySample;
  x: number;
  y: number;
}

/**
 * Places every bucket on a time axis spanning the first sample to the last, so
 * a gap in the series reads as a gap. Series whose timestamps are unusable —
 * all identical, out of order, or not parseable after a JSON round-trip — fall
 * back to even spacing, which is wrong about time but never about order.
 */
function plotPoints(
  samples: LatencySample[],
  min: number,
  max: number,
): PlottedPoint[] {
  const times = samples.map((sample) => timestampOf(sample.at));
  const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
  const chronological =
    span > 0 &&
    times.every(
      (time, index) => Number.isFinite(time) && time >= (times[index - 1] ?? time), // prettier-ignore
    );

  return samples.map((sample, index) => ({
    sample,
    x: round(
      chronological
        ? ((times[index]! - times[0]!) / span) * viewWidth
        : (index / (samples.length - 1)) * viewWidth,
    ),
    y: round(plotY(sample.latencyMs, min, max)),
  }));
}

interface HoverBand {
  sample: LatencySample;
  x: number;
  width: number;
}

/**
 * Hit areas that tile the full width, each reaching halfway to its neighbours.
 * Fixed-width bands centred on every point left dead gaps between them once
 * the spacing stopped being uniform, so a bucket's tooltip was only reachable
 * from part of the column it belongs to.
 */
function hoverBands(points: PlottedPoint[]): HoverBand[] {
  return points.map((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
    const start = previous ? (previous.x + point.x) / 2 : 0;
    const end = next ? (point.x + next.x) / 2 : viewWidth;
    return {
      sample: point.sample,
      x: round(start),
      width: round(Math.max(end - start, 0)),
    };
  });
}

/** Flat series are drawn as a centred line instead of collapsing onto an edge. */
function plotY(latencyMs: number, min: number, max: number): number {
  const usable = viewHeight - verticalPadding * 2;
  if (max === min) return viewHeight / 2;
  return verticalPadding + usable * (1 - (latencyMs - min) / (max - min));
}

/** Timestamps arrive as `Date` from the runtime and as strings from the API. */
function timestampOf(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

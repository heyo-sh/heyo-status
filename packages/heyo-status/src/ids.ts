/**
 * Base-36 milliseconds padded to a fixed width, so identifiers compare
 * correctly as plain strings. Nine characters cover every timestamp until the
 * year 5138, which is well past the point where a shorter prefix would start
 * sorting a newer record before an older one.
 */
const timestampWidth = 9;
/** Records written inside one millisecond, which is 1.6M before it wraps. */
const sequenceWidth = 4;
const sequenceLimit = 36 ** sequenceWidth;

let lastTimestamp = 0;
let sequence = 0;

/**
 * Creates a prefixed, time-sortable identifier.
 *
 * Every list is ordered by a timestamp column with the identifier as its
 * tie-breaker, and two records written in the same millisecond are common: one
 * check run can open several incidents at once. A random identifier made that
 * tie-break arbitrary, so an incident list or a feed could report the newer
 * record first. Sorting time into the identifier keeps `ORDER BY created_at,
 * id` in insertion order without adding a column.
 *
 * Millisecond collisions and a clock that steps backwards are handled the same
 * way ULIDs handle them: the encoded timestamp never moves backwards and a
 * counter orders whatever shares it. The authoritative time stays in the row's
 * own timestamp column.
 *
 * The random half stays at 128 bits because some identifiers are also
 * capabilities: an unsubscribe link authenticates with nothing else.
 */
export function createId(prefix: string, now = Date.now()): string {
  const requested = Math.max(0, Math.trunc(now));
  if (requested > lastTimestamp) {
    lastTimestamp = requested;
    sequence = 0;
  } else if (sequence + 1 < sequenceLimit) {
    sequence += 1;
  } else {
    // Overflowing the counter is preferable to reusing an ordering slot.
    lastTimestamp += 1;
    sequence = 0;
  }

  const timestamp = lastTimestamp.toString(36).padStart(timestampWidth, "0");
  const ordinal = sequence.toString(36).padStart(sequenceWidth, "0");
  return `${prefix}_${timestamp}${ordinal}${crypto.randomUUID().replaceAll("-", "")}`;
}

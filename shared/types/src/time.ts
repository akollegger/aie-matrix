export const WORLD_TIMEZONE = "America/Los_Angeles";

const _fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: WORLD_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "shortOffset",
});

/** Returns the current wall-clock time as ISO 8601 with US/Pacific UTC offset,
 *  e.g. "2026-06-05T09:30:00-07:00". All server services MUST use this instead
 *  of new Date().toISOString() (which produces bare UTC "Z" timestamps). */
export function worldNow(): string {
  return toWorldTime(new Date());
}

/** Formats an arbitrary Date as ISO 8601 with the Pacific UTC offset. */
export function toWorldTime(date: Date): string {
  const parts = _fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  const offsetRaw = get("timeZoneName"); // e.g. "GMT-7"
  const rawNum = offsetRaw.replace("GMT", ""); // e.g. "-7"
  const sign = rawNum.startsWith("-") ? "-" : "+";
  const absH = rawNum.replace(/^[+-]/, "").split(":")[0].padStart(2, "0");
  const absM = rawNum.includes(":") ? rawNum.split(":")[1].padStart(2, "0") : "00";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${absH}:${absM}`;
}

import { Temporal } from '@js-temporal/polyfill';

export function validDay(day: string): boolean {
  try { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Temporal.PlainDate.from(day).toString() === day; } catch { return false; }
}
export function validateTime(time: string | null): void {
  if (time !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`时间必须为 HH:mm：${time}`);
}
export function validateExpected(value: string | null): void {
  if (value !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('预计完成时刻必须为带偏移的 ISO 时间，例如 2026-10-03T16:00:00-07:00');
}
export function timestamp(day: string | null, time: string | null, zone: string): number | null {
  if (day === null) { if (time) throw new Error('具体时间必须同时有日期'); return null; }
  if (!validDay(day)) throw new Error(`无效日期：${day}`);
  validateTime(time);
  if (!time) return null;
  const plain = Temporal.PlainDateTime.from(`${day}T${time}`);
  // Fall-back ambiguity chooses the earlier occurrence. Spring gaps are rejected, not shifted.
  const zoned = plain.toZonedDateTime(zone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(plain)) throw new Error(`该时区的时间不存在（夏令时）：${day} ${time}`);
  return zoned.epochMilliseconds;
}
export function fromHost(day: string | null | undefined, ms: number | null | undefined, zone: string): { day: string | null; time: string | null } {
  if (ms != null) {
    const z = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone);
    return { day: z.toPlainDate().toString(), time: `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}` };
  }
  return { day: day || null, time: null };
}

import type { TaskValue } from '../types';
export const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function mergeTask(base: TaskValue | undefined, host: TaskValue, file: TaskValue): { value: TaskValue; conflicts: string[] } {
  const value = structuredClone(host), conflicts: string[] = [];
  for (const key of Object.keys(host) as Array<keyof TaskValue>) {
    if (equal(host[key], file[key])) continue;
    if (base && equal(host[key], base[key])) (value as unknown as Record<string, unknown>)[key] = file[key];
    else if (!base || !equal(file[key], base[key])) conflicts.push(key);
  }
  return { value, conflicts };
}

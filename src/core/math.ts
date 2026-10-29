export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

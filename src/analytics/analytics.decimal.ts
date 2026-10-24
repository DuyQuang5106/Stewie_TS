// Decimal amounts from PostgreSQL NUMERIC are converted without binary-float arithmetic.
export function cents(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  const s = String(value),
    negative = s.startsWith('-'),
    [whole, fraction = ''] = s.replace(/^[+-]/, '').split('.');
  const n = BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -n : n;
}
export function divideHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('Invalid analytics denominator');
  const negative = n < 0n,
    abs = negative ? -n : n,
    result = (abs * 2n + d) / (d * 2n);
  return negative ? -result : result;
}
export const percentage = (earned: bigint, possible: bigint) =>
  possible > 0n ? Number(divideHalfUp(earned * 10000n, possible)) / 100 : 0;
export const rate = (correct: number, count: number) =>
  count > 0
    ? Number(divideHalfUp(BigInt(correct) * 10000n, BigInt(count))) / 10000
    : 0;
export function meanPercentage(rows: Record<string, any>[]) {
  if (!rows.length) return null;
  let sum = 0n;
  for (const r of rows)
    sum += divideHalfUp(cents(r.total_grade) * 1000000n, cents(r.max_grade));
  return Number(divideHalfUp(sum, BigInt(rows.length) * 100n)) / 100;
}

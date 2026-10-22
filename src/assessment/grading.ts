import { javaTrim } from '../academic-write/question.binding.js';
import type { Row } from './assessment.binding.js';
export const jsonText = (v: any): string =>
  v === null ? 'null' : typeof v === 'object' ? '' : String(v);
export function rational(text: string): [bigint, bigint] {
  const s = javaTrim(text);
  if (!s || s.length > 32) throw new Error('Invalid rational');
  const spaced = Array.from(s, (c) => {
    const n = c.charCodeAt(0);
    return n >= 9 && n <= 13 ? ' ' : c;
  }).join('');
  const fraction = /^([+-]?\d+) *\/ *([+-]?\d+)$/.exec(spaced);
  if (fraction) {
    const a = BigInt(fraction[1]!),
      b = BigInt(fraction[2]!);
    if (b === 0n) throw new Error('Zero denominator');
    return [a, b];
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))
    throw new Error('Invalid decimal');
  const sign = s.startsWith('-') ? -1n : 1n;
  const unsigned = s.replace(/^[+-]/, '');
  const [whole, decimal = ''] = unsigned.split('.');
  return [
    sign * BigInt((whole || '0') + decimal),
    10n ** BigInt(decimal.length),
  ];
}
// Java equalsIgnoreCase uses simple character case mappings, not full String case expansion.
export function javaEqualsIgnoreCase(a: string, b: string) {
  if (a.length !== b.length) return false;
  const fold = (s: string) =>
    Array.from(s, (c) => {
      const upper = c.toUpperCase();
      const simpleUpper = Array.from(upper).length === 1 ? upper : c;
      return Array.from(simpleUpper.toLowerCase())[0]!;
    }).join('');
  return fold(a) === fold(b);
}
export function evaluate(snapshot: Row, data: any): boolean {
  const spec = snapshot.answer ?? {};
  if (snapshot.questionType === 'MULTIPLE_CHOICE') {
    const expected = new Set(spec.correctOptionIds ?? []);
    let values: any[] = [];
    if (Array.isArray(data)) values = data;
    else if (typeof data === 'string') values = [data];
    else if (Array.isArray(data?.selectedOptionIds))
      values = data.selectedOptionIds;
    else if (
      data?.selectedOptionId !== null &&
      data?.selectedOptionId !== undefined
    )
      values = [data.selectedOptionId];
    const actual = new Set(values.map((v) => javaTrim(jsonText(v))));
    return (
      expected.size > 0 &&
      expected.size === actual.size &&
      [...expected].every((v) => actual.has(String(v)))
    );
  }
  if (snapshot.questionType !== 'FILL_IN') return false;
  const text = javaTrim(
    typeof data === 'string' ? data : jsonText(data?.value ?? data?.text ?? ''),
  );
  if (!text) return false;
  return (spec.acceptedAnswers ?? []).some((answer: any) => {
    if (answer === null) return false;
    if (spec.gradingMode === 'NUMERIC') {
      try {
        const [a, b] = rational(text),
          [c, d] = rational(String(answer));
        return a * d === c * b;
      } catch {
        return false;
      }
    }
    return javaEqualsIgnoreCase(javaTrim(String(answer)), text);
  });
}

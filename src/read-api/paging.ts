import { apiError } from './auth.guard.js';

export function parsePaging(query: Record<string, unknown>) {
  const integer = (value: unknown, fallback: number, min: number) => {
    if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) return fallback;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= 2147483647 && number >= min ? number : fallback;
  };
  return { page: integer(query.page, 0, 0), size: Math.min(integer(query.size, 20, 1), 2000) };
}

export function parseSort(query: Record<string, unknown>, columns: Record<string, string>, path: string,
  textProperties: string[]) {
  const orders: string[] = [];
  const sorts = query.sort === undefined ? [] : Array.isArray(query.sort) ? query.sort : [query.sort];
  for (const sort of sorts) {
    if (typeof sort !== 'string') continue;
    const parts = sort.split(',').filter(Boolean);
    const ignoreCase = parts.at(-1)?.toLowerCase() === 'ignorecase';
    if (ignoreCase) parts.pop();
    const last = parts.at(-1)?.toLowerCase();
    const direction = last === 'desc' ? 'DESC' : 'ASC';
    if (last === 'asc' || last === 'desc') parts.pop();
    for (const property of parts) {
      const column = Object.hasOwn(columns, property) ? columns[property] : undefined;
      if (!column) throw apiError(400, `Không thể sắp xếp theo '${property}'`, path);
      const expression = ignoreCase && textProperties.includes(property) ? `lower(${column})` : column;
      orders.push(`${expression} ${direction}`);
    }
  }
  return orders.length ? 'ORDER BY ' + orders.join(', ') : '';
}

import mongoose, { Types } from 'mongoose';
import { generateHex24Id, isHex24 } from '../config/supabase.js';

export type PlainDoc = Record<string, any>;

function isPlainObject(val: unknown): val is Record<string, any> {
  if (!val || typeof val !== 'object') return false;
  if (val instanceof Date || val instanceof RegExp || val instanceof Types.ObjectId || val instanceof Map || Buffer.isBuffer(val) || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

export function cloneValue<T>(val: T): T {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (val instanceof Date) return new Date(val.getTime()) as unknown as T;
  if (val instanceof Types.ObjectId) return new Types.ObjectId(val.toString()) as unknown as T;
  if (val instanceof RegExp) return new RegExp(val.source, val.flags) as unknown as T;
  if (val instanceof Map) {
    const cloned = new Map();
    for (const [k, v] of val.entries()) {
      cloned.set(k, cloneValue(v));
    }
    return cloned as unknown as T;
  }
  if (Buffer.isBuffer(val)) return Buffer.from(val) as unknown as T;
  if (Array.isArray(val)) return val.map((item) => cloneValue(item)) as unknown as T;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = cloneValue(v);
  }
  return out as T;
}

export function normalizeComparable(val: unknown): unknown {
  if (val instanceof Types.ObjectId) return val.toString().toLowerCase();
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string' && isHex24(val)) return val.toLowerCase();
  return val;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return a === b;
  if (a == null || b == null) return false;

  const na = normalizeComparable(a);
  const nb = normalizeComparable(b);
  if (na === nb) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, idx) => valuesEqual(v, b[idx]));
  }
  return false;
}

export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const restPath = parts.slice(i).join('.');
      return cur.map((item) => getByPath(item, restPath));
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  return cur;
}

export function setByPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key]) || cur[key] instanceof Date) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

export function unsetByPath(obj: Record<string, any>, path: string): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object') return;
    cur = cur[key];
  }
  delete cur[parts[parts.length - 1]];
}

function compareValues(a: unknown, b: unknown): number {
  const na = normalizeComparable(a);
  const nb = normalizeComparable(b);
  if (na === nb) return 0;
  if (na === null || na === undefined) return -1;
  if (nb === null || nb === undefined) return 1;
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  if (typeof na === 'string' && typeof nb === 'string') return na < nb ? -1 : 1;
  return String(na) < String(nb) ? -1 : 1;
}

function evalExpression(expr: unknown, doc: PlainDoc): unknown {
  if (expr === null || expr === undefined) return expr;
  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) {
      return undefined;
    }
    if (expr.startsWith('$')) {
      return getByPath(doc, expr.slice(1));
    }
    return expr;
  }
  if (typeof expr !== 'object' || expr instanceof Date || expr instanceof Types.ObjectId) {
    return expr;
  }
  if (Array.isArray(expr)) {
    return expr.map((item) => evalExpression(item, doc));
  }

  const obj = expr as Record<string, any>;
  if ('$literal' in obj) return cloneValue(obj.$literal);
  if ('$ifNull' in obj) {
    const [first, fallback] = obj.$ifNull as [unknown, unknown];
    const v = evalExpression(first, doc);
    return v !== null && v !== undefined ? v : evalExpression(fallback, doc);
  }
  if ('$cond' in obj) {
    const condSpec = obj.$cond;
    let testVal: unknown;
    let thenBranch: unknown;
    let elseBranch: unknown;
    if (Array.isArray(condSpec)) {
      [testVal, thenBranch, elseBranch] = condSpec;
    } else {
      testVal = condSpec.if;
      thenBranch = condSpec.then;
      elseBranch = condSpec.else;
    }
    return evalExpression(testVal, doc)
      ? evalExpression(thenBranch, doc)
      : evalExpression(elseBranch, doc);
  }
  if ('$and' in obj) {
    return (obj.$and as unknown[]).every((sub) => Boolean(evalExpression(sub, doc)));
  }
  if ('$or' in obj) {
    return (obj.$or as unknown[]).some((sub) => Boolean(evalExpression(sub, doc)));
  }
  if ('$not' in obj) {
    const inner = Array.isArray(obj.$not) ? obj.$not[0] : obj.$not;
    return !evalExpression(inner, doc);
  }
  if ('$eq' in obj) {
    const [a, b] = obj.$eq as [unknown, unknown];
    return valuesEqual(evalExpression(a, doc), evalExpression(b, doc));
  }
  if ('$ne' in obj) {
    const [a, b] = obj.$ne as [unknown, unknown];
    return !valuesEqual(evalExpression(a, doc), evalExpression(b, doc));
  }
  if ('$lt' in obj) {
    const [a, b] = obj.$lt as [unknown, unknown];
    return compareValues(evalExpression(a, doc), evalExpression(b, doc)) < 0;
  }
  if ('$lte' in obj) {
    const [a, b] = obj.$lte as [unknown, unknown];
    return compareValues(evalExpression(a, doc), evalExpression(b, doc)) <= 0;
  }
  if ('$gt' in obj) {
    const [a, b] = obj.$gt as [unknown, unknown];
    return compareValues(evalExpression(a, doc), evalExpression(b, doc)) > 0;
  }
  if ('$gte' in obj) {
    const [a, b] = obj.$gte as [unknown, unknown];
    return compareValues(evalExpression(a, doc), evalExpression(b, doc)) >= 0;
  }
  if ('$add' in obj) {
    return (obj.$add as unknown[]).reduce<number>(
      (acc, item) => acc + (Number(evalExpression(item, doc)) || 0),
      0
    );
  }
  if ('$subtract' in obj) {
    const [a, b] = obj.$subtract as [unknown, unknown];
    return (Number(evalExpression(a, doc)) || 0) - (Number(evalExpression(b, doc)) || 0);
  }
  if ('$type' in obj) {
    const target = evalExpression(obj.$type, doc);
    if (target === undefined) return 'missing';
    if (target === null) return 'null';
    if (target instanceof Date) return 'date';
    if (target instanceof Types.ObjectId) return 'objectId';
    if (Array.isArray(target)) return 'array';
    if (typeof target === 'boolean') return 'bool';
    if (typeof target === 'number') return 'number';
    if (typeof target === 'string') return 'string';
    return 'object';
  }
  if ('$let' in obj) {
    const { vars, in: inExpr } = obj.$let as { vars: Record<string, unknown>; in: unknown };
    const scopedDoc = cloneValue(doc);
    for (const [k, v] of Object.entries(vars || {})) {
      scopedDoc[k] = evalExpression(v, doc);
    }
    const resolveScoped = (node: unknown): unknown => {
      if (typeof node === 'string' && node.startsWith('$$')) {
        return getByPath(scopedDoc, node.slice(2));
      }
      if (Array.isArray(node)) return node.map(resolveScoped);
      if (isPlainObject(node)) {
        const mapped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) {
          mapped[k] = resolveScoped(v);
        }
        return mapped;
      }
      return node;
    };
    return evalExpression(resolveScoped(inExpr), scopedDoc);
  }
  if ('$size' in obj) {
    const arr = evalExpression(obj.$size, doc);
    return Array.isArray(arr) ? arr.length : 0;
  }

  // Plain object construction inside $set
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = evalExpression(v, doc);
  }
  return out;
}

function matchCondition(val: unknown, condition: unknown): boolean {
  if (condition instanceof RegExp) {
    if (Array.isArray(val)) return val.some((v) => typeof v === 'string' && condition.test(v));
    return typeof val === 'string' && condition.test(val);
  }

  if (!isPlainObject(condition)) {
    if (Array.isArray(val) && !Array.isArray(condition)) {
      return val.some((item) => valuesEqual(item, condition));
    }
    return valuesEqual(val, condition);
  }

  const keys = Object.keys(condition);
  const isOperatorObj = keys.some((k) => k.startsWith('$'));
  if (!isOperatorObj) {
    if (Array.isArray(val)) {
      return val.some((item) => valuesEqual(item, condition));
    }
    return valuesEqual(val, condition);
  }

  for (const op of keys) {
    const operand = condition[op];
    switch (op) {
      case '$eq':
        if (Array.isArray(val) && !Array.isArray(operand)) {
          if (!val.some((v) => valuesEqual(v, operand))) return false;
        } else if (!valuesEqual(val, operand)) {
          return false;
        }
        break;
      case '$ne':
        if (Array.isArray(val) && !Array.isArray(operand)) {
          if (val.some((v) => valuesEqual(v, operand))) return false;
        } else if (valuesEqual(val, operand)) {
          return false;
        }
        break;
      case '$in': {
        const list = Array.isArray(operand) ? operand : [];
        if (Array.isArray(val)) {
          if (!val.some((v) => list.some((c) => valuesEqual(v, c)))) return false;
        } else if (!list.some((c) => valuesEqual(val, c))) {
          return false;
        }
        break;
      }
      case '$nin': {
        const list = Array.isArray(operand) ? operand : [];
        if (Array.isArray(val)) {
          if (val.some((v) => list.some((c) => valuesEqual(v, c)))) return false;
        } else if (list.some((c) => valuesEqual(val, c))) {
          return false;
        }
        break;
      }
      case '$gt':
        if (val === null || val === undefined || compareValues(val, operand) <= 0) return false;
        break;
      case '$gte':
        if (val === null || val === undefined || compareValues(val, operand) < 0) return false;
        break;
      case '$lt':
        if (val === null || val === undefined || compareValues(val, operand) >= 0) return false;
        break;
      case '$lte':
        if (val === null || val === undefined || compareValues(val, operand) > 0) return false;
        break;
      case '$exists':
        if (Boolean(operand) !== (val !== undefined)) return false;
        break;
      case '$regex': {
        const regex =
          operand instanceof RegExp
            ? operand
            : new RegExp(String(operand), typeof condition.$options === 'string' ? condition.$options : '');
        if (Array.isArray(val)) {
          if (!val.some((v) => typeof v === 'string' && regex.test(v))) return false;
        } else if (typeof val !== 'string' || !regex.test(val)) {
          return false;
        }
        break;
      }
      case '$options':
        break;
      case '$not':
        if (matchCondition(val, operand)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

export function matchesFilter(doc: PlainDoc, filter: PlainDoc = {}): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, rawCond] of Object.entries(filter)) {
    if (key === '$and') {
      const clauses = Array.isArray(rawCond) ? rawCond : [];
      if (!clauses.every((c) => matchesFilter(doc, c))) return false;
      continue;
    }
    if (key === '$or') {
      const clauses = Array.isArray(rawCond) ? rawCond : [];
      if (!clauses.some((c) => matchesFilter(doc, c))) return false;
      continue;
    }
    if (key === '$expr') {
      if (!evalExpression(rawCond, doc)) return false;
      continue;
    }

    const val = getByPath(doc, key);
    if (!matchCondition(val, rawCond)) {
      return false;
    }
  }
  return true;
}

export function sortDocs(docs: PlainDoc[], sortSpec?: Record<string, 1 | -1 | 'asc' | 'desc'> | null): PlainDoc[] {
  if (!sortSpec || Object.keys(sortSpec).length === 0) return docs;
  const entries = Object.entries(sortSpec);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      const mult = dir === -1 || dir === 'desc' ? -1 : 1;
      const cmp = compareValues(getByPath(a, field), getByPath(b, field));
      if (cmp !== 0) return cmp * mult;
    }
    return 0;
  });
}

export function projectFields(doc: PlainDoc, selectSpec?: string | Record<string, 0 | 1> | null): PlainDoc {
  if (!selectSpec) return doc;
  const inclusions: string[] = [];
  const exclusions: string[] = [];

  if (typeof selectSpec === 'string') {
    for (const token of selectSpec.trim().split(/\s+/)) {
      if (!token) continue;
      if (token.startsWith('-')) exclusions.push(token.slice(1));
      else inclusions.push(token.replace(/^\+/, ''));
    }
  } else {
    for (const [k, v] of Object.entries(selectSpec)) {
      if (v === 1) inclusions.push(k);
      else if (v === 0) exclusions.push(k);
    }
  }

  if (inclusions.length > 0) {
    const out: PlainDoc = {};
    if (doc._id !== undefined && !exclusions.includes('_id')) {
      out._id = cloneValue(doc._id);
    }
    for (const inc of inclusions) {
      const val = getByPath(doc, inc);
      if (val !== undefined) {
        setByPath(out, inc, cloneValue(val));
      }
    }
    return out;
  }

  if (exclusions.length > 0) {
    const out = cloneValue(doc);
    for (const exc of exclusions) {
      unsetByPath(out, exc);
    }
    return out;
  }

  return doc;
}

export function applyUpdate(
  existing: PlainDoc | null,
  update: PlainDoc | PlainDoc[],
  options?: { isInsert?: boolean }
): PlainDoc {
  const base = existing ? cloneValue(existing) : { _id: new Types.ObjectId(generateHex24Id()) };
  const now = new Date();

  if (Array.isArray(update)) {
    // Aggregation pipeline update ([ { $set: ... }, { $unset: ... } ])
    for (const stage of update) {
      if (stage.$set) {
        const stageSnapshot = cloneValue(base);
        for (const [k, expr] of Object.entries(stage.$set)) {
          const resolved = evalExpression(expr, stageSnapshot);
          if (resolved !== undefined) {
            setByPath(base, k, resolved);
          }
        }
      }
      if (stage.$unset) {
        const fields = Array.isArray(stage.$unset)
          ? stage.$unset
          : typeof stage.$unset === 'string'
            ? [stage.$unset]
            : Object.keys(stage.$unset);
        for (const f of fields) {
          unsetByPath(base, f);
        }
      }
    }
    base.updatedAt = now;
    return base;
  }

  const hasOperators = Object.keys(update).some((k) => k.startsWith('$'));
  if (!hasOperators) {
    for (const [k, v] of Object.entries(update)) {
      if (k !== '_id') {
        setByPath(base, k, cloneValue(v));
      }
    }
    base.updatedAt = now;
    return base;
  }

  if (options?.isInsert && update.$setOnInsert) {
    for (const [k, v] of Object.entries(update.$setOnInsert)) {
      setByPath(base, k, cloneValue(v));
    }
  }

  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) {
      setByPath(base, k, cloneValue(v));
    }
  }

  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      unsetByPath(base, k);
    }
  }

  if (update.$inc) {
    for (const [k, delta] of Object.entries(update.$inc)) {
      const cur = Number(getByPath(base, k) ?? 0);
      setByPath(base, k, cur + Number(delta));
    }
  }

  if (update.$push) {
    for (const [k, pushSpec] of Object.entries(update.$push)) {
      const existingArr = getByPath(base, k);
      const arr = Array.isArray(existingArr) ? [...existingArr] : [];
      if (isPlainObject(pushSpec) && '$each' in pushSpec) {
        const items = Array.isArray(pushSpec.$each) ? pushSpec.$each : [];
        arr.push(...items.map((x) => cloneValue(x)));
        if (typeof pushSpec.$slice === 'number') {
          if (pushSpec.$slice < 0) {
            arr.splice(0, Math.max(0, arr.length + pushSpec.$slice));
          } else if (pushSpec.$slice === 0) {
            arr.length = 0;
          } else {
            arr.splice(pushSpec.$slice);
          }
        }
      } else {
        arr.push(cloneValue(pushSpec));
      }
      setByPath(base, k, arr);
    }
  }

  if (update.$addToSet) {
    for (const [k, val] of Object.entries(update.$addToSet)) {
      const existingArr = getByPath(base, k);
      const arr = Array.isArray(existingArr) ? [...existingArr] : [];
      if (!arr.some((item) => valuesEqual(item, val))) {
        arr.push(cloneValue(val));
      }
      setByPath(base, k, arr);
    }
  }

  if (!base.createdAt) base.createdAt = now;
  base.updatedAt = now;
  return base;
}

export function evaluateAggregation(docs: PlainDoc[], pipeline: PlainDoc[]): PlainDoc[] {
  let current = docs.map((d) => cloneValue(d));
  for (const stage of pipeline) {
    if (stage.$match) {
      current = current.filter((d) => matchesFilter(d, stage.$match));
    } else if (stage.$group) {
      const spec = stage.$group as Record<string, any>;
      const groups = new Map<string, { id: unknown; docs: PlainDoc[] }>();
      for (const d of current) {
        const groupId = evalExpression(spec._id, d);
        const key = String(normalizeComparable(groupId));
        if (!groups.has(key)) {
          groups.set(key, { id: groupId, docs: [] });
        }
        groups.get(key)!.docs.push(d);
      }
      const next: PlainDoc[] = [];
      for (const grp of groups.values()) {
        const row: PlainDoc = { _id: grp.id };
        for (const [outField, accExpr] of Object.entries(spec)) {
          if (outField === '_id') continue;
          if (isPlainObject(accExpr) && '$addToSet' in accExpr) {
            const setVals: unknown[] = [];
            for (const d of grp.docs) {
              const v = evalExpression(accExpr.$addToSet, d);
              if (v !== undefined && !setVals.some((x) => valuesEqual(x, v))) {
                setVals.push(v);
              }
            }
            row[outField] = setVals;
          } else if (isPlainObject(accExpr) && '$sum' in accExpr) {
            let total = 0;
            for (const d of grp.docs) {
              const v = typeof accExpr.$sum === 'number' ? accExpr.$sum : Number(evalExpression(accExpr.$sum, d)) || 0;
              total += v;
            }
            row[outField] = total;
          }
        }
        next.push(row);
      }
      current = next;
    } else if (stage.$project) {
      const spec = stage.$project as Record<string, any>;
      current = current.map((d) => {
        const out: PlainDoc = {};
        for (const [k, expr] of Object.entries(spec)) {
          if (expr === 1) {
            out[k] = getByPath(d, k);
          } else if (expr !== 0) {
            out[k] = evalExpression(expr, d);
          }
        }
        return out;
      });
    } else if (stage.$sort) {
      current = sortDocs(current, stage.$sort);
    } else if (typeof stage.$limit === 'number') {
      current = current.slice(0, stage.$limit);
    }
  }
  return current;
}

export class SupabaseQuery<T = any> implements PromiseLike<T> {
  private selectSpec: string | Record<string, 0 | 1> | null = null;
  private sortSpec: Record<string, 1 | -1 | 'asc' | 'desc'> | null = null;
  private skipCount = 0;
  private limitCount: number | null = null;
  private isLean = false;
  private populates: Array<{ path: string; select?: string }> = [];

  constructor(
    private readonly executor: (opts: {
      selectSpec: string | Record<string, 0 | 1> | null;
      sortSpec: Record<string, 1 | -1 | 'asc' | 'desc'> | null;
      skipCount: number;
      limitCount: number | null;
      isLean: boolean;
      populates: Array<{ path: string; select?: string }>;
    }) => Promise<T>
  ) {}

  select(spec: string | Record<string, 0 | 1>): this {
    this.selectSpec = spec;
    return this;
  }

  sort(spec: Record<string, 1 | -1 | 'asc' | 'desc'> | string): this {
    if (typeof spec === 'string') {
      const parsed: Record<string, 1 | -1> = {};
      for (const token of spec.trim().split(/\s+/)) {
        if (!token) continue;
        if (token.startsWith('-')) parsed[token.slice(1)] = -1;
        else parsed[token.replace(/^\+/, '')] = 1;
      }
      this.sortSpec = parsed;
    } else {
      this.sortSpec = spec;
    }
    return this;
  }

  skip(n: number): this {
    this.skipCount = Math.max(0, n);
    return this;
  }

  limit(n: number): this {
    this.limitCount = Math.max(0, n);
    return this;
  }

  lean(_val = true): this {
    this.isLean = Boolean(_val);
    return this;
  }

  session(_sess?: unknown): this {
    return this;
  }

  setOptions(_opts?: unknown): this {
    return this;
  }

  collation(_opts?: unknown): this {
    return this;
  }

  hint(_opts?: unknown): this {
    return this;
  }

  populate(path: string, select?: string): this {
    this.populates.push({ path, select });
    return this;
  }

  exec(): Promise<T> {
    return this.executor({
      selectSpec: this.selectSpec,
      sortSpec: this.sortSpec,
      skipCount: this.skipCount,
      limitCount: this.limitCount,
      isLean: this.isLean,
      populates: this.populates,
    });
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.exec().finally(onfinally);
  }
}

export function attachDocumentMethods(
  doc: PlainDoc,
  saveHandler: (doc: PlainDoc) => Promise<PlainDoc>
): PlainDoc {
  if (!doc || typeof doc !== 'object') return doc;
  Object.defineProperty(doc, 'id', {
    get() {
      return doc._id ? String(doc._id) : undefined;
    },
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(doc, 'save', {
    value: async () => {
      const updated = await saveHandler(doc);
      Object.assign(doc, updated);
      return doc;
    },
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(doc, 'markModified', {
    value: (_path: string) => {},
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(doc, 'toObject', {
    value: () => cloneValue(doc),
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(doc, 'toJSON', {
    value: () => cloneValue(doc),
    configurable: true,
    enumerable: false,
  });
  return doc;
}

export function createMongoDuplicateError(message: string, keyPattern?: Record<string, number>) {
  const err = new Error(message) as Error & { code: number; keyPattern?: Record<string, number> };
  err.code = 11000;
  if (keyPattern) err.keyPattern = keyPattern;
  return err;
}

export function reviveDatesDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(obj)) {
      const d = new Date(obj);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(reviveDatesDeep);
  if (isPlainObject(obj)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = reviveDatesDeep(v);
    }
    return out;
  }
  return obj;
}

export function normalizeObjectIdFields(doc: PlainDoc, idFields: string[]): PlainDoc {
  for (const field of idFields) {
    const v = doc[field];
    if (v && typeof v === 'string' && isHex24(v)) {
      doc[field] = new Types.ObjectId(v);
    }
  }
  return doc;
}

export function ensureHex24(val: unknown): string {
  if (!val) return generateHex24Id();
  if (val instanceof Types.ObjectId) return val.toString().toLowerCase();
  const str = String(val).trim().toLowerCase();
  if (isHex24(str)) return str;
  return mongoose.Types.ObjectId.isValid(str) ? new Types.ObjectId(str).toString().toLowerCase() : generateHex24Id();
}

/**
 * Corrispondenza articolo -> fornitore tramite un campo personalizzato Dinghuobao.
 *
 * L'API ERP non espone il fornitore sull'anagrafica articolo: il fornitore viene
 * scritto in un campo personalizzato (field_1..field_6) e qui viene riconosciuto
 * confrontandolo con l'anagrafica fornitori sincronizzata (nome, numero cliente o id ERP).
 */

export const SUPPLIER_FIELD_KEYS = ['field_1', 'field_2', 'field_3', 'field_4', 'field_5', 'field_6'] as const;

export type SupplierFieldKey = (typeof SUPPLIER_FIELD_KEYS)[number];

/** Campo personalizzato usato come fornitore quando nessuna configurazione e' salvata. */
export const DEFAULT_SUPPLIER_FIELD: SupplierFieldKey = 'field_6';

/** Normalizza un valore per il confronto: spazi compattati e maiuscole/minuscole ignorate. */
export function normalizeSupplierKey(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface SupplierIndexEntry {
  supplierName?: string | null;
  clientNum?: string | null;
  erpClientId?: string | null;
}

export interface SupplierIndex {
  /** nome normalizzato -> nome ufficiale in anagrafica */
  byName: Map<string, string>;
  /** numero cliente / id ERP normalizzato -> nome ufficiale in anagrafica */
  byCode: Map<string, string>;
}

export function buildSupplierIndex(rows: SupplierIndexEntry[]): SupplierIndex {
  const byName = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const row of rows) {
    const canonical = String(row.supplierName ?? '').trim();
    if (!canonical) continue;
    const name = normalizeSupplierKey(canonical);
    if (name && !byName.has(name)) byName.set(name, canonical);
    for (const code of [row.clientNum, row.erpClientId]) {
      const key = normalizeSupplierKey(code);
      if (key && !byCode.has(key)) byCode.set(key, canonical);
    }
  }
  return { byName, byCode };
}

/**
 * Risolve il contenuto di un campo personalizzato in un fornitore dell'anagrafica.
 * Se il campo contiene piu' valori separati, viene preso il primo riconosciuto.
 * Restituisce null quando non c'e' nessuna corrispondenza (il valore non viene inventato).
 */
export function resolveSupplierValue(value: string | null | undefined, index: SupplierIndex): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const lookup = (candidate: string): string | null => {
    const key = normalizeSupplierKey(candidate);
    if (!key) return null;
    return index.byName.get(key) ?? index.byCode.get(key) ?? null;
  };

  const direct = lookup(raw);
  if (direct) return direct;

  for (const part of raw.split(/[,;|、，；]+/)) {
    const hit = lookup(part);
    if (hit) return hit;
  }
  return null;
}

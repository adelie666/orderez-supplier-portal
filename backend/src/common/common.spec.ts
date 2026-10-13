import 'reflect-metadata';
import { beijingToUtc, formatBeijing, formatRome, romeLocalToUtc } from './time.util';
import { amountOf, formatEur, formatQty, toNumber } from './format.util';
import { ORDER_STATUSES, SHIPPABLE_STATUSES } from '../orders/dto/list-orders.dto';
import { buildSupplierIndex, resolveSupplierValue } from './supplier-match.util';

describe('time.util', () => {
  it('converte orario di Pechino in UTC', () => {
    const utc = beijingToUtc('2026-10-08 12:30:00');
    expect(utc?.toISOString()).toBe('2026-10-08T04:30:00.000Z');
  });

  it('accetta timestamp in secondi', () => {
    expect(beijingToUtc(1760000000)?.toISOString()).toBe('2025-10-09T08:53:20.000Z');
  });

  it('ignora valori vuoti', () => {
    expect(beijingToUtc(null)).toBeNull();
    expect(beijingToUtc('')).toBeNull();
  });

  it('gestisce l ora legale italiana (CEST = UTC+2)', () => {
    // 2026-07-15 00:00 a Roma = 2026-07-14 22:00 UTC
    expect(romeLocalToUtc('2026-07-15', false)?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('gestisce l ora solare italiana (CET = UTC+1)', () => {
    // 2026-01-15 00:00 a Roma = 2026-01-14 23:00 UTC
    expect(romeLocalToUtc('2026-01-15', false)?.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('prende la fine giornata italiana', () => {
    expect(romeLocalToUtc('2026-07-15', true)?.toISOString()).toBe('2026-07-15T21:59:59.999Z');
  });

  it('formatta in ora italiana', () => {
    expect(formatRome(new Date('2026-10-08T04:30:00.000Z'))).toBe('08/10/2026 06:30');
  });

  it('formatta il tempo in stringa G8 per i filtri updateGe/updateLe', () => {
    // 2026-10-08 04:30 UTC = 12:30 a Pechino (UTC+8), senza ora legale
    expect(formatBeijing(new Date('2026-10-08T04:30:00.000Z'))).toBe('2026-10-08 12:30:00');
    expect(formatBeijing(null)).toBe('');
  });
});

describe('ERP Dinghuobao', () => {
  it('usa lo stato di ritorno stockup (senza underscore), non stock_up', () => {
    expect(SHIPPABLE_STATUSES).toEqual(['stockup']);
    // Non spedibile finche l'ordine non e approvato su Dinghuobao (ERP rifiuta con rStatus 204)
    expect(SHIPPABLE_STATUSES).not.toContain('pending');
  });

  it('copre gli stati reali di OrderStatus nella validazione', () => {
    expect([...ORDER_STATUSES]).toEqual([
      'pricing',
      'pending',
      'stockup',
      'shipped',
      'received',
      'finished',
      'forcedone',
      'cancelled',
    ]);
    expect(ORDER_STATUSES).not.toContain('receivedin');
  });
});

describe('format.util', () => {
  it('formatta EUR in stile italiano', () => {
    expect(formatEur(1234.56).replace(/\u00a0/g, ' ')).toBe('1.234,56 €');
  });

  it('formatta le quantita con 4 decimali e virgola', () => {
    expect(formatQty(12).replace(/\u00a0/g, ' ')).toBe('12,0000');
  });

  it('normalizza numeri come stringa e Decimal', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber({ toString: () => '10.25' })).toBe(10.25);
    expect(toNumber('')).toBeNull();
  });

  it('calcola l importo per riga con 2 decimali HALF_UP', () => {
    expect(amountOf(12, 1.8555)).toBe(22.27);
    expect(amountOf('3', '2.5')).toBe(7.5);
    expect(amountOf(null, 10)).toBe(0);
    // HALF_UP per riga su 2 decimali: 0,125 -> 0,13
    expect(amountOf(0.125, 1)).toBe(0.13);
  });
});

describe('supplier-match.util', () => {
  const index = buildSupplierIndex([
    { supplierName: 'Aurora Food Italia S.r.l.', clientNum: 'DEMO-AUR-01', erpClientId: 'DEMO-AUR-01' },
    { supplierName: 'Verdi Distribuzione S.p.A.', clientNum: 'DEMO-VER-02', erpClientId: 'DEMO-VER-02' },
  ]);

  it('riconosce il fornitore per nome esatto', () => {
    expect(resolveSupplierValue('Aurora Food Italia S.r.l.', index)).toBe('Aurora Food Italia S.r.l.');
  });

  it('ignora spazi e maiuscole/minuscole', () => {
    expect(resolveSupplierValue('  verdi   distribuzione s.p.a. ', index)).toBe('Verdi Distribuzione S.p.A.');
  });

  it('accetta anche numero cliente e id ERP', () => {
    expect(resolveSupplierValue('DEMO-AUR-01', index)).toBe('Aurora Food Italia S.r.l.');
    expect(resolveSupplierValue('DEMO-VER-02', index)).toBe('Verdi Distribuzione S.p.A.');
  });

  it('prende il primo valore riconosciuto in un elenco', () => {
    expect(resolveSupplierValue('Codice non noto, Aurora Food Italia S.r.l.', index)).toBe('Aurora Food Italia S.r.l.');
  });

  it('non inventa un fornitore quando il valore non e in anagrafica', () => {
    expect(resolveSupplierValue('Codice non presente', index)).toBeNull();
    expect(resolveSupplierValue('', index)).toBeNull();
    expect(resolveSupplierValue(null, index)).toBeNull();
  });
});

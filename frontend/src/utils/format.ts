const eur = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: true,
});

const qty = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
  useGrouping: true,
});

const date = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  dateStyle: 'short',
});

const dateTime = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  dateStyle: 'short',
  timeStyle: 'short',
});

const dateTimeSec = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatEur(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? eur.format(n) : '—';
}

export function formatQty(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? qty.format(n) : '—';
}

/** Prezzo unitario (EUR, 4 decimali, formato italiano) — senza simbolo di valuta. */
export function formatPrice(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? qty.format(n) : '—';
}

export function formatDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? '—' : date.format(d);
}

export function formatDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d);
}

/** Data e ora in ora italiana (Europe/Rome) con i secondi. */
export function formatDateTimeSec(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? '—' : dateTimeSec.format(d);
}

export function todayRome(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function orderStatusLabel(status?: string | null): string {
  const map: Record<string, string> = {
    pricing: 'In attesa di prezzo',
    pending: 'In attesa di approvazione',
    stockup: 'Da evadere',
    shipped: 'Da spedire',
    received: 'In attesa di ricezione',
    receiveding: 'In attesa di ricezione',
    finished: 'Completato',
    forcedone: 'Completato forzatamente',
    cancelled: 'Annullato',
  };
  return status ? map[status] ?? status : 'Sconosciuto';
}

export function payStatusLabel(status?: string | null): string {
  const map: Record<string, string> = {
    oblig: 'Da pagare',
    uncollect: 'Parzialmente pagato',
    paided: 'Pagato',
    cancelled: 'Annullato',
  };
  return status ? map[status] ?? status : '';
}

export function shipmentStatusLabel(status?: string | null): string {
  const map: Record<string, string> = {
    shipped: 'Da spedire',
    receivedin: 'In attesa di ricezione',
    received: 'Ricevuto',
    cancelled: 'Annullato',
    failed: 'Errore',
    pending: 'In corso',
  };
  return status ? map[status] ?? status : 'Sconosciuto';
}

export function syncStatusLabel(status?: string | null): string {
  return status === 'ok' ? 'Completato' : status === 'fail' ? 'Errore' : status ?? '—';
}

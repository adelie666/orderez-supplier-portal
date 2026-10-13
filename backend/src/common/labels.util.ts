/**
 * Etichette italiane condivise (usate dove il testo viene generato lato server,
 * per esempio negli export Excel). I valori arrivano da Dinghuobao.
 */

const ORDER_STATUS: Record<string, string> = {
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

const PAY_STATUS: Record<string, string> = {
  oblig: 'Da pagare',
  uncollect: 'Parzialmente pagato',
  paided: 'Pagato',
  cancelled: 'Annullato',
};

export function orderStatusLabelIt(status?: string | null): string {
  if (!status) return 'Sconosciuto';
  return ORDER_STATUS[status] ?? status;
}

export function payStatusLabelIt(status?: string | null): string {
  if (!status) return '';
  return PAY_STATUS[status] ?? status;
}

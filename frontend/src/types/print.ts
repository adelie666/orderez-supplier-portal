export interface OrderPrintItem {
  goodsNum?: string | null;
  goodsName?: string | null;
  optionsName?: string | null;
  qty?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  amount?: string | number | null;
}

/** Payload di GET /orders/:id/print — scheda ordine/spedizione. */
export interface OrderPrintData {
  order: Record<string, string | number | null | undefined>;
  items: OrderPrintItem[];
}

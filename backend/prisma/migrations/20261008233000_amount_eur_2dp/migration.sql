-- Financial rule: each shipment line is rounded HALF_UP to 2 decimals.
ALTER TABLE "shipment_items"
  ALTER COLUMN "amount_eur" TYPE DECIMAL(14, 2)
  USING ROUND("amount_eur", 2);

-- Nota del fornitore allegata alla spedizione: viene inoltrata a Dinghuobao
-- come consignmentRemark (visibile sull'ordine/发货单 nel gestionale).
ALTER TABLE "shipments" ADD COLUMN "remark" VARCHAR(500);

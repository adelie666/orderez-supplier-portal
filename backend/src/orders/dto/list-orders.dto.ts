import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 可发货状态：仅「待出库 stockup」。
 * 实测（2026-10-08）addAllShips 会直接拒绝非待出库的订单：
 *   rStatus 204 订单号（xxx）对应的订单不为待出库状态，不允许出库（发货）
 * 所以 pending（待审核）不能出现在这里，必须先到订货宝审核通过。
 * 注意：返回值为 stockup（无下划线）；仅 order_status_val 入参用下划线写法 stock_up。
 */
export const SHIPPABLE_STATUSES = ['stockup'] as const;

/** 订单状态全集（订货宝 OrderStatus 返回值） */
export const ORDER_STATUSES = [
  'pricing',
  'pending',
  'stockup',
  'shipped',
  'received',
  'finished',
  'forcedone',
  'cancelled',
] as const;

/** 支付状态全集（订货宝 pay_status 返回值） */
export const PAY_STATUSES = ['oblig', 'uncollect', 'paided', 'cancelled'] as const;

/** 列表筛选用：发货记录的状态分组 */
export const SHIPMENT_STATES = ['failed', 'awaiting', 'sent'] as const;

export class ListOrdersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;

  /** 订单号 / 客户名模糊搜索 */
  @IsOptional() @IsString() keyword?: string;

  @IsOptional() @IsIn(ORDER_STATUSES as unknown as string[]) status?: string;

  @IsOptional() @IsIn(PAY_STATUSES as unknown as string[]) payStatus?: string;

  /** Stato della spedizione locale: failed | awaiting | sent */
  @IsOptional() @IsIn(SHIPMENT_STATES as unknown as string[]) shipmentState?: string;

  /** 供应商（管理员才能传；供应商角色强制为自己的 id） */
  @IsOptional() @Type(() => Number) @IsInt() supplierId?: number;

  /** 意大利本地日期（yyyy-MM-dd），后端转 UTC 查询 */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

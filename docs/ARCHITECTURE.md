# 架构说明

面向要接手这套代码的人：模块怎么分、数据从哪来、哪些业务口径是硬约定。

## 一、整体形态

```
        ┌────────────────────────┐
        │  浏览器（仅意大利语）    │  Vue 3 + Ant Design Vue
        └───────────┬────────────┘
                    │ /api  （JWT）
        ┌───────────▼────────────┐
        │  中间服务               │  NestJS + Prisma
        │  · 账号与角色            │
        │  · 拉单 / 对账 / 发货回写  │
        │  · 报表聚合与 Excel 导出  │
        └───┬────────────────┬───┘
            │                │
   ┌────────▼──────┐  ┌──────▼─────────────┐
   │  PostgreSQL   │  │  订货类 ERP（HTTP） │
   │  业务数据 +    │  │  读：订单/商品/供应商│
   │  同步水位      │  │  写：登记发货        │
   └───────────────┘  └────────────────────┘
```

关键点：**ERP 不是本系统的一部分**。中间服务只做三件事 —— 把 ERP 的单拉下来、
把供应商的履约动作写回去、把两边的事实沉淀成可查可导的数据。所以 ERP 一旦不可达，
系统是"暂停同步"而不是"降级到假数据"。

## 二、后端模块

`backend/src/` 下每个目录是一个 NestJS 模块：

| 模块 | 职责 |
| --- | --- |
| `auth/` | 登录、JWT 签发与校验、`admin` / `supplier` 角色守卫、改密码 |
| `settings/` | 集成凭证（唯一入口），敏感值 AES-256-GCM 加密落库、接口只回掩码 |
| `integration/` | `ErpClient`（唯一 ERP 出入口，读 + 写同一套凭证）、`GatewayClient`（类型化只读适配层） |
| `sync/` | 拉单水位、定时任务、同步日志、全量重算供应商归属 |
| `orders/` | 订单列表 / 详情 / 相邻单 / 打印 / Excel 导出 |
| `shipments/` | 发货登记与回写、失败重试、发货前对账 |
| `reports/` | 按商品聚合的销量与金额、导出 |
| `suppliers/` `products/` | 供应商档案、商品档案与图片、供应关系映射 |
| `users/` | 账号管理（管理员专属） |
| `dashboard/` | 首页 KPI 与待办队列 |
| `queue/` | 有 `REDIS_URL` 时用 BullMQ，否则退回进程内指数退避 |
| `common/` | 金额/数量格式化、时区、状态文案、供应商匹配 |

## 三、数据模型

`backend/prisma/schema.prisma`，9 张表：

- `suppliers` — 供应商档案，`supplier_name` 是唯一键，也是与 ERP 数据的匹配键
- `users` — 账号，`role` 为 `admin` 或 `supplier`；供应商账号绑 `supplier_id`
- `products` — 商品档案，唯一键 `(erp_goods_id, erp_options_id)`
- `orders` / `order_items` — 订单头与明细，来源 ERP
- `shipments` / `shipment_items` — 发货单与发货明细
- `sync_logs` / `sync_watermark` — 同步日志与拉单水位
- `settings` — 键值配置，ERP 凭证存在这里（密文）

设计取舍：

- **主键用 `Int`**，不追求大数，避免 `BigInt` 在 JSON 序列化和比较上的麻烦。
- **金额列一律 `Decimal(14,2)`**，报表用 `Prisma.Decimal` 聚合，不做 JS 浮点累加。
- **发货明细是报表的唯一数据源**，入库时把当时的进货价快照下来 —— 之后商品改价不影响历史报表。
- **`shipments.order_id` 唯一**，配合事务里的行锁，从数据库层兜住"一单重复发货"。

## 四、同步机制

拉模式（pull），不依赖 ERP 推送：

1. `SyncScheduler` 每 60 秒 tick 一次，距上次成功超过 `SYNC_INTERVAL_MINUTES` 才真正拉。
2. 没有配置 ERP 凭证时，自动同步**暂停**并只记一条告警（一个进程只记一次），不写任何伪造数据。
3. 拉单用 `updateGe` / `updateLe` 时间窗 + `apiStatus=all`，成功后把水位推到本次窗口末端，
   存进 `sync_watermark`；下次从这里继续。
4. 每日 03:00（`Europe/Rome`）回扫近 7 天订单，纠正状态漂移。
5. 每日 02:30（`Europe/Rome`）同步商品与供应商档案（先商品后供应商 —— 只有商品档案变动
   才可能带来新供应商，所以供应商不单独轮询）。
6. 发货回写失败进队列重试；重试前先查 ERP 是否已有出库单做对账，避免重复登记。

ERP 的订单头/明细/商品都不返回供应商字段，所以**订单与供应商的归属关系**
是靠商品档案的供应关系反推的（`sync.resolveAllOrderSuppliers()`）；
一个订单里的商品跨多个供应商时归为空，需要在页面上人工处理。

## 五、业务口径（硬约定）

| 项 | 约定 |
| --- | --- |
| 金额舍入 | 每行 数量 × 进货价，`ROUND_HALF_UP` 到 **2 位**，再按行汇总 |
| 币种 | 仅 EUR，按意式格式展示（`1.234,56 €`） |
| 数量精度 | 4 位小数 |
| 时区 | 入库统一 UTC；页面与定时任务按 `Europe/Rome` |
| 界面语言 | 仅意大利语 `it-IT`，不做多语言切换 |
| 角色隔离 | 供应商只能看到自己的订单 / 发货 / 报表；`/accounts`、`/settings`、`/sync` 一律 403 |

## 六、前端

Vue 3 + TypeScript + Vite + Ant Design Vue + Pinia。

- `src/api/client.ts` 统一挂 JWT，并负责把后端错误翻成意大利语提示
- `src/router/index.ts` 的路由守卫负责登录态与 `admin` 路由的角色校验
- `src/styles/tokens.css` 是设计变量（颜色、圆角、间距），改主题从这里改
- `src/components/ColumnPicker.vue` 让用户自选列表显示哪些列，选择存在浏览器本地
- 打印走独立路由 `/print/order/:id`，用 `styles/print.css` 控制分页

前端静态资源由 Nginx 托管，`/api` 反代到后端同源访问，因此生产环境不依赖 CORS。

## 七、已知边界

- ERP 协议是对一个具体账号实测确认的（HTTP `POST` + 方法名 + `sKey` 令牌），
  换 ERP 供应商需要重写 `ErpClient`。
- 订单供应商归属在商品跨供应商时无法自动判定，需要人工映射。
- 前端主包未做按路由拆包，首屏 gzip 后约 500 KB；内网/区域网络下可接受。

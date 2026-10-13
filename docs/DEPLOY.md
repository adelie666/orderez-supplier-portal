# 部署

两种方式：**Docker（推荐，一条命令起全栈）** 和 **手工部署（自有 Node 与 PostgreSQL）**。

系统不依赖任何外部 SaaS，只要能连到企业自己的 ERP 就能跑。整套服务内存占用约 400 MB。

---

## 一、Docker 一键部署

前置：装了 Docker Engine 24+（含 Compose v2）。

```bash
cd deploy
cp .env.example .env
```

打开 `.env`，**填这三项**（都标了「必填」）：

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_PASSWORD` | 数据库密码，建议只用字母数字 |
| `JWT_SECRET` | 登录令牌签名密钥，`openssl rand -hex 32` |
| `CREDENTIALS_KEY` | ERP 凭证加密密钥，`openssl rand -hex 32` |

后两个必须是随机值：生产环境下 `JWT_SECRET` 缺失会直接拒绝启动，
`CREDENTIALS_KEY` 决定库里凭证能不能解开（写进去之后就别再改）。

然后：

```bash
docker compose up -d --build
```

起好后访问 `http://<服务器IP>:${HTTP_PORT}`（默认 8080）。

### 建第一个管理员

```bash
docker compose exec backend node_modules/.bin/ts-node prisma/seed.ts
```

用户名密码取自 `.env` 的 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`（默认 `admin` / `OrderEZ@2026`）。
**建完账号后请把 `SEED_ADMIN_PASSWORD` 从 `.env` 删掉，并在页面上改掉密码。**

### 灌一套演示数据（可选）

不需要 ERP 凭证就能看到完整界面效果：

```bash
docker compose exec backend node_modules/.bin/ts-node prisma/demo-seed.ts
```

这套数据是虚构的（虚构的意大利食品供应商、商品与订单），会**先清空业务表**再写入，
界面上方会常驻一条 `Ambiente dimostrativo` 提示条。真实使用前用
`docker compose exec backend node_modules/.bin/ts-node prisma/seed.ts` 重建，
或在「Integrazione」页点重置。

### 接上企业 ERP

用管理员登录 → 左侧 **Integrazione** → 填 `URL base`、`Numero seriale`、`Password` →
**Verifica connessione** 确认可达 → 保存。之后自动同步才会开始工作；
没配凭证时同步是**暂停**状态，不会写任何伪造数据。

---

## 二、手工部署

前置：Node.js 20+、PostgreSQL 16、pnpm（后端用）、npm（前端用）。

```bash
# 数据库
createdb orderez_supplier

# 后端
cd backend
cp .env.example .env        # 填 DATABASE_URL / JWT_SECRET / CREDENTIALS_KEY
pnpm install
pnpm prisma migrate deploy  # 建表
pnpm build
pnpm seed                   # 建管理员（可选加 SEED_DEMO_SUPPLIERS=true 建演示供应商账号）
node dist/main.js           # 监听 :3100

# 前端
cd ../frontend
npm ci
npm run build               # 产物在 dist/，用任意静态服务器托管
```

生产环境建议用 systemd 或 PM2 守护 `node dist/main.js`，前面用 Nginx 同时托管
`frontend/dist` 并反代 `/api`（配置可直接抄 `deploy/nginx.conf`，把
`upstream orderez_backend` 改成 `127.0.0.1:3100`）。

## 三、域名与 HTTPS

容器只监听 HTTP。要挂域名和证书，在前面再放一层反代（Nginx / Caddy / 云负载均衡）即可：

```nginx
server {
    listen 443 ssl http2;
    server_name fornitore.example.com;

    ssl_certificate     /etc/letsencrypt/live/fornitore.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fornitore.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;   # 指向 frontend 容器
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`/api` 由前端容器内部的 Nginx 转给后端，所以外层只需要反代一个端口。
如果你把前端放到别的域名，记得同步改 `.env` 里的 `CORS_ORIGINS`。

## 四、升级

```bash
git pull
cd deploy && docker compose up -d --build
```

后端容器每次启动都会先跑 `prisma migrate deploy` 再起服务，数据库结构自动跟上；
迁移失败容器会退出并在日志里报错（`docker compose logs backend`），不会带着半旧的结构提供服务。

## 五、备份与恢复

数据都在 PostgreSQL 里，备份就是 `pg_dump`：

```bash
# 备份
docker compose exec -T db pg_dump -U orderez orderez_supplier | gzip > backup-$(date +%F).sql.gz

# 恢复
gunzip -c backup-2026-10-14.sql.gz | docker compose exec -T db psql -U orderez -d orderez_supplier
```

要一起备份的话，`.env` 里的 `CREDENTIALS_KEY` 必须留好 —— 丢了它，备份里的
ERP 凭证密文就解不开了（重新在页面上填一次即可，不影响订单数据）。

建议放一条每日 cron 跑上面的备份，并把文件同步到另一台机器。

## 六、排障

| 现象 | 排查方向 |
| --- | --- |
| 容器起不来，日志提示 `JWT_SECRET non configurato` | `.env` 里 `JWT_SECRET` 为空。生产环境缺这个值会拒绝启动，属预期行为 |
| 页面能打开但一直转圈 / 接口 502 | `docker compose logs backend`；多半是后端还在跑迁移或数据库没起来 |
| 装完依赖提示 `Ignored build scripts` | 后端 `pnpm-workspace.yaml` 的 `allowBuilds` 没生效，重跑 `pnpm install` |
| 同步一直不跑 | 「Integrazione」页凭证是否齐全；`SYNC_ENABLED` 是否为 `true`；看「同步日志」里的报错 |
| 供应商账号看不到订单 | 账号的 `supplier_id` 是否已绑定到供应商档案（管理端「Account」页） |
| 报表金额和 ERP 对不上 | 报表按「发货明细快照价」算，不是订单行价；口径见 `docs/ARCHITECTURE.md` §五 |

健康检查：`curl http://127.0.0.1:3100/api/health`（容器内），
返回 `{"status":"ok","database":"ok",...}` 表示服务和数据库都正常。

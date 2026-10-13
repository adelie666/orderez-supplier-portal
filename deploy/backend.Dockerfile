# OrderEZ Supplier Portal · 后端镜像（NestJS + Prisma + PostgreSQL）
#
# 构建上下文是仓库根目录，不是 backend/：
#   docker build -f deploy/backend.Dockerfile -t orderez-supplier-backend .
# 用 docker compose 时由 deploy/docker-compose.yml 指定。
#
# 基镜像选 Debian slim 而非 alpine：Prisma 的引擎在 alpine 上需要额外装
# libssl 兼容层，slim 开箱即用，且构建与运行同为 debian-openssl-3.0.x。
FROM node:20-slim AS build
WORKDIR /app/backend

RUN corepack enable

# 先只拷依赖清单，让依赖层能被缓存
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY backend/ ./
RUN pnpm prisma generate && pnpm build


FROM node:20-slim AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production
# 页面按 Europe/Rome 显示，容器时区跟着走，日志时间才不会错 8 小时
ENV TZ=Europe/Rome

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 运行时保留完整 node_modules：`prisma migrate deploy` 和一次性 seed 都要用到
# 其中的 CLI 与 ts-node。业务量级下这点体积换来「一个镜像自洽」是划算的。
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY backend/package.json ./

# 直接用二进制而不是 `pnpm run`：pnpm 启动脚本前会做依赖状态检查，
# 在只拷贝了 node_modules 的镜像里这一步没有必要。
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

# OrderEZ Supplier Portal · 前端镜像（Vue 3 + Vite → Nginx）
#
# 构建上下文是仓库根目录，不是 frontend/：
#   docker build -f deploy/frontend.Dockerfile -t orderez-supplier-frontend .
#
# 前端在浏览器里请求同源的 /api，由 Nginx 反代到 backend 容器（见 nginx.conf）。
# 如果要把接口放到另一个域名，构建时传：
#   --build-arg VITE_API_BASE_URL=https://api.example.com/api
FROM node:20-slim AS build
WORKDIR /app/frontend

ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM nginx:1.27-alpine AS runtime

# 时区跟随欧洲：日志与 Nginx 的 autoindex/缓存头时间保持一致
RUN apk add --no-cache tzdata && cp /usr/share/zoneinfo/Europe/Rome /etc/localtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

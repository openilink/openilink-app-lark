# ---- 构建阶段 ----
FROM node:20-alpine AS builder

# 安装编译 better-sqlite3 原生模块所需的依赖
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 先复制依赖清单，利用 Docker 缓存层
COPY package*.json ./
RUN npm ci

# 复制源码并编译 TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime

# better-sqlite3 运行时需要 libstdc++
RUN apk add --no-cache libstdc++

# 创建非 root 用户
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 创建数据目录并设置权限
RUN mkdir -p /data && chown -R app:app /data /app

USER app

EXPOSE 8081

ENV NODE_ENV=production
ENV DB_PATH=/data/lark.db

CMD ["node", "dist/index.js"]

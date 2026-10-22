FROM oven/bun:1.4.2 AS bun_binary
FROM node:24.14.0-bookworm-slim AS build
COPY --from=bun_binary /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN bun run build

FROM node:24.14.0-bookworm-slim AS production_dependencies
COPY --from=bun_binary /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:24.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=production_dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

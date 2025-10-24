# Dockerfile para ZapFlow Integration
FROM node:18-alpine AS base

# Instalar dependências necessárias para Prisma
RUN apk add --no-cache libc6-compat openssl

# Configurar encoding UTF-8
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV NODE_ENV=production

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências
RUN npm ci --only=production && npm cache clean --force

# Gerar cliente Prisma
RUN npx prisma generate

# Build da aplicação
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma

RUN npm ci
RUN npx prisma generate

# Imagem de produção
FROM node:18-alpine AS runner

# Instalar dependências necessárias para Prisma
RUN apk add --no-cache libc6-compat openssl

# Configurar encoding UTF-8
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV NODE_ENV=production

WORKDIR /app

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 zapflow

# Copiar arquivos necessários
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Criar diretório de logs
RUN mkdir -p logs && chown -R zapflow:nodejs logs

# Mudar para usuário não-root
USER zapflow

# Expor porta
EXPOSE 3333

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3333/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Comando de inicialização
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "src/index.ts"]

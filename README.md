# ZapFlow Integration - Microserviço WhatsApp/Z-API

> **🚀 Novo aqui?** Comece por **[COMECE_AQUI.md](./COMECE_AQUI.md)** - Guia rápido de 3 minutos!

## Descrição

Microserviço Node.js + TypeScript responsável pela integração entre o WhatsApp (via Z-API) e o sistema principal de fotografia, utilizando o mesmo banco PostgreSQL e controlando estados de conversas e fluxos de mensagens.

## ✅ Status do Projeto

**PROJETO FINALIZADO E PRONTO PARA DEPLOY**

- ✅ Receber mensagens via webhook da Z-API
- ✅ Enviar respostas via endpoint REST /send-text da Z-API
- ✅ Armazenar estados de conversa e histórico no PostgreSQL
- ✅ Usar Redis para sessões temporárias e cache (opcional)
- ✅ Preparar integração futura com o CRM principal
- ✅ Webhook configurado: `POST /api/webhook/whatsapp`
- ✅ Sistema de conversação implementado
- ✅ Rate limiting e segurança
- ✅ Docker e produção configurados
- ✅ **Guias de deploy para VPS criados**

## 🚀 Deploy em Produção

### Documentação Completa:

1. **[PRE_REQUISITOS.md](./PRE_REQUISITOS.md)** - Checklist antes do deploy
2. **[DEPLOY_RESUMO.md](./DEPLOY_RESUMO.md)** - Deploy rápido em 5 passos ⚡
3. **[DEPLOY_VPS.md](./DEPLOY_VPS.md)** - Guia completo e detalhado 📚

### Deploy Rápido:

```powershell
# 1. Execute o script de deploy (Windows/PowerShell)
.\scripts\deploy-vps.ps1

# 2. Configure .env na VPS
ssh root@62.72.9.193
cd /root/zapflow-integration
cp env.prod.example .env
nano .env  # Preencher credenciais

# 3. Inicie os containers
docker compose build
docker compose up -d

# 4. Verifique
curl http://localhost:3333/health
```

Consulte **[DEPLOY_RESUMO.md](./DEPLOY_RESUMO.md)** para mais detalhes.

## Stack Tecnológico

- **Backend**: Node.js + Express + TypeScript
- **ORM**: Prisma ORM
- **Database**: PostgreSQL (mesmo usado pelo CRM principal)
- **Cache**: Redis (para sessões temporárias)
- **API Integration**: Z-API (webhook + REST send-text)
- **Auth**: JWT (opcional para rotas internas)
- **Containerization**: Docker + Docker Compose

## 📁 Estrutura Simplificada

```
zapflow-integration/
├── src/                    # Código fonte TypeScript
│   ├── controllers/        # Controllers (webhook, health)
│   ├── services/          # Serviços (conversação, Z-API, Redis)
│   ├── routes/            # Definição das rotas
│   ├── types/             # Tipos TypeScript
│   ├── config/            # Configurações
│   └── utils/             # Utilitários (logger)
├── prisma/                # Schema do banco de dados
├── logs/                  # Diretório de logs
├── docker-compose.yml     # Docker Compose simplificado
├── Dockerfile            # Imagem Docker
├── package.json          # Dependências
├── env.example           # Exemplo de variáveis
└── README.md             # Este arquivo
```

## ⚙️ Configuração Rápida

1. **Copiar variáveis de ambiente:**
```bash
cp env.example .env
```

2. **Editar `.env` com suas credenciais Z-API**

3. **Executar com Docker:**
```bash
docker-compose up -d
```

4. **Configurar webhook na Z-API:**
- URL: `https://seu-dominio.com/api/webhook/whatsapp`

## Workflow

1. Cliente envia mensagem no WhatsApp
2. Z-API envia webhook para /webhook/whatsapp
3. Servidor registra a mensagem e estado no banco/Redis
4. conversation.service decide resposta com base no estado
5. zapi.service envia mensagem via /send-text
6. WhatsApp entrega mensagem ao cliente

## Instalação e Execução

### Integração com CRM Existente

```bash
# Configuração rápida
chmod +x setup.sh
./setup.sh

# OU configuração manual:

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp env.example .env
# Editar .env com credenciais do banco CRM existente

# Gerar cliente Prisma
npx prisma generate

# Executar migrações (adiciona tabelas ao banco existente)
npx prisma db push

# Executar em modo desenvolvimento
npm run dev
```

### ⚠️ Configuração Importante

**Este projeto usa o MESMO banco PostgreSQL do seu CRM existente.** 

Configure no arquivo `.env`:
- `DATABASE_URL`: URL do banco do CRM
- `ZAPI_*`: Tokens da Z-API
- `REDIS_URL`: Redis do CRM (opcional)

Consulte `INTEGRATION_GUIDE.md` para detalhes completos.

### Teste com Ngrok

```bash
# Instalar ngrok
npm install -g ngrok

# Expor porta local
ngrok http 3333

# Registrar URL pública gerada no painel da Z-API
# Exemplo: https://xxxxx.ngrok.io/webhook/whatsapp
```

### Docker

```bash
# Construir imagem
docker build -t zapflow-integration .

# Executar com Docker Compose
docker-compose up -d
```

## 🚀 Próximos Passos para Deploy

### 1. Configurar Variáveis de Ambiente
```bash
cp env.example .env
# Editar .env com suas credenciais Z-API e banco de dados
```

### 2. Configurar Banco de Dados
```bash
npx prisma generate
npx prisma db push
```

### 3. Configurar Webhook na Z-API
- URL: `https://seu-dominio.com/api/webhook/whatsapp`
- Método: POST
- Headers: Content-Type: application/json

### 4. Deploy
```bash
# Docker Compose
docker-compose up -d

# Ou produção
docker-compose --profile production up -d
```

## Comportamento Esperado

### Primeira Mensagem
- Registrar nova sessão
- Responder com mensagem de boas-vindas e menu inicial

### Exemplo de Menu
```
1️⃣ Ver pacotes
2️⃣ Consultar pagamentos
3️⃣ Falar com suporte
```

### Persistência de Estado
- Salvar `currentStep` no banco para rastrear etapa do usuário

## Segurança

- ✅ Variáveis sensíveis no arquivo .env
- ✅ Verificação de payloads Z-API (status, type, phone)
- ✅ Logs estruturados de mensagens recebidas/enviadas
- ✅ Rate limiting para evitar flood de mensagens consecutivas

## Justificativa da Arquitetura

Esta arquitetura garante:
- **Modularidade**: Serviço independente e desacoplado
- **Escalabilidade**: Preparado para crescimento e novas integrações
- **Reaproveitamento**: Usa mesma infraestrutura do CRM principal
- **Independência**: Deploy e evolução independentes
- **Futuro**: Possibilita automação de atendimento e cobrança integrada

## 📋 Arquivos Principais

- `src/controllers/webhook.controller.ts` - Controller do webhook
- `src/services/conversation.service.ts` - Lógica de conversação
- `src/services/zapi.service.ts` - Integração com Z-API
- `src/routes/index.ts` - Definição das rotas
- `prisma/schema.prisma` - Schema do banco de dados
- `docker-compose.yml` - Configuração Docker

## 📞 Webhook Configurado

**Endpoint**: `POST /api/webhook/whatsapp`
- Recebe mensagens da Z-API
- Processa conversação automaticamente
- Rate limiting: 100 req/min
- Validação de payload

## Licença

MIT

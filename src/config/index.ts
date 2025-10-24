import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3333', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL,
  zapi: {
    instance: process.env.ZAPI_INSTANCE || '',
    token: process.env.ZAPI_TOKEN || '',
    clientToken: process.env.ZAPI_CLIENT_TOKEN || '',
    baseUrl: process.env.ZAPI_BASE_URL || 'https://api.z-api.io',
  },
  jwt: process.env.JWT_SECRET ? {
    secret: process.env.JWT_SECRET,
  } : undefined,
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

// Validação das variáveis obrigatórias
const requiredEnvVars = [
  'DATABASE_URL',
  'ZAPI_INSTANCE',
  'ZAPI_TOKEN',
  'ZAPI_CLIENT_TOKEN',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Variável de ambiente obrigatória não encontrada: ${envVar}`);
  }
}

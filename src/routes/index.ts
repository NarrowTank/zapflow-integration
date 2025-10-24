import { Router } from 'express';
import { WebhookController } from '@/controllers/webhook.controller';
import { HealthController } from '@/controllers/health.controller';
import { MettaController } from '@/controllers/metta.controller';
import rateLimit from 'express-rate-limit';
import logger from '@/utils/logger';

const router = Router();

// Instanciar controllers
const webhookController = new WebhookController();
const healthController = new HealthController();
const mettaController = new MettaController();

// Rate limiting para webhook (evitar spam)
const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // máximo 100 requests por minuto
  message: {
    error: 'Muitas requisições. Tente novamente em alguns minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting para endpoints de teste
const testRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // máximo 10 requests por 5 minutos
  message: {
    error: 'Muitas requisições de teste. Tente novamente em alguns minutos.',
  },
});

// Middleware de logging
router.use((req, res, next) => {
  logger.info('Requisição recebida', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  next();
});

// Rotas de webhook
router.post('/webhook/whatsapp', webhookRateLimit, (req, res) => {
  webhookController.handleWebhook(req, res);
});

// Webhook de vencimentos do Metta
router.post('/webhooks/metta-vencimentos', webhookRateLimit, (req, res) => {
  webhookController.handleMettaVencimentos(req, res);
});

// Rotas de health check
router.get('/health', (req, res) => {
  healthController.healthCheck(req, res);
});

router.get('/health/ready', (req, res) => {
  healthController.readinessCheck(req, res);
});

router.get('/health/live', (req, res) => {
  healthController.livenessCheck(req, res);
});

// Rotas de teste e administração
router.get('/zapi/status', (req, res) => {
  webhookController.getInstanceStatus(req, res);
});

router.post('/test/send-message', testRateLimit, (req, res) => {
  webhookController.sendTestMessage(req, res);
});

router.get('/redis/info', (req, res) => {
  webhookController.getRedisInfo(req, res);
});

router.delete('/redis/cache/:phone', (req, res) => {
  webhookController.clearRedisCache(req, res);
});

// Rotas de validação da integração Metta (health e webhook test)
router.get('/metta/health', (req, res) => {
  mettaController.health(req, res);
});

router.post('/metta/test', (req, res) => {
  mettaController.testWebhook(req, res);
});

// Rotas protegidas do Metta para validação
router.get('/metta/users', (req, res) => {
  mettaController.users(req, res);
});

router.get('/metta/alunos', (req, res) => {
  mettaController.alunos(req, res);
});

router.post('/metta/refresh-token', (req, res) => {
  mettaController.refreshToken(req, res);
});

// Rotas de proxy para alunos
router.get('/metta/turmas', (req, res) => {
  mettaController.turmas(req, res);
});

router.get('/metta/alunos/:id', (req, res) => {
  mettaController.alunoById(req, res);
});

router.post('/metta/alunos', (req, res) => {
  mettaController.createAluno(req, res);
});

// Rotas de proxy para cobranças
router.post('/metta/cobrancas/boleto', (req, res) => {
  mettaController.gerarBoleto(req, res);
});

router.post('/metta/cobrancas/carne', (req, res) => {
  mettaController.gerarCarne(req, res);
});

router.get('/metta/cobrancas/:id', (req, res) => {
  mettaController.getCobranca(req, res);
});

router.post('/metta/cobrancas/automatica', (req, res) => {
  mettaController.gerarAutomatica(req, res);
});

// Middleware de tratamento de erros
router.use((error: any, req: any, res: any, next: any) => {
  logger.error('Erro não tratado', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Algo deu errado',
  });
});

// Middleware para rotas não encontradas
router.use('*', (req, res) => {
  logger.warn('Rota não encontrada', {
    method: req.method,
    url: req.url,
    ip: req.ip,
  });

  res.status(404).json({
    error: 'Rota não encontrada',
    message: `A rota ${req.method} ${req.url} não existe`,
  });
});

export default router;

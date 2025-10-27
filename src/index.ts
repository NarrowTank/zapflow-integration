// Configurar encoding UTF-8 globalmente
process.env.LANG = 'C.UTF-8';
process.env.LC_ALL = 'C.UTF-8';
process.env.LC_CTYPE = 'C.UTF-8';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import logger from './utils/logger';
import routes from './routes';

class App {
  private app: express.Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = config.port;
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Trust proxy (necessário quando atrás de Nginx)
    this.app.set('trust proxy', true);

    // Segurança
    this.app.use(helmet({
      contentSecurityPolicy: false, // Desabilitado para APIs
    }));

    // CORS
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging de requisições
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('Requisição processada', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
        });
      });
      
      next();
    });
  }

  private initializeRoutes(): void {
    // Rota raiz
    this.app.get('/', (req, res) => {
      res.json({
        name: 'ZapFlow Integration',
        version: '1.0.0',
        description: 'Microserviço de integração WhatsApp/Z-API',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          webhook: '/webhook/whatsapp',
          health: '/health',
          status: '/zapi/status',
        },
      });
    });

    // Rotas da aplicação
    this.app.use('/api', routes);
  }

  private initializeErrorHandling(): void {
    // Middleware global de tratamento de erros
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Erro global não tratado', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
      });

      res.status(500).json({
        error: 'Erro interno do servidor',
        message: config.nodeEnv === 'development' ? error.message : 'Algo deu errado',
        timestamp: new Date().toISOString(),
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Verificar conexão com banco de dados
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      await prisma.$connect();
      logger.info('Conectado ao banco de dados PostgreSQL');
      await prisma.$disconnect();

      // Iniciar servidor
      this.app.listen(this.port, () => {
        logger.info(`Servidor iniciado na porta ${this.port}`, {
          port: this.port,
          environment: config.nodeEnv,
          timestamp: new Date().toISOString(),
        });
      });

      // Graceful shutdown
      process.on('SIGTERM', this.gracefulShutdown);
      process.on('SIGINT', this.gracefulShutdown);
      
    } catch (error: any) {
      logger.error('Erro ao iniciar aplicação', error);
      process.exit(1);
    }
  }

  private gracefulShutdown = (signal: string): void => {
    logger.info(`Recebido sinal ${signal}. Iniciando shutdown graceful...`);
    
    // Aqui você pode adicionar lógica para fechar conexões, salvar dados, etc.
    
    process.exit(0);
  };

  public getApp(): express.Application {
    return this.app;
  }
}

// Inicializar aplicação
const app = new App();

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  logger.error('Exceção não capturada', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Promise rejeitada não tratada', { reason, promise });
  process.exit(1);
});

// Iniciar servidor
app.start().catch((error) => {
  logger.error('Erro fatal ao iniciar aplicação', error);
  process.exit(1);
});

export default app;

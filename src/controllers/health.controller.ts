import { Request, Response } from 'express';
import logger from '@/utils/logger';

export class HealthController {
  /**
   * Endpoint de health check
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      };

      logger.info('Health check executado', health);
      res.status(200).json(health);
    } catch (error: any) {
      logger.error('Erro no health check', error);
      res.status(500).json({ 
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Endpoint de readiness check
   */
  async readinessCheck(req: Request, res: Response): Promise<void> {
    try {
      // Verificar conexão com banco de dados
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();

      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: 'ok',
        },
      });
    } catch (error: any) {
      logger.error('Erro no readiness check', error);
      res.status(503).json({
        status: 'not ready',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Endpoint de liveness check
   */
  async livenessCheck(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }
}

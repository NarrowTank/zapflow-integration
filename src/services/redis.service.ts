import { createClient, RedisClientType } from 'redis';
import { config } from '@/config';
import logger from '@/utils/logger';
import { SessionContext } from '@/types';

export class RedisService {
  private client: RedisClientType | null = null;
  private isConnected = false;

  constructor() {
    if (config.redisUrl) {
      this.initializeClient();
    } else {
      logger.warn('Redis URL não configurada. Serviço Redis desabilitado.');
    }
  }

  private async initializeClient(): Promise<void> {
    try {
      this.client = createClient({
        url: config.redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Muitas tentativas de reconexão Redis. Parando.');
              return new Error('Muitas tentativas de reconexão');
            }
            const delay = Math.min(retries * 100, 3000);
            logger.info(`Tentando reconectar ao Redis em ${delay}ms (tentativa ${retries})`);
            return delay;
          },
          connectTimeout: 10000,
        },
      });

      this.client.on('error', (error) => {
        logger.error('Erro do Redis', error);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Conectado ao Redis');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('Redis pronto para uso');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        logger.info('Conexão Redis encerrada');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('Reconectando ao Redis...');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error: any) {
      logger.error('Erro ao inicializar cliente Redis', error);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Verifica se o Redis está disponível
   */
  isAvailable(): boolean {
    return this.client !== null && this.isConnected;
  }

  /**
   * Armazena uma sessão no Redis
   */
  async setSession(phone: string, session: SessionContext, ttlSeconds = 3600): Promise<boolean> {
    if (!this.isAvailable()) {
      // Tenta reconectar uma vez
      const reconnected = await this.reconnect();
      if (!reconnected) {
        return false;
      }
    }

    try {
      const key = `session:${phone}`;
      const value = JSON.stringify(session);
      
      await this.client!.setEx(key, ttlSeconds, value);
      
      logger.debug('Sessão armazenada no Redis', { phone, ttlSeconds });
      return true;
    } catch (error: any) {
      logger.error('Erro ao armazenar sessão no Redis', {
        phone,
        error: error.message,
      });
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Recupera uma sessão do Redis
   */
  async getSession(phone: string): Promise<SessionContext | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const key = `session:${phone}`;
      const value = await this.client!.get(key);
      
      if (!value) {
        return null;
      }

      const session = JSON.parse(value) as SessionContext;
      
      logger.debug('Sessão recuperada do Redis', { phone });
      return session;
    } catch (error: any) {
      logger.error('Erro ao recuperar sessão do Redis', {
        phone,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Remove uma sessão do Redis
   */
  async deleteSession(phone: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const key = `session:${phone}`;
      await this.client!.del(key);
      
      logger.debug('Sessão removida do Redis', { phone });
      return true;
    } catch (error: any) {
      logger.error('Erro ao remover sessão do Redis', {
        phone,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Define um valor no cache com TTL
   */
  async set(key: string, value: any, ttlSeconds = 3600): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const serializedValue = JSON.stringify(value);
      await this.client!.setEx(key, ttlSeconds, serializedValue);
      
      logger.debug('Valor armazenado no Redis', { key, ttlSeconds });
      return true;
    } catch (error: any) {
      logger.error('Erro ao armazenar valor no Redis', {
        key,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Define um valor apenas se a chave não existir (idempotência)
   */
  async setIfNotExists(key: string, value: any, ttlSeconds = 300): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      // Redis v4: SET key value NX EX ttl
      // @ts-ignore - tipos parciais
      const result = await (this.client as any).set(key, serializedValue, { NX: true, EX: ttlSeconds });
      return result === 'OK';
    } catch (error: any) {
      logger.error('Erro no setIfNotExists (NX) do Redis', { key, error: error.message });
      return false;
    }
  }

  /**
   * Recupera um valor do cache
   */
  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const value = await this.client!.get(key);
      
      if (!value) {
        return null;
      }

      return JSON.parse(value) as T;
    } catch (error: any) {
      logger.error('Erro ao recuperar valor do Redis', {
        key,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Remove um valor do cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client!.del(key);
      
      logger.debug('Valor removido do Redis', { key });
      return true;
    } catch (error: any) {
      logger.error('Erro ao remover valor do Redis', {
        key,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Verifica se uma chave existe
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const result = await this.client!.exists(key);
      return result === 1;
    } catch (error: any) {
      logger.error('Erro ao verificar existência da chave no Redis', {
        key,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Define TTL para uma chave existente
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const result = await this.client!.expire(key, ttlSeconds);
      return result;
    } catch (error: any) {
      logger.error('Erro ao definir TTL no Redis', {
        key,
        ttlSeconds,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Obtém informações sobre a conexão Redis
   */
  async getInfo(): Promise<{ connected: boolean; url?: string }> {
    return {
      connected: this.isConnected,
      url: config.redisUrl,
    };
  }

  /**
   * Reconecta ao Redis se necessário
   */
  async reconnect(): Promise<boolean> {
    if (!this.client) {
      await this.initializeClient();
      return this.isConnected;
    }

    try {
      if (!this.isConnected) {
        await this.client.connect();
        return this.isConnected;
      }
      return true;
    } catch (error: any) {
      logger.error('Erro ao reconectar Redis', error);
      return false;
    }
  }

  /**
   * Fecha a conexão com o Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
        logger.info('Conexão Redis fechada');
      } catch (error: any) {
        logger.error('Erro ao fechar conexão Redis', error);
      }
    }
  }
}

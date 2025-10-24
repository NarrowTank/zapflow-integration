import axios, { AxiosError } from 'axios';
import logger from '@/utils/logger';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: any): boolean {
  const status = error?.response?.status as number | undefined;
  const code = error?.code as string | undefined;
  if (status && status >= 500) return true;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED';
}

export class TokenProvider {
  private token: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly baseUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly timeoutMs: number;
  private readonly intervalMs?: number; // intervalo bruto vindo da env

  constructor() {
    this.baseUrl = process.env.METTA_API_BASE_URL || process.env.PAYMENT_SYSTEM_BASE_URL || 'http://metta_backend:3001';
    this.username = process.env.METTA_USERNAME || undefined;
    this.password = process.env.METTA_PASSWORD || undefined;
    this.timeoutMs = parseInt(process.env.METTA_API_TIMEOUT || process.env.PAYMENT_SYSTEM_TIMEOUT || '10000', 10);
    this.intervalMs = process.env.METTA_TOKEN_REFRESH_INTERVAL ? parseInt(process.env.METTA_TOKEN_REFRESH_INTERVAL, 10) : undefined;

    const envToken = process.env.METTA_API_TOKEN || process.env.PAYMENT_SYSTEM_AUTH_TOKEN;
    if (envToken) {
      this.token = envToken;
    }

    // Se tivermos credenciais e intervalo, agenda refresh automático
    if (this.username && this.password && this.intervalMs && this.intervalMs > 5 * 60 * 1000) {
      // Faz um refresh inicial em background, mas não bloqueia o boot
      this.scheduleNextRefresh(this.intervalMs - 5 * 60 * 1000);
    }
  }

  public async getToken(): Promise<string | undefined> {
    if (this.token) return this.token;
    if (this.username && this.password) {
      await this.refresh();
      return this.token;
    }
    return undefined;
  }

  public async refresh(): Promise<void> {
    if (!this.username || !this.password) {
      logger.warn('Token refresh solicitado sem credenciais configuradas');
      return;
    }

    const startedAt = Date.now();
    const maxRetries = 2;
    let attempt = 0;

    while (true) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/api/auth/login`,
          { username: this.username, password: this.password },
          { timeout: this.timeoutMs, validateStatus: (s) => !!s && s >= 200 && s < 400 }
        );

        const accessToken = (response.data as any)?.accessToken as string | undefined;
        if (!accessToken) {
          throw new Error('Resposta de login sem accessToken');
        }

        this.token = accessToken;

        const elapsedMs = Date.now() - startedAt;
        logger.info('Token refresh concluído', { elapsedMs });

        // Reagendar próximo refresh se houver intervalo
        if (this.intervalMs && this.intervalMs > 5 * 60 * 1000) {
          const nextInMs = this.intervalMs - 5 * 60 * 1000;
          this.scheduleNextRefresh(nextInMs);
          logger.info('Próximo token refresh agendado', { nextInMs });
        }
        return;
      } catch (error: any) {
        const transient = isTransientError(error);
        const status = error?.response?.status;
        const message = error instanceof AxiosError ? error.message : String(error);
        logger.error('Falha no token refresh', { status, transient, message });
        if (!transient || attempt >= maxRetries) {
          throw error;
        }
        const backoff = 300 * Math.pow(2, attempt);
        await delay(backoff);
        attempt += 1;
      }
    }
  }

  private scheduleNextRefresh(delayMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch((err) => {
        const status = err?.response?.status;
        logger.error('Erro ao executar token refresh agendado', { status, message: err?.message });
      });
    }, delayMs);
  }
}

export const tokenProvider = new TokenProvider();



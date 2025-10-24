import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import logger from '@/utils/logger';
import { tokenProvider } from '@/services/token-provider.service';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  path: string;
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class MettaApiClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly bearerToken?: string;
  private readonly apiKey?: string;

  constructor() {
    this.baseUrl = process.env.METTA_API_BASE_URL || process.env.PAYMENT_SYSTEM_BASE_URL || 'http://metta_backend:3001';
    this.defaultTimeoutMs = parseInt(process.env.METTA_API_TIMEOUT || process.env.PAYMENT_SYSTEM_TIMEOUT || '10000', 10);
    this.bearerToken = process.env.METTA_API_TOKEN || process.env.PAYMENT_SYSTEM_AUTH_TOKEN || undefined;
    this.apiKey = process.env.METTA_PUBLIC_API_KEY || undefined;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: this.defaultTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
      },
    });

    this.axiosInstance.interceptors.request.use((config) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      (config as any).requestId = requestId;
      const headers: any = config.headers || {};
      // garantir Authorization/X-Api-Key em cada request se disponíveis
      if (this.bearerToken && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${this.bearerToken}`;
      }
      if (this.apiKey && !headers['X-Api-Key'] && !headers['x-api-key']) {
        headers['X-Api-Key'] = this.apiKey;
      }
      config.headers = headers;
      const hasAuth = Boolean(headers.Authorization || headers.authorization);
      const hasApiKey = Boolean(headers['X-Api-Key'] || headers['x-api-key']);
      logger.info('Metta request', {
        requestId,
        method: config.method,
        url: config.url,
        baseURL: config.baseURL,
        timeout: config.timeout,
        hasAuth,
        hasApiKey,
      });
      return config;
    });

    this.axiosInstance.interceptors.response.use(
      (response) => {
        const requestId = (response.config as any).requestId;
        logger.info('Metta response', {
          requestId,
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error: AxiosError) => {
        const requestId = (error.config as any)?.requestId;
        const status = error.response?.status;
        logger.error('Metta error', {
          requestId,
          status,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const { path, method = 'GET', body, headers, timeoutMs } = options;

    // token dinâmico (se disponível) antes de cada request
    const dynamicToken = await tokenProvider.getToken();
    const mergedHeaders = {
      ...(headers || {}),
      ...(dynamicToken ? { Authorization: `Bearer ${dynamicToken}` } : {}),
    } as Record<string, string>;

    const config: AxiosRequestConfig = {
      url: path,
      method,
      data: body,
      headers: mergedHeaders,
      timeout: timeoutMs ?? this.defaultTimeoutMs,
      validateStatus: (status) => !!status && status >= 200 && status < 400,
    };

    return this.withRetries<T>(() => this.axiosInstance.request<T>(config).then(r => r.data));
  }

  async getHealth(): Promise<any> {
    return this.request<any>({ path: '/webhook/health', method: 'GET' });
  }

  async postWebhookTest(body: unknown): Promise<any> {
    return this.request<any>({ path: '/webhook/test', method: 'POST', body });
  }

  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = parseInt(process.env.METTA_API_MAX_RETRIES || '2', 10);
    const baseDelayMs = 300;
    let attempt = 0;

    // Helper para decidir retry: timeout, 5xx e conexão
    const shouldRetry = (error: any): boolean => {
      const status = error?.response?.status as number | undefined;
      const code = error?.code as string | undefined;
      if (status && status >= 500) return true; // 5xx
      if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') return true; // timeout/conn
      return false; // 4xx não faz retry
    };

    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        if (attempt >= maxRetries || !shouldRetry(error)) {
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt); // exponencial
        await new Promise((res) => setTimeout(res, delay));
        attempt += 1;
      }
    }
  }
}

export const mettaApiClient = new MettaApiClient();



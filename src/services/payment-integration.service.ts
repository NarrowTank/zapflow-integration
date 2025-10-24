import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';

/**
 * Serviço de integração com o Sistema de Pagamentos da Metta Studio (Efí Bank)
 */

interface ClienteData {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: {
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
  };
}

interface ItemPagamento {
  nome: string;
  valor: number;
  quantidade: number;
}

interface BoletoRequest {
  alunoId: number;
  valor: number;
  descricao: string;
  vencimento?: string;
  message?: string;
  configurations?: {
    fine?: number;
    interest?: number;
  };
}

interface PixRequest {
  alunoId: number;
  valor: number;
  descricao: string;
}

interface CarneRequest {
  alunoId: number;
  valor: number;
  descricao: string;
  parcelas: number;
  vencimentoPrimeiraParcela: string;
  message?: string;
  configurations?: {
    fine?: number;
    interest?: number;
  };
}

interface BoletoResponse {
  success: boolean;
  message: string;
  data: {
    chargeId: number;
    link: string;
    pdf: string;
    barcode: string;
    pixQrcode?: string;
    pixQrcodeImage?: string;
  };
}

interface PixResponse {
  success: boolean;
  message: string;
  data: {
    txid: string;
    pixCopiaECola: string;
    qrcode: string;
    linkVisualizacao: string;
  };
}

interface CarneResponse {
  success: boolean;
  message: string;
  data: {
    carneId: number;
    parcelas: Array<{
      parcel: number;
      chargeId: number;
      link: string;
      pdf: string;
      barcode: string;
      valor: number;
      vencimento: string;
    }>;
  };
}

export class PaymentIntegrationService {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private authToken: string | null = null;

  constructor() {
    this.baseUrl = process.env.METTA_API_BASE_URL || process.env.PAYMENT_SYSTEM_BASE_URL || 'http://metta_backend:3001';
    this.authToken = process.env.METTA_API_TOKEN || process.env.PAYMENT_SYSTEM_AUTH_TOKEN || null;
    const timeoutMs = parseInt(process.env.METTA_API_TIMEOUT || process.env.PAYMENT_SYSTEM_TIMEOUT || '10000');

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` }),
        ...(process.env.METTA_PUBLIC_API_KEY ? { 'X-Api-Key': process.env.METTA_PUBLIC_API_KEY } : {}),
      },
    });

    // Interceptor para logs
    this.axiosInstance.interceptors.request.use(
      (config) => {
        logger.info('Requisição ao sistema de pagamentos', {
          method: config.method,
          url: config.url,
          data: config.data,
        });
        return config;
      },
      (error) => {
        logger.error('Erro no interceptor de requisição', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.axiosInstance.interceptors.response.use(
      (response) => {
        logger.info('Resposta do sistema de pagamentos', {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error('Erro na resposta do sistema de pagamentos', {
          error: error.message,
          response: error.response?.data,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Gera um boleto à vista
   */
  async gerarBoleto(request: BoletoRequest): Promise<BoletoResponse> {
    try {
      // Autenticar se necessário
      await this.authenticate();

      const response = await this.axiosInstance.post<BoletoResponse>(
        '/api/cobrancas/boleto',
        request
      );

      return response.data;
    } catch (error: any) {
      logger.error('Erro ao gerar boleto', {
        error: error.message,
        request,
      });
      throw new Error('Erro ao gerar boleto. Por favor, tente novamente.');
    }
  }

  /**
   * Gera um PIX imediato
   */
  async gerarPix(request: PixRequest): Promise<PixResponse> {
    try {
      // Autenticar se necessário
      await this.authenticate();

      const response = await this.axiosInstance.post<PixResponse>(
        '/api/cobrancas/pix',
        request
      );

      return response.data;
    } catch (error: any) {
      logger.error('Erro ao gerar PIX', {
        error: error.message,
        request,
      });
      throw new Error('Erro ao gerar PIX. Por favor, tente novamente.');
    }
  }

  /**
   * Gera um carnê parcelado
   */
  async gerarCarne(request: CarneRequest): Promise<CarneResponse> {
    try {
      // Autenticar se necessário
      await this.authenticate();

      const response = await this.axiosInstance.post<CarneResponse>(
        '/api/cobrancas/carne',
        request
      );

      return response.data;
    } catch (error: any) {
      logger.error('Erro ao gerar carnê', {
        error: error.message,
        request,
      });
      throw new Error('Erro ao gerar carnê. Por favor, tente novamente.');
    }
  }

  /**
   * Busca uma cobrança por ID
   */
  async buscarCobranca(cobrancaId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/api/cobranca/${cobrancaId}`
      );

      return response.data;
    } catch (error: any) {
      logger.error('Erro ao buscar cobrança', {
        error: error.message,
        cobrancaId,
      });
      throw new Error('Erro ao buscar cobrança. Por favor, tente novamente.');
    }
  }

  /**
   * Busca cobranças de um aluno
   */
  async buscarCobrancasAluno(alunoId: number): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/api/cobranca/aluno/${alunoId}`
      );

      return response.data;
    } catch (error: any) {
      logger.error('Erro ao buscar cobranças do aluno', {
        error: error.message,
        alunoId,
      });
      throw new Error('Erro ao buscar cobranças. Por favor, tente novamente.');
    }
  }

  /**
   * Autentica no sistema de pagamentos e obtém JWT token
   */
  private async authenticate(): Promise<void> {
    if (this.authToken) {
      return; // Já autenticado
    }

    try {
      const username = process.env.PAYMENT_SYSTEM_USERNAME || 'admin';
      const password = process.env.PAYMENT_SYSTEM_PASSWORD;

      if (!password) {
        throw new Error('PAYMENT_SYSTEM_PASSWORD não configurada');
      }

      const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
        username: username,
        password: password
      });

      if (response.data.accessToken) {
        this.authToken = response.data.accessToken;
        
        // Atualizar header de autorização
        this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.authToken}`;
        
        logger.info('Autenticação realizada com sucesso', {
          username,
          tokenLength: this.authToken?.length || 0
        });
      } else {
        throw new Error('Falha na autenticação: ' + response.data.message);
      }
    } catch (error: any) {
      logger.error('Erro na autenticação', {
        error: error.message,
        baseUrl: this.baseUrl
      });
      throw new Error('Erro ao autenticar no sistema de pagamentos');
    }
  }

  /**
   * Calcula a data de vencimento padrão (7 dias a partir de hoje)
   */
  private calcularVencimentoPadrao(): string {
    const dataVencimento = new Date();
    dataVencimento.setDate(dataVencimento.getDate() + 7);
    return dataVencimento.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Formata descrição do pacote baseado nos itens selecionados
   */
  formatarDescricaoPacote(itens: ItemPagamento[]): string {
    if (itens.length === 1) {
      return itens[0].nome;
    } else if (itens.length === 2) {
      return `${itens[0].nome} + ${itens[1].nome}`;
    } else {
      return `${itens.length} itens personalizados`;
    }
  }
}


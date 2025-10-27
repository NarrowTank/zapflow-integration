import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';

/**
 * Serviço de integração com o Sistema Principal da Metta Studio via APIs HTTP
 * Substitui o acesso direto ao banco de dados por chamadas HTTP
 */

export interface Aluno {
  id: number;
  cpf: string;
  telefone: string;
  cep: string;
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  email?: string;
  nomeCompleto: string;
  turmaId: string;
  observacao?: string;
  createdAt?: string;
  updatedAt?: string;
  turma?: {
    id: string;
    universidade: string;
    curso: string;
    nomeTurma: string;
    ano: number;
  };
}

export interface Turma {
  id: string;
  universidade: string;
  curso: string;
  ano: number;
  nomeTurma: string;
  siglaUniversidade: string;
  createdAt?: string;
  updatedAt?: string;
  alunos?: Array<{
    id: number;
    cpf: string;
    nomeCompleto: string;
    telefone: string;
  }>;
  configuracao?: {
    id: string;
    turmaId: string;
    pixMaxParcelas: number;
    carneMaxParcelas: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface ConfiguracaoTurma {
  id: string;
  turmaId: string;
  valorAlbum25x30: number;
  valorAlbum30x30: number;
  valorAlbum30x40: number;
  valorFoto60: number;
  valorFoto80: number;
  valorFoto100: number;
  valorExtraCapaAcrilico: number;
  valorExtraMadeira: number;
  valorExtraCouro: number;
  valorExtraMarcadores: number;
  valorExtraBox: number;
  pixMaxParcelas: number;
  carneMaxParcelas: number;
}

export interface ItemCustomizado {
  id: string;
  nome: string;
  valor: number;
  configuracaoTurmaId: string;
}

export class MettaApiService {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private authToken: string | null = null;

  constructor() {
    this.baseUrl = process.env.METTA_API_BASE_URL || process.env.PAYMENT_SYSTEM_BASE_URL || 'http://metta_backend:3001';
    const timeoutMs = parseInt(process.env.METTA_API_TIMEOUT || process.env.PAYMENT_SYSTEM_TIMEOUT || '10000');
    const bearer = process.env.METTA_API_TOKEN || process.env.PAYMENT_SYSTEM_AUTH_TOKEN;
    const apiKey = process.env.METTA_PUBLIC_API_KEY;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {}),
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
    });

    // Interceptor para logs
    this.axiosInstance.interceptors.request.use(
      (config) => {
        logger.info('Requisição ao sistema principal', {
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
        logger.info('Resposta do sistema principal', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('Erro na resposta do sistema principal', {
          error: error.message,
          url: error.config?.url,
          response: error.response?.data,
        });
        return Promise.reject(error);
      }
    );

    // Se já existe token via variável de ambiente, evitar reautenticação
    if (bearer) {
      this.authToken = bearer;
    }
  }

  /**
   * Autentica no sistema principal e obtém JWT token
   */
  private async authenticate(): Promise<void> {
    // Se já houver token (via METTA_API_TOKEN), não autenticar novamente
    if (this.authToken) {
      return;
    }

    try {
      // Preferir variáveis METTA_*, com fallback às antigas se existirem
      const username = process.env.METTA_USERNAME || process.env.PAYMENT_SYSTEM_USERNAME || 'admin';
      const password = process.env.METTA_PASSWORD || process.env.PAYMENT_SYSTEM_PASSWORD;

      if (!password) {
        throw new Error('Credenciais de autenticação ausentes (METTA_USERNAME/METTA_PASSWORD)');
      }

      const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
        username,
        password,
      });

      if (response.data?.accessToken) {
        this.authToken = response.data.accessToken;
        // Atualizar header de autorização
        this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.authToken}`;

        logger.info('Autenticação realizada com sucesso', {
          username,
          tokenLength: this.authToken?.length || 0,
        });
        return;
      }

      throw new Error('Falha na autenticação: resposta sem accessToken');
    } catch (error: any) {
      logger.error('Erro na autenticação', {
        error: error.message,
        baseUrl: this.baseUrl,
      });
      throw new Error('Erro ao autenticar no sistema principal');
    }
  }

  /**
   * Verifica se um CPF já existe no sistema
   */
  async checkCpfExists(cpf: string): Promise<Aluno | null> {
    try {
      await this.authenticate();

      // Remover formatação do CPF para busca
      const cleanCpf = cpf.replace(/\D/g, '');
      
      const response = await this.axiosInstance.get(`/api/alunos?search=${cleanCpf}`);
      
      if (response.data.data && response.data.data.length > 0) {
        const aluno = response.data.data[0];
        logger.info('CPF encontrado no sistema principal', {
          cpf: cleanCpf,
          nomeCompleto: aluno.nomeCompleto,
          turmaId: aluno.turmaId,
        });
        return aluno;
      }

      logger.info('CPF não encontrado no sistema principal', { cpf: cleanCpf });
      return null;
    } catch (error: any) {
      logger.error('Erro ao verificar CPF no sistema principal', {
        cpf,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Verifica se um código de turma existe
   */
  async checkTurmaExists(turmaId: string): Promise<Turma | null> {
    try {
      await this.authenticate();

      const response = await this.axiosInstance.get(`/api/turmas?search=${turmaId}`);
      
      if (response.data.data && response.data.data.length > 0) {
        const turma = response.data.data[0];
        logger.info('Turma encontrada no sistema principal', {
          turmaId,
          universidade: turma.universidade,
          curso: turma.curso,
        });
        return turma;
      }

      logger.info('Turma não encontrada no sistema principal', { turmaId });
      return null;
    } catch (error: any) {
      logger.error('Erro ao verificar turma no sistema principal', {
        turmaId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca configuração de uma turma
   */
  async getConfiguracaoTurma(turmaId: string): Promise<ConfiguracaoTurma | null> {
    try {
      await this.authenticate();

      const response = await this.axiosInstance.get(`/api/turmas?search=${turmaId}`);
      
      if (response.data.data && response.data.data.length > 0) {
        const turma = response.data.data[0];
        if (turma.configuracao) {
          logger.info('Configuração da turma encontrada', {
            turmaId,
            pixMaxParcelas: turma.configuracao.pixMaxParcelas,
            carneMaxParcelas: turma.configuracao.carneMaxParcelas,
          });
          return turma.configuracao;
        }
      }

      logger.warn('Configuração da turma não encontrada', { turmaId });
      return null;
    } catch (error: any) {
      logger.error('Erro ao buscar configuração da turma', {
        turmaId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca itens customizados de uma turma
   */
  async getItensCustomizados(turmaId: string): Promise<ItemCustomizado[]> {
    try {
      await this.authenticate();

      // Buscar configuração da turma primeiro
      const turmas = await this.searchTurmas(turmaId);
      if (!turmas || turmas.length === 0) {
        logger.warn('Turma não encontrada para buscar itens', { turmaId });
        return [];
      }

      const turma = turmas[0];
      if (!turma.configuracao) {
        logger.warn('Configuração da turma não encontrada', { turmaId });
        return [];
      }

      // Buscar itens customizados via endpoint (se existir no futuro)
      // Por enquanto, retornar vazio pois os itens vêm do metta-database.service
      logger.info('Buscando itens customizados da turma', { turmaId });
      
      return [];
    } catch (error: any) {
      logger.error('Erro ao buscar itens customizados', {
        turmaId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Cria um novo aluno no sistema
   */
  async createAluno(alunoData: {
    cpf: string;
    telefone: string;
    cep: string;
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
    email?: string;
    nomeCompleto: string;
    turmaId: string;
    observacao?: string;
  }): Promise<Aluno | null> {
    try {
      await this.authenticate();

      // Remover formatação do CPF
      const cleanCpf = alunoData.cpf.replace(/\D/g, '');
      
      const alunoRequest = {
        ...alunoData,
        cpf: cleanCpf,
      };

      const response = await this.axiosInstance.post('/api/alunos', alunoRequest);

      if (response.data) {
        logger.info('Aluno criado com sucesso no sistema principal', {
          id: response.data.id,
          cpf: cleanCpf,
          nomeCompleto: response.data.nomeCompleto,
          turmaId: response.data.turmaId,
        });
        return response.data;
      }

      return null;
    } catch (error: any) {
      logger.error('Erro ao criar aluno no sistema principal', {
        alunoData,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca um aluno por ID
   */
  async getAlunoById(alunoId: number): Promise<Aluno | null> {
    try {
      await this.authenticate();

      const response = await this.axiosInstance.get(`/api/alunos/${alunoId}`);

      if (response.data) {
        logger.info('Aluno encontrado por ID', {
          alunoId,
          nomeCompleto: response.data.nomeCompleto,
        });
        return response.data;
      }

      return null;
    } catch (error: any) {
      logger.error('Erro ao buscar aluno por ID', {
        alunoId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca cobranças de um aluno por ID
   */
  async getCobrancasByAlunoId(alunoId: number): Promise<any[]> {
    try {
      await this.authenticate();

      const response = await this.axiosInstance.get(`/api/cobrancas?alunoId=${alunoId}`);

      // Verificar se a resposta é um array ou um objeto com array dentro
      let cobrancas: any[] = [];
      
      if (response.data) {
        // Se for array direto
        if (Array.isArray(response.data)) {
          cobrancas = response.data;
        }
        // Se for objeto com propriedade data
        else if (response.data.data && Array.isArray(response.data.data)) {
          cobrancas = response.data.data;
        }
        // Se for objeto com propriedade cobrancas
        else if (response.data.cobrancas && Array.isArray(response.data.cobrancas)) {
          cobrancas = response.data.cobrancas;
        }
        // Tentar converter objeto único em array
        else if (typeof response.data === 'object') {
          cobrancas = [response.data];
        }

        logger.info('Cobranças encontradas para aluno', {
          alunoId,
          quantidade: cobrancas.length,
          estrutura: Array.isArray(response.data) ? 'array' : 'objeto'
        });
        
        return cobrancas;
      }

      return [];
    } catch (error: any) {
      logger.error('Erro ao buscar cobranças do aluno', {
        alunoId,
        error: error.message,
      });
      return [];
    }
  }
}

import { PrismaClient } from '@prisma/client';
import logger from '@/utils/logger';

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
}

export interface Turma {
  id: string;
  universidade: string;
  curso: string;
  ano: number;
  nomeTurma: string;
  siglaUniversidade: string;
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

export class MettaDatabaseService {
  private prisma: PrismaClient | null = null;

  constructor() {
    try {
      this.prisma = new PrismaClient();
      logger.info('MettaDatabaseService inicializado');
    } catch (error: any) {
      logger.error('Erro ao inicializar MettaDatabaseService', {
        error: error.message,
      });
      this.prisma = null;
    }
  }

  /**
   * Verifica se um CPF já existe no banco de dados
   */
  async checkCpfExists(cpf: string): Promise<Aluno | null> {
    if (!this.prisma) {
      logger.warn('Prisma não disponível para verificação de CPF');
      return null;
    }

    try {
      // Remover formatação do CPF para busca
      const cleanCpf = cpf.replace(/\D/g, '');
      
      const aluno = await this.prisma.$queryRaw`
        SELECT * FROM alunos 
        WHERE cpf = ${cleanCpf} 
        LIMIT 1
      ` as Aluno[];

      if (aluno && aluno.length > 0) {
        logger.info('CPF encontrado no banco de dados', {
          cpf: cleanCpf,
          nomeCompleto: aluno[0].nomeCompleto,
          turmaId: aluno[0].turmaId,
        });
        return aluno[0];
      }

      logger.info('CPF não encontrado no banco de dados', { cpf: cleanCpf });
      return null;
    } catch (error: any) {
      logger.error('Erro ao verificar CPF no banco de dados', {
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
    if (!this.prisma) {
      logger.warn('Prisma não disponível para verificação de turma');
      return null;
    }

    try {
      logger.info('Executando consulta SQL para turma', { turmaId });
      
      const turma = await this.prisma.$queryRaw`
        SELECT * FROM turmas 
        WHERE LOWER(id) = LOWER(${turmaId}) 
        LIMIT 1
      ` as Turma[];

      logger.info('Resultado da consulta SQL', { 
        turmaId, 
        resultado: turma,
        quantidade: turma?.length 
      });

      if (turma && turma.length > 0) {
        logger.info('Turma encontrada no banco de dados', {
          turmaId,
          nomeTurma: turma[0].nomeTurma,
          universidade: turma[0].universidade,
        });
        return turma[0];
      }

      logger.info('Turma não encontrada no banco de dados', { turmaId });
      return null;
    } catch (error: any) {
      logger.error('Erro ao verificar turma no banco de dados', {
        turmaId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Cria um novo aluno no banco de dados
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
    if (!this.prisma) {
      logger.warn('Prisma não disponível para criação de aluno');
      return null;
    }

    try {
      // Remover formatação do CPF
      const cleanCpf = alunoData.cpf.replace(/\D/g, '');
      
      // Normalizar strings para UTF-8
      const normalizeUTF8 = (text: string) => text.normalize('NFC');
      
      const novoAluno = await this.prisma.$queryRaw`
        INSERT INTO alunos (
          cpf, telefone, cep, rua, numero, bairro, cidade, uf, 
          email, "nomeCompleto", "turmaId", observacao, "updatedAt"
        ) VALUES (
          ${cleanCpf}, ${alunoData.telefone}, ${alunoData.cep}, 
          ${normalizeUTF8(alunoData.rua)}, ${alunoData.numero}, ${normalizeUTF8(alunoData.bairro)}, 
          ${normalizeUTF8(alunoData.cidade)}, ${alunoData.uf}, ${alunoData.email || null}, 
          ${normalizeUTF8(alunoData.nomeCompleto)}, ${alunoData.turmaId}, ${alunoData.observacao || null},
          CURRENT_TIMESTAMP
        ) RETURNING *
      ` as Aluno[];

      if (novoAluno && novoAluno.length > 0) {
        logger.info('Aluno criado com sucesso', {
          id: novoAluno[0].id,
          cpf: cleanCpf,
          nomeCompleto: novoAluno[0].nomeCompleto,
          turmaId: novoAluno[0].turmaId,
        });
        return novoAluno[0];
      }

      return null;
    } catch (error: any) {
      logger.error('Erro ao criar aluno no banco de dados', {
        alunoData,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca configurações de uma turma
   */
  async getConfiguracaoTurma(turmaId: string): Promise<ConfiguracaoTurma | null> {
    if (!this.prisma) {
      logger.warn('Prisma não disponível para buscar configuração de turma');
      return null;
    }

    try {
      const configuracao = await this.prisma.$queryRaw`
        SELECT * FROM configuracoes_turma 
        WHERE "turmaId" = ${turmaId} 
        LIMIT 1
      ` as ConfiguracaoTurma[];

      if (configuracao && configuracao.length > 0) {
        logger.info('Configuração de turma encontrada', {
          turmaId,
          configuracaoId: configuracao[0].id,
        });
        return configuracao[0];
      }

      logger.info('Configuração de turma não encontrada', { turmaId });
      return null;
    } catch (error: any) {
      logger.error('Erro ao buscar configuração de turma', {
        turmaId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Busca itens customizados de uma turma
   */
  async getItensCustomizados(configuracaoTurmaId: string): Promise<ItemCustomizado[]> {
    if (!this.prisma) {
      logger.warn('Prisma não disponível para buscar itens customizados');
      return [];
    }

    try {
      const itens = await this.prisma.$queryRaw`
        SELECT * FROM itens_turma 
        WHERE "configuracaoTurmaId" = ${configuracaoTurmaId}
        ORDER BY nome
      ` as ItemCustomizado[];

      logger.info('Itens customizados encontrados', {
        configuracaoTurmaId,
        quantidade: itens.length,
      });
      return itens;
    } catch (error: any) {
      logger.error('Erro ao buscar itens customizados', {
        configuracaoTurmaId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Desconecta do banco de dados
   */
  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }
  }
}

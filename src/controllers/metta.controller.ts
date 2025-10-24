import { Request, Response } from 'express';
import { mettaApiClient } from '@/services/mettaApiClient';
import { tokenProvider } from '@/services/token-provider.service';
import logger from '@/utils/logger';

export class MettaController {
  async health(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    try {
      const data = await mettaApiClient.getHealth();
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta health OK', { elapsedMs });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 401 || status === 403 ? 'Falha de autenticação/autorização no Metta' : 'Falha ao consultar health do Metta';
      logger.error('Metta health erro', { status, message, elapsedMs });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  async testWebhook(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    try {
      const data = await mettaApiClient.postWebhookTest(req.body);
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta webhook test OK', { elapsedMs });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 401 || status === 403 ? 'Falha de autenticação/autorização no Metta' : 'Falha ao testar webhook no Metta';
      logger.error('Metta webhook test erro', { status, message, elapsedMs });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  async users(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    try {
      const data = await mettaApiClient.request<any>({ path: '/api/users', method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta users OK', { elapsedMs });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 401 || status === 403 ? 'Falha de autenticação/autorização no Metta' : 'Falha ao consultar usuários no Metta';
      logger.error('Metta users erro', { status, message, elapsedMs });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  async alunos(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const search = (req.query.search as string) || '';
    if (!search) {
      res.status(400).json({ success: false, error: 'Parâmetro query "search" é obrigatório' });
      return;
    }
    try {
      const data = await mettaApiClient.request<any>({ path: `/api/alunos?search=${encodeURIComponent(search)}`, method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta alunos OK', { elapsedMs, search });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 401 || status === 403 ? 'Falha de autenticação/autorização no Metta' : 'Falha ao consultar alunos no Metta';
      logger.error('Metta alunos erro', { status, message, elapsedMs, search });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    try {
      await tokenProvider.refresh();
      const elapsedMs = Date.now() - startedAt;
      logger.info('Refresh de token solicitado manualmente', { elapsedMs });
      res.status(200).json({ success: true, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 500;
      logger.error('Erro ao forçar refresh de token', { status, elapsedMs });
      res.status(status).json({ success: false, error: 'Falha ao atualizar token', elapsedMs });
    }
  }

  // Listar turmas (auxiliar para obter turmaId)
  async turmas(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    try {
      const search = (req.query.search as string) || '';
      const query = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await mettaApiClient.request<any>({ path: `/api/turmas${query}`, method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta turmas OK', { elapsedMs, search });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      logger.error('Metta turmas erro', { status, elapsedMs });
      res.status(status).json({ success: false, error: 'Falha ao listar turmas', elapsedMs });
    }
  }

  // Buscar aluno por ID
  async alunoById(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const alunoId = req.params.id;
    try {
      const data = await mettaApiClient.request<any>({ path: `/api/alunos/${encodeURIComponent(alunoId)}`, method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta alunoById OK', { elapsedMs, alunoId });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 404 ? 'Aluno não encontrado' : 'Falha ao buscar aluno';
      logger.error('Metta alunoById erro', { status, elapsedMs, alunoId });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  // Criar aluno
  async createAluno(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const body = req.body || {};
    const required = ['cpf', 'telefone', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'uf', 'nomeCompleto', 'turmaId'];
    const missing = required.filter((k) => body[k] == null || body[k] === '');
    if (missing.length) {
      res.status(400).json({ success: false, error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
      return;
    }
    try {
      const data = await mettaApiClient.request<any>({ path: '/api/alunos', method: 'POST', body });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta createAluno OK', { elapsedMs });
      res.status(201).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      logger.error('Metta createAluno erro', { status, elapsedMs });
      res.status(status).json({ success: false, error: 'Falha ao criar aluno', elapsedMs });
    }
  }

  // Gerar boleto (com PIX automático)
  async gerarBoleto(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const body = req.body || {};
    const required = ['valor', 'descricao'];
    const missing = required.filter((k) => body[k] == null || body[k] === '');
    if (missing.length) {
      res.status(400).json({ success: false, error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
      return;
    }
    try {
      // Resolver alunoId a partir de alunoCpf se necessário
      let alunoId = body.alunoId as number | undefined;
      if (!alunoId && body.alunoCpf) {
        const cleanCpf = String(body.alunoCpf).replace(/\D/g, '');
        const lookup = await mettaApiClient.request<any>({ path: `/api/alunos?search=${encodeURIComponent(cleanCpf)}`, method: 'GET' });
        const found = lookup?.data?.[0];
        if (!found?.id) {
          res.status(404).json({ success: false, error: 'Aluno não encontrado para o CPF informado' });
          return;
        }
        alunoId = found.id;
      }
      if (!alunoId) {
        res.status(400).json({ success: false, error: 'Informe alunoCpf ou alunoId' });
        return;
      }
      const payload = {
        alunoId,
        valor: body.valor,
        descricao: body.descricao,
        ...(body.vencimento ? { vencimento: body.vencimento } : {}),
      };
      const data = await mettaApiClient.request<any>({ path: '/api/cobrancas/boleto', method: 'POST', body: payload });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta gerarBoleto OK', { elapsedMs });
      res.status(201).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const details = status >= 400 && status < 500 ? (error?.response?.data && typeof error.response.data === 'object' ? { message: error.response.data.message } : undefined) : undefined;
      logger.error('Metta gerarBoleto erro', { status, elapsedMs });
      res.status(status).json({ success: false, error: 'Falha ao gerar boleto', elapsedMs, ...(details ? { details } : {}) });
    }
  }

  // Gerar carnê
  async gerarCarne(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const body = req.body || {};
    const required = ['valor', 'parcelas', 'vencimentoPrimeiraParcela', 'descricao'];
    const missing = required.filter((k) => body[k] == null || body[k] === '');
    if (missing.length) {
      res.status(400).json({ success: false, error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
      return;
    }
    try {
      // Resolver alunoId a partir de alunoCpf (se fornecido)
      let alunoId = body.alunoId as number | undefined;
      if (!alunoId && body.alunoCpf) {
        const cleanCpf = String(body.alunoCpf).replace(/\D/g, '');
        const lookup = await mettaApiClient.request<any>({ path: `/api/alunos?search=${encodeURIComponent(cleanCpf)}`, method: 'GET' });
        const found = lookup?.data?.[0];
        if (!found?.id) {
          res.status(404).json({ success: false, error: 'Aluno não encontrado para o CPF informado' });
          return;
        }
        alunoId = found.id;
      }
      if (!alunoId) {
        res.status(400).json({ success: false, error: 'Informe alunoCpf ou alunoId' });
        return;
      }

      const payload: any = {
        alunoId,
        valor: body.valor,
        descricao: body.descricao,
        parcelas: body.parcelas,
        vencimentoPrimeiraParcela: body.vencimentoPrimeiraParcela,
      };
      if (body.message) payload.message = body.message;
      if (body.configurations) payload.configurations = body.configurations;
      if (body.itens) payload.itens = body.itens;

      const data = await mettaApiClient.request<any>({ path: '/api/cobrancas/carne', method: 'POST', body: payload });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta gerarCarne OK', { elapsedMs });
      res.status(201).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const responseData = error?.response?.data;
      const details = status >= 400 && status < 500 && responseData && typeof responseData === 'object' ? responseData : undefined;
      logger.error('Metta gerarCarne erro', {
        status,
        elapsedMs,
        payloadShape: {
          hasAlunoId: Boolean((req.body || {}).alunoId),
          hasAlunoCpf: Boolean((req.body || {}).alunoCpf),
          hasItens: Array.isArray((req.body || {}).itens),
          hasConfigurations: Boolean((req.body || {}).configurations),
        },
      });
      const sentPayload = {
        alunoId: (req.body || {}).alunoId,
        valor: (req.body || {}).valor,
        parcelas: (req.body || {}).parcelas,
        vencimentoPrimeiraParcela: (req.body || {}).vencimentoPrimeiraParcela,
        descricao: (req.body || {}).descricao,
      };
      res.status(status).json({ success: false, error: 'Falha ao gerar carnê', elapsedMs, sentPayload, ...(details ? { mettaError: details } : {}) });
    }
  }

  // Consultar cobrança por ID
  async getCobranca(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const cobrancaId = req.params.id;
    try {
      const data = await mettaApiClient.request<any>({ path: `/api/cobrancas/${encodeURIComponent(cobrancaId)}`, method: 'GET' });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta getCobranca OK', { elapsedMs, cobrancaId });
      res.status(200).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const message = status === 404 ? 'Cobrança não encontrada' : 'Falha ao consultar cobrança';
      logger.error('Metta getCobranca erro', { status, elapsedMs, cobrancaId });
      res.status(status).json({ success: false, error: message, elapsedMs });
    }
  }

  // (Opcional) Geração automática por tipo (boleto/carne)
  async gerarAutomatica(req: Request, res: Response): Promise<void> {
    const startedAt = Date.now();
    const body = req.body || {};
    const required = ['turmaId', 'tipo', 'valor', 'descricao', 'alunosIds', 'vencimento'];
    const missing = required.filter((k) => body[k] == null || body[k] === '' || (k === 'alunosIds' && (!Array.isArray(body.alunosIds) || body.alunosIds.length === 0)));
    if (missing.length) {
      res.status(400).json({ success: false, error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
      return;
    }
    try {
      const payload: any = {
        turmaId: body.turmaId,
        tipo: body.tipo,
        valor: body.valor,
        descricao: body.descricao,
        alunosIds: body.alunosIds,
        vencimento: body.vencimento,
      };
      if (body.parcelas) payload.parcelas = body.parcelas;
      if (body.message) payload.message = body.message;
      if (body.configurations) payload.configurations = body.configurations;
      if (body.itens) payload.itens = body.itens;

      const data = await mettaApiClient.request<any>({ path: '/api/cobrancas/automatica', method: 'POST', body: payload });
      const elapsedMs = Date.now() - startedAt;
      logger.info('Metta gerarAutomatica OK', { elapsedMs });
      res.status(201).json({ success: true, data, elapsedMs });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      const status = error?.response?.status || 502;
      const details = status >= 400 && status < 500 ? (error?.response?.data && typeof error.response.data === 'object' ? { message: error.response.data.message } : undefined) : undefined;
      logger.error('Metta gerarAutomatica erro', { status, elapsedMs });
      res.status(status).json({ success: false, error: 'Falha ao gerar cobrança automática', elapsedMs, ...(details ? { details } : {}) });
    }
  }
}



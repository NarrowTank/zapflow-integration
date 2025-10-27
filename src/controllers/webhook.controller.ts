import { Request, Response } from 'express';
import { ConversationService } from '@/services/conversation.service';
import { RedisService } from '@/services/redis.service';
import { ZApiService } from '@/services/zapi.service';
import logger from '@/utils/logger';
import { ZApiWebhookPayload } from '@/types';
import Joi from 'joi';

// Configurar encoding UTF-8 para processamento de mensagens
process.env.LANG = 'C.UTF-8';
process.env.LC_ALL = 'C.UTF-8';

// Schema de validação para webhook de vencimentos do Metta
const mettaVencimentosSchema = Joi.object({
  alunoId: Joi.number().integer().positive().required(),
  alunoNome: Joi.string().min(1).max(255).required(),
  alunoTelefone: Joi.string().pattern(/^\d{10,15}$/).required(),
  alunoEmail: Joi.string().email().optional(),
  cobrancaId: Joi.string().min(1).max(50).required(),
  tipo: Joi.string().valid('boleto', 'carne', 'pix').required(),
  valor: Joi.number().positive().precision(2).required(),
  vencimento: Joi.date().iso().required(),
  descricao: Joi.string().max(500).optional(),
  diasParaVencimento: Joi.number().integer().optional(),
  turmaId: Joi.string().max(50).optional(),
  turmaNome: Joi.string().max(255).optional(),
  webhookType: Joi.string().valid('vencimento_proximo', 'vencimento_hoje', 'vencimento_atrasado').required(),
});

export class WebhookController {
  private conversationService: ConversationService;
  private redisService: RedisService;
  private zapiService: ZApiService;

  constructor() {
    this.redisService = new RedisService();
    this.conversationService = new ConversationService(this.redisService);
    this.zapiService = new ZApiService();
  }

  /**
   * Endpoint para receber webhooks da Z-API
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const payload: ZApiWebhookPayload = req.body;

      logger.info('Webhook recebido', {
        status: payload.status,
        type: payload.type,
        phone: payload.phone,
        message: payload.message,
      });

      // Validar payload básico
      if (!payload.phone || !payload.type) {
        logger.warn('Payload inválido recebido', payload);
        res.status(400).json({ error: 'Payload inválido' });
        return;
      }

      // Ignorar mensagens enviadas por nós (evita loop)
      const fromMe = (payload as any).fromMe === true;
      if (fromMe) {
        logger.info('Mensagem ignorada (fromMe=true)', { phone: payload.phone, type: payload.type });
        res.status(200).json({ success: true, ignored_from_me: true });
        return;
      }

      // Idempotência: evitar reprocessar o mesmo messageId (quando disponível)
      const messageId = (payload as any).messageId || (payload as any).id;
      if (messageId && this.redisService && await this.redisService.setIfNotExists(`zapi:msg:${messageId}`, '1', 300) === false) {
        logger.info('Mensagem duplicada ignorada (idempotência)', { messageId, phone: payload.phone });
        res.status(200).json({ success: true, deduped: true });
        return;
      }

      // De-bounce por conteúdo (telefon + conteúdo) para evitar múltiplos posts iguais em curto período
      if (this.redisService) {
        const content = (payload as any).message
          || (payload as any).text?.message
          || (payload as any).listResponseMessage?.selectedRowId
          || (payload as any).buttonResponseMessage?.buttonId
          || '';
        const sig = `${payload.phone}|${payload.type}|${content}`;
        const ok = await this.redisService.setIfNotExists(`zapi:debounce:${Buffer.from(sig).toString('base64')}`, '1', 8);
        if (ok === false) {
          logger.info('Mensagem ignorada (debounce de conteúdo)', { phone: payload.phone, type: payload.type });
          res.status(200).json({ success: true, debounced: true });
          return;
        }
      }

      // Processar somente mensagens de usuário (texto/lista/botões/ReceivedCallback)
      if ((payload.type === 'text' && (payload.message || payload.text)) || payload.type === 'ReceivedCallback' || payload.listResponseMessage || payload.buttonResponseMessage) {
        // Lock de processamento por telefone (3s) para evitar concorrência/race conditions
        const lockKey = `zapi:lock:${payload.phone}`;
        let locked = false;
        try {
          if (this.redisService) {
            locked = await this.redisService.setIfNotExists(lockKey, '1', 3);
            if (!locked) {
              logger.info('Mensagem ignorada (lock ativo)', { phone: payload.phone });
              res.status(200).json({ success: true, locked: true });
              return;
            }
          }
          await this.conversationService.processIncomingMessage(payload);
        } finally {
          if (locked && this.redisService) {
            await this.redisService.delete(lockKey);
          }
        }
      } else {
        logger.info('Tipo de mensagem não processado', {
          type: payload.type,
          phone: payload.phone,
          hasListResponse: !!payload.listResponseMessage,
          hasButtonResponse: !!payload.buttonResponseMessage,
          hasText: !!payload.text,
        });
      }

      // Responder com sucesso
      res.status(200).json({ success: true });
    } catch (error: any) {
      logger.error('Erro ao processar webhook', {
        error: error.message,
        stack: error.stack,
      });
      
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: error.message,
      });
    }
  }

  /**
   * Endpoint para receber webhooks de vencimentos do Metta
   */
  async handleMettaVencimentos(req: Request, res: Response): Promise<void> {
    try {
      // Validação do payload com Joi
      const { error, value } = mettaVencimentosSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const errorDetails = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        
        logger.warn('Payload inválido recebido', {
          errors: errorDetails,
          receivedPayload: req.body,
        });

        res.status(400).json({
          success: false,
          error: 'Payload inválido',
          details: errorDetails,
        });
        return;
      }

      const {
        alunoId,
        alunoNome,
        alunoTelefone,
        alunoEmail,
        cobrancaId,
        tipo,
        valor,
        vencimento,
        descricao,
        diasParaVencimento,
        turmaId,
        turmaNome,
        webhookType,
      } = value;

      // Chave de idempotência: cobrancaId + webhookType
      const idempotencyKey = `metta:webhook:${cobrancaId}:${webhookType}`;
      
      // Verificar se já foi processado (idempotência)
      const isAlreadyProcessed = await this.redisService.get(idempotencyKey);
      if (isAlreadyProcessed) {
        logger.info('Webhook já processado (idempotência)', {
          alunoId,
          cobrancaId,
          webhookType,
          idempotencyKey,
        });

        res.json({
          success: true,
          message: 'Notificação já processada anteriormente',
          alunoId,
          cobrancaId,
          webhookType,
          idempotent: true,
        });
        return;
      }

      logger.info('Webhook de vencimento recebido', {
        alunoId,
        alunoNome,
        cobrancaId,
        tipo,
        webhookType,
        idempotencyKey,
      });

      const mensagem = this.gerarMensagemVencimento({
        nome: alunoNome,
        tipo,
        valor,
        vencimento,
        diasParaVencimento,
        webhookType,
        turmaNome,
      });

      const sendResult = await this.zapiService.sendTextMessage({
        phone: alunoTelefone,
        message: mensagem,
      });

      if (!sendResult.success) {
        logger.error('Falha ao enviar mensagem de vencimento', {
          alunoTelefone,
          error: sendResult.error,
          idempotencyKey,
        });
        res.status(502).json({ success: false, error: 'Falha ao enviar mensagem' });
        return;
      }

      // Marcar como processado (TTL de 7 dias)
      await this.redisService.set(idempotencyKey, 'processed', 7 * 24 * 60 * 60);

      logger.info('Mensagem de vencimento enviada', { 
        alunoNome, 
        alunoTelefone,
        idempotencyKey,
        webhookType,
      });

      res.json({
        success: true,
        message: 'Notificação enviada com sucesso',
        alunoId,
        cobrancaId,
        webhookType,
      });
    } catch (error: any) {
      logger.error('Erro ao processar webhook de vencimento', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message,
      });
    }
  }

  private gerarMensagemVencimento(dados: {
    nome: string;
    tipo: 'boleto' | 'carne' | 'pix' | string;
    valor: number;
    vencimento: string | Date;
    diasParaVencimento?: number;
    webhookType: 'vencimento_proximo' | 'vencimento_hoje' | 'vencimento_atrasado' | string;
    turmaNome?: string;
  }): string {
    const { nome, tipo, valor, vencimento, diasParaVencimento, webhookType, turmaNome } = dados;

    const dataFmt = new Date(vencimento).toLocaleDateString('pt-BR');

    let mensagem = `Olá ${nome}!\n\n`;

    if (webhookType === 'vencimento_proximo') {
      mensagem += `Lembrete de vencimento.\n`;
      mensagem += `Sua cobrança de ${String(tipo).toUpperCase()} no valor de R$ ${valor.toFixed(2)} vence em ${diasParaVencimento} dias.\n`;
      mensagem += `Data de vencimento: ${dataFmt}.\n\n`;
    } else if (webhookType === 'vencimento_hoje') {
      mensagem += `Atenção: vencimento hoje.\n`;
      mensagem += `Sua cobrança de ${String(tipo).toUpperCase()} no valor de R$ ${valor.toFixed(2)} vence HOJE.\n`;
      mensagem += `Data de vencimento: ${dataFmt}.\n\n`;
    } else if (webhookType === 'vencimento_atrasado') {
      const dias = Math.abs(diasParaVencimento || 0);
      mensagem += `Cobrança atrasada.\n`;
      mensagem += `Sua cobrança de ${String(tipo).toUpperCase()} no valor de R$ ${valor.toFixed(2)} está atrasada há ${dias} dias.\n`;
      mensagem += `Data de vencimento: ${dataFmt}.\n\n`;
    } else {
      mensagem += `Atualização sobre sua cobrança de ${String(tipo).toUpperCase()} no valor de R$ ${valor.toFixed(2)} com vencimento em ${dataFmt}.\n\n`;
    }

    if (turmaNome) {
      mensagem += `Turma: ${turmaNome}.\n\n`;
    }

    mensagem += `Para efetuar o pagamento:\n`;
    mensagem += `• Acesse o link do boleto/PIX\n`;
    mensagem += `• Use o código PIX para pagamento instantâneo\n`;
    mensagem += `• Ou escaneie o QR Code\n\n`;

    mensagem += `Dúvidas? Entre em contato conosco.\n`;
    mensagem += `WhatsApp: [seu número]\n`;
    mensagem += `Email: [seu email]`;

    return mensagem;
  }

  /**
   * Endpoint para verificar status da instância Z-API
   */
  async getInstanceStatus(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.zapiService.getInstanceStatus();
      
      if (result.success) {
        res.status(200).json(result.data);
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      logger.error('Erro ao verificar status da instância', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  /**
   * Endpoint para enviar mensagem de teste
   */
  async sendTestMessage(req: Request, res: Response): Promise<void> {
    try {
      const { phone, message } = req.body;

      if (!phone || !message) {
        res.status(400).json({ error: 'Phone e message são obrigatórios' });
        return;
      }

      const result = await this.zapiService.sendTextMessage({
        phone,
        message,
      });

      if (result.success) {
        res.status(200).json({ success: true, data: result.data });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      logger.error('Erro ao enviar mensagem de teste', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  /**
   * Endpoint para obter informações do Redis
   */
  async getRedisInfo(req: Request, res: Response): Promise<void> {
    try {
      const info = await this.redisService.getInfo();
      res.status(200).json(info);
    } catch (error: any) {
      logger.error('Erro ao obter informações do Redis', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  /**
   * Endpoint para limpar cache do Redis
   */
  async clearRedisCache(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = req.params;

      if (phone) {
        await this.redisService.deleteSession(phone);
        res.status(200).json({ message: `Cache limpo para ${phone}` });
      } else {
        res.status(400).json({ error: 'Phone é obrigatório' });
      }
    } catch (error: any) {
      logger.error('Erro ao limpar cache do Redis', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
}

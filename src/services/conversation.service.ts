import { PrismaClient } from '@prisma/client';
import { ZApiService } from './zapi.service';
import { RedisService } from './redis.service';
import { MettaDatabaseService, Aluno, Turma } from './metta-database.service';
import { MettaApiService } from './metta-api.service';
import { PaymentIntegrationService } from './payment-integration.service';
import logger from '@/utils/logger';
import {
  ConversationStep,
  SessionContext,
  ZApiWebhookPayload,
  ZApiSendMessageRequest,
  ZApiSendButtonRequest,
  ZApiSendListRequest,
  ZApiSendOptionListRequest,
} from '@/types';

// Configurar encoding UTF-8 para processamento de mensagens
process.env.LANG = 'C.UTF-8';
process.env.LC_ALL = 'C.UTF-8';

export class ConversationService {
  private prisma: PrismaClient | null = null;
  private zapiService: ZApiService;
  private redisService?: RedisService;
  private mettaDatabaseService: MettaDatabaseService;
  private mettaApiService: MettaApiService;
  private paymentIntegrationService: PaymentIntegrationService;

  constructor(redisService?: RedisService) {
    try {
    this.prisma = new PrismaClient();
    } catch (error: any) {
      logger.warn('Prisma não pôde ser inicializado, usando apenas Redis', { error: error.message });
      this.prisma = null;
    }
    this.zapiService = new ZApiService();
    this.redisService = redisService;
    this.mettaDatabaseService = new MettaDatabaseService();
    this.mettaApiService = new MettaApiService();
    this.paymentIntegrationService = new PaymentIntegrationService();
  }

  /**
   * Processa uma mensagem recebida via webhook
   */
  async processIncomingMessage(payload: ZApiWebhookPayload): Promise<void> {
    try {
      const { phone, message, type, listResponseMessage, text, buttonResponseMessage } = payload;

      logger.info('Processando mensagem recebida', {
        phone,
        message,
        type,
        hasListResponse: !!listResponseMessage,
        hasText: !!text,
        hasButtonResponse: !!buttonResponseMessage,
        selectedRowId: listResponseMessage?.selectedRowId,
      });

      // Determinar o conteúdo da mensagem
      let messageContent: string = '';
      let messageType = type || 'text';

      // Se for uma resposta de lista de opções, usar o selectedRowId como mensagem
      if (listResponseMessage) {
        messageContent = listResponseMessage.selectedRowId;
        messageType = 'list_response';
        
        logger.info('Resposta de lista de opções detectada', {
          phone,
          selectedRowId: listResponseMessage.selectedRowId,
          title: listResponseMessage.title,
          message: listResponseMessage.message,
        });
      }
      // Se for uma resposta de botão, usar o buttonId como mensagem
      else if (buttonResponseMessage) {
        messageContent = buttonResponseMessage.buttonId;
        messageType = 'button_response';
        
        logger.info('Resposta de botão detectada', {
          phone,
          buttonId: buttonResponseMessage.buttonId,
          message: buttonResponseMessage.message,
        });
      }
      // Se for uma mensagem de texto, extrair do campo text
      else if (text && text.message) {
        messageContent = text.message;
        messageType = 'text';
        
        logger.info('Mensagem de texto detectada', {
          phone,
          message: text.message,
        });
      }
      // Se message for um objeto com conversation, extrair
      else if (message && typeof message === 'object' && (message as any).conversation) {
        messageContent = (message as any).conversation;
        messageType = 'text';
        
        logger.info('Mensagem extraída do objeto conversation', {
          phone,
          message: messageContent,
        });
      }
      // Se message for uma string diretamente
      else if (message && typeof message === 'string') {
        messageContent = message;
        messageType = 'text';
      }

      // Log da mensagem recebida
      await this.logMessage({
        phone,
        message: messageContent,
        direction: 'incoming',
        messageType,
      });

      // Buscar ou criar sessão
      const session = await this.getOrCreateSession(phone);

      // Determinar resposta baseada no estado atual
      const response = await this.determineResponse(session, messageContent);

      if (response) {
        // Atualizar sessão ANTES de enviar a resposta (preservando dados existentes)
        const currentSession = await this.getOrCreateSession(phone);
        await this.updateSession(phone, response.step, messageContent, currentSession.data);
        
        // Enviar resposta
        await this.sendResponse(phone, response);
      }

    } catch (error: any) {
      logger.error('Erro ao processar mensagem recebida', {
        phone: payload.phone,
        error: error.message,
      });
    }
  }

  /**
   * Normaliza texto para UTF-8
   */
  private normalizeUTF8(text: string): string {
    try {
      // Normalizar caracteres Unicode
      return text.normalize('NFC');
    } catch (error) {
      logger.warn('Erro ao normalizar UTF-8', { text, error });
      return text;
    }
  }

  /**
   * Capitaliza texto (primeira letra de cada palavra em maiúscula)
   */
  private capitalizeText(text: string): string {
    const normalizedText = this.normalizeUTF8(text);
    return normalizedText
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Formata CEP para o padrão xxxxx-xxx
   */
  private formatCEP(cep: string): string {
    return cep.replace(/(\d{5})(\d{3})/, '$1-$2');
  }

  /**
   * Atualiza dados do cliente na sessão
   */
  private async updateClienteData(phone: string, key: string, value: any): Promise<void> {
    try {
      const session = await this.getOrCreateSession(phone);
      const clienteData = session.data?.clienteData || {};
      clienteData[key] = value;

      await this.updateSession(phone, session.currentStep, session.lastMessage || '', {
        ...session.data,
        clienteData
      });

      logger.info('Dados do cliente atualizados na sessão com sucesso', {
        phone,
        key,
        value,
      });
    } catch (error: any) {
      logger.error('Erro ao atualizar dados do cliente na sessão', {
        phone,
        key,
        value,
        error: error.message,
      });
    }
  }
  private async getOrCreateSession(phone: string): Promise<SessionContext> {
    try {
      // Tentar buscar do Redis primeiro (se disponível)
      if (this.redisService) {
        const cachedSession = await this.redisService.getSession(phone);
        if (cachedSession) {
          return cachedSession;
        }
      }

      // Se Prisma estiver disponível, usar banco
      if (this.prisma) {
        try {
      // Usar SQL direto para evitar problemas de mapeamento
      const sessions = await this.prisma.$queryRaw`
        SELECT * FROM zapflow_sessions WHERE phone = ${phone}
      ` as any[];

      let session = sessions[0];

      if (!session) {
        await this.prisma.$executeRaw`
          INSERT INTO zapflow_sessions (phone, current_step, last_message, created_at, updated_at)
          VALUES (${phone}, 'welcome', '', NOW(), NOW())
        `;
        
        const newSessions = await this.prisma.$queryRaw`
          SELECT * FROM zapflow_sessions WHERE phone = ${phone}
        ` as any[];
        
        session = newSessions[0];
      }

      const sessionContext: SessionContext = {
        phone: session.phone,
        currentStep: session.current_step,
        lastMessage: session.last_message || undefined,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        data: session.context ? JSON.parse(session.context) : undefined,
      };

      // Cache no Redis (se disponível)
      if (this.redisService) {
        await this.redisService.setSession(phone, sessionContext);
      }

      return sessionContext;
        } catch (error: any) {
          logger.warn('Erro ao acessar banco de dados, usando Redis/memória', {
            phone,
            error: error.message,
          });
          // Continua para o fallback
        }
      }

      // Fallback: criar sessão em memória
      const fallbackSession: SessionContext = {
        phone,
        currentStep: 'welcome',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Cache no Redis
      if (this.redisService) {
        await this.redisService.setSession(phone, fallbackSession);
      }

      return fallbackSession;
    } catch (error: any) {
      logger.error('Erro ao buscar/criar sessão', {
        phone,
        error: error.message,
      });
      
      // Fallback: sessão básica
      return {
        phone,
        currentStep: 'welcome',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  /**
   * Determina a resposta baseada no estado atual da conversa
   */
  private async determineResponse(session: SessionContext, message: string): Promise<ConversationStep | null> {
    const currentStep = session.currentStep;
    const messageLower = message.toLowerCase().trim();

    logger.info('Determinando resposta', {
      phone: session.phone,
      currentStep,
      message: messageLower,
    });

    logger.info('ConversationService.determineResponse - Processando step', {
      currentStep,
      messageLower,
    });

    switch (currentStep) {
      case 'welcome':
        logger.info('Retornando getWelcomeStep');
        return this.getWelcomeStep();

      case 'main_menu':
        logger.info('Retornando handleMainMenu');
        return this.handleMainMenu(messageLower);

      case 'contract_cpf':
        logger.info('Retornando handleContractCpf');
        return await this.handleContractCpf(messageLower, session.phone);
      case 'existing_client_menu':
        logger.info('Retornando handleExistingClientMenu');
        return this.handleExistingClientMenu(messageLower);

      case 'contract_existing_client':
        logger.info('Retornando handleExistingClient');
        return this.handleExistingClient(messageLower);

      case 'contract_class_code':
        logger.info('Retornando handleClassCode');
        return await this.handleClassCode(messageLower, session.phone);

      case 'contract_name':
        logger.info('Retornando handleName');
        return await this.handleName(message, session.phone);

      case 'contract_email':
        logger.info('Retornando handleEmail');
        return await this.handleEmail(message, session.phone);

      case 'contract_cep':
        logger.info('Retornando handleCep');
        return await this.handleCep(message, session.phone);

      case 'contract_address':
        logger.info('Retornando handleAddress');
        return await this.handleAddress(message, session.phone);

      case 'contract_neighborhood':
        logger.info('Retornando handleNeighborhood');
        return await this.handleNeighborhood(message, session.phone);

      case 'contract_city':
        logger.info('Retornando handleCity');
        return await this.handleCity(message, session.phone);

      case 'contract_state':
        logger.info('Retornando handleState');
        return await this.handleState(messageLower, session.phone);

      case 'contract_confirmed':
        logger.info('Retornando getContractConfirmedStep');
        return await this.getContractConfirmedStep(session.phone);

      case 'package_selection':
        logger.info('Retornando handlePackageSelection');
        return await this.handlePackageSelection(messageLower, session.phone);

      case 'package_album_size':
        logger.info('Retornando handlePackageAlbumSize');
        return await this.handlePackageAlbumSize(messageLower, session.phone);

      case 'package_photo_quantity':
        logger.info('Retornando handlePackagePhotoQuantity');
        return await this.handlePackagePhotoQuantity(messageLower, session.phone);

      case 'package_extras':
        logger.info('Retornando handlePackageExtras');
        return await this.handlePackageExtras(messageLower, session.phone);

      case 'package_custom_items':
        logger.info('Retornando handlePackageCustomItems');
        return await this.handlePackageCustomItems(messageLower, session.phone);

      case 'package_confirmation':
        logger.info('Retornando handlePackageConfirmation');
        return await this.handlePackageConfirmation(messageLower, session.phone);

      case 'billing_cpf':
        logger.info('Retornando handleBillingCpf');
        return await this.handleBillingCpf(messageLower, session.phone);

      case 'payment_method':
        logger.info('Retornando handlePaymentMethodSelection');
        return await this.handlePaymentMethodSelection(messageLower, session.phone);

      case 'carne_parcelas':
        logger.info('Retornando handleCarneParcelas');
        return await this.handleCarneParcelas(messageLower, session.phone);

      case 'contract':
        logger.info('Retornando getWelcomeStep');
        return this.getWelcomeStep();

      case 'billing':
        logger.info('Retornando getBillingStep');
        return this.getBillingStep();

      case 'editing':
        logger.info('Retornando getEditingStep');
        return this.getEditingStep();

      case 'admin':
        logger.info('Retornando getAdminStep');
        return this.getAdminStep();

      case 'quote':
        logger.info('Retornando getQuoteStep');
        return this.getQuoteStep();

      case 'meeting':
        logger.info('Retornando getMeetingStep');
        return this.getMeetingStep();

      case 'support':
        logger.info('Retornando getSupportStep');
        return this.getSupportStep();

      default:
        // Não responder com menu por padrão para evitar loops em callbacks/ecos inesperados
        logger.info('Nenhuma transição válida para o currentStep; ignorando mensagem');
        return null;
    }
  }

  /**
   * Passo de boas-vindas
   */
  private getWelcomeStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Bem-vindo(a) ao Metta Studio!\nAqui, cada clique é pensado para eternizar emoções e transformar momentos em arte. 💫',
      optionList: this.getMainMenuOptions()
    };
  }

  /**
   * Manipula o menu principal
   */
  private handleMainMenu(message: string): ConversationStep | null {
    // Decisão estrita por IDs/comandos para evitar falsos positivos em testes/eco
    const m = message.trim();
    if (m === '1' || m === 'contract') {
      return {
        step: 'contract_cpf',
        message: 'Para darmos continuidade, por favor informe o seu CPF. Digite apenas números, sem pontos nem traços.\n👉 Exemplo: 00516400320',
      };
    }
    if (m === '2' || m === 'billing') {
      return {
        step: 'billing_cpf',
        message: 'Para consultar suas cobranças e pagamentos, por favor informe seu CPF (apenas números).',
      };
    }
    if (m === '3' || m === 'editing') {
      return this.getSupportStep();
    }
    if (m === '4' || m === 'admin') {
      return this.getSupportStep();
    }
    if (m === '5' || m === 'quote') {
      return this.getSupportStep();
    }
    if (m === '6' || m === 'meeting') {
      return this.getSupportStep();
    }

    // Opção 7: Falar com Atendente
    if (message.includes('atendente') || message.includes('suporte') || message.includes('7') || message === 'support') {
      return {
        step: 'support',
        message: 'Você será direcionado para nossa equipe de atendimento. Aguarde um momento...',
      };
    }

    // Se não reconhecer, não responde (evita loops)
    return null;
  }

  /**
   * Manipula o passo de solicitação de CPF para contrato
   */
  private async handleContractCpf(message: string, phone: string): Promise<ConversationStep | null> {
    // Remover espaços e caracteres especiais, mantendo apenas números
    const cpfNumbers = message.replace(/\D/g, '');
    
    logger.info('Processando CPF para contrato', {
      originalMessage: message,
      cpfNumbers,
      cpfLength: cpfNumbers.length,
    });

    // Validar se é um CPF válido (11 dígitos)
    if (cpfNumbers.length === 11) {
      // Validar CPF usando algoritmo
      if (this.isValidCPF(cpfNumbers)) {
        // Salvar CPF na sessão
        await this.updateClienteData(phone, 'cpf', cpfNumbers);
        
               // Verificar se o CPF já existe no sistema principal
               const alunoExistente = await this.mettaApiService.checkCpfExists(cpfNumbers);
        
        if (alunoExistente) {
          // Cliente já existe - vai para um menu estrito (evita textos livres)
          return {
            step: 'existing_client_menu',
            message: `CPF válido e já cadastrado.\n\nNome: ${alunoExistente.nomeCompleto}\nCódigo da Turma: ${alunoExistente.turmaId}\n\nComo podemos ajudar agora?`,
            optionList: {
              title: 'Opções disponíveis',
              buttonLabel: 'Abrir opções',
              options: [
                { id: '2', title: 'Cobrança ou Pagamentos', description: 'Consultar boletos/PIX ou carnês.' },
                { id: '7', title: 'Falar com um atendente', description: 'Nossa equipe entrará em contato.' },
                { id: 'menu', title: 'Voltar ao menu inicial', description: 'Retornar ao início.' }
              ]
            }
          };
        } else {
          // Cliente não existe - solicitar código da turma
          return {
            step: 'contract_class_code',
            message: '✅ CPF válido!\n\nDigite o código da sua turma:',
          };
        }
      } else {
        return {
          step: 'contract_cpf',
          message: '❌ CPF inválido. Por favor, verifique os números digitados e tente novamente.\n\n👉 Exemplo: 00516400320',
        };
      }
    } else if (cpfNumbers.length > 0) {
      return {
        step: 'contract_cpf',
        message: '❌ CPF deve ter exatamente 11 dígitos. Você digitou ' + cpfNumbers.length + ' números.\n\nPor favor, digite apenas números, sem pontos nem traços.\n👉 Exemplo: 00516400320',
      };
    } else {
      return {
        step: 'contract_cpf',
        message: 'Por favor, digite seu CPF com apenas números.\n\n👉 Exemplo: 00516400320',
      };
    }
  }

  /**
   * Manipula cliente existente
   */
  private handleExistingClient(message: string): ConversationStep | null {
    if (message === '1') {
      // Aderir a nova turma
      return {
        step: 'contract_class_code',
        message: 'Perfeito! Vamos cadastrar você em uma nova turma.\n\nDigite o código da turma que deseja aderir:',
      };
    } else if (message === '2') {
      // Menu do cliente
      return {
        step: 'main_menu',
        message: 'Bem-vindo ao seu menu de cliente! Aqui você pode acessar todas as suas informações e serviços.',
        optionList: {
          title: 'Opções disponíveis',
          buttonLabel: 'Abrir lista de opções',
          options: [
            {
              id: '1',
              title: 'Assinar meu contrato',
              description: 'Assinatura digital ou pendências de contrato.'
            },
            {
              id: '2',
              title: 'Cobrança ou Pagamentos',
              description: 'Dúvidas sobre boletos, PIX ou faturas.'
            },
            {
              id: '3',
              title: 'Edição de Fotos ou Álbum',
              description: 'Solicitar revisões, prazos ou acompanhar andamento.'
            },
            {
              id: '4',
              title: 'Administrativo',
              description: 'Questões internas ou documentos administrativos.'
            },
            {
              id: '5',
              title: 'Solicitar um Orçamento',
              description: 'Monte seu pacote personalizado com nossa equipe.'
            },
            {
              id: '6',
              title: 'Faço parte da comissão (Agendar reunião)',
              description: 'Agendar uma reunião com a equipe responsável.'
            },
            {
              id: '7',
              title: 'Falar com um atendente',
              description: 'Conversar diretamente com nossa equipe de suporte.'
            }
          ]
        }
      };
    } else {
      return {
        step: 'contract_existing_client',
        message: 'Por favor, escolha uma das opções disponíveis.',
        optionList: {
          title: 'Opções disponíveis',
          buttonLabel: 'Abrir lista de opções',
          options: [
            {
              id: '1',
              title: 'Aderir a uma nova turma',
              description: 'Cadastrar-se em uma nova turma.'
            },
            {
              id: '2',
              title: 'Acessar o menu do cliente',
              description: 'Acessar suas informações e serviços.'
            }
          ]
        }
      };
    }
  }

  /**
   * Menu estrito para cliente já existente (evita textos livres fora de contexto)
   */
  private handleExistingClientMenu(message: string): ConversationStep | null {
    const m = message.trim();
    if (m === '2' || m === 'billing') {
      return {
        step: 'billing_cpf',
        message: 'Para consultar suas cobranças e pagamentos, por favor informe seu CPF (apenas números).',
      };
    }
    if (m === '7') {
      return this.getSupportStep();
    }
    if (m === 'menu') {
      return this.getWelcomeStep();
    }
    // Ignora entradas não reconhecidas
    return null;
  }

  /**
   * Manipula código da turma
   */
  private async handleClassCode(message: string, phone: string): Promise<ConversationStep | null> {
    const turmaId = message.trim();
    
    logger.info('Processando código da turma', {
      turmaId,
    });

    if (!turmaId) {
      return {
        step: 'contract_class_code',
        message: 'Por favor, digite o código da sua turma.',
      };
    }

           // Verificar se a turma existe no sistema principal
           const turma = await this.mettaApiService.checkTurmaExists(turmaId);
    
    if (turma) {
      // Salvar ID da turma na sessão (não o código)
      await this.updateClienteData(phone, 'turmaId', turma.id);
      
      // Prosseguir para coleta de dados
      return {
        step: 'contract_name',
        message: `✅ Turma encontrada!\n\nTurma: ${turma.nomeTurma}\nUniversidade: ${turma.universidade}\nCurso: ${turma.curso}\n\nAgora vamos coletar seus dados pessoais.\n\nDigite seu nome completo:`,
      };
    } else {
      // Controle de tentativas inválidas
      const session = await this.getOrCreateSession(phone);
      const tentativas = (session.data?.tentativasTurma || 0) + 1;
      await this.updateSession(phone, 'contract_class_code', message, { ...session.data, tentativasTurma: tentativas });

      if (tentativas >= 3) {
        return this.getSupportStep();
      }

      return {
        step: 'contract_class_code',
        message: '❌ Código da turma não encontrado. Verifique o código e tente novamente.\n\nDigite o código da sua turma:',
      };
    }
  }

  /**
   * Manipula nome completo
   */
  private async handleName(message: string, phone: string): Promise<ConversationStep | null> {
    const nome = message.trim();
    
    if (!nome || nome.length < 2) {
      return {
        step: 'contract_name',
        message: 'Por favor, digite seu nome completo (mínimo 2 caracteres).',
      };
    }

    // Salvar nome na sessão
    const nomeNormalizado = nome.normalize('NFC');
    await this.updateClienteData(phone, 'nomeCompleto', nomeNormalizado);

    return {
      step: 'contract_email',
      message: `✅ Nome registrado: ${nomeNormalizado}\n\nAgora digite seu e-mail:`,
    };
  }

  /**
   * Manipula e-mail
   */
  private async handleEmail(message: string, phone: string): Promise<ConversationStep | null> {
    const email = message.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!email || !emailRegex.test(email)) {
      return {
        step: 'contract_email',
        message: 'Por favor, digite um e-mail válido.\n\nExemplo: usuario@email.com',
      };
    }

    // Salvar email na sessão
    await this.updateClienteData(phone, 'email', email);

    return {
      step: 'contract_cep',
      message: `✅ E-mail registrado: ${email}\n\nAgora digite seu CEP (apenas números):\n\n👉 Exemplo: 65000000`,
    };
  }

  /**
   * Manipula CEP
   */
  private async handleCep(message: string, phone: string): Promise<ConversationStep | null> {
    const cepNumbers = message.replace(/\D/g, '');
    
    if (cepNumbers.length !== 8) {
      return {
        step: 'contract_cep',
        message: '❌ CEP deve ter exatamente 8 dígitos. Você digitou ' + cepNumbers.length + ' números.\n\nDigite apenas números do CEP.\n👉 Exemplo: 65000000',
      };
    }

    // Salvar CEP na sessão
    const cepFormatado = this.formatCEP(cepNumbers);
    await this.updateClienteData(phone, 'cep', cepFormatado);

    return {
      step: 'contract_address',
      message: `✅ CEP registrado: ${cepFormatado}\n\nAgora digite sua rua e número da casa (separados por vírgula):\n\n👉 Exemplo: Rua das Flores, 123`,
    };
  }

  /**
   * Manipula endereço (rua e número)
   */
  private async handleAddress(message: string, phone: string): Promise<ConversationStep | null> {
    const endereco = message.trim();
    
    if (!endereco || !endereco.includes(',')) {
      return {
        step: 'contract_address',
        message: 'Por favor, digite sua rua e número separados por vírgula.\n\n👉 Exemplo: Rua das Flores, 123',
      };
    }

    const [rua, numero] = endereco.split(',').map(part => part.trim());
    
    if (!rua || !numero) {
      return {
        step: 'contract_address',
        message: 'Por favor, digite sua rua e número separados por vírgula.\n\n👉 Exemplo: Rua das Flores, 123',
      };
    }

    // Salvar endereço na sessão
    const enderecoNormalizado = endereco.normalize('NFC');
    await this.updateClienteData(phone, 'endereco', enderecoNormalizado);

    return {
      step: 'contract_neighborhood',
      message: `✅ Endereço registrado: ${enderecoNormalizado}\n\nAgora digite seu bairro:`,
    };
  }

  /**
   * Manipula bairro
   */
  private async handleNeighborhood(message: string, phone: string): Promise<ConversationStep | null> {
    const bairro = message.trim();
    
    if (!bairro || bairro.length < 2) {
      return {
        step: 'contract_neighborhood',
        message: 'Por favor, digite seu bairro (mínimo 2 caracteres).',
      };
    }

    // Salvar bairro na sessão
    const bairroNormalizado = bairro.normalize('NFC');
    await this.updateClienteData(phone, 'bairro', bairroNormalizado);

    return {
      step: 'contract_city',
      message: `✅ Bairro registrado: ${bairroNormalizado}\n\nAgora digite sua cidade:`,
    };
  }

  /**
   * Manipula cidade
   */
  private async handleCity(message: string, phone: string): Promise<ConversationStep | null> {
    const cidade = message.trim();
    
    if (!cidade || cidade.length < 2) {
      return {
        step: 'contract_city',
        message: 'Por favor, digite sua cidade (mínimo 2 caracteres).',
      };
    }

    // Salvar cidade na sessão
    const cidadeNormalizada = cidade.normalize('NFC');
    await this.updateClienteData(phone, 'cidade', cidadeNormalizada);

    return {
      step: 'contract_state',
      message: `✅ Cidade registrada: ${cidadeNormalizada}\n\nAgora selecione seu estado:`,
      optionList: {
        title: 'Estados brasileiros',
        buttonLabel: 'Selecionar estado',
        options: [
          { id: 'AC', title: 'Acre', description: 'AC' },
          { id: 'AL', title: 'Alagoas', description: 'AL' },
          { id: 'AP', title: 'Amapá', description: 'AP' },
          { id: 'AM', title: 'Amazonas', description: 'AM' },
          { id: 'BA', title: 'Bahia', description: 'BA' },
          { id: 'CE', title: 'Ceará', description: 'CE' },
          { id: 'DF', title: 'Distrito Federal', description: 'DF' },
          { id: 'ES', title: 'Espírito Santo', description: 'ES' },
          { id: 'GO', title: 'Goiás', description: 'GO' },
          { id: 'MA', title: 'Maranhão', description: 'MA' },
          { id: 'MT', title: 'Mato Grosso', description: 'MT' },
          { id: 'MS', title: 'Mato Grosso do Sul', description: 'MS' },
          { id: 'MG', title: 'Minas Gerais', description: 'MG' },
          { id: 'PA', title: 'Pará', description: 'PA' },
          { id: 'PB', title: 'Paraíba', description: 'PB' },
          { id: 'PR', title: 'Paraná', description: 'PR' },
          { id: 'PE', title: 'Pernambuco', description: 'PE' },
          { id: 'PI', title: 'Piauí', description: 'PI' },
          { id: 'RJ', title: 'Rio de Janeiro', description: 'RJ' },
          { id: 'RN', title: 'Rio Grande do Norte', description: 'RN' },
          { id: 'RS', title: 'Rio Grande do Sul', description: 'RS' },
          { id: 'RO', title: 'Rondônia', description: 'RO' },
          { id: 'RR', title: 'Roraima', description: 'RR' },
          { id: 'SC', title: 'Santa Catarina', description: 'SC' },
          { id: 'SP', title: 'São Paulo', description: 'SP' },
          { id: 'SE', title: 'Sergipe', description: 'SE' },
          { id: 'TO', title: 'Tocantins', description: 'TO' }
        ]
      }
    };
  }

  /**
   * Manipula estado
   */
  private async handleState(message: string, phone: string): Promise<ConversationStep | null> {
    const estados = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    
    if (!estados.includes(message.toUpperCase())) {
      return {
        step: 'contract_state',
        message: 'Por favor, selecione um estado válido da lista.',
        optionList: {
          title: 'Estados brasileiros',
          buttonLabel: 'Selecionar estado',
          options: [
            { id: 'AC', title: 'Acre', description: 'AC' },
            { id: 'AL', title: 'Alagoas', description: 'AL' },
            { id: 'AP', title: 'Amapá', description: 'AP' },
            { id: 'AM', title: 'Amazonas', description: 'AM' },
            { id: 'BA', title: 'Bahia', description: 'BA' },
            { id: 'CE', title: 'Ceará', description: 'CE' },
            { id: 'DF', title: 'Distrito Federal', description: 'DF' },
            { id: 'ES', title: 'Espírito Santo', description: 'ES' },
            { id: 'GO', title: 'Goiás', description: 'GO' },
            { id: 'MA', title: 'Maranhão', description: 'MA' },
            { id: 'MT', title: 'Mato Grosso', description: 'MT' },
            { id: 'MS', title: 'Mato Grosso do Sul', description: 'MS' },
            { id: 'MG', title: 'Minas Gerais', description: 'MG' },
            { id: 'PA', title: 'Pará', description: 'PA' },
            { id: 'PB', title: 'Paraíba', description: 'PB' },
            { id: 'PR', title: 'Paraná', description: 'PR' },
            { id: 'PE', title: 'Pernambuco', description: 'PE' },
            { id: 'PI', title: 'Piauí', description: 'PI' },
            { id: 'RJ', title: 'Rio de Janeiro', description: 'RJ' },
            { id: 'RN', title: 'Rio Grande do Norte', description: 'RN' },
            { id: 'RS', title: 'Rio Grande do Sul', description: 'RS' },
            { id: 'RO', title: 'Rondônia', description: 'RO' },
            { id: 'RR', title: 'Roraima', description: 'RR' },
            { id: 'SC', title: 'Santa Catarina', description: 'SC' },
            { id: 'SP', title: 'São Paulo', description: 'SP' },
            { id: 'SE', title: 'Sergipe', description: 'SE' },
            { id: 'TO', title: 'Tocantins', description: 'TO' }
          ]
        }
      };
    }

    // Coletar todos os dados da sessão e criar o aluno
    const session = await this.getOrCreateSession(phone);
    const clienteData = session.data?.clienteData;
    
    if (!clienteData) {
    return {
      step: 'main_menu',
        message: '❌ Erro: Dados do cliente não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Extrair rua e número do endereço
    const endereco = clienteData.endereco || '';
    const [rua, numero] = endereco.split(',').map((part: string) => part.trim());
    
    // Criar o cliente no banco de dados
    const novoCliente = await this.mettaApiService.createAluno({
      cpf: clienteData.cpf,
      telefone: session.phone,
      cep: clienteData.cep,
      rua: rua || '',
      numero: numero || '',
      bairro: clienteData.bairro,
      cidade: clienteData.cidade,
      uf: message.toUpperCase(),
      email: clienteData.email,
      nomeCompleto: clienteData.nomeCompleto,
      turmaId: clienteData.turmaId,
    });

    if (!novoCliente) {
      return {
        step: 'main_menu',
        message: '❌ Erro ao criar cliente no banco de dados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Salvar ID do aluno criado na sessão para uso nos pagamentos
    await this.updateClienteData(phone, 'id', novoCliente.id);

    // Chamar getContractConfirmedStep para exibir os itens automaticamente
    logger.info('Cliente cadastrado com sucesso, exibindo itens de pacote', {
      phone: session.phone,
      clienteId: novoCliente.id,
    });
    
    return await this.getContractConfirmedStep(session.phone);
  }

  /**
   * Valida CPF usando algoritmo oficial
   */
  private isValidCPF(cpf: string): boolean {
    // Verificar se todos os dígitos são iguais
    if (/^(\d)\1{10}$/.test(cpf)) {
      return false;
    }

    // Calcular primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let remainder = sum % 11;
    let digit1 = remainder < 2 ? 0 : 11 - remainder;

    // Calcular segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cpf.charAt(i)) * (11 - i);
    }
    remainder = sum % 11;
    let digit2 = remainder < 2 ? 0 : 11 - remainder;

    // Verificar se os dígitos calculados coincidem com os fornecidos
    return digit1 === parseInt(cpf.charAt(9)) && digit2 === parseInt(cpf.charAt(10));
  }

  /**
   * Passo de contrato confirmado - inicia seleção de pacotes
   */
  private async getContractConfirmedStep(phone: string): Promise<ConversationStep> {
    // Buscar configuração da turma para mostrar itens customizados
    const session = await this.getOrCreateSession(phone);
    const turmaId = session.data?.clienteData?.turmaId;
    
    if (!turmaId) {
    return {
      step: 'main_menu',
        message: '❌ Erro: Turma não encontrada. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    const configuracao = await this.mettaApiService.getConfiguracaoTurma(turmaId);
    
    if (!configuracao) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Configuração da turma não encontrada. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Buscar itens configurados da turma
    let itensCustomizados = await this.mettaDatabaseService.getItensCustomizados(configuracao.id);
    if (!itensCustomizados || itensCustomizados.length === 0) {
      // Fallback: tentar API caso DB não retorne
      itensCustomizados = await this.mettaApiService.getItensCustomizados(turmaId);
    }
    if (!itensCustomizados || itensCustomizados.length === 0) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Nenhum item disponível para esta turma. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Salvar configuracaoTurmaId na sessão
    await this.updatePackageData(phone, 'configuracaoTurmaId', configuracao.id);

    // Construir mensagem com lista numerada de itens
    let mensagem = '🎉 Cliente cadastrado com sucesso!\n\nAgora vamos escolher seu pacote personalizado.\n\n';
    mensagem += '📦 **Itens Disponíveis:**\n\n';
    
    itensCustomizados.forEach((item, index) => {
      const numero = index + 1;
      const valor = typeof item.valor === 'number' ? `R$ ${item.valor.toFixed(2)}` : 'Consultar';
      mensagem += `${numero}. ${item.nome} - ${valor}\n\n`;
    });

    mensagem += '💡 **Como selecionar:**\n';
    mensagem += 'Digite os números dos itens que deseja, separados por vírgula.\n';
    mensagem += '📝 Exemplo: 1, 3, 5\n\n';
    mensagem += 'Você pode escolher quantos itens quiser!';

    return {
      step: 'package_selection',
      message: mensagem,
    };
  }

  /**
   * Processa seleção de itens do pacote
   */
  private async handlePackageSelection(message: string, phone: string): Promise<ConversationStep | null> {
    const session = await this.getOrCreateSession(phone);
    const clienteData = session.data?.clienteData;
    const pacoteData = session.data?.pacoteData;
    
    if (!clienteData || !pacoteData?.configuracaoTurmaId) {
    return {
      step: 'main_menu',
        message: '❌ Erro: Dados não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Buscar itens customizados (usar a mesma fonte do passo anterior para consistência)
    const turmaId = clienteData.turmaId;
    let itensCustomizados = await this.mettaApiService.getItensCustomizados(turmaId);
    if (!itensCustomizados || itensCustomizados.length === 0) {
      // Fallback para base local se API não retornar
      itensCustomizados = await this.mettaDatabaseService.getItensCustomizados(pacoteData.configuracaoTurmaId);
    }
    
    if (!itensCustomizados || itensCustomizados.length === 0) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Nenhum item disponível. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Processar seleção (números separados por vírgula)
    const numerosStr = message.replace(/\s/g, ''); // Remover espaços
    const numeros = numerosStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    
    if (numeros.length === 0) {
      return {
        step: 'package_selection',
        message: '❌ Por favor, digite os números dos itens separados por vírgula.\n\n📝 Exemplo: 1, 2, 3',
      };
    }

    // Validar números selecionados
    const numerosInvalidos = numeros.filter(n => n < 1 || n > itensCustomizados.length);
    if (numerosInvalidos.length > 0) {
      return {
        step: 'package_selection',
        message: `❌ Número(s) inválido(s): ${numerosInvalidos.join(', ')}\n\nPor favor, escolha números entre 1 e ${itensCustomizados.length}.`,
      };
    }

    // Buscar itens selecionados
    const itensSelecionados = numeros.map(n => itensCustomizados[n - 1]);
    const valorTotal = itensSelecionados.reduce((total, item) => total + (item.valor || 0), 0);

    // Salvar seleção na sessão (objetos completos para cálculo/descrição posterior)
    await this.updatePackageData(phone, 'itensSelecionados', itensSelecionados);
    await this.updatePackageData(phone, 'valorTotal', valorTotal);

    // Construir mensagem de confirmação
    let mensagem = '📋 **RESUMO DO SEU PACOTE:**\n\n';
    mensagem += '📦 **Itens selecionados:**\n\n';
    
    itensSelecionados.forEach((item, index) => {
      const valor = item.valor ? `R$ ${item.valor.toFixed(2)}` : 'Consultar';
      mensagem += `${index + 1}. ${item.nome} - ${valor}\n\n`;
    });

    mensagem += `💰 **VALOR TOTAL: R$ ${valorTotal.toFixed(2)}**\n\n`;
    mensagem += '✅ Confirma este pacote?';

    return {
      step: 'package_confirmation',
      message: mensagem,
      optionList: {
        title: 'Confirmar Pacote',
        buttonLabel: 'Confirmar',
        options: [
          {
            id: 'sim',
            title: 'Sim, confirmar',
            description: 'Prosseguir com este pacote'
          },
          {
            id: 'nao',
            title: 'Não, alterar',
            description: 'Refazer as escolhas'
          }
        ]
      }
    };
  }

  /**
   * Processa seleção do tamanho do álbum
   */
  private async handlePackageAlbumSize(message: string, phone: string): Promise<ConversationStep | null> {
    const albumSize = message.toLowerCase();
    
    if (!['25x30', '30x30', '30x40'].includes(albumSize)) {
      return {
        step: 'package_album_size',
        message: '❌ Opção inválida. Por favor, escolha um dos tamanhos disponíveis.',
        optionList: {
          title: 'Tamanhos de Álbum Disponíveis',
          buttonLabel: 'Escolher tamanho',
          options: [
            { id: '25x30', title: 'Álbum 25x30', description: 'Tamanho padrão' },
            { id: '30x30', title: 'Álbum 30x30', description: 'Tamanho quadrado' },
            { id: '30x40', title: 'Álbum 30x40', description: 'Tamanho retangular' }
          ]
        }
      };
    }

    // Salvar escolha do álbum
    const session = await this.getOrCreateSession(phone);
    await this.updatePackageData(phone, 'albumSize', albumSize);

    // Buscar configuração para mostrar opções de quantidade de fotos
    const turmaId = session.data?.clienteData?.turmaId;
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(turmaId!);

    return {
      step: 'package_photo_quantity',
      message: `✅ Álbum ${albumSize} selecionado!\n\n📷 **Agora escolha a quantidade de fotos:**`,
      optionList: {
        title: 'Quantidade de Fotos',
        buttonLabel: 'Escolher quantidade',
        options: [
          {
            id: '60',
            title: '60 fotos',
            description: `R$ ${configuracao?.valorFoto60.toFixed(2) || '0.00'}`
          },
          {
            id: '80',
            title: '80 fotos',
            description: `R$ ${configuracao?.valorFoto80.toFixed(2) || '0.00'}`
          },
          {
            id: '100',
            title: '100 fotos',
            description: `R$ ${configuracao?.valorFoto100.toFixed(2) || '0.00'}`
          }
        ]
      }
    };
  }

  /**
   * Processa seleção da quantidade de fotos
   */
  private async handlePackagePhotoQuantity(message: string, phone: string): Promise<ConversationStep | null> {
    const photoQuantity = message.toLowerCase();
    
    if (!['60', '80', '100'].includes(photoQuantity)) {
      return {
        step: 'package_photo_quantity',
        message: '❌ Opção inválida. Por favor, escolha uma das quantidades disponíveis.',
        optionList: {
          title: 'Quantidade de Fotos',
          buttonLabel: 'Escolher quantidade',
          options: [
            { id: '60', title: '60 fotos', description: 'Pacote básico' },
            { id: '80', title: '80 fotos', description: 'Pacote intermediário' },
            { id: '100', title: '100 fotos', description: 'Pacote completo' }
          ]
        }
      };
    }

    // Salvar escolha da quantidade de fotos
    const session = await this.getOrCreateSession(phone);
    await this.updatePackageData(phone, 'photoQuantity', photoQuantity);

    // Buscar configuração para mostrar opções de extras
    const turmaId = session.data?.clienteData?.turmaId;
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(turmaId!);

    return {
      step: 'package_extras',
      message: `✅ ${photoQuantity} fotos selecionadas!\n\n✨ **Agora escolha os extras (pode escolher múltiplos):**`,
      optionList: {
        title: 'Extras Disponíveis',
        buttonLabel: 'Escolher extras',
        options: [
          {
            id: 'capa_acrilico',
            title: 'Capa Acrílico',
            description: `R$ ${configuracao?.valorExtraCapaAcrilico.toFixed(2) || '0.00'}`
          },
          {
            id: 'madeira',
            title: 'Capa Madeira',
            description: `R$ ${configuracao?.valorExtraMadeira.toFixed(2) || '0.00'}`
          },
          {
            id: 'couro',
            title: 'Capa Couro',
            description: `R$ ${configuracao?.valorExtraCouro.toFixed(2) || '0.00'}`
          },
          {
            id: 'marcadores',
            title: 'Marcadores',
            description: `R$ ${configuracao?.valorExtraMarcadores.toFixed(2) || '0.00'}`
          },
          {
            id: 'box',
            title: 'Box',
            description: `R$ ${configuracao?.valorExtraBox.toFixed(2) || '0.00'}`
          },
          {
            id: 'nenhum',
            title: 'Nenhum extra',
            description: 'Continuar sem extras'
          }
        ]
      }
    };
  }

  /**
   * Processa seleção dos extras
   */
  private async handlePackageExtras(message: string, phone: string): Promise<ConversationStep | null> {
    const extra = message.toLowerCase();
    
    if (extra === 'nenhum') {
      // Salvar que não escolheu extras
      await this.updatePackageData(phone, 'extras', []);
      
      // Verificar se há itens customizados
      const session = await this.getOrCreateSession(phone);
      const turmaId = session.data?.clienteData?.turmaId;
      const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(turmaId!);
      
      if (configuracao) {
        const itensCustomizados = await this.mettaDatabaseService.getItensCustomizados(configuracao.id);
        
        if (itensCustomizados.length > 0) {
          return {
            step: 'package_custom_items',
            message: `✅ Nenhum extra selecionado!\n\n🎁 **Itens personalizados disponíveis para sua turma:**`,
            optionList: {
              title: 'Itens Personalizados',
              buttonLabel: 'Escolher itens',
              options: [
                ...itensCustomizados.map(item => ({
                  id: item.id,
                  title: item.nome,
                  description: `R$ ${item.valor.toFixed(2)}`
                })),
                {
                  id: 'nenhum',
                  title: 'Nenhum item personalizado',
                  description: 'Continuar sem itens personalizados'
                }
              ]
            }
          };
        }
      }
      
      // Ir direto para confirmação se não há itens customizados
      return await this.handlePackageConfirmation('', phone);
    }

    const validExtras = ['capa_acrilico', 'madeira', 'couro', 'marcadores', 'box'];
    
    if (!validExtras.includes(extra)) {
      return {
        step: 'package_extras',
        message: '❌ Opção inválida. Por favor, escolha um dos extras disponíveis.',
        optionList: {
          title: 'Extras Disponíveis',
          buttonLabel: 'Escolher extras',
          options: [
            { id: 'capa_acrilico', title: 'Capa Acrílico', description: 'Capa transparente' },
            { id: 'madeira', title: 'Capa Madeira', description: 'Capa de madeira' },
            { id: 'couro', title: 'Capa Couro', description: 'Capa de couro' },
            { id: 'marcadores', title: 'Marcadores', description: 'Marcadores de página' },
            { id: 'box', title: 'Box', description: 'Caixa para o álbum' },
            { id: 'nenhum', title: 'Nenhum extra', description: 'Continuar sem extras' }
          ]
        }
      };
    }

    // Salvar escolha do extra
    const session = await this.getOrCreateSession(phone);
    const currentExtras = session.data?.pacoteData?.extras || [];
    const newExtras = [...currentExtras, extra];
    await this.updatePackageData(phone, 'extras', newExtras);

    return {
      step: 'package_extras',
      message: `✅ ${extra.replace('_', ' ')} adicionado!\n\n✨ **Escolha mais extras ou continue:**`,
      optionList: {
        title: 'Extras Disponíveis',
        buttonLabel: 'Escolher mais extras',
        options: [
          { id: 'capa_acrilico', title: 'Capa Acrílico', description: 'Capa transparente' },
          { id: 'madeira', title: 'Capa Madeira', description: 'Capa de madeira' },
          { id: 'couro', title: 'Capa Couro', description: 'Capa de couro' },
          { id: 'marcadores', title: 'Marcadores', description: 'Marcadores de página' },
          { id: 'box', title: 'Box', description: 'Caixa para o álbum' },
          { id: 'continuar', title: 'Continuar', description: 'Finalizar seleção de extras' }
        ]
      }
    };
  }

  /**
   * Processa seleção de itens customizados
   */
  private async handlePackageCustomItems(message: string, phone: string): Promise<ConversationStep | null> {
    if (message.toLowerCase() === 'nenhum') {
      // Salvar que não escolheu itens customizados
      await this.updatePackageData(phone, 'customItems', []);
      
      // Ir para confirmação
      return await this.handlePackageConfirmation('', phone);
    }

    // Verificar se é um ID válido de item customizado
    const session = await this.getOrCreateSession(phone);
    const turmaId = session.data?.clienteData?.turmaId;
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(turmaId!);
    
    if (configuracao) {
      const itensCustomizados = await this.mettaDatabaseService.getItensCustomizados(configuracao.id);
      const itemSelecionado = itensCustomizados.find(item => item.id === message);
      
      if (itemSelecionado) {
        // Salvar escolha do item customizado
        const currentCustomItems = session.data?.pacoteData?.customItems || [];
        const newCustomItems = [...currentCustomItems, message];
        await this.updatePackageData(phone, 'customItems', newCustomItems);

        return {
          step: 'package_custom_items',
          message: `✅ ${itemSelecionado.nome} adicionado!\n\n🎁 **Escolha mais itens personalizados ou continue:**`,
          optionList: {
            title: 'Itens Personalizados',
            buttonLabel: 'Escolher mais itens',
            options: [
              ...itensCustomizados.map(item => ({
                id: item.id,
                title: item.nome,
                description: `R$ ${item.valor.toFixed(2)}`
              })),
              {
                id: 'continuar',
                title: 'Continuar',
                description: 'Finalizar seleção de itens personalizados'
              }
            ]
          }
        };
      }
    }

    return {
      step: 'package_custom_items',
      message: '❌ Opção inválida. Por favor, escolha um dos itens disponíveis.',
      optionList: {
        title: 'Itens Personalizados',
        buttonLabel: 'Escolher itens',
        options: [
          { id: 'nenhum', title: 'Nenhum item personalizado', description: 'Continuar sem itens personalizados' }
        ]
      }
    };
  }

  /**
   * Processa confirmação do pacote
   */
  private async handlePackageConfirmation(message: string, phone: string): Promise<ConversationStep | null> {
    const messageLower = message.toLowerCase();
    
    // Se confirmou, ir para seleção de método de pagamento
    if (messageLower === 'confirmo' || messageLower === 'sim' || messageLower === 'confirmar') {
      return await this.handlePaymentMethod('', phone);
    }
    
    // Se quer editar, voltar para seleção de itens
    if (messageLower === 'editar' || messageLower === 'nao' || messageLower === 'alterar') {
      return await this.getContractConfirmedStep(phone);
    }

    // Mostrar resumo do pacote
    const session = await this.getOrCreateSession(phone);
    const pacoteData = session.data?.pacoteData;
    const clienteData = session.data?.clienteData;
    
    if (!pacoteData || !clienteData) {
    return {
      step: 'main_menu',
        message: '❌ Erro: Dados do pacote não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Buscar configuração para calcular valores
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(clienteData.turmaId);
    const itensCustomizados = configuracao ? await this.mettaDatabaseService.getItensCustomizados(configuracao.id) : [];

    let resumo = `📋 **RESUMO DO SEU PACOTE:**\n\n`;
    let valorTotal = 0;

    // Álbum
    if (pacoteData.albumSize) {
      const valorAlbum = configuracao ? 
        (pacoteData.albumSize === '25x30' ? configuracao.valorAlbum25x30 :
         pacoteData.albumSize === '30x30' ? configuracao.valorAlbum30x30 :
         configuracao.valorAlbum30x40) : 0;
      resumo += `📸 Álbum ${pacoteData.albumSize}: R$ ${valorAlbum.toFixed(2)}\n`;
      valorTotal += valorAlbum;
    }

    // Fotos
    if (pacoteData.photoQuantity) {
      const valorFotos = configuracao ?
        (pacoteData.photoQuantity === '60' ? configuracao.valorFoto60 :
         pacoteData.photoQuantity === '80' ? configuracao.valorFoto80 :
         configuracao.valorFoto100) : 0;
      resumo += `📷 ${pacoteData.photoQuantity} fotos: R$ ${valorFotos.toFixed(2)}\n`;
      valorTotal += valorFotos;
    }

    // Extras
    if (pacoteData.extras && pacoteData.extras.length > 0) {
      resumo += `✨ Extras:\n`;
      pacoteData.extras.forEach((extra: string) => {
        const valorExtra = configuracao ?
          (extra === 'capa_acrilico' ? configuracao.valorExtraCapaAcrilico :
           extra === 'madeira' ? configuracao.valorExtraMadeira :
           extra === 'couro' ? configuracao.valorExtraCouro :
           extra === 'marcadores' ? configuracao.valorExtraMarcadores :
           configuracao.valorExtraBox) : 0;
        resumo += `   • ${extra.replace('_', ' ')}: R$ ${valorExtra.toFixed(2)}\n`;
        valorTotal += valorExtra;
      });
    }

    // Itens customizados
    if (pacoteData.customItems && pacoteData.customItems.length > 0) {
      resumo += `🎁 Itens personalizados:\n`;
      pacoteData.customItems.forEach((itemId: string) => {
        const item = itensCustomizados.find(i => i.id === itemId);
        if (item) {
          resumo += `   • ${item.nome}: R$ ${item.valor.toFixed(2)}\n`;
          valorTotal += item.valor;
        }
      });
    }

    resumo += `\n💰 **VALOR TOTAL: R$ ${valorTotal.toFixed(2)}**\n\n`;
    resumo += `✅ Confirma este pacote?`;

    return {
      step: 'package_confirmation',
      message: resumo,
      optionList: {
        title: 'Confirmar Pacote',
        buttonLabel: 'Confirmar',
        options: [
          {
            id: 'sim',
            title: 'Sim, confirmar',
            description: 'Prosseguir com este pacote'
          },
          {
            id: 'nao',
            title: 'Não, alterar',
            description: 'Refazer as escolhas'
          }
        ]
      }
    };
  }

  /**
   * Fluxo de cobrança: solicita e valida CPF e retorna resumo financeiro
   */
  private async handleBillingCpf(message: string, phone: string): Promise<ConversationStep | null> {
    // Garantir que só processa quando o step atual é billing_cpf
    const s = await this.getOrCreateSession(phone);
    if (s.currentStep !== 'billing_cpf') {
      logger.info('Ignorando billing_cpf fora de contexto', { phone, currentStep: s.currentStep });
      return null;
    }

    // Usar message ou, se vazio/curto, tentar extrair do contexto (quando usuário já é identificado)
    const raw = (message || '').toString();
    let cpfNumbers = raw.replace(/\D/g, '');
    if (cpfNumbers.length !== 11) {
      const session = await this.getOrCreateSession(phone);
      const cpfCtx = session.data?.clienteData?.cpf;
      if (cpfCtx && cpfCtx.replace(/\D/g, '').length === 11) {
        cpfNumbers = cpfCtx.replace(/\D/g, '');
      }
    }
    if (cpfNumbers.length !== 11) {
      return {
        step: 'billing_cpf',
        message: 'Por favor, informe um CPF válido com 11 dígitos (apenas números).',
      };
    }

    const aluno = await this.mettaApiService.checkCpfExists(cpfNumbers);
    if (!aluno) {
      return {
        step: 'main_menu',
        message: 'CPF não encontrado. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Placeholder de resumo. Integração detalhada pode consultar cobranças do aluno no Metta.
    const resumo = 'Resumo financeiro:\n- Boletos/PIX pendentes: 0\n- Carnês pendentes: 0';

    return {
      step: 'main_menu',
      message: `Aluno: ${aluno.nomeCompleto} (Turma ${aluno.turmaId})\n\n${resumo}`,
      optionList: this.getMainMenuOptions(),
    };
  }

  /**
   * Processa seleção do método de pagamento
   */
  private async handlePaymentMethod(message: string, phone: string): Promise<ConversationStep | null> {
    const session = await this.getOrCreateSession(phone);
    const clienteData = session.data?.clienteData;
    
    if (!clienteData) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Dados do cliente não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Buscar configuração para mostrar opções de pagamento
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(clienteData.turmaId);
    
    if (!configuracao) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Configuração da turma não encontrada. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    const carneMaxParcelas = configuracao.carneMaxParcelas || 1;

    return {
      step: 'payment_method',
      message: `💳 **Escolha o método de pagamento:**`,
      optionList: {
        title: 'Métodos de Pagamento',
        buttonLabel: 'Escolher método',
        options: [
          {
            id: 'boleto_pix',
            title: 'Boleto/PIX',
            description: 'Pagamento à vista'
          },
          {
            id: 'carne',
            title: `Carnê (em até ${carneMaxParcelas}x)`,
            description: `Parcelamento em até ${carneMaxParcelas}x`
          }
        ]
      }
    };
  }

  /**
   * Processa seleção do método de pagamento
   */
  private async handlePaymentMethodSelection(message: string, phone: string): Promise<ConversationStep | null> {
    const session = await this.getOrCreateSession(phone);
    const clienteData = session.data?.clienteData;
    const pacoteData = session.data?.pacoteData;
    
    if (!clienteData || !pacoteData?.configuracaoTurmaId) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Dados não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    // Buscar configuração para obter número máximo de parcelas
    const configuracao = await this.mettaDatabaseService.getConfiguracaoTurma(clienteData.turmaId);
    
    if (!configuracao) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Configuração da turma não encontrada. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    if (message === 'boleto_pix') {
      // Processar pagamento à vista (Boleto/PIX)
      return await this.processPaymentBoletoPix(phone, configuracao);
    } else if (message === 'carne') {
      // Mostrar opções de parcelamento para Carnê
      return await this.showCarneParcelasOptions(phone, configuracao);
    } else {
      return {
        step: 'payment_method',
        message: '❌ Opção inválida. Por favor, escolha uma das opções disponíveis.',
        optionList: {
          title: 'Métodos de Pagamento',
          buttonLabel: 'Escolher método',
          options: [
            {
              id: 'boleto_pix',
              title: 'Boleto/PIX',
              description: 'Pagamento à vista'
            },
            {
              id: 'carne',
              title: `Carnê (em até ${configuracao.carneMaxParcelas}x)`,
              description: `Parcelamento em até ${configuracao.carneMaxParcelas}x`
            }
          ]
        }
      };
    }
  }

  /**
   * Mostra opções de parcelamento para Carnê
   */
  private async showCarneParcelasOptions(phone: string, configuracao: any): Promise<ConversationStep> {
    const carneMaxParcelas = configuracao.carneMaxParcelas || 1;
    
    // Criar opções de parcelamento (1x até o máximo)
    const parcelasOptions = [];
    for (let i = 1; i <= carneMaxParcelas; i++) {
      parcelasOptions.push({
        id: i.toString(),
        title: `${i}x`,
        description: i === 1 ? 'À vista' : `Parcelamento em ${i} vezes`
      });
    }

    return {
      step: 'carne_parcelas',
      message: `💳 **Escolha a quantidade de parcelas:**\n\nVocê pode parcelar em até ${carneMaxParcelas}x.`,
      optionList: {
        title: 'Quantidade de Parcelas',
        buttonLabel: 'Escolher parcelas',
        options: parcelasOptions
      }
    };
  }

  /**
   * Processa seleção de parcelas do Carnê
   */
  private async handleCarneParcelas(message: string, phone: string): Promise<ConversationStep | null> {
    const session = await this.getOrCreateSession(phone);
    const clienteData = session.data?.clienteData;
    const pacoteData = session.data?.pacoteData;
    
    if (!clienteData || !pacoteData?.configuracaoTurmaId) {
      return {
        step: 'main_menu',
        message: '❌ Erro: Dados não encontrados. Retornando ao menu principal.',
        optionList: this.getMainMenuOptions(),
      };
    }

    const parcelas = parseInt(message);
    
    if (isNaN(parcelas) || parcelas < 1) {
      // Buscar configuração para mostrar opções corretas
      const session = await this.getOrCreateSession(phone);
      const clienteData = session.data?.clienteData;
      const configuracao = clienteData ? await this.mettaDatabaseService.getConfiguracaoTurma(clienteData.turmaId) : null;
      const carneMaxParcelas = configuracao?.carneMaxParcelas || 6;
      
      const parcelasOptions = [];
      for (let i = 1; i <= carneMaxParcelas; i++) {
        parcelasOptions.push({
          id: i.toString(),
          title: `${i}x`,
          description: i === 1 ? 'À vista' : `Parcelamento em ${i} vezes`
        });
      }
      
      return {
        step: 'carne_parcelas',
        message: '❌ Número de parcelas inválido. Por favor, escolha uma opção válida.',
        optionList: {
          title: 'Quantidade de Parcelas',
          buttonLabel: 'Escolher parcelas',
          options: parcelasOptions
        }
      };
    }

    // Salvar número de parcelas na sessão
    await this.updatePackageData(phone, 'parcelas', parcelas);

    // Processar pagamento parcelado (Carnê)
    return await this.processPaymentCarne(phone, parcelas);
  }

  /**
   * Processa pagamento à vista (Boleto/PIX)
   */
  private async processPaymentBoletoPix(phone: string, configuracao: any): Promise<ConversationStep> {
    try {
      const session = await this.getOrCreateSession(phone);
      const clienteData = session.data?.clienteData;
      const pacoteData = session.data?.pacoteData;
      
      if (!clienteData || !pacoteData) {
        throw new Error('Dados do cliente ou pacote não encontrados');
      }

      const valorTotal = pacoteData.valorTotal || 0;
      const itensSelecionados = pacoteData.itensSelecionados || [];

      // Preparar descrição do pacote
      const descricao = this.paymentIntegrationService.formatarDescricaoPacote(
        itensSelecionados.map((item: any) => ({
          nome: item.nome,
          valor: item.valor,
          quantidade: 1
        }))
      );

      // Gerar Bolepix (boleto com PIX embutido) via sistema de pagamentos
      const boletoResponse = await this.paymentIntegrationService.gerarBoleto({
        alunoId: clienteData.id,
        valor: valorTotal,
        descricao: `${descricao} - ${clienteData.nomeCompleto}`,
        message: 'Obrigado por escolher a Metta Studio! 📸✨',
        configurations: {
          fine: 200,    // Multa de 2%
          interest: 133 // Juros de 1,33% ao mês
        }
      });

      if (!boletoResponse.success) {
        throw new Error(boletoResponse.message || 'Erro ao gerar boleto');
      }

      // Montar mensagem com os dados reais
      const mensagem = `💳 **BOLEPIX (Boleto + PIX)**\n\n` +
        `💰 Valor Total: R$ ${valorTotal.toFixed(2)}\n\n` +
        `📋 **Pagamento disponível em boleto e PIX no mesmo título:**\n\n` +
        `**📄 BOLETO**\n` +
        `🔗 Link: ${boletoResponse.data.link}\n` +
        `📱 Código de Barras:\n${boletoResponse.data.barcode}\n\n` +
        (boletoResponse.data.pixQrcode ? `**🔵 PIX (No mesmo boleto)**\n` +
        `🧾 QR Code (imagem): disponível no link do boleto\n` : '') +
        `✅ Seu pedido foi registrado com sucesso!\n\n` +
        `Retornando ao menu principal.`;

      return {
        step: 'main_menu',
        message: mensagem,
        optionList: this.getMainMenuOptions()
      };
    } catch (error: any) {
      logger.error('Erro ao processar pagamento à vista', {
        phone,
        error: error.message
      });

      return {
        step: 'main_menu',
        message: `❌ **Erro ao gerar pagamento**\n\n${error.message}\n\nPor favor, entre em contato com o suporte.\n\nRetornando ao menu principal.`,
        optionList: this.getMainMenuOptions()
      };
    }
  }

  /**
   * Processa pagamento parcelado (Carnê)
   */
  private async processPaymentCarne(phone: string, parcelas: number): Promise<ConversationStep> {
    try {
      const session = await this.getOrCreateSession(phone);
      const clienteData = session.data?.clienteData;
      const pacoteData = session.data?.pacoteData;
      
      if (!clienteData || !pacoteData) {
        throw new Error('Dados do cliente ou pacote não encontrados');
      }

      const valorTotal = pacoteData.valorTotal || 0;
      const valorParcela = valorTotal / parcelas;
      const itensSelecionados = pacoteData.itensSelecionados || [];

      // Preparar descrição do pacote
      const descricao = this.paymentIntegrationService.formatarDescricaoPacote(
        itensSelecionados.map((item: any) => ({
          nome: item.nome,
          valor: item.valor,
          quantidade: 1
        }))
      );

      // Gerar carnê via sistema de pagamentos
      const carneResponse = await this.paymentIntegrationService.gerarCarne({
        alunoId: clienteData.id,
        valor: valorTotal,
        descricao: `${descricao} - ${clienteData.nomeCompleto}`,
        parcelas: parcelas,
        vencimentoPrimeiraParcela: this.calcularVencimentoPadrao(),
        message: 'Obrigado por escolher a Metta Studio! 📸✨',
        configurations: {
          fine: 200,    // Multa de 2%
          interest: 133 // Juros de 1,33% ao mês
        }
      });

      if (!carneResponse.success) {
        throw new Error(carneResponse.message || 'Erro ao gerar carnê');
      }

      // Pegar dados da primeira parcela
      const primeiraParcela = carneResponse.data.parcelas[0];

      // Montar mensagem com os dados reais
      const mensagem = `💳 **PAGAMENTO PARCELADO (Carnê ${parcelas}x)**\n\n` +
        `💰 Valor Total: R$ ${valorTotal.toFixed(2)}\n` +
        `📅 Valor da Parcela: R$ ${valorParcela.toFixed(2)}\n\n` +
        `📋 **1ª Parcela:**\n` +
        `📅 Vencimento: ${new Date(primeiraParcela.vencimento).toLocaleDateString('pt-BR')}\n` +
        `💵 Valor: R$ ${primeiraParcela.valor.toFixed(2)}\n\n` +
        `**📄 BOLETO**\n` +
        `🔗 Link: ${primeiraParcela.link}\n` +
        `📱 Código de Barras:\n${primeiraParcela.barcode}\n\n` +
        `✅ Seu pedido foi registrado com sucesso!\n` +
        `📬 As demais parcelas serão enviadas nos próximos meses.\n\n` +
        `Retornando ao menu principal.`;

      return {
        step: 'main_menu',
        message: mensagem,
        optionList: this.getMainMenuOptions()
      };
    } catch (error: any) {
      logger.error('Erro ao processar pagamento parcelado', {
        phone,
        parcelas,
        error: error.message
      });

      return {
        step: 'main_menu',
        message: `❌ **Erro ao gerar pagamento**\n\n${error.message}\n\nPor favor, entre em contato com o suporte.\n\nRetornando ao menu principal.`,
        optionList: this.getMainMenuOptions()
      };
    }
  }

  /**
   * Atualiza dados do pacote na sessão
   */
  private async updatePackageData(phone: string, key: string, value: any): Promise<void> {
    const session = await this.getOrCreateSession(phone);
    const pacoteData = session.data?.pacoteData || {};
    pacoteData[key] = value;
    
    await this.updateSession(phone, session.currentStep, session.lastMessage || '', {
      ...session.data,
      pacoteData
    });
  }

  /**
   * Retorna as opções do menu principal
   */
  private getMainMenuOptions() {
    return {
      title: 'Opções disponíveis',
      buttonLabel: 'Abrir lista de opções',
      options: [
        {
          id: '1',
          title: 'Assinar meu contrato',
          description: 'Assine aqui seu contrato'
        },
        {
          id: '2',
          title: 'Pagamentos',
          description: 'Verificar pagamentos'
        },
        {
          id: '3',
          title: 'Edição de Fotos ou Álbum',
          description: 'Solicitar revisões, prazos ou acompanhar andamento.'
        },
        {
          id: '4',
          title: 'Administrativo',
          description: 'Questões internas ou documentos administrativos.'
        },
        {
          id: '5',
          title: 'Solicitar um Orçamento',
          description: 'Monte seu pacote personalizado com nossa equipe.'
        },
        {
          id: '6',
          title: 'Faço parte da comissão (Agendar reunião)',
          description: 'Agendar uma reunião com a equipe responsável.'
        },
        {
          id: '7',
          title: 'Falar com um atendente',
          description: 'Conversar diretamente com nossa equipe de suporte.'
        }
      ]
    };
  }

  /**
   * Passo de cobrança/pagamentos
   */
  private getBillingStep(): ConversationStep {
    return {
      step: 'billing_cpf',
      message: 'Para consultar suas cobranças e pagamentos, por favor informe seu CPF (apenas números).',
    };
  }

  /**
   * Passo de edição
   */
  private getEditingStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Você foi direcionado para nossa equipe de pós-produção. Eles entrarão em contato para resolver suas solicitações sobre edição, revisões e prazos.',
      optionList: {
        title: 'Opções disponíveis',
        buttonLabel: 'Abrir lista de opções',
        options: [
          {
            id: '1',
            title: 'Assinar meu contrato',
            description: 'Assinatura digital ou pendências de contrato.'
          },
          {
            id: '2',
            title: 'Cobrança ou Pagamentos',
            description: 'Dúvidas sobre boletos, PIX ou faturas.'
          },
          {
            id: '3',
            title: 'Edição de Fotos ou Álbum',
            description: 'Solicitar revisões, prazos ou acompanhar andamento.'
          },
          {
            id: '4',
            title: 'Administrativo',
            description: 'Questões internas ou documentos administrativos.'
          },
          {
            id: '5',
            title: 'Solicitar um Orçamento',
            description: 'Monte seu pacote personalizado com nossa equipe.'
          },
          {
            id: '6',
            title: 'Faço parte da comissão (Agendar reunião)',
            description: 'Agendar uma reunião com a equipe responsável.'
          },
          {
            id: '7',
            title: 'Falar com um atendente',
            description: 'Conversar diretamente com nossa equipe de suporte.'
          }
        ]
      }
    };
  }

  /**
   * Passo administrativo
   */
  private getAdminStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Você foi direcionado para nossa equipe administrativa. Eles entrarão em contato para resolver suas questões administrativas e documentos.',
      optionList: {
        title: 'Opções disponíveis',
        buttonLabel: 'Abrir lista de opções',
        options: [
          {
            id: '1',
            title: 'Assinar meu contrato',
            description: 'Assinatura digital ou pendências de contrato.'
          },
          {
            id: '2',
            title: 'Cobrança ou Pagamentos',
            description: 'Dúvidas sobre boletos, PIX ou faturas.'
          },
          {
            id: '3',
            title: 'Edição de Fotos ou Álbum',
            description: 'Solicitar revisões, prazos ou acompanhar andamento.'
          },
          {
            id: '4',
            title: 'Administrativo',
            description: 'Questões internas ou documentos administrativos.'
          },
          {
            id: '5',
            title: 'Solicitar um Orçamento',
            description: 'Monte seu pacote personalizado com nossa equipe.'
          },
          {
            id: '6',
            title: 'Faço parte da comissão (Agendar reunião)',
            description: 'Agendar uma reunião com a equipe responsável.'
          },
          {
            id: '7',
            title: 'Falar com um atendente',
            description: 'Conversar diretamente com nossa equipe de suporte.'
          }
        ]
      }
    };
  }

  /**
   * Passo de orçamento
   */
  private getQuoteStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Você foi direcionado para nossa equipe comercial. Eles entrarão em contato para criar um orçamento personalizado para você.',
      optionList: {
        title: 'Opções disponíveis',
        buttonLabel: 'Abrir lista de opções',
        options: [
          {
            id: '1',
            title: 'Assinar meu contrato',
            description: 'Assinatura digital ou pendências de contrato.'
          },
          {
            id: '2',
            title: 'Cobrança ou Pagamentos',
            description: 'Dúvidas sobre boletos, PIX ou faturas.'
          },
          {
            id: '3',
            title: 'Edição de Fotos ou Álbum',
            description: 'Solicitar revisões, prazos ou acompanhar andamento.'
          },
          {
            id: '4',
            title: 'Administrativo',
            description: 'Questões internas ou documentos administrativos.'
          },
          {
            id: '5',
            title: 'Solicitar um Orçamento',
            description: 'Monte seu pacote personalizado com nossa equipe.'
          },
          {
            id: '6',
            title: 'Faço parte da comissão (Agendar reunião)',
            description: 'Agendar uma reunião com a equipe responsável.'
          },
          {
            id: '7',
            title: 'Falar com um atendente',
            description: 'Conversar diretamente com nossa equipe de suporte.'
          }
        ]
      }
    };
  }

  /**
   * Passo de reunião
   */
  private getMeetingStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Você foi direcionado para nosso sistema de agendamento. Nossa equipe entrará em contato para agendar uma reunião com você.',
      optionList: {
        title: 'Opções disponíveis',
        buttonLabel: 'Abrir lista de opções',
        options: [
          {
            id: '1',
            title: 'Assinar meu contrato',
            description: 'Assinatura digital ou pendências de contrato.'
          },
          {
            id: '2',
            title: 'Cobrança ou Pagamentos',
            description: 'Dúvidas sobre boletos, PIX ou faturas.'
          },
          {
            id: '3',
            title: 'Edição de Fotos ou Álbum',
            description: 'Solicitar revisões, prazos ou acompanhar andamento.'
          },
          {
            id: '4',
            title: 'Administrativo',
            description: 'Questões internas ou documentos administrativos.'
          },
          {
            id: '5',
            title: 'Solicitar um Orçamento',
            description: 'Monte seu pacote personalizado com nossa equipe.'
          },
          {
            id: '6',
            title: 'Faço parte da comissão (Agendar reunião)',
            description: 'Agendar uma reunião com a equipe responsável.'
          },
          {
            id: '7',
            title: 'Falar com um atendente',
            description: 'Conversar diretamente com nossa equipe de suporte.'
          }
        ]
      }
    };
  }

  /**
   * Passo de suporte
   */
  private getSupportStep(): ConversationStep {
    return {
      step: 'main_menu',
      message: 'Um atendente irá entrar em contato em breve para dar continuidade ao seu atendimento. Obrigado pelo contato!',
      optionList: this.getMainMenuOptions()
    };
  }

  /**
   * Envia a resposta para o usuário
   */
  private async sendResponse(phone: string, response: ConversationStep): Promise<void> {
    try {
      logger.info('ConversationService.sendResponse - Analisando resposta', {
        phone,
        hasOptionList: !!response.optionList,
        hasList: !!response.list,
        hasButtons: !!response.buttons,
        message: response.message,
      });

      let request: ZApiSendMessageRequest | ZApiSendButtonRequest | ZApiSendListRequest | ZApiSendOptionListRequest;

      if (response.optionList) {
        logger.info('Preparando request com optionList');
        request = {
          phone,
          message: response.message || '',
          optionList: response.optionList,
        } as ZApiSendOptionListRequest;
      } else if (response.list) {
        logger.info('Preparando request com list');
        request = {
          phone,
          message: response.message || '',
          list: response.list,
        } as ZApiSendListRequest;
      } else if (response.buttons) {
        logger.info('Preparando request com buttons');
        request = {
          phone,
          message: response.message || '',
          buttons: response.buttons,
        } as ZApiSendButtonRequest;
      } else {
        logger.info('Preparando request com texto simples');
        request = {
          phone,
          message: response.message || '',
        } as ZApiSendMessageRequest;
      }

      const result = await this.zapiService.sendMessage(request);

      if (result.success) {
        // Log da mensagem enviada
        await this.logMessage({
          phone,
          message: response.message || '',
          direction: 'outgoing',
          messageType: response.optionList ? 'optionList' : response.list ? 'list' : response.buttons ? 'button' : 'text',
        });
      } else {
        logger.error('Erro ao enviar resposta', {
          phone,
          error: result.error,
        });
      }
    } catch (error: any) {
      logger.error('Erro ao enviar resposta', {
        phone,
        error: error.message,
      });
    }
  }

  /**
   * Atualiza a sessão no banco de dados
   */
  private async updateSession(phone: string, step: string, message?: string, data?: any): Promise<void> {
    try {
      // Se Prisma estiver disponível, atualizar banco
      if (this.prisma) {
        try {
          // Usar SQL direto com cast explícito para JSONB
          const contextJson = data ? JSON.stringify(data) : null;
          
          if (contextJson) {
            await this.prisma.$executeRaw`
              INSERT INTO zapflow_sessions (phone, current_step, last_message, context, created_at, updated_at)
              VALUES (${phone}, ${step}, ${message || ''}, ${contextJson}::jsonb, NOW(), NOW())
              ON CONFLICT (phone) 
              DO UPDATE SET 
                current_step = ${step},
                last_message = ${message || ''},
                context = ${contextJson}::jsonb,
                updated_at = NOW()
            `;
          } else {
            await this.prisma.$executeRaw`
              INSERT INTO zapflow_sessions (phone, current_step, last_message, context, created_at, updated_at)
              VALUES (${phone}, ${step}, ${message || ''}, NULL, NOW(), NOW())
              ON CONFLICT (phone) 
              DO UPDATE SET 
                current_step = ${step},
                last_message = ${message || ''},
                context = NULL,
                updated_at = NOW()
            `;
          }
        } catch (error: any) {
          logger.warn('Erro ao atualizar banco de dados, usando apenas Redis', {
          phone,
            step,
            error: error.message,
      });
        }
      }

      // Invalidar cache do Redis (se disponível)
      if (this.redisService) {
        await this.redisService.deleteSession(phone);
        
        // Buscar dados existentes da sessão para preservar
        const existingSession = await this.getOrCreateSession(phone);
        
        // Salvar nova sessão no Redis preservando os dados existentes
        const sessionContext: SessionContext = {
          phone,
          currentStep: step,
          lastMessage: message || '',
          createdAt: existingSession.createdAt,
          updatedAt: new Date(),
          data: data ? { ...existingSession.data, ...data } : existingSession.data,
        };
        await this.redisService.setSession(phone, sessionContext);
      }
    } catch (error: any) {
      logger.error('Erro ao atualizar sessão', {
        phone,
        error: error.message,
      });
    }
  }

  /**
   * Remove sessão do Redis e do banco (quando disponível)
   */
  public async deleteSession(phone: string): Promise<void> {
    try {
      // Remover do Redis
      if (this.redisService) {
        await this.redisService.deleteSession(phone);
      }
      // Remover do banco (se disponível)
      if (this.prisma) {
        await this.prisma.$executeRaw`
          DELETE FROM zapflow_sessions WHERE phone = ${phone}
        `;
      }
      logger.info('Sessão removida (Redis/DB)', { phone });
    } catch (error: any) {
      logger.warn('Falha ao remover sessão (Redis/DB)', { phone, error: error.message });
    }
  }

  /**
   * Registra uma mensagem no log
   */
  private async logMessage(log: {
    phone: string;
    message: string;
    direction: 'incoming' | 'outgoing';
    messageType: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      // Se Prisma estiver disponível, usar banco
      if (this.prisma) {
      // Usar SQL direto para evitar problemas de mapeamento
      await this.prisma.$executeRaw`
        INSERT INTO zapflow_message_logs (phone, message, direction, message_type, metadata, created_at)
        VALUES (${log.phone}, ${log.message}, ${log.direction}, ${log.messageType}, ${log.metadata ? JSON.stringify(log.metadata) : null}, NOW())
      `;
      }
    } catch (error: any) {
      logger.error('Erro ao registrar log de mensagem', {
        phone: log.phone,
        error: error.message,
      });
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
   * Fecha conexões
   */
  async disconnect(): Promise<void> {
    if (this.prisma) {
    await this.prisma.$disconnect();
    }
  }
}

// Tipos para integração com Z-API

export interface ZApiWebhookPayload {
  status: string;
  type: string;
  phone: string;
  message?: string;
  messageType?: string;
  instance?: string;
  timestamp?: number;
  data?: any;
  text?: {
    message: string;
  };
  listResponseMessage?: {
    message: string;
    title: string;
    selectedRowId: string;
  };
  buttonResponseMessage?: {
    buttonId: string;
    message: string;
  };
}

export interface ZApiSendMessageRequest {
  phone: string;
  message: string;
  messageType?: 'text' | 'button' | 'list' | 'image' | 'document';
  options?: {
    delay?: number;
    presence?: 'composing' | 'recording' | 'paused';
  };
}

export interface ZApiSendButtonRequest {
  phone: string;
  message: string;
  buttons: Array<{
    id: string;
    title: string;
  }>;
}

export interface ZApiSendListRequest {
  phone: string;
  message: string;
  list: {
    title: string;
    description: string;
    buttonText: string;
    sections: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

export interface ZApiSendOptionListRequest {
  phone: string;
  message: string;
  optionList: {
    title: string;
    buttonLabel: string;
    options: Array<{
      id: string;
      title: string;
      description: string;
    }>;
  };
}

export interface ZApiSendButtonListRequest {
  phone: string;
  message: string;
  buttonList: {
    buttons: Array<{
      id?: string;
      label: string;
    }>;
  };
}

export interface ZApiResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

// Tipos para controle de conversa

export interface ConversationStep {
  step: string;
  nextSteps?: string[];
  message?: string;
  buttons?: Array<{
    id: string;
    title: string;
  }>;
  list?: {
    title: string;
    description: string;
    buttonText: string;
    sections: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
  optionList?: {
    title: string;
    buttonLabel: string;
    options: Array<{
      id: string;
      title: string;
      description: string;
    }>;
  };
  buttonList?: {
    buttons: Array<{
      id?: string;
      label: string;
    }>;
  };
}

export interface SessionContext {
  phone: string;
  currentStep: string;
  lastMessage?: string;
  data?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  // Dados do cliente sendo cadastrado
  clienteData?: {
    cpf: string;
    nomeCompleto: string;
    email: string;
    cep: string;
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
    turmaId: string;
  };
  // Dados do pacote selecionado
  pacoteData?: {
    albumSize?: string;
    photoQuantity?: string;
    extras?: string[];
    customItems?: string[];
    configuracaoTurmaId?: string;
  };
}

// Tipos para logs e auditoria

export interface MessageLog {
  phone: string;
  message: string;
  direction: 'incoming' | 'outgoing';
  messageType: string;
  metadata?: Record<string, any>;
}

// Tipos para configuração

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl?: string;
  zapi: {
    instance: string;
    token: string;
    clientToken: string;
    baseUrl: string;
  };
  jwt?: {
    secret: string;
  };
  logging: {
    level: string;
  };
}

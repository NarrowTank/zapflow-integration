import axios, { AxiosInstance } from 'axios';
import { config } from '@/config';
import logger from '@/utils/logger';
import {
  ZApiSendMessageRequest,
  ZApiSendButtonRequest,
  ZApiSendListRequest,
  ZApiSendOptionListRequest,
  ZApiSendButtonListRequest,
  ZApiResponse,
} from '@/types';

export class ZApiService {
  private client: AxiosInstance;

  constructor() {
    const baseURL = `${config.zapi.baseUrl}/instances/${config.zapi.instance}/token/${config.zapi.token}`;
    
    logger.info('Z-API Configuration', {
      baseUrl: config.zapi.baseUrl,
      instance: config.zapi.instance,
      token: config.zapi.token ? `${config.zapi.token.substring(0, 8)}...` : 'undefined',
      clientToken: config.zapi.clientToken ? `${config.zapi.clientToken.substring(0, 8)}...` : 'undefined',
      fullBaseURL: baseURL,
    });

    this.client = axios.create({
      baseURL,
      headers: {
        'Client-Token': config.zapi.clientToken,
        'Content-Type': 'application/json; charset=utf-8',
        'Accept-Charset': 'utf-8',
      },
      timeout: 30000,
    });

    // Interceptor para logs
    this.client.interceptors.request.use(
      (config) => {
        logger.info('Z-API Request', {
          method: config.method,
          url: config.url,
          baseURL: config.baseURL,
          fullURL: `${config.baseURL}${config.url}`,
        });
        return config;
      },
      (error) => {
        logger.error('Z-API Request Error', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info('Z-API Response', {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error('Z-API Response Error', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Envia uma mensagem de texto simples
   */
  async sendTextMessage(request: ZApiSendMessageRequest): Promise<ZApiResponse> {
    try {
      const normalizedMessage = (request.message || '').normalize('NFC');
      const payload = {
        phone: request.phone,
        message: normalizedMessage,
        messageType: request.messageType || 'text',
        ...request.options,
      };

      const response = await this.client.post('/send-text', payload);
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao enviar mensagem de texto', {
        phone: request.phone,
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envia uma mensagem com botões
   */
  async sendButtonMessage(request: ZApiSendButtonRequest): Promise<ZApiResponse> {
    try {
      const payload = {
        phone: request.phone,
        message: request.message,
        messageType: 'button',
        instance: config.zapi.instance,
        buttons: request.buttons,
      };

      const response = await this.client.post('/send-button', payload);
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao enviar mensagem com botões', {
        phone: request.phone,
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envia uma mensagem com lista
   */
  async sendListMessage(request: ZApiSendListRequest): Promise<ZApiResponse> {
    try {
      const payload = {
        phone: request.phone,
        message: request.message,
        messageType: 'list',
        instance: config.zapi.instance,
        list: request.list,
      };

      const response = await this.client.post('/send-list', payload);
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao enviar mensagem com lista', {
        phone: request.phone,
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envia uma mensagem com lista de opções
   */
  async sendOptionList(request: ZApiSendOptionListRequest): Promise<ZApiResponse> {
    try {
      const payload = {
        phone: request.phone,
        message: request.message,
        optionList: request.optionList,
      };

      const response = await this.client.post('/send-option-list', payload);
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao enviar mensagem com lista de opções', {
        phone: request.phone,
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verifica o status da instância
   */
  async getInstanceStatus(): Promise<ZApiResponse> {
    try {
      const response = await this.client.get('/instance/status');
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao verificar status da instância', {
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envia mensagem com lista de botões
   */
  async sendButtonList(request: ZApiSendButtonListRequest): Promise<ZApiResponse> {
    try {
      logger.info('Z-API Request', {
        method: 'post',
        url: '/send-button-list',
        fullURL: `${this.client.defaults.baseURL}/send-button-list`,
        baseURL: this.client.defaults.baseURL,
      });

      const response = await this.client.post('/send-button-list', request);
      
      logger.info('Z-API Response', {
        status: response.status,
        data: response.data,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      logger.error('Erro ao enviar lista de botões', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      return {
        success: false,
        error: error.message,
        data: error.response?.data,
      };
    }
  }

  /**
   * Envia uma mensagem com base no tipo
   */
  async sendMessage(request: ZApiSendMessageRequest | ZApiSendButtonRequest | ZApiSendListRequest | ZApiSendOptionListRequest | ZApiSendButtonListRequest): Promise<ZApiResponse> {
    logger.info('ZApiService.sendMessage - Analisando tipo de mensagem', {
      hasButtons: 'buttons' in request,
      hasList: 'list' in request,
      hasOptionList: 'optionList' in request,
      hasButtonList: 'buttonList' in request,
      requestKeys: Object.keys(request),
    });

    if ('buttons' in request) {
      logger.info('Enviando mensagem com botões');
      return this.sendButtonMessage(request);
    }
    
    if ('list' in request) {
      logger.info('Enviando mensagem com lista');
      return this.sendListMessage(request);
    }
    
    if ('optionList' in request) {
      logger.info('Enviando mensagem com lista de opções');
      return this.sendOptionList(request);
    }
    
    if ('buttonList' in request) {
      logger.info('Enviando mensagem com lista de botões');
      return this.sendButtonList(request);
    }
    
    logger.info('Enviando mensagem de texto simples');
    return this.sendTextMessage(request);
  }
}

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendResult {
  /** Só em modo simulado: devolvido na resposta para facilitar o desenvolvimento. */
  devCode?: string;
}

/**
 * Canal real de envio (SMS, WhatsApp...). O adaptador só entrega a mensagem: o código, o
 * hash, a validade e os limites são da API. Nunca ponha chave, token nem telefone completo
 * em mensagem de erro ou log.
 */
export interface OtpChannel {
  send(phone: string, message: string): Promise<void>;
}

type ChannelFactory = (config: ConfigService) => OtpChannel;

/**
 * Canais reais, por nome (valor de OTP_MODE). Vazio até um provedor ser contratado:
 * ver docs/INTEGRACAO_OTP.md.
 */
export const REAL_CHANNELS: Record<string, ChannelFactory> = {};

export const otpMessage = (code: string) =>
  `AMMA: seu código é ${code}. Vale por 5 minutos. Não compartilhe com ninguém.`;

/**
 * Envio do código. Modo simulado (OTP_MODE=simulated, padrão): escreve no log e devolve
 * o código na resposta; é recusado em produção. Qualquer outro valor de OTP_MODE precisa
 * estar em REAL_CHANNELS, senão a API não sobe.
 */
@Injectable()
export class OtpSender {
  private readonly logger = new Logger('OTP');
  private readonly mode: string;
  private readonly channel?: OtpChannel;

  constructor(config: ConfigService) {
    this.mode = config.get<string>('OTP_MODE') ?? 'simulated';
    if (this.mode === 'simulated') {
      if (config.get('NODE_ENV') === 'production') {
        throw new Error('OTP_MODE=simulated não pode ser usado em produção');
      }
      return;
    }
    const make = REAL_CHANNELS[this.mode];
    if (!make) {
      throw new Error(
        `OTP_MODE=${this.mode} não tem canal registrado (disponíveis: ${
          Object.keys(REAL_CHANNELS).join(', ') || 'nenhum'
        })`,
      );
    }
    this.channel = make(config);
  }

  async send(phone: string, code: string): Promise<SendResult> {
    if (!this.channel) {
      this.logger.log(`[SIMULADO] código para ***${phone.slice(-4)}: ${code}`);
      return { devCode: code };
    }
    try {
      await this.channel.send(phone, otpMessage(code));
    } catch (err) {
      // Detalhe só no log (sem o telefone inteiro); o usuário recebe uma mensagem genérica.
      this.logger.error(
        `Falha ao enviar código para ***${phone.slice(-4)}: ${err instanceof Error ? err.message : 'erro'}`,
      );
      throw new ServiceUnavailableException('Não foi possível enviar o código. Tente novamente.');
    }
    return {};
  }
}

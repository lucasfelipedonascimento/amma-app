import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendResult {
  /** Só em modo simulado: devolvido na resposta para facilitar o desenvolvimento. */
  devCode?: string;
}

/**
 * Envio do código. Modo simulado (OTP_MODE=simulated, padrão): escreve no log e devolve
 * o código na resposta. Modo "sms" exige um provedor real (não implementado: sem chaves inventadas).
 */
@Injectable()
export class OtpSender {
  private readonly logger = new Logger('OTP');
  private readonly mode: string;

  constructor(config: ConfigService) {
    this.mode = config.get<string>('OTP_MODE') ?? 'simulated';
    if (this.mode === 'simulated' && config.get('NODE_ENV') === 'production') {
      throw new Error('OTP_MODE=simulated não pode ser usado em produção');
    }
  }

  async send(phone: string, code: string): Promise<SendResult> {
    if (this.mode === 'simulated') {
      this.logger.log(`[SIMULADO] código para ***${phone.slice(-4)}: ${code}`);
      return { devCode: code };
    }
    throw new Error('Provedor de SMS ainda não configurado (OTP_MODE=sms)');
  }
}

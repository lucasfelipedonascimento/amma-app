import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { OtpSender, REAL_CHANNELS, otpMessage } from './otp-sender';

const cfg = (env: Record<string, string>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('OtpSender', () => {
  afterEach(() => {
    delete REAL_CHANNELS.fake;
  });

  it('simulado devolve o código; em produção é recusado', async () => {
    expect(await new OtpSender(cfg({})).send('+5583999991234', '123456')).toEqual({
      devCode: '123456',
    });
    expect(() => new OtpSender(cfg({ NODE_ENV: 'production' }))).toThrow(/produção/);
  });

  it('modo sem canal registrado não sobe', () => {
    expect(() => new OtpSender(cfg({ OTP_MODE: 'sms' }))).toThrow(/não tem canal/);
  });

  it('canal real recebe a mensagem e o código NÃO volta na resposta', async () => {
    const sent: Array<[string, string]> = [];
    REAL_CHANNELS.fake = () => ({ send: async (p, m) => void sent.push([p, m]) });
    const r = await new OtpSender(cfg({ OTP_MODE: 'fake' })).send('+5583999991234', '654321');
    expect(r).toEqual({});
    expect(sent).toEqual([['+5583999991234', otpMessage('654321')]]);
  });

  it('falha do provedor vira 503 genérico, sem vazar detalhe', async () => {
    REAL_CHANNELS.fake = () => ({
      send: async () => {
        throw new Error('token abc123 inválido');
      },
    });
    const p = new OtpSender(cfg({ OTP_MODE: 'fake' })).send('+5583999991234', '1');
    await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(p).rejects.not.toThrow(/abc123/);
  });
});

# Conectar um provedor de SMS/WhatsApp ao código de login

Estado: **pronto para conectar, nada contratado**. O modo `OTP_MODE=simulated` (padrão) só serve em desenvolvimento: devolve o código na resposta e a API recusa subir assim em produção.

## O que a API já faz (não precisa no adaptador)

Gera o código de 6 dígitos, guarda só o hash, validade de 5 min, limite de tentativas, limite de pedidos por telefone/dia e por IP, e reautenticação do admin. O adaptador **só entrega a mensagem**.

## Passo a passo

1. Crie `apps/api/src/auth/<nome>-channel.ts` implementando `OtpChannel` (`send(phone, message)`; telefone em E.164, ex. `+5583999991234`). Use `fetch` com timeout; lance erro se o provedor recusar.
2. Registre em `REAL_CHANNELS` (`otp-sender.ts`): `REAL_CHANNELS.<nome> = (config) => new MeuCanal(config.getOrThrow('...'))`. Faltando chave, a API falha no boot.
3. Ative com `OTP_MODE=<nome>` e acrescente as chaves do provedor ao `.env.example`.
4. Com canal real a resposta de `/auth/otp/request` **não** traz `devCode`.

## Regras

- Nunca ponha chave, token ou telefone completo em log ou mensagem de erro (o `OtpSender` já mascara o telefone e responde 503 genérico ao usuário).
- Falha de envio não revela se o número existe (a resposta é a mesma para qualquer telefone).
- Para WhatsApp, o texto precisa ser um **template aprovado** pela Meta (categoria autenticação); `otpMessage()` em `otp-sender.ts` é o texto padrão e pode ser trocado.

## Decisões suas (👤)

- **SMS ou WhatsApp** (ou os dois, com SMS de reserva). WhatsApp é mais barato e confiável no Brasil, mas exige conta Business e template aprovado.
- Contratar o provedor e definir o **limite de gasto** no painel dele (cada código custa; o teto por telefone/dia da API é só uma trava).
- Registrar o remetente (SMS no Brasil exige cadastro de sender ID nas operadoras, conforme o provedor).

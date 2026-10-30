# Segurança — auditoria e hardening

> **Estado: em andamento, por partes.** Este documento cresce a cada parte e será fechado ao final. Metodologia: Fase 1 (reconhecimento), 2 (análise estática), 3 (testes que reproduzem a falha), 4 (relatório), 5 (correção), 6 (validação). Referências: OWASP Top 10, API Security Top 10, ASVS, MASVS, LGPD.

## Partes

| Parte | Escopo                                                                                                                                             | Estado                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1     | Autenticação e sessões: OTP, JWT, refresh, MFA do admin, limite de taxa, cabeçalhos, guard global                                                  | ✅ corrigida e testada (2026-10-30) |
| 2     | Autorização (matriz endpoint × papel × dono, IDOR/BOLA) e fraude de corrida/financeiro (inclui bloqueio do `ENTREGUE` a mais de ~300 m do destino) | ⏳ próxima                          |
| 3     | WebSocket, localização e privacidade, uploads/documentos, LGPD (consentimento no servidor, exportação)                                             | ⏳                                  |
| 4     | Infra (Docker/Redis/Postgres), mobile, painel, dependências, CI                                                                                    | ⏳                                  |

## Resumo da Parte 1

Mapeei a autenticação e confirmei **uma vulnerabilidade com teste que falha no código antigo** (H2) e várias lacunas de defesa em profundidade. Todas corrigidas sem dependência nova; 367 testes de integração, 71+ unitários e 43 do painel passam.

## Achados da Parte 1

| ID  | Sev.     | Situação              | Componente                    | Descrição / evidência                                                                                                                                                                                                                                                                     | Correção                                                                                                                                                            | Teste                                                                          |
| --- | -------- | --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| H2  | **Alta** | **Confirmada**        | `auth.service.ts` `verifyOtp` | A contagem de tentativas lia `attempts` e só depois incrementava (não atômico). 40 chutes em paralelo contra um código resultaram em **9 tentativas em vez de 5** (reproduzido no código antigo). Com limite fraco de pedidos, permitia força bruta de 6 dígitos contra um telefone alvo. | Reserva atômica da tentativa antes de comparar (`updateMany` condicional); teto de 20 erros/hora por telefone somando todos os códigos; 10 códigos/dia por telefone | `auth-security.int.test.ts` (paralelo, uso único, teto horário e diário)       |
| H1  | **Alta** | Confirmada (ausência) | `main.ts`, `package.json`     | Nenhum limite de taxa geral, só o do OTP por telefone; sem `X-Content-Type-Options` etc. e `X-Powered-By` exposto                                                                                                                                                                         | `common/rate-limit.ts` (guard global por IP + por rota + por usuário), `common/security-headers.ts`, `TRUST_PROXY`                                                  | limite com `Retry-After`; `security-headers.test.ts`                           |
| H3  | **Alta** | Confirmada (ausência) | `/admin/*`                    | Admin entrava só com OTP por SMS e fazia ações críticas (preço, bloqueio, sobras, orçamento) sem segundo passo                                                                                                                                                                            | `@Reauth()`: código por SMS ao telefone da própria conta, validade de 10 min, em 24 rotas críticas; painel ganhou o fluxo                                           | 4 testes de reautenticação + teste de componente do painel                     |
| H5  | Média    | Preventiva            | todos os controllers          | `AuthGuard` era opt-in: controller novo sem `@UseGuards` ficava público                                                                                                                                                                                                                   | `DenyByDefaultGuard` global + `@Public()`; teste enumera todas as rotas e as 9 públicas                                                                             | `auth-security.int.test.ts` (negar por padrão)                                 |
| H6  | Média    | Preventiva            | `auth.module.ts`              | JWT sem `iss`/`aud` e algoritmo implícito; `JWT_SECRET` sem checagem de força                                                                                                                                                                                                             | `jwt-config.ts`: HS256, `iss`, `aud` fixos nos dois lados; segredo de 32+ caracteres em produção                                                                    | token sem `iss/aud`, de outro segredo e `alg=none` → 401; `jwt-config.test.ts` |
| H7  | Média    | Confirmada (ausência) | `auth.controller.ts`          | Não havia como encerrar todas as sessões                                                                                                                                                                                                                                                  | `POST /auth/logout-all`                                                                                                                                             | `auth-security.int.test.ts`                                                    |

Também: DTOs de auth ganharam `@MaxLength`; `/share/:token/data` e uploads ganharam limite.

## Verificado e sem falha (Parte 1)

- Hash de OTP e refresh só como HMAC/SHA-256, comparação em tempo constante; OTP de uso único (consumo atômico, testado com 10 requisições paralelas → 1 sucesso).
- Refresh com rotação e revogação de todas as sessões ao detectar reuso.
- Papéis lidos do banco a cada requisição; conta excluída recusada mesmo com token válido (testado).
- Cadastro não aceita `role` no corpo (whitelist + `forbidNonWhitelisted`).
- Todos os `$queryRaw/$executeRaw` usam template tagged (parametrizados); nenhum `Unsafe` na aplicação (só o `TRUNCATE` dos testes).

## Pendências e limitações (Parte 1)

- **SIM swap:** a reautenticação usa o mesmo canal (SMS) do login; não protege contra troca de chip. Evolução: TOTP.
- **Negação de serviço do login:** o teto de erros/hora permite a um terceiro travar o login de um telefone por até 1 h. Escolha consciente (ver `DECISOES.md`).
- **Provedor de SMS real** continua não implementado; `OTP_MODE=simulated` é recusado em produção e imprime o código no log em desenvolvimento.
- **Sem lista de dispositivos** nem alerta de novo login.
- **Limite por usuário geral** (além do IP) não existe: o guard global limita por IP; só uploads têm limite por usuário.
- **Painel:** todo o tráfego do painel chega à API pelo mesmo IP, então os limites por IP de `/auth/*` valem para o painel todo.
- O limite de taxa e os testes de integração rodam só contra Postgres/Redis locais; **nada foi testado contra produção**.

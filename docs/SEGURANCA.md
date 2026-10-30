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

---

# Parte 2 — autorização e fraude de corrida/financeiro

## Resumo

Li todos os controllers e as checagens de dono nos serviços (pedido, corrida, segurança, pontos de acolhida, seguro, compra coletiva) e escrevi uma **matriz de testes IDOR/BOLA** (`test/authz-fraud.int.test.ts`). **Não encontrei IDOR/BOLA nem escalada de privilégio:** o dono é conferido no servidor em todas as rotas `:id` e o recurso alheio responde 404/403. Encontrei e confirmei **duas falhas de regra de negócio**, ambas corrigidas.

## Achados da Parte 2

| ID  | Sev.     | Situação       | Componente                                  | Descrição / evidência                                                                                                                                                                        | Correção                                                                                                                                                                                                                                                                                                    | Teste                                                                                                                                         |
| --- | -------- | -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A2  | **Alta** | **Confirmada** | `delivery.service.ts` `advance`/`settle`    | `ENTREGUE` não conferia onde o motorista estava. Um motorista a ~2 km do destino concluiu (200), gerando repasse, taxa e cotas no ledger por uma entrega que não fez.                        | `assertAtDropoff`: a última posição que o **servidor** recebeu (Redis, ou PostGIS se o Redis não souber) precisa ter até 120 s e estar a até **300 m** do destino; senão `409 TOO_FAR_FROM_DROPOFF` ou `409 POSITION_UNKNOWN`. Vale para entrega e corrida. Posição enviada no corpo da chamada é ignorada. | 8 testes (longe, 250 m/350 m, corpo ignorado, sem posição, posição velha, fallback PostGIS, 6 conclusões simultâneas = 1 lançamento, corrida) |
| A1  | **Alta** | **Confirmada** | `dispatch.service.ts` `candidates`/`accept` | Quem tem os papéis PASSAGEIRO e MOTORISTA (permitido no cadastro) recebia a oferta do **próprio pedido** e a aceitava (200), podendo gerar repasse, cotas (voto) e benefícios para si mesmo. | O despacho exclui o cliente dos candidatos e o aceite recusa com `where: { clientId: { not: driverId } }` (atômico, dentro da transação)                                                                                                                                                                    | 2 testes (sem oferta própria; oferta forjada no banco → 409 e pedido continua sem motorista)                                                  |

## Verificado e sem falha (Parte 2)

Cada item abaixo tem teste na matriz:

- Pedido de outra pessoa: leitura, recibo, avaliação, cancelamento e confirmação de Pix (como passageiro, comerciante e motorista de fora) → 403/404. Motorista não vê recibo nem pagamento.
- Lista `/deliveries` só traz os pedidos do próprio usuário.
- Todos os passos do motorista, rota, avaliação e liberar pedido de outro motorista → 404; aceitar/recusar oferta alheia → 404.
- Corrida: foto do motorista, compartilhar (criar/listar/revogar), registro e denúncia/emergência de corrida alheia → 403/404.
- Rotas `/admin/*` e `/panel/*` (13 rotas) recusam passageiro, comerciante e motorista (403) e anônimo (401).
- Escalada: `roles: ['ADMIN']` no onboarding → 400; campos extras (`role`, `isAdmin`) → 400; perfil de motorista não aceita `genderVerifiedAt`, `userId` nem `associationRate` → 400.
- Pontos de acolhida: só o dono edita/apaga/vê visitas; só o visitante encerra e avalia o próprio check-in; só o anfitrião avalia o visitante.
- Seguro mútuo: ler, anexar e cancelar pedido de outro sócio → 404; lista só a própria.
- Ledger: valores em centavos inteiros, arredondamento para baixo (centavo quebrado não sai do motorista), lançamento só-inserção por gatilho, fechamento único por pedido (índice `(kind, reference)`), conclusão + taxas + ledger na mesma transação.

## Pendências e limitações (Parte 2)

- **GPS falso (mock location):** a regra dos 300 m usa a posição que o aparelho informa. Quem falsifica o GPS ainda passa. Mitigações possíveis (não implementadas): checar velocidade impossível entre posições, tempo mínimo entre coleta e entrega proporcional à distância, integridade do aparelho (Play Integrity/App Attest), revisão de padrões pelo admin.
- **Conluio entre duas contas** (um passageiro e um motorista de pessoas diferentes combinados, ou a mesma pessoa com dois celulares) não é detectável só no código. Exige análise de padrão (mesmos pares repetidos) no painel.
- **Check-in nos pontos de acolhida** também confia na posição informada pelo app (mesma limitação).
- **Cancelamento com estorno total** continua sem ressarcir o motorista que já se deslocou (pendência de regra de negócio, já registrada).
- **Idempotência do pedido:** repetir a chave com corpo diferente devolve o pedido anterior em vez de erro. Sem impacto financeiro (nada é cobrado de novo).
- **Estimativa de corrida** (`availability`) ainda conta o próprio usuário como motorista próximo (informativo; não gera oferta).
- Saída para quem não consegue chegar a 300 m (portaria longe, GPS ruim): cancelar por `ENTREGA_IMPOSSIVEL` (sem conclusão manual pelo admin; avaliar se é necessária).

---

# Parte 3 — WebSocket, localização, arquivos e LGPD

## Resumo

Cada achado abaixo foi **reproduzido com teste que falhava** antes da correção (`test/privacy.int.test.ts`, 11 testes). Na análise estática, o WebSocket já isolava eventos por `userId` (não há salas por ID de corrida, então "entrar na sala de outra corrida" não existe) e o armazenamento de arquivos já usava nomes gerados.

## Achados da Parte 3

| ID  | Sev.  | Situação                  | Componente                                 | Descrição / evidência                                                                                                                                                                                                         | Correção                                                                                                                                                                                                                                                    |
| --- | ----- | ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Média | **Confirmada**            | `realtime.gateway.ts`                      | O token só era conferido no `auth`: a conexão sobrevivia a bloqueio, exclusão da conta e "sair de todos os aparelhos" (recebendo eventos e aceitando posição). Sem limite de conexões por usuário e sem checagem de `Origin`. | Revalidação periódica (`WS_REVALIDATE_MS`, 60 s): sem sessão válida ou conta bloqueada/excluída → 4401. Máx. 3 conexões por usuário (4429). `Origin` de navegador fora de `CORS_ORIGINS` → 4403 (app nativo não envia). 120 conexões/min por IP.            |
| P1  | Média | **Confirmada**            | `driver-ops.controller.ts`                 | `POST /driver/presence/online` não exigia o consentimento de localização (só o app pedia): sem prova no servidor. Revogar também não tirava o motorista do ar.                                                                | `403 LOCATION_CONSENT_REQUIRED` sem consentimento vigente; revogar encerra a presença e apaga a posição (Redis e PostGIS).                                                                                                                                  |
| L1  | Média | **Confirmada** (ausência) | `/me`                                      | Não havia exportação dos dados do titular (LGPD art. 18).                                                                                                                                                                     | `GET /me/export`: JSON só com dados do titular; sem terceiros (motorista não recebe endereço do cliente), sem notas/comentários recebidos, sem chaves de arquivo, tokens de push, hashes nem referências do provedor; 3/dia; funciona para conta bloqueada. |
| U1  | Média | **Confirmada**            | `common/file-type.ts` e serviços de upload | PDF com `/JavaScript`, `/OpenAction`, `/Launch`, `/EmbeddedFile` etc. era aceito (só os bytes iniciais eram conferidos).                                                                                                      | Recusa PDF com conteúdo ativo (documentos, anexos de seguro e fotos de ponto).                                                                                                                                                                              |
| U2  | Baixa | **Confirmada**            | `driver.service.ts`                        | Sem teto de documentos por conta (só 20 envios/h): enchimento de disco.                                                                                                                                                       | Máx. 50 por conta (409).                                                                                                                                                                                                                                    |
| U3  | Baixa | **Confirmada**            | `admin.controller.ts`                      | O download do documento pelo admin não impedia abrir o arquivo na página.                                                                                                                                                     | `Content-Disposition: attachment` + `CSP: sandbox`, sem cache. A abertura já ia para a trilha (testado).                                                                                                                                                    |
| L2  | Baixa | Confirmada                | `otp-sender.ts`                            | O OTP simulado (só dev) registrava o telefone completo no log.                                                                                                                                                                | Telefone mascarado (`***1234`).                                                                                                                                                                                                                             |

## Verificado e sem falha (Parte 3)

- Eventos em tempo real vão só ao `userId` dono; cliente só recebe a posição do motorista enquanto o pedido está em andamento; o motorista só envia a própria posição e só online (testes existentes).
- Posição: só a **última** fica guardada (Redis expira em 120 s; apagada ao ficar offline). Trajeto só de corrida, 90 dias, com auditoria de acesso do admin.
- Pontos de acolhida: casa parceira só com bairro e posição arredondada (~110 m); a posição do check-in não é guardada, só a distância.
- Upload: nome do cliente nunca vira caminho (teste com `../../../etc/passwd`); chave é UUID + extensão do tipo **detectado**; arquivo `0600`; documentos pessoais só para admin (auditado) e dono do link da foto durante a corrida.
- Compartilhamento de viagem: token de 192 bits, só o hash no banco, lista fechada de campos.

## Pendências e limitações (Parte 3)

- **Sem antivírus** e sem reencodar imagens (polyglot JPEG/HTML é neutralizado por `nosniff` + tipo servido, mas o arquivo é guardado como veio). Recomendado: varredura (ClamAV) ou reencode ao migrar para bucket.
- **Armazenamento em disco local**; sem URL temporária assinada. Trocar por bucket privado cifrado (já isolado em `StorageService`).
- **WebSocket:** a expiração do _token_ (15 min) não derruba a conexão; ela cai pela revalidação de sessão (refresh). Reconexão exige token novo. Registro de conexões continua em memória (1 instância).
- **Retenção:** logs, `DeliveryEvent`, trilha de auditoria, endereços de pedidos antigos e denúncias não têm rotina de expurgo (decisão do jurídico). ROPA, encarregado e RIPD seguem pendentes (👤).
- **Política de privacidade:** não reexige aceite quando a versão muda; faltam termos de uso.
- **Exportação:** não inclui arquivos dos documentos nem o que outras pessoas escreveram sobre o titular (por desenho); o prazo de resposta ao titular é processo, não código.
- A localização em tempo real do app e do servidor depende do GPS do aparelho (ver limitação da Parte 2).

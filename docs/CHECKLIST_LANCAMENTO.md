# Checklist de lançamento (Etapa 11)

Legenda: ✅ já existe no código · 🟡 existe em parte · ❌ falta · 👤 decisão ou ação sua (não é código).
Cada item tem um **bloqueia?** implícito: o que está em **A. Bloqueadores** impede publicar; o resto pode ir em seguida, mas com data.

> Esta etapa **auditou o estado atual e listou o que falta**; não alterou código. O que aparece como ✅ foi conferido no repositório em 2026-10-30.

---

## A. Bloqueadores (nada vai ao ar sem isto)

1. ❌ **Texto jurídico definitivo**: política de privacidade e termos de uso. Hoje `apps/api/src/legal/privacy-policy.ts` é _placeholder_ (versão `0.1-placeholder`). 👤 advogado.
2. ❌ **Provedor de pagamento real.** `PAYMENT_PROVIDER=sandbox` é recusado em produção (a API não sobe). Sem ele não há cobrança.
3. ❌ **Rota real** (`ROUTE_PROVIDER=mapbox` + token) e **push real** (`PUSH_MODE=expo`) e **SMS/OTP real** (`OTP_MODE` ≠ `simulated`; o sender recusa simulado em produção). Falta escolher e contratar o provedor de SMS.
4. ❌ **Limite de taxa geral e cabeçalhos de segurança** na API (seção B).
5. ✅ **Exportação dos dados do titular** (`GET /me/export`, seção D).
6. ❌ **Ambiente de produção e deploy** (seção F): os workflows de deploy são esqueleto (`echo TODO`).
7. ❌ **Contas de loja** (seção H) e **ícone/capturas**: não existe `apps/mobile/assets` nem `eas.json`.
8. 👤 **Decisões da associação** que o código assumiu como exemplo (lista em PROGRESSO, etapas 7–10): regras de sócio/quórum, fila, sobras, benefício do anfitrião, plantão de emergência, multa de cancelamento.
9. 👤 **Parecer jurídico** sobre seguro mútuo (possível regulação SUSEP) e sobre consórcio/cooperativa parceira. Sem parceiro real, o app deve **esconder ou marcar como "em breve"** compra coletiva e seguro.

---

## B. Segurança (OWASP Top 10, 2021)

| #   | Risco                           | Estado                                                                                                                                                                                                                                                                                                                                                                           | O que fazer                                                                                                                                                                                                         |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Controle de acesso quebrado     | ✅ `AuthGuard` por controller (`@UseGuards`), papéis, `PanelGuard` nega por padrão, bloqueio de conta (`ACCOUNT_BLOCKED`), "cada parte vê só o seu" testado em integração. 🟡 O guard **não é global** (opt-in): um controller novo sem `@UseGuards` fica público. Hoje sem guard: `app`, `auth`, `legal` e `dispatch` (conferir se as regras do `dispatch` são mesmo públicas). | Tornar o guard global (`APP_GUARD`) com decorador `@Public()` explícito nas rotas abertas (negar por padrão), ou ao menos um teste que falhe se um controller não tiver guard e não estiver numa lista de públicos. |
| A02 | Falhas criptográficas           | ✅ OTP, refresh e links guardados só como hash (HMAC/SHA-256); comparação em tempo constante; cartão nunca chega à API; JWT de 15 min. ❌ Segredo `JWT_SECRET` sem checagem de força em produção. ❌ Criptografia em repouso e em trânsito é de infraestrutura (ver seção E).                                                                                                    | Falhar o boot em produção se `JWT_SECRET` < 32 bytes ou igual ao exemplo. HTTPS obrigatório na borda (HSTS). Disco/bucket/backup cifrados. Rotação de segredo documentada.                                          |
| A03 | Injeção                         | ✅ Prisma parametrizado; DTOs com `whitelist` + `forbidNonWhitelisted`. 🟡 Conferir os `$queryRaw` (PostGIS) um a um.                                                                                                                                                                                                                                                            | `grep -rn queryRaw apps/api/src` e confirmar que só usam `Prisma.sql`/parâmetros, nunca concatenação.                                                                                                               |
| A04 | Design inseguro                 | ✅ Ledger só-inserção com gatilho no banco, fechamento único de votação, estorno único, anti-fraude básico do check-in. 🟡 Anti-fraude de benefício do anfitrião é básico (ver PROGRESSO etapa 9).                                                                                                                                                                               | Revisão de abuso: cupom/benefício, cancelamento repetido, criação em massa de contas.                                                                                                                               |
| A05 | Configuração incorreta          | ✅ Painel com `X-Frame-Options`, `nosniff`, `no-store`. ✅ Provedores simulados recusados com `NODE_ENV=production`. ✅ CORS explícito por lista (`CORS_ORIGINS`, vazio = nega). ❌ **API sem `helmet`**, sem validação central das variáveis de ambiente, `uploads/` em disco local.                                                                                            | Adicionar `helmet`; CORS desligado (só app nativo e proxy do painel); validar `.env` no boot (falha se faltar `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL` https); bucket S3.                       |
| A06 | Componentes vulneráveis         | ❌ Sem varredura de dependências no CI. Lockfile ✅.                                                                                                                                                                                                                                                                                                                             | `pnpm audit --prod` no CI (falha em _high_); Dependabot/Renovate semanal; fixar Node 20 LTS e imagens Docker por versão.                                                                                            |
| A07 | Falhas de autenticação          | ✅ OTP com TTL 5 min, 5 tentativas, 3 pedidos por 10 min; refresh com rotação e revogação; sessões apagadas ao sair/excluir. 🟡 Limite de OTP é por telefone; falta por IP/aparelho (enumeração e custo de SMS).                                                                                                                                                                 | Limite por IP + teto diário de SMS por telefone e global (alarme de custo).                                                                                                                                         |
| A08 | Integridade de software e dados | ✅ Votos com `ballotDigest`, registros imutáveis. ❌ Builds de produção sem assinatura/proveniência; ações do GitHub por tag móvel.                                                                                                                                                                                                                                              | Fixar ações por SHA; exigir PR + CI verde na `main`; segredos só em GitHub Secrets/EAS.                                                                                                                             |
| A09 | Falhas de log e monitoramento   | 🟡 Log de acesso sem corpo/cabeçalho ✅; trilha de auditoria do admin ✅. ❌ Sem erro central, métrica nem alerta (seção G).                                                                                                                                                                                                                                                     | Seção G.                                                                                                                                                                                                            |
| A10 | SSRF                            | ✅ A API não busca URL fornecida pelo usuário. 🟡 Provedores externos (Mapbox, Expo, pagamento) têm endereço fixo.                                                                                                                                                                                                                                                               | Manter assim; se surgir "importar por URL", bloquear IPs internos.                                                                                                                                                  |

### Limites de taxa (rate limiting)

| Onde                                     | Estado                              | Proposta inicial                                                                          |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| OTP por telefone                         | ✅ 3 pedidos / 10 min; 5 tentativas | Manter                                                                                    |
| API em geral                             | ❌                                  | `@nestjs/throttler` com Redis: 120 req/min por usuário autenticado, 60/min por IP anônimo |
| `/auth/otp/*`, `/auth/refresh`           | ❌ por IP                           | 10/min por IP                                                                             |
| Upload de documentos/fotos               | 🟡 tipo e tamanho (5 MB) ✅         | 10/hora por usuário                                                                       |
| Denúncia, emergência, check-in           | 🟡 denúncia de ponto 5/dia ✅       | Emergência sem teto baixo (nunca bloquear socorro); demais por usuário                    |
| Link público de viagem (`/share/:token`) | ❌                                  | 30/min por IP; token de 192 bits já impede adivinhar                                      |
| WebSocket `/ws`                          | ❌                                  | Máx. conexões por usuário (ex.: 3) e mensagens/s                                          |
| Painel admin (`/api/auth/*`)             | ❌                                  | 5 pedidos de código / 10 min por IP                                                       |

Atrás de proxy (Nginx/ALB), configurar `trust proxy` para o IP real, senão o limite por IP vira limite global.

### Testes de segurança antes de publicar

- [ ] `pnpm audit --prod` sem _high_/_critical_.
- [ ] Varredura com OWASP ZAP (modo baseline) contra o ambiente de _staging_.
- [ ] Teste manual de IDOR: usuário A tentando ler/alterar pedido, pagamento, recibo, documento e ponto do usuário B (em todas as rotas `:id`).
- [ ] Escalada de papel: passageiro chamando `/admin/*`, `/panel/*`, `/driver/*`.
- [ ] Conta bloqueada e conta excluída com token ainda vigente.
- [ ] Upload com extensão trocada (já validado pelos bytes ✅), arquivo de 5 MB+ e PDF malicioso.
- [ ] Painel: CSRF (proxy exige mesma origem nas escritas ✅), cookies `httpOnly`/`Secure`/`SameSite`.
- [ ] Revisão do app: nenhum segredo no bundle (`expo export` e `grep`), tokens só em `expo-secure-store` ✅.

---

## C. Logs sem dados pessoais

- ✅ Log de acesso: só método, rota (sem query string), status e tempo.
- ✅ Trilha de auditoria guarda ids, motivo e IP, sem corpo da requisição.
- ❌ **OTP simulado imprime o código no log**: aceitável só em desenvolvimento (recusado em produção ✅).
- ❌ **Rota com dado pessoal no caminho** (ex.: telefone em `:phone`)? Conferir e, se houver, registrar o padrão da rota (`/users/:id`), não o caminho real.
- ❌ Padrão central de _redaction_ para erros: nunca logar `Authorization`, `phone`, `cpf`, `name`, `address`, `token`, `code`, corpo de pagamento.
- ❌ Definir **retenção dos logs** (sugestão: 30 dias em busca, 90 dias arquivados) e quem acessa.
- [ ] Teste: provocar erro 500 com corpo contendo telefone e CPF e conferir que nada aparece no log nem no Sentry.

---

## D. LGPD

| Item                                     | Estado                                                                                                                                      | Falta                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consentimento da política                | ✅ `Consent` com versão e data; cadastro exige aceite                                                                                       | Reexigir aceite quando a versão mudar; exigir também o aceite dos **termos de uso** (novo `ConsentType`)                                                                                       |
| Consentimento de localização em 2º plano | ✅ tela própria, gravado e revogável no app. ✅ O servidor exige em `presence/online`                              | Exigir no servidor (vale como prova)                                                                                                                                                           |
| Consentimentos específicos               | ❌ Registro da viagem (corrida), gênero declarado, anexos de seguro/saúde, casa parceira                                                    | Textos e aceite próprios ou base legal documentada; avisar na política                                                                                                                         |
| Exclusão de conta                        | ✅ `DELETE /me` (anonimiza, apaga documentos, trajeto, tokens, comentários); bloqueia se houver pedido em andamento                         | Botão visível no app e no site; prazo de resposta ao titular; retenção de bloqueios/denúncias (ver LGPD.md)                                                                                    |
| **Exportação dos dados**                 | ✅ `GET /me/export` (3/dia, sem terceiros)                                                                                                                                | `GET /me/export` (JSON): perfil, consentimentos, veículos, pedidos, pagamentos (sem cartão), recibos, ledger do sócio, votos próprios, avaliações dadas, visitas; limitar a 1 por dia; auditar |
| Retenção e expurgo                       | 🟡 Trajeto: 90 dias com rotina ✅. ❌ Endereços/notas de pedidos antigos, `DeliveryEvent`, trilha de auditoria, bloqueios, votos, denúncias | Tabela de prazos por tipo de dado e rotina de anonimização (👤 jurídico define os prazos)                                                                                                      |
| Encarregado (DPO) e canal do titular     | ❌                                                                                                                                          | 👤 Nomear encarregado; e-mail `privacidade@…`; fluxo de resposta em até 15 dias                                                                                                                |
| Registro de operações (ROPA)             | ❌                                                                                                                                          | Planilha: dado, finalidade, base legal, compartilhamento, prazo — partir de `docs/LGPD.md`                                                                                                     |
| Operadores e transferência internacional | ❌                                                                                                                                          | Listar: hospedagem, Expo/EAS (push), Mapbox, SMS, pagamento, Sentry, loja de apps; contratos e país dos servidores                                                                             |
| Incidente de segurança                   | ❌                                                                                                                                          | Plano de resposta (quem decide, comunicação à ANPD e aos titulares em prazo razoável)                                                                                                          |
| RIPD (relatório de impacto)              | ❌                                                                                                                                          | Recomendável: localização contínua, registro de viagem, dados de saúde no seguro, gênero                                                                                                       |
| Admin lendo listas                       | 🟡 abertura de documentos é auditada; leitura de listas com nome/telefone não                                                               | Decidir se audita e por quanto tempo guarda                                                                                                                                                    |

**Política de privacidade e termos** devem cobrir, no mínimo: quem somos e o encarregado; dados por perfil (passageiro, motorista, comerciante, sócio, anfitrião); finalidades e bases legais; localização em 2º plano (quando, por quê, como desligar); registro de viagem (90 dias, quem acessa); compartilhamento (provedores acima, contato do link de viagem); retenção; direitos (acesso, correção, exclusão, portabilidade, revogação) e como exercê-los; crianças (app só para maiores de 18); alterações e versão. Publicar em **URL pública** (as lojas exigem) e também no app.

---

## E. Criptografia, backup e infraestrutura

- [ ] HTTPS em tudo (API, painel, link de viagem); HSTS; TLS ≥ 1.2.
- [ ] Banco gerenciado (Postgres + PostGIS) com **criptografia em repouso**, rede privada e usuário da aplicação sem permissão de DDL (migração roda com outro usuário).
- [ ] Redis em rede privada com senha/TLS. Lembrar: posição do motorista e limites vivem nele; perdê-lo não pode perder dado financeiro (✅ ledger está no Postgres).
- [ ] **Documentos e fotos fora do disco da instância**: bucket privado, cifrado, sem acesso público, URL só via API (hoje `UPLOAD_DIR`). `StorageService` já isola o acesso: trocar a implementação.
- [ ] **Backup do Postgres**: automático diário + PITR (WAL), retenção 30 dias, cópia em outra região, **cifrado**.
- [ ] **Teste de restauração** feito e registrado (backup que nunca foi restaurado não conta). Meta sugerida: RPO ≤ 15 min, RTO ≤ 4 h.
- [ ] Backup do bucket de documentos (versionamento ligado).
- [ ] Apagar de backups: ao excluir uma conta, o dado some dos backups quando eles expirarem (documentar na política).
- [ ] Segredos em cofre (GitHub Secrets, EAS Secrets, secret manager da nuvem); `.env` nunca no repositório (✅ no `.gitignore`).
- [ ] Rotação do `JWT_SECRET` planejada (invalida sessões: aceitável, comunicar).
- [ ] **WebSocket é em memória (1 instância).** Para mais de uma instância: adaptador Redis ou manter 1 instância no lançamento (documentar e dimensionar).
- [ ] Rotinas periódicas (despacho, associação, retenção do trajeto) rodando em **uma** instância só, ou com trava no Redis.

---

## F. CI/CD e ambientes

| Item                  | Estado                                                                                             | Falta                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI por app            | ✅ `ci-api`, `ci-admin`, `ci-mobile` (lint, typecheck, teste, build; API com Postgres/Redis reais) | `pnpm audit`, cobertura mínima, checagem do `prisma migrate diff` (schema = migrações)                                                                                                                            |
| Deploy                | ❌ esqueleto (`echo TODO`) nos três                                                                | 👤 Escolher destino (sugestão: contêiner único para a API + Postgres/Redis gerenciados; painel em Vercel/contêiner; app via **EAS Build/Submit**)                                                                 |
| Ambientes             | ❌                                                                                                 | **dev** (local), **staging** (cópia de produção, dados falsos, provedores em sandbox reais) e **produção**. Branch `main` → staging automático; produção por _tag_ com aprovação manual (`environment` do GitHub) |
| Migrações             | ✅ `prisma migrate deploy`                                                                         | Rodar como etapa do deploy **antes** de subir a versão nova; migrações compatíveis com a versão anterior (expandir → migrar → contrair); backup antes                                                             |
| Dockerfile da API     | ❌                                                                                                 | Imagem multi-estágio, usuário não-root, `HEALTHCHECK` em `/health`                                                                                                                                                |
| Saúde                 | 🟡 `GET /health`                                                                                   | Separar _liveness_ e _readiness_ (banco e Redis)                                                                                                                                                                  |
| Rollback              | ❌                                                                                                 | Imagem anterior mantida; procedimento escrito                                                                                                                                                                     |
| App mobile            | ❌ sem `eas.json`                                                                                  | Perfis `development`, `preview` (staging), `production`; `EXPO_PUBLIC_API_URL` por perfil; versão e `versionCode`/`buildNumber` automáticos                                                                       |
| Atualizações OTA      | ❌                                                                                                 | Decidir se usa EAS Update (só JS; mudanças nativas exigem nova build e nova revisão das lojas)                                                                                                                    |
| Provedores no staging | ❌                                                                                                 | Pagamento em sandbox **do provedor real** (não o simulado), SMS para números de teste, Mapbox com token próprio                                                                                                   |
| Proteção da `main`    | 👤                                                                                                 | PR obrigatório, CI verde, 1 revisão (ou auto-revisão documentada)                                                                                                                                                 |

---

## G. Observabilidade

- [ ] **Erros**: Sentry (ou equivalente) na API, no painel e no app (`sentry-expo`/`@sentry/react-native` com _source maps_). `sendDefaultPii: false`, filtro de `Authorization`/telefone/CPF/endereço antes do envio, amostragem de _traces_ baixa.
- [ ] **Logs estruturados** (JSON, nível, id de requisição) em vez de texto; propagar `x-request-id` do painel à API.
- [ ] **Métricas** da API (Prometheus/OpenTelemetry ou do provedor): latência p95 por rota, taxa de erro 5xx, conexões WebSocket, tamanho das filas de despacho, ofertas expiradas, falhas de pagamento.
- [ ] **Métricas de negócio** (já existem no painel via `MetricsService`): pedidos/h, taxa de conclusão, tempo até aceite, cancelamentos. Definir limites que disparam alerta (ex.: conclusão < 70% por 1 h; 0 motoristas online em horário de pico).
- [ ] **Alertas** para um canal que você de fato vê: API fora do ar, 5xx > 2% por 5 min, erro de pagamento, banco com pouco espaço/conexões, backup falhou, custo de SMS acima do teto, **alerta de emergência sem atendimento em 2 min**.
- [ ] **Monitor externo** de disponibilidade em `/health` (UptimeRobot/Better Stack).
- [ ] **Emergência sem plantão** (pendência desde a Etapa 7): definir quem atende, em quanto tempo e por qual canal (SMS/WhatsApp/telefone). Sem isso, o botão de emergência dá falsa sensação de segurança — avaliar **não lançar corridas** antes disso. 👤
- [ ] Painel de _status_ simples e um _runbook_ de uma página ("API fora do ar", "pagamento falhando", "restaurar backup").

---

## H. Testes ponta a ponta

**Já temos:** shared (286), API unitários (67) e **integração com banco real (353)**, mobile (265, com mocks nativos), painel (42). Nada disso roda o **app num aparelho** nem o fluxo inteiro por HTTP + WebSocket + app.

Roteiros manuais por aparelho estão em `docs/MOBILE.md` (A–I) e **nunca foram executados em celular físico**. Executar todos é pré-requisito.

### Automatizar (prioridade)

1. **API ponta a ponta (HTTP + WebSocket)** — já há base em `delivery-flow.int.test.ts`, `rides.int.test.ts`, `realtime.int.test.ts`. Garantir um teste por fluxo abaixo, partindo do cadastro:
   - [ ] Cadastro (OTP → aceite → perfil) → sair → entrar → renovar sessão → excluir conta.
   - [ ] Motorista: envia documentos → admin aprova → fica online → recebe oferta → aceita → coleta → entrega → ganho aparece.
   - [ ] Cliente: cotação → pagamento Pix → pagamento cartão → acompanha → recibo → avalia.
   - [ ] Corrida: PIN, compartilhar viagem, emergência, denúncia, registro da viagem.
   - [ ] Pagamento: recusado, Pix vencido, estorno, cancelamento.
   - [ ] Associação: escolher taxa → cotas → votar → fechamento → sobras; compra coletiva; seguro.
   - [ ] Acolhida: cadastrar casa → aprovar → check-in → saída → benefício.
   - [ ] Painel: login admin/sócio, aprovação, bloqueio → recurso → decisão por outro admin.
2. **Mobile com Maestro** (ou Detox): 3 fluxos no emulador Android — login simulado, motorista online/aceita/entrega, cliente pede e acompanha. Rodar em `preview` antes de cada release; não bloquear o CI no começo.
3. **Painel com Playwright**: login, aprovar motorista, bloquear, ver auditoria. Fecha a lacuna "sem teste visual".
4. **Carga** (k6): 200 motoristas online enviando posição + 50 pedidos/min por 10 min no staging. Meta inicial: p95 < 500 ms, sem 5xx, despacho < 30 s.
5. **Teste de caos básico**: derrubar Redis e reiniciar API durante entrega em andamento — nenhum dado financeiro pode divergir.

### Em aparelho real (manual, antes de cada versão)

- [ ] Android de entrada (2–3 GB de RAM) e um iPhone: instalação limpa, permissões, 2º plano com tela bloqueada por 30 min, economia de bateria, perda de rede, push com app fechado, ligação de emergência, mapa, foto do motorista (cabeçalho `Authorization` no Android), compartilhar viagem, geocodificação.
- [ ] Fluxo completo de **motorista bloqueado** e de **recurso** (o app **ainda não tem tela** para isso: ver pendências — ❌ bloqueador de usabilidade).

---

## I. Publicação — Google Play e App Store

### I.1 Contas (👤 comece já: leva dias ou semanas)

- [ ] **CNPJ da associação** ativo e com dados iguais em todos os cadastros.
- [ ] **D-U-N-S Number** (grátis, ~30 dias) — exigido pela Apple e pelo Google para conta de organização.
- [ ] **Apple Developer Program** como **organização** (US$ 99/ano); titular com poder de representar a associação; verificação por telefone.
- [ ] **Google Play Console** como **organização** (taxa única de US$ 25); verificação do D-U-N-S; conta em nome de pessoa física passa por **teste fechado de 12+ testadores por 14 dias** antes de produzir — conta de organização escapa dessa regra, outra razão para não usar conta pessoal.
- [ ] Papéis de acesso: pelo menos 2 pessoas com acesso administrativo (evita ficar trancado).
- [ ] Conta Expo/EAS da organização, com 2FA.
- [ ] Chaves: _upload key_ Android guardada em cofre (Play App Signing ligado), certificados e perfis iOS geridos pelo EAS; push (FCM `google-services.json` e chave APNs).

### I.2 Identificadores e build

- [ ] Pacote `br.org.amma.app` (Android) e bundle id `br.org.amma.app` (iOS): confirmar que são definitivos (não mudam depois).
- [ ] `version` real (hoje `0.0.0`), `android.versionCode` e `ios.buildNumber` incrementais.
- [ ] `GOOGLE_MAPS_API_KEY` restrita por pacote/SHA-1 e por bundle id; `EAS_PROJECT_ID`; `GOOGLE_SERVICES_JSON`.
- [ ] Android: `targetSdkVersion` no mínimo exigido pela Play no ano; AAB (não APK) para produção.
- [ ] iOS: `ITSAppUsesNonExemptEncryption` declarado (o app só usa HTTPS: marcar isenta) para não travar cada envio.
- [ ] Permissões Android realmente usadas, e só elas (`ACCESS_FINE/COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, câmera/galeria se houver). Remover o que o Expo adicionar sem uso.
- [ ] Mensagens de permissão no iOS em português, específicas (✅ já existem para localização; revisar câmera e fotos).
- [ ] Ligar o app à API de **produção** por perfil (`production`), nunca por `localhost`.
- [ ] Desligar modos simulados: o app não pode mostrar "código aparece na tela".

### I.3 Material gráfico

| Peça                        | Especificação                                                                                           | Estado |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| Ícone do app                | 1024×1024 PNG sem transparência nem cantos arredondados (iOS); 512×512 (Play)                           | ❌     |
| Ícone adaptativo Android    | Primeiro plano 1024×1024 com margem de segurança + cor de fundo `#1e1a18`; ícone monocromático opcional | ❌     |
| Tela de abertura (_splash_) | Fundo `#1e1a18` com a marca                                                                             | ❌     |
| Fonte Outfit                | Embutir (`expo-font`), hoje não carregada                                                               | ❌     |
| Imagem de destaque (Play)   | 1024×500                                                                                                | ❌     |
| Capturas Android (celular)  | 2–8 imagens, 16:9 ou 9:16, lado entre 320 e 3840 px                                                     | ❌     |
| Capturas iPhone             | 6,9" (1320×2868) obrigatório; 6,5"/6,3" conforme exigência atual da App Store Connect                   | ❌     |
| Capturas iPad               | Só se marcar suporte a tablet; **desligar `supportsTablet`** para dispensar                             | 👤     |
| Vídeo de prévia             | Opcional                                                                                                | —      |

Sugestão de 6 capturas (com dados de exemplo, **sem pessoa real, telefone ou endereço reais**): 1) motorista online com oferta; 2) comparativo "quanto fica com você"; 3) acompanhamento do cliente no mapa; 4) pagamento e recibo; 5) aba AMMA (cotas, nível, assembleia); 6) pontos de acolhida no mapa. Gerar do _staging_ com o seed.

### I.4 Textos da ficha (português do Brasil)

- [ ] **Nome**: "AMMA" (até 30 caracteres); subtítulo iOS (30): ex. "Entregas e corridas justas".
- [ ] **Descrição curta** (Play, 80): ex. "Entregas e corridas da associação dos motoboys e motoristas de João Pessoa."
- [ ] **Descrição completa** (4000): o que é, para quem (passageiro, comerciante, entregador, motorista), taxa transparente (10% + associação opcional), cotas e assembleia, pontos de acolhida, segurança (PIN, link de viagem, emergência). **Não prometer** o que não existe (seguro, crédito, financiamento) nem cobrir áreas fora de João Pessoa-PB.
- [ ] **Palavras-chave** iOS (100), categoria (Mapas e navegação ou Viagens/Negócios — escolher uma), classificação etária (preencher o questionário com franqueza; contém localização e compras).
- [ ] **Novidades** da versão; **URL de suporte** (página ou e-mail que responda); **URL da política de privacidade** (obrigatória); **URL de marketing** (o `apps/site` serve).
- [ ] **Conta de teste para a revisão**: como o login é por SMS, a Apple e o Google **não conseguem receber o código**. Criar um **número de revisão** (ou código fixo só para esse telefone no ambiente de produção, controlado por variável e registrado/auditado), com contas passageiro e motorista já aprovadas, e escrever o passo a passo nas "Notas para o revisor". Sem isso a análise é rejeitada.
- [ ] Notas ao revisor também explicam: o app é de uma associação de trabalhadores, opera apenas em João Pessoa-PB, motorista passa por aprovação documental.

### I.5 Justificativa da localização em segundo plano

Esta é a maior causa de rejeição para este app. Preparar **antes** de enviar.

**Google Play** (Declaração de permissões → Localização em segundo plano; exige **vídeo** e texto):

- [ ] Funcionalidade que depende: _"Receber pedidos de corrida/entrega próximos enquanto o motorista está online, mesmo com a tela bloqueada ou outro app em uso, e atualizar a posição durante o trajeto para o cliente acompanhar."_
- [ ] Por que primeiro plano não basta: o motorista usa o app de navegação por cima e bloqueia a tela; sem 2º plano o despacho perde a posição e o cliente deixa de ver o veículo.
- [ ] Vídeo (até 30 s, legendado): motorista abre o app → tela de consentimento própria (✅ `LocationConsentScreen`) → permissão do sistema "Permitir o tempo todo" → fica online → aparece a notificação persistente → bloqueia a tela e a posição continua.
- [ ] Mostrar a **divulgação em destaque** (_prominent disclosure_) **antes** do diálogo do sistema, com o texto de `shared/location-consent.ts`: quando coletamos, para quê, em 2º plano, o que **não** fazemos, como desligar. ✅ já existe; confirmar que o texto da loja e o do app dizem a mesma coisa.
- [ ] Declarar também o serviço em primeiro plano do tipo localização (`FOREGROUND_SERVICE_LOCATION`) com a justificativa equivalente.
- [ ] Dizer que a coleta **só ocorre com o motorista online**, guarda apenas a última posição (sem histórico, exceto corrida: 90 dias para denúncia/emergência) e para ao ficar offline ou excluir a conta.

**App Store** (guideline 5.1.1 e 2.5.4; `UIBackgroundModes: location`):

- [ ] Textos de `NSLocationAlwaysAndWhenInUseUsageDescription` e `NSLocationWhenInUseUsageDescription` (✅ existem) coerentes com o uso real.
- [ ] Nas notas do revisor: _"Localização em segundo plano só para o perfil Motorista, apenas enquanto está online, para continuar recebendo pedidos e permitir ao cliente acompanhar a entrega. O usuário pode ficar offline a qualquer momento."_
- [ ] O passageiro/cliente **não** usa localização em 2º plano: garantir que o app do cliente não peça "sempre".
- [ ] Indicador de uso no iOS (barra azul) é esperado; não tentar esconder.

### I.6 Privacidade nas lojas

- [ ] **Play — Segurança dos dados**: declarar localização precisa (coletada, compartilhada com o cliente durante a entrega), nome, telefone, CPF e data de nascimento (motorista), fotos/documentos, histórico de compras/pagamento, identificadores do aparelho (token de push), diagnósticos de falha (Sentry). Marcar criptografia em trânsito e **exclusão disponível**.
- [ ] **Play — URL de exclusão de conta** (obrigatória): página pública explicando como excluir a conta e quais dados permanecem anonimizados e por quê. O fluxo dentro do app também é exigido.
- [ ] **App Store — Rótulos de privacidade** ("Nutrition labels"): mesmos dados; marcar "vinculado ao usuário" e finalidade (funcionalidade do app); sem rastreamento entre apps → **não** pedir ATT.
- [ ] **Apple 5.1.1(v)**: exclusão de conta dentro do app (✅ `DELETE /me`; confirmar botão visível).
- [ ] Declaração de **anúncios**: não há. **Conteúdo gerado por usuário** (avaliações, denúncias): Apple 1.2 exige filtro, denúncia e bloqueio — ✅ denúncia e bloqueio existem no painel; ❌ falta **bloquear usuário** pelo próprio app e contato de suporte visível.
- [ ] **Pagamentos**: serviços físicos (corrida/entrega) podem usar pagamento externo sem o IAP da Apple; **não** vender nada digital dentro do app. Cotas são registro contábil, não produto digital: descrever assim.
- [ ] **Marketplace/transporte**: confirmar exigências locais de licenciamento do serviço (ver abaixo) caso a loja peça.

### I.7 Itens específicos do app

- [ ] Funciona só em João Pessoa-PB: restringir a distribuição ao **Brasil** (ou declarar a limitação).
- [ ] Verificação de motoristas e documentos: descrever na ficha para a revisão de segurança.
- [ ] Mencionar onde o usuário reporta abuso e como contatar a associação.
- [ ] Versão mínima de SO compatível com Expo 58/React Native 0.88 (conferir o exigido por `expo`).

---

## J. Legal e operação (👤)

- [ ] Estatuto/atas da AMMA permitem operar o app; quem responde pelo app perante a Justiça.
- [ ] Regras municipais de transporte remunerado individual e de entrega em João Pessoa (a Etapa 7 criou `municipal-rules` como configuração; o conteúdo precisa de revisão jurídica).
- [ ] **Contrato do motorista/entregador** e **termos do passageiro/comerciante**: relação (associado, não empregado), taxa, bloqueio e recurso (✅ fluxo existe), responsabilidade em acidente.
- [ ] Seguro de responsabilidade civil/acidentes pessoais de terceiros, se houver, contratado em seguradora (diferente do "seguro mútuo" interno).
- [ ] Emissão fiscal: o app **guarda recibo**, não emite nota (pendência desde a Etapa 6). Definir com contador.
- [ ] Atendimento: canal, horário, quem responde; modelo de resposta a usuário bloqueado e a denúncia.
- [ ] Plano de comunicação do lançamento e **lançamento gradual**: começar com poucos motoristas/bairros (lançamento em fases na Play e liberação por fases na App Store), com meta de aprendizado, antes de abrir ao público.

---

## K. Ordem sugerida

**Semana 0 (paralelo, começa já):** D-U-N-S, contas de loja, advogado (política, termos, seguro), escolha de provedores (SMS, pagamento, hospedagem, Sentry), nomear encarregado.

**Semanas 1–2 (código):** `helmet`/CORS/validação de ambiente; limites de taxa; exigir consentimento de localização no servidor; `GET /me/export`; aceite de termos e reaceite por versão; tela de bloqueio/recurso no app; botão de excluir conta e página pública de exclusão; Dockerfile, deploy e _staging_; Sentry e logs estruturados; `pnpm audit` no CI.

**Semanas 3–4:** ícones, _splash_, fonte, capturas, `eas.json`; build `preview`; roteiros `docs/MOBILE.md` A–I em aparelhos reais; ZAP; teste de restauração do backup; carga; Maestro/Playwright dos fluxos principais.

**Semana 5:** teste fechado/TestFlight com motoristas reais (10–20); corrigir; enviar à revisão (conta de teste + vídeo da localização); lançamento gradual por bairro.

## L. Critério de "pronto para publicar"

Todos os itens da seção **A** concluídos; seções B (A01, A02, A05, A07 e limites de taxa), C, D (exportação, exclusão, consentimentos, política publicada), E (backup restaurado uma vez), F (staging e deploy por _tag_), G (erros e alertas ativos) e H (fluxos principais passando em aparelho real); seção I sem pendências bloqueantes.

# App do motorista — como testar em celular real

> **Status:** tudo abaixo foi escrito e conferido por testes automáticos, empacotamento Android (`expo export`) e um teste ponta a ponta da API. **Nenhum item foi executado em celular de verdade** — este roteiro existe para você fazer isso. Onde algo depende de conta/chave sua (Google Maps, Firebase, EAS), está dito.

## 1. Por que não dá para usar só o Expo Go

| Recurso                                    | Expo Go                                         | Precisa de build próprio (`expo run:android` / EAS) |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| Telas, login, ganhos, simulador            | ✅                                              | ✅                                                  |
| Mapa                                       | ⚠️ funciona, mas com a chave do Expo, não a sua | ✅ com `GOOGLE_MAPS_API_KEY`                        |
| Localização em **segundo plano** (Android) | ❌ limitada                                     | ✅                                                  |
| **Push** de novo pedido (Android)          | ❌ removido do Expo Go a partir do SDK 53       | ✅ (com Firebase/FCM)                               |

Para validar o que a Etapa 5 entrega (segundo plano e push), use um **build de desenvolvimento** no seu Android. iOS exige conta Apple Developer paga; o roteiro abaixo é Android.

## 2. Preparação (uma vez)

1. **Celular Android** com _Opções do desenvolvedor → Depuração USB_ ligada e cabo USB. Computador e celular na **mesma rede Wi-Fi**.
2. **Android SDK** no computador (Android Studio) para `expo run:android`. Alternativa sem SDK local: build na nuvem com EAS (`npm i -g eas-cli`, `eas login`) — **não há `eas.json` no repositório ainda**; crie com `eas build:configure` e um perfil `development` com `"developmentClient": true` (exige também `npx expo install expo-dev-client`).
3. **Chave do Google Maps** (sua): no Google Cloud, ative _Maps SDK for Android_ e crie uma chave. Exporte `GOOGLE_MAPS_API_KEY=...` antes de gerar o app (o `app.config.ts` injeta). Sem a chave o mapa abre cinza.
4. **Push (Android)** — três coisas suas:
   - `eas init` (cria o projeto no Expo) → exporte `EAS_PROJECT_ID=<id>`. Sem isso o app diz “App sem projectId do EAS” e o push fica desligado (o resto funciona).
   - Projeto no **Firebase** com o app Android `br.org.amma.app`; baixe o `google-services.json` e exporte `GOOGLE_SERVICES_JSON=/caminho/google-services.json`.
   - Envie a credencial FCM V1 ao Expo: `eas credentials` → Android → Google Service Account Key.
5. **API acessível pelo celular.** Descubra o IP do computador (`hostname -I`) e:
   ```
   pnpm db:up
   cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..
   pnpm build
   PUSH_MODE=expo API_PORT=3000 node apps/api/dist/main.js     # sem PUSH_MODE=expo o push é só simulado (log)
   ```
   Libere a porta 3000 no firewall se necessário e teste do navegador do celular: `http://IP:3000/health`.
6. **Gerar e instalar o app** (cabo conectado):
   ```
   cd apps/mobile
   export EXPO_PUBLIC_API_URL=http://IP_DO_PC:3000
   export GOOGLE_MAPS_API_KEY=...  EAS_PROJECT_ID=...  GOOGLE_SERVICES_JSON=...
   npx expo run:android
   ```
   O build de _debug_ aceita `http://` (sem HTTPS). Um build de produção **não** aceitaria; em produção a API precisa de HTTPS.
7. Login do app: telefone `+5583999990003` (motorista aprovado do seed). O código OTP aparece na resposta da API (modo simulado); para ver, `curl -X POST http://IP:3000/auth/otp/request -H 'content-type: application/json' -d '{"phone":"(83) 99999-0003"}'`.

## 3. Roteiro de teste (marque cada item)

Para criar pedidos sem o app do cliente, use o script (a posição é a **do seu celular** — pegue no Google Maps, “o que há aqui?”):

```
node scripts/demo-delivery.mjs <LATITUDE> <LONGITUDE> http://IP_DO_PC:3000
```

### A. Consentimento e permissões

- [ ] Primeiro “Ficar online” mostra a **tela de consentimento** (5 blocos) _antes_ de qualquer pedido de permissão do Android.
- [ ] “Agora não” volta ao início, ainda offline, sem pedir permissão.
- [ ] “Concordo e continuar” → o Android pergunta localização; escolha _Durante o uso_; depois, nas configurações, _Permitir o tempo todo_.
- [ ] Negar a localização: o app **não** fica online e mostra “Sem permissão de localização” + botão _Abrir configurações_.
- [ ] Só _Durante o uso_: online funciona e aparece o cartão amarelo “Só com o app aberto”.
- [ ] Aba **Conta → Revogar autorização**: fica offline; no banco, `SELECT * FROM "Consent" WHERE type='LOCALIZACAO_SEGUNDO_PLANO'` fica vazio para o usuário.

### B. Localização e mapa

- [ ] Online com “o tempo todo”: aparece o **aviso fixo** “AMMA — você está online” na barra do Android.
- [ ] Tela apagada por 2 min com o celular parado → ao rodar o script de pedido, a oferta chega (confirma que a posição segue sendo enviada). Confira: `GET /driver/presence` mostra `position.at` recente.
- [ ] Caminhando/andando de carro com o app em segundo plano, a posição acompanha (veja a `position` mudar).
- [ ] “Ficar offline”: o aviso fixo some e `GET /driver/presence` volta `position: null`.

### C. Pedido, push e entrega

- [ ] **App aberto:** rode o script → cartão “Novo pedido” aparece em segundos, com contagem regressiva de 30 s, taxa base, associação e _Você recebe_. Recusar não pede motivo e não pune.
- [ ] **App fechado/tela apagada:** rode o script → chega a notificação “Novo pedido de entrega — Você recebe R$ … · corrida de … km” (som + vibração). Tocar abre o app já com a oferta. _(Precisa de `PUSH_MODE=expo` + passos 4 e 5.)_
- [ ] Notificação **não** mostra endereço.
- [ ] Deixar a oferta vencer: o cartão some sozinho.
- [ ] Aceitar → abre a aba **Entrega** com mapa, rota vermelha até a coleta, marcadores verde/preto e o seu ponto.
- [ ] Percorrer as 4 etapas pelos botões; a rota muda para a entrega depois de “Confirmar coleta”.
- [ ] “Não consigo seguir” só aparece até a coleta e pede confirmação.
- [ ] **Emergência** pede escolha e abre o discador com 190/192/193.
- [ ] “Abrir no app de mapas” abre o Google Maps com o destino.
- [ ] Ao concluir: volta ao início com “Entrega concluída” e os ganhos do dia sobem.

### D. Ganhos

- [ ] Início: “Ganhos de hoje” com “Na AMMA / Num app com 25% / A mais no seu bolso”.
- [ ] Ganhos: 7 barras (hoje em preto), simulador (R$ 11,00 a 2% → R$ 9,68), histórico.
- [ ] Puxar a tela para baixo atualiza.

### E. Sem conexão e falhas

- [ ] Modo avião no Início: faixa preta “Sem internet…”; ao desligar, reconecta sozinho.
- [ ] Parar a API (`Ctrl+C`) com o app online: faixa amarela “Reconectando ao tempo real…”; ao subir de novo a API, volta.
- [ ] Abrir o app com a API parada: tela “Não deu certo” + _Tentar de novo_.
- [ ] Com entrega em andamento e sem internet, o botão da etapa fica desabilitado.
- [ ] Matar o app (arrastar da lista de recentes) estando online: a posição continua chegando (tarefa do sistema) — **teste mais sujeito a variação por fabricante** (Xiaomi, Samsung e outros matam apps em segundo plano; veja <https://dontkillmyapp.com>).

### F. App do cliente e do comerciante (Etapa 6)

Entre com a passageira do seed (`+5583999990002`) ou a comerciante (`+5583999990006`). Para ver o pedido andando, deixe um motorista online (`+5583999990003`) em outro aparelho/emulador, perto da coleta. **Tudo aqui usa o pagamento de teste:** nenhum Pix ou cartão real é cobrado.

- [ ] **Entrega** (aba): coleta, entrega e descrição obrigatórias; “Usar minha localização” preenche a coleta (pede permissão _durante o uso_).
- [ ] Endereço que o aparelho não acha → mensagem dizendo qual (coleta ou entrega). Endereços sem cidade são buscados em João Pessoa.
- [ ] “Ver preço” mostra mapa com os dois pontos, distância, tempo e **total antes de pagar**. Nada é cobrado até “Confirmar e pagar”.
- [ ] **Cartão** `4242 4242 4242 4242` (qualquer validade futura e CVV de 3 dígitos): pedido nasce pago e vai ao motorista. `4000 0000 0000 0002` → “Cartão recusado pelo banco” e **nenhum pedido** aparece em Pedidos. Número com dígito trocado → “Confira o número do cartão.”
- [ ] **Pix:** abre o acompanhamento com “Aguardando o pagamento”, código `PIX-SIMULADO…`, contagem de 15 min e o botão **Simular pagamento do Pix** → vira “Pago” e o motorista recebe a oferta. Sem pagar, o motorista **não** recebe nada.
- [ ] Deixar um Pix vencer (ou no banco: `UPDATE "Payment" SET "pixExpiresAt" = now() WHERE method='PIX'` e esperar ~3 s): pedido “Cancelado — O Pix não foi pago a tempo.”
- [ ] **Acompanhar:** etapas mudam conforme o motorista avança; o ponto vermelho do motorista anda no mapa; com a API parada aparece a faixa amarela (consulta a cada 5 s) e volta sozinho.
- [ ] **Cancelar** até a coleta pede confirmação; pago → “O valor pago será devolvido” e, depois, pagamento “Estornado”. Depois de coletado o botão não existe.
- [ ] **Entregue:** pede nota (1–5 estrelas, obrigatória) e comentário opcional; depois mostra “Sua avaliação”. Não dá para avaliar duas vezes.
- [ ] **Recibo** (pago ou estornado): número `AMMA-AAAAMMDD-XXXXXXXX`, valores, forma de pagamento, aviso “não é nota fiscal”; “Compartilhar” abre o menu do sistema. O motorista **não** vê o recibo nem o pagamento.
- [ ] **Pedidos:** “Em andamento” em cima, “Anteriores” embaixo, com situação do pagamento; a aba Pedidos mostra bolinha enquanto há pedido aberto.
- [ ] **Comerciante:** abas Loja e Relatório aparecem só para ele. Loja: nome, CNPJ opcional (máscara; inválido é recusado), endereço; depois disso a coleta em Pedir já vem preenchida. Sem cadastro, Pedir mostra o convite para cadastrar.
- [ ] **Relatório:** 7/30/90 dias, gasto (só pago), pedidos, cancelados, gasto médio, estornado e barras por dia.
- [ ] Conta: sair e excluir conta funcionam; a exclusão é recusada com pedido em andamento.

> Mapa: como no app do motorista, o mapa real do Android precisa de `GOOGLE_MAPS_API_KEY` (build próprio).

### Roteiro G — Corridas de passageiro (Etapa 7)

Precisa de **dois aparelhos/emuladores**: passageira `+5583999990002` e motorista de **carro** `+5583999990007` (mulher verificada, no seed). O motorista `...0003` é de moto: serve para conferir que **não** recebe corrida de carro. Deixe o motorista online perto do ponto de saída. Tudo simulado (Pix/cartão de teste, rota em linha reta sem `ROUTE_PROVIDER=mapbox`).

Passageira (aba **Corrida**):

- [ ] **Estimativa:** saída e destino → “Ver preços e tempo” mostra mapa, distância, **tempo de viagem** e, por tipo de veículo, **preço** e “Motorista chega em X min” (ou “Nenhum motorista por perto agora”). Só aparecem os tipos liberados (carro; **moto só depois de a associação liberar**). Nada é cobrado até “Pedir …”.
- [ ] Trocar de tipo muda o preço e o botão (“Pedir carro · R$ …”); avisos do tipo (ex.: capacete na moto) aparecem abaixo.
- [ ] **Prefiro motorista mulher** (switch): a estimativa passa a contar só mulheres verificadas; sem nenhuma por perto o pedido fica “Buscando motorista” até acabar o tempo (e estorna) — não cai em outro motorista. Se a configuração desligar a opção, o switch some.
- [ ] Pagar com Pix ou cartão de teste igual à entrega; o pedido abre o acompanhamento.
- [ ] **Acompanhamento:** “Motorista a caminho de você” → “Você embarcou” → “Em viagem” → “Viagem concluída”. Saída/Destino no lugar de Coleta/Entrega.
- [ ] **Confira o motorista:** foto, nome, nota (“sem avaliações ainda” no início), **placa** e modelo — a placa precisa bater com o carro que chegar — e o **PIN de embarque** grande. Depois de embarcar o PIN some.
- [ ] **Compartilhar minha viagem** abre o menu do sistema com um link; abra o link no navegador do PC: página com motorista, veículo, saída, destino e posição, atualizando sozinha, **sem telefone nem valor**. Revogar não tem botão no app ainda (só pela API).
- [ ] **🚨 Emergência:** pede confirmação, oferece 190/192/193 e “Só avisar a associação”; texto “A associação foi avisada”. No banco/API (`GET /admin/safety/alerts`) o alerta aparece com a posição; o link do contato passa a exibir a faixa vermelha.
- [ ] **Denunciar:** escolha a categoria, descreva (mín. 10 letras) → “Denúncia enviada”. Nunca pede nem mostra a identidade da outra pessoa.
- [ ] Cancelar até embarcar → estorno; depois de embarcar não há botão de cancelar.
- [ ] Concluída: **Como foi a viagem?** (nota 1–5) e a nota do motorista só aparece como média.

Motorista (`...0007`):

- [ ] A oferta diz **Nova corrida**, o tipo de veículo, “Motorista mulher” quando for o caso, **nome e nota do passageiro**, Embarque/Destino e o dinheiro (taxa 10%, associação, líquido) como nas entregas.
- [ ] Ao chegar: **Confirmar embarque** fica desligado até digitar os 4 dígitos do PIN que o passageiro mostra. PIN errado → mensagem; 5 erros travam o embarque (o passageiro cancela).
- [ ] Os botões seguem “Iniciar a viagem” → “Concluir a viagem”. 🚨 Emergência avisa a associação; **Denunciar** fica disponível.
- [ ] Ao concluir: “Corrida concluída ✓” e **Como foi o passageiro?** (opcional; “Agora não” dispensa).
- [ ] **Conta → Corridas de passageiro:** lista cada veículo com “Habilitado” ou o que falta (idade do veículo, documento…), botão **Enviar:** para os documentos pedidos, e a declaração de gênero (Feminino mostra “Aguardando a conferência” até o admin conferir). Com as regras padrão aparece o aviso **“NÃO confirmados”**.
- [ ] Motorista de moto (`...0003`) **não** recebe corrida de carro; recebe entregas normalmente.

### Roteiro H — Associação (Etapa 8)

Motorista `+5583999990003` (12 cotas no seed) e, para comparar, `...0007` (35 cotas). Para dar cotas a outro motorista ou abrir votações/grupos, use a API de admin (`docs/API.md` seção 14). Aba **AMMA**.

- [ ] **Resumo:** nível (Bronze/Prata/Ouro), cotas, barra de progresso e “Faltam N cotas … para o nível Prata”. Motorista sem cota vê “Você ainda não é sócio”.
- [ ] **Taxa:** tocar em 0% / 2% / 4% grava na hora; a escolha continua marcada ao reabrir. Vale para a próxima corrida concluída (confira a cota na tela depois).
- [ ] **Assembleia:** a proposta de exemplo aparece como “Votação aberta”. Abra, vote **Sim**, volte e reabra: “Seu voto atual: Sim”. Mude para **Não**: vale o último. Não há contagem enquanto estiver aberta.
- [ ] Com a votação vencida (admin cria uma com prazo de 24 h e você espera, ou ajuste no banco), a proposta mostra o **resultado**, o seu voto e nenhum botão de voto.
- [ ] **Compra:** “Motos 2027 (exemplo)” → entrar na fila mostra a **posição** e os pontos; os dois sócios do seed aparecem ordenados por cotas e dias. Sair da fila só sem aportes.
- [ ] **Aporte:** valor abaixo do mínimo é recusado na tela; R$ 100,00 aparece como confirmado e entra no “Total aportado”. R$ 13,13 simula parceiro fora do ar (mensagem; nada registrado) e acima de R$ 10.000,00 simula recusa. O texto **“SIMULAÇÃO: nenhum dinheiro é movimentado”** está visível.
- [ ] **Seguro:** “Novo pedido de seguro” valida data (dd/mm/aaaa), texto e valor; depois de enviado abre o acompanhamento. **Anexar foto** (galeria) envia o arquivo e aumenta “Anexos”. **Cancelar pedido** encerra.
- [ ] Peça ao admin para analisar e decidir (API): a linha do tempo ganha “Em análise” e depois “Aprovado/Negado” com o **motivo escrito por uma pessoa**; aprovado mostra o valor aprovado e os botões de anexar/cancelar somem.
- [ ] **Sobras:** depois de o admin fechar um ano, o resumo lista “Sobras de AAAA”, o valor e o peso do uso.

## 4. Problemas comuns

| Sintoma                              | Causa provável                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| “Sem conexão com o servidor”         | `EXPO_PUBLIC_API_URL` com `localhost`/`10.0.2.2` em celular físico; use o IP do PC; firewall.                                                 |
| Mapa cinza                           | `GOOGLE_MAPS_API_KEY` ausente ou sem _Maps SDK for Android_ ativado.                                                                          |
| “App sem projectId do EAS”           | Falta `EAS_PROJECT_ID` (passo 4).                                                                                                             |
| Push nunca chega                     | API sem `PUSH_MODE=expo`; sem FCM/`google-services.json`; permissão de notificação negada; economia de bateria. Veja o log da API (`[Push]`). |
| Nunca recebe oferta                  | Raio de 3 km: o script usa a **sua** posição; motorista precisa estar online com posição < 60 s.                                              |
| Oferta chega, mas a rota não aparece | Provedor simulado traça uma reta entre dois pontos; use `ROUTE_PROVIDER=mapbox` + token para ruas.                                            |

## 5. Rodar só os testes automáticos

```
pnpm --filter @amma/shared build
pnpm --filter @amma/mobile test       # Jest: 193 testes (motorista e cliente): componentes, hooks, provider e WebSocket
pnpm --filter @amma/mobile typecheck && pnpm lint
```

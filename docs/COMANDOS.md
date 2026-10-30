# Comandos do dia a dia

Rode tudo a partir da raiz do projeto (`/home/lucas/Documentos/projetos/amma-app`), salvo quando indicado.

## 1. Subir o ambiente para desenvolver

Ordem normal, cada item em um terminal.

| Comando | O que faz |
| --- | --- |
| `pnpm install` | Instala as dependências de todo o monorepo. Rode depois de baixar código novo ou mudar `package.json`. |
| `pnpm db:up` | Sobe o Postgres (PostGIS, porta 5433) e o Redis (6379) com Docker. |
| `pnpm db:down` | Para o Postgres e o Redis. Os dados continuam no volume. |
| `cd apps/api && pnpm prisma:deploy && cd ../..` | Aplica as migrações pendentes no banco. Rode depois de puxar código com migração nova. |
| `cd apps/api && pnpm db:seed && cd ../..` | Cria os dados de exemplo (usuários, tabela de preço). Pode repetir sem problema. |
| `pnpm build` | Compila `shared` e `api`. **Obrigatório depois de mudar código da API ou do shared**, porque a API roda o código compilado. |
| `API_PORT=3000 node apps/api/dist/main.js` | Sobe a API. Para parar: `Ctrl+C`. Se mudar o código, pare, rode `pnpm build` e suba de novo. |
| `curl localhost:3000/health` | Confirma que a API está de pé (deve responder `ok`). |

### Celular físico e emulador

| Comando | O que faz |
| --- | --- |
| `hostname -I` | Mostra o IP do computador na rede (use o primeiro, ex.: `192.168.0.14`). |
| `cd apps/mobile && EXPO_PUBLIC_API_URL=http://SEU_IP:3000 npx expo start -c` | Sobe o Metro apontando o app para a API. `-c` limpa o cache, necessário quando a variável muda. |
| `cd apps/mobile && EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo start -c` | Mesmo, para o **emulador** Android (`10.0.2.2` é o computador visto de dentro dele). |
| `cd apps/mobile && npx expo run:android` | Gera e instala o build de desenvolvimento no Android (necessário para push e localização em segundo plano; o Expo Go não serve). Detalhes e chaves em `docs/MOBILE.md`. |

Celular e computador precisam estar na mesma rede Wi-Fi. Teste no navegador do celular: `http://SEU_IP:3000/health`.

## 2. Login no app (modo de desenvolvimento)

| Comando | O que faz |
| --- | --- |
| `curl -X POST localhost:3000/auth/otp/request -H 'content-type: application/json' -d '{"phone":"(83) 99999-0003"}'` | Pede o código de login. Em modo simulado o código vem na resposta (`devCode`) e no log da API. |

Telefones do seed: admin `...0001`, passageira `...0002`, motorista aprovado `...0003`, pendente `...0004`, reprovado `...0005`, comerciante `...0006` (todos `+5583999990XXX`).

| Comando | O que faz |
| --- | --- |
| `cd apps/api && pnpm db:approve` | Aprova um motorista pelo script (útil para liberar um cadastro novo). |
| `node scripts/demo-delivery.mjs LAT LNG http://SEU_IP:3000` | Cria um pedido de teste perto da coordenada informada (use a posição do seu celular). O motorista precisa estar online e a menos de 3 km. |

## 3. Testes e verificações

| Comando | O que faz |
| --- | --- |
| `pnpm test` | Testes unitários de tudo (shared, api, mobile). Não precisa de banco. |
| `pnpm --filter @amma/api test:int` | Testes de integração da API. Precisa de `pnpm db:up`. Usa o banco `amma_test`, nunca o de desenvolvimento. |
| `pnpm --filter @amma/mobile test` | Só os testes do app (Jest). |
| `pnpm --filter @amma/shared test` | Só os testes das regras compartilhadas. |
| `pnpm lint` | ESLint em tudo e a regra de importação entre apps. |
| `pnpm typecheck` | Confere os tipos TypeScript. |
| `pnpm format` | Formata o código com Prettier. |
| `npx prettier --check .` | Só verifica a formatação, sem alterar. |
| `cd apps/mobile && npx expo export --platform android` | Gera o bundle Android para provar que o app empacota. |

Antes de commitar, o ideal é: `pnpm build && pnpm test && pnpm lint && pnpm typecheck`.

## 4. Banco de dados

| Comando | O que faz |
| --- | --- |
| `cd apps/api && pnpm prisma:migrate` | Cria uma migração nova a partir de mudanças no `schema.prisma` (desenvolvimento). |
| `cd apps/api && pnpm prisma:generate` | Regenera o cliente Prisma depois de mudar o schema. |
| `docker exec -it amma-app-postgres-1 psql -U amma -d amma` | Abre o console SQL do banco de desenvolvimento. |
| `docker exec amma-app-postgres-1 psql -U amma -d amma -c 'SELECT * FROM "Delivery" ORDER BY "createdAt" DESC LIMIT 5;'` | Consulta rápida (exemplo: últimos pedidos). |

## 5. Problemas comuns

| Sintoma | Causa e solução |
| --- | --- |
| App: "Sem conexão com o servidor" | A API não está rodando (`curl localhost:3000/health`) ou o app aponta para o endereço errado. Suba a API e reinicie o Metro com `EXPO_PUBLIC_API_URL` e `-c`. |
| App: `Cannot GET /driver/...` | A API em execução é uma versão antiga. Pare, rode `pnpm build` e suba de novo. |
| API não sobe: erro de banco | Rode `pnpm db:up` e depois `pnpm prisma:deploy` (dentro de `apps/api`). |
| API não sobe: `JWT_SECRET` | Falta no `.env`. Gere com `openssl rand -hex 32` e coloque em `JWT_SECRET=`. Se não existir `.env`, `cp .env.example .env`. |
| Mapa cinza no celular | Falta `GOOGLE_MAPS_API_KEY` no build. Ver `docs/MOBILE.md`. |
| Nunca chega oferta | Motorista precisa estar online, com posição recente e a menos de 3 km do pedido. |
| Mudou o `shared` e a API/app não vê | Rode `pnpm build` (eles usam o `shared` compilado). |

## 6. Onde está cada documentação

- `docs/PROGRESSO.md`: o que foi feito em cada etapa e o que falta.
- `docs/DECISOES.md`: escolhas feitas e os motivos.
- `docs/API.md`: todas as rotas da API.
- `docs/MOBILE.md`: roteiro para testar o app em celular real.
- `docs/ARQUITETURA.md`: estrutura do projeto.
- `docs/LGPD.md`: tratamento de dados pessoais.
- `docs/REGRAS_FINANCEIRAS.md`: taxas, cotas e ledger.

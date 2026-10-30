# AMMA — Associação dos Motoboys e Motoristas de Aplicativo

Cidade: João Pessoa-PB, Brasil. Idioma da interface: português do Brasil.
Desenvolvimento: desenvolvedor solo → preferir soluções simples, bem documentadas e fáceis de manter.

## Produto

App de **entregas** e de **corridas de passageiros** (estilo Uber), pensado para valer a pena a quem trabalha.

### Regras de preço

- Taxa base: **10% por corrida**.
- Taxa de associação **opcional**: 0%, 2% ou 4%, que vira **cotas** do trabalhador (**1 cota = R$ 5**).
- **Piso** de valor por km e por minuto.

### Perfis

Passageiro/cliente, entregador/motorista, comerciante e administrador da associação.

### Associação

- Cotas e níveis: **Bronze 0–29**, **Prata 30–59**, **Ouro 60+**.
- Sobras anuais.
- Seguro mútuo.
- Compra coletiva de veículos (fila por cotas e tempo).
- Assembleia com **1 sócio = 1 voto**.

### Pontos de acolhida

Locais com água, banheiro e carregador; mapa, filtro, check-in e avaliação.

- Três tipos: **espaço público**, **casa parceira** e **comércio**. A casa parceira passa por checklist de segurança e aprovação da associação, e o anfitrião ganha um benefício (crédito ou desconto).
- Check-in só perto do ponto; avaliação dos dois lados (o motorista avalia o ponto, o anfitrião avalia o motorista).
- Denúncia e remoção de pontos mal avaliados ou denunciados. Detalhes e decisões em `docs/API.md` (seção 15) e `docs/DECISOES.md`.

### Limites regulatórios

- O app **NÃO capta dinheiro nem faz crédito** por conta própria.
- Pagamentos e financiamento passam por **parceiros regulados** (consórcio e cooperativa de crédito).
- No app, cotas e saldos são **registros contábeis**.

### Marca

Vermelho `#c9221a`, preto `#1e1a18`, creme `#fbf8f4`; fonte **Outfit**.

## Stack

Monorepo:

- `apps/mobile` — React Native + Expo + TypeScript
- `apps/api` — NestJS + TypeScript
- `apps/admin` — Next.js (mais tarde)
- `packages/shared` — tipos e regras compartilhados

Infra: PostgreSQL + PostGIS (Prisma ou TypeORM), Redis (cache e filas), WebSocket (tempo real).

Convenções: dinheiro **sempre em centavos (inteiros)**; datas em **UTC**.

### Gerenciamento do monorepo

- **pnpm workspaces + Turborepo** (cache e execução apenas do que mudou).
- **Regras de importação:** `apps/mobile`, `apps/api` e `apps/admin` podem importar de `packages/shared`, mas **nunca uns dos outros**. (Fazer cumprir por lint/checagem automática.)
- **Dependências comuns em um lugar só** (raiz do workspace / catálogo do pnpm / configs compartilhadas), sem duplicar versões entre apps.
- A estrutura será documentada em `docs/ARQUITETURA.md` (criado na Etapa 1).
- **CI e deploy separados por app**, acionados só quando as pastas relevantes mudarem (ex.: `apps/api/**` + `packages/shared/**` + config raiz para a API).

## Regras de trabalho

1. No início de cada etapa, ler `docs/PROJETO.md`, `docs/DECISOES.md` e `docs/PROGRESSO.md` (se existirem) e seguir o que já foi decidido.
2. Antes de codar, mostrar plano curto e perguntar só o estritamente necessário.
3. Escrever testes para regras de negócio (taxas, cotas, estados da corrida).
4. No fim da etapa: atualizar `docs/PROGRESSO.md` (feito, como rodar, o que falta) e `docs/DECISOES.md` (escolhas e motivos), e listar comandos de teste.
5. Não inventar dados, chaves ou integrações: usar variáveis de ambiente e modo sandbox/simulado.
6. Código simples, comentado onde a regra não for óbvia.
7. Respeitar as regras de importação entre apps e manter `docs/ARQUITETURA.md` atualizado quando a estrutura mudar.
8. No fim de cada etapa, entregar também uma **descrição pronta para commit** (título + corpo curto, em português). Quem commita é o usuário.

# Decisões

| Data       | Decisão                                                                          | Motivo                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-29 | pnpm 9 + Turborepo + catálogo de versões                                         | Pedido do projeto; cache e execução só do que mudou                                                                                |
| 2026-10-29 | Prisma 6 (com `postgresqlExtensions` p/ PostGIS)                                 | Mais simples para dev solo. Consultas geoespaciais usarão SQL cru                                                                  |
| 2026-10-29 | Versões "conservadoras": TypeScript 5.9, NestJS 11, Prisma 6, Vitest 3, ESLint 9 | O npm já traz majors mais novos (TS 7, Nest 12, Prisma 7/8-rc); preferi estabilidade e compatibilidade com Node 20. Revisar depois |
| 2026-10-29 | Expo 58 / RN 0.88 (alinhado por `expo install --fix`)                            | Versões mutuamente compatíveis ditadas pelo Expo                                                                                   |
| 2026-10-29 | `node-linker=hoisted` no `.npmrc`                                                | Compatibilidade do Metro com monorepo pnpm                                                                                         |
| 2026-10-29 | Postgres exposto na porta **5433** (configurável por `POSTGRES_PORT`)            | A 5432 já estava ocupada na máquina de desenvolvimento                                                                             |
| 2026-10-29 | Testes com Vitest (shared e api)                                                 | Simples e rápido; mesma ferramenta em todo o monorepo                                                                              |
| 2026-10-29 | CI em GitHub Actions (assumido) com filtro de `paths`; deploy é esqueleto        | Destino de deploy ainda indefinido; não inventar integrações                                                                       |
| 2026-10-29 | Dinheiro em centavos (`Cents`), datas em UTC                                     | Definido no projeto                                                                                                                |

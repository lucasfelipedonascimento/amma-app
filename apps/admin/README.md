# apps/admin

Painel web da associação (Next.js 15, App Router). Acesso por papel: **ADMIN** faz tudo; **sócio** (motorista com ao menos 1 cota) só lê assembleias, fila da compra coletiva e o orçamento aberto.

```
pnpm db:up && pnpm build                      # raiz: banco, shared e api compilados
node apps/api/dist/main.js                    # API em :3000
pnpm --filter @amma/admin dev                 # painel em http://localhost:3001
```

Entrada com o celular + código por SMS (no modo simulado o código aparece na tela). Admin do seed: `+5583999990001`; sócio do seed: `+5583999990003`.

- `src/middleware.ts` renova a sessão; `src/app/api/proxy` repassa `/admin/*` e `/panel/*` com o token que fica em cookie `httpOnly`.
- Cada página chama `requireSection(...)` e a API confere de novo: o menu só esconde o que a pessoa não pode usar.
- Documentação: `docs/PROGRESSO.md` (Etapa 10), `docs/API.md` (seção 16), `docs/ARQUITETURA.md`.

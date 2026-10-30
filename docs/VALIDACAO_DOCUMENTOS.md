# Leitura e validação automática de documentos (CNH e CRLV)

Estado: **pronto para conectar, nenhuma base oficial contratada**. Hoje a conferência oficial é simulada (`GOV_PROVIDER=sandbox`), então **nada é aprovado sozinho**. Tudo o mais (leitura, dígitos verificadores, cruzamento com o cadastro, recomendação no painel) já funciona.

## Como funciona

```
motorista envia CNH/CRLV ──► API grava (PENDENTE) e responde na hora
                               └─ em segundo plano ─► serviço Python (services/doc-reader)
                                     1. texto: camada de texto do PDF; foto/escaneado → OCR (tesseract)
                                     2. classifica (CNH × CRLV) e extrai os campos
                                     3. valida: CPF, nº de registro da CNH, RENAVAM, placa, validade, EAR
                                     4. consulta a base oficial (só se 1–3 passaram: não gasta consulta paga à toa)
                               ◄─ campos + checagens + resultado da base oficial
                             API cruza com o CADASTRO do motorista (CPF, nome, nascimento, placa, ano, categoria × veículo)
                             e grava DocumentVerification: APROVAR | REVISAR + lista de achados
                               ├─ painel mostra os achados ao lado do documento
                               └─ DOC_AUTO_APPROVE=true e tudo OK em base REAL → aprova sozinho
```

Regras de segurança do desenho:

- **Reprovação nunca é automática.** Divergência vira `REVISAR` com o motivo; quem reprova é uma pessoa.
- **Aprovação automática é opt-in** (`DOC_AUTO_APPROVE=false` por padrão) e só acontece com **todos** os achados `OK`, incluindo a base oficial **real** (provedor `sandbox` nunca conta) e com o documento ainda `PENDENTE` e sendo o envio mais recente do tipo.
- **Falha do leitor ou da base oficial não trava ninguém**: o documento fica `PENDENTE` para análise manual (`INDISPONIVEL` no painel). Dá para refazer a leitura pelo painel ("Refazer leitura").
- **A foto do rosto não é lida** (não há comparação facial): segue 100% manual.
- Documento trocado (mandou CRLV como CNH) não paga consulta à base oficial.

## O que é conferido

| Documento | Local (sem rede) | Contra o cadastro | Base oficial |
|---|---|---|---|
| CNH | CPF, nº de registro (2 dígitos verificadores), validade, observação **EAR** (exerce atividade remunerada) | CPF, nome, data de nascimento, categoria × tipo do veículo (moto exige A; ACC não vale) | situação do CPF e da CNH |
| CRLV | formato da placa, RENAVAM, exercício (ano atual ou anterior) | placa × veículo cadastrado, ano do veículo; proprietário (alerta, não falha: veículo de família/associação é comum) | veículo (placa × RENAVAM) |

## Rodar

```bash
# 1. Leitor
cd services/doc-reader && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DOC_READER_TOKEN=<segredo> .venv/bin/python -m docreader        # 127.0.0.1:8001
# 2. API (.env): DOC_READER_MODE=http, DOC_READER_URL=http://127.0.0.1:8001, DOC_READER_TOKEN=<mesmo segredo>
# 3. Rode a migração: pnpm --filter @amma/api prisma:deploy  (20261107120000_verificacao_documentos)
```

Para ler **fotos** instale o `tesseract` com o idioma `por` (`apt install tesseract-ocr tesseract-ocr-por`); `GET /health` do leitor informa `ocr: true/false`. PDFs digitais não precisam dele.

## Conectar uma base oficial (👤 depende de contrato)

Não existe API gratuita e aberta que confirme CPF, CNH ou veículo: a consulta pública da Receita exige captcha e a automação dela é proibida, e Senatran/Detran só abrem consulta a intermediários autorizados. Opções reais, a avaliar com preço e contrato:

- **Serpro** (Datavalid / consultas Senatran) — o caminho institucional.
- **Intermediários privados** (ex.: Infosimples, outros) que revendem consultas de CPF, CNH e veículo.

A AMMA trata o dado pessoal: o contrato precisa prever LGPD (operador), e a base legal de consulta deve ser validada com o advogado (ver `docs/LGPD.md`).

Passo a passo:

1. Crie `services/doc-reader/docreader/<nome>.py` com uma classe que implemente `GovernmentValidator` (`gov.py`): `check_cpf`, `check_cnh`, `check_vehicle`, devolvendo `GovResult` (`CONFIRMADO | DIVERGENTE | NAO_ENCONTRADO`). Em timeout, 5xx ou limite, lance `GovUnavailableError` (vira `INDISPONIVEL`, **nunca reprovação**).
2. Registre em `REAL_VALIDATORS` (`gov.py`): `REAL_VALIDATORS["<nome>"] = lambda env: MeuProvedor(env["CHAVE"])`. Faltando chave, o serviço falha no boot.
3. Ative com `GOV_PROVIDER=<nome>` e `APP_ENV=production` no serviço.
4. Teste primeiro no ambiente de testes do provedor, com **limite de gasto definido no painel dele**. Mantenha `DOC_AUTO_APPROVE=false` até conferir, na prática, que as recomendações `APROVAR` batem com a análise humana.
5. Só então considere `DOC_AUTO_APPROVE=true`.

O `sandbox` existe só para teste: CPF começando em 0 → não encontrado, em 9 → base fora do ar; registro de CNH começando em 8 → divergente, em 9 → fora do ar; placa terminando em 0 → divergente, em 9 → fora do ar. Os demais → confirmado.

## Limites conhecidos (leia antes de ligar)

- Os extratores foram escritos e testados com **textos de exemplo**, não com documentos reais (não havia amostras). Layouts variam por estado e por emissão (CNH antiga em papel, CNH digital, CRLV-e). **Antes de produção**, teste com documentos reais anonimizados e ajuste `docreader/parsers.py`; campo não lido nunca aprova (vira alerta), então o erro típico é "mandar para revisão", não "aprovar errado".
- OCR de fotos de celular (reflexo, ângulo) tem qualidade variável. Hoje a foto é só reduzida e convertida para tons de cinza; sem correção de perspectiva.
- Não detecta documento **falsificado** ou adulterado: só confere coerência, dígitos e (com base oficial real) existência. A base oficial é o que dá garantia; sem ela a leitura serve de triagem para o revisor.
- CRLV de pessoa jurídica (CNPJ) não tem CPF do proprietário: vira alerta de "proprietário não conferido".
- PDF escaneado (só imagem) depende do `tesseract`; sem ele cai na análise manual.

## LGPD

- O leitor **não guarda nada** (nem arquivo, nem texto, nem campos) e não registra dados em log; é stateless.
- A API grava só campos **mascarados** (CPF `***.982.247-**`, registro/RENAVAM só os 4 últimos dígitos) mais os achados, em `DocumentVerification`. O arquivo original continua no armazenamento privado, aberto só por admin.
- O leitor só deve ser alcançável pela API (rede privada, `127.0.0.1` por padrão) e exige token (32+ caracteres em produção).
- Quando uma base oficial real for ligada, o CPF/placa/RENAVAM sairão do nosso ambiente para o provedor: atualize a política de privacidade e o registro de operadores em `docs/LGPD.md`.

## Variáveis

`DOC_READER_MODE`, `DOC_READER_URL`, `DOC_READER_TOKEN`, `DOC_AUTO_APPROVE` (API) · `GOV_PROVIDER`, `APP_ENV`, `DOC_READER_TOKEN`, `DOC_READER_HOST`, `DOC_READER_PORT` (leitor). Em produção a API não sobe com `DOC_READER_MODE=http` sem URL e token forte, nem com `DOC_AUTO_APPROVE=true` sem o leitor.

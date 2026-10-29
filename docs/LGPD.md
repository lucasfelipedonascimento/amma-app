# LGPD — o que o app faz hoje

| Tema                            | Implementação                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consentimento**               | No cadastro o usuário lê a política e marca o aceite. A API só conclui o cadastro com `acceptPrivacyPolicy: true` e a versão vigente; grava em `Consent` (usuário, tipo, versão, data/hora UTC).                                                                                                                                          |
| **Política de privacidade**     | `GET /legal/privacy-policy` devolve `{ version, text }`. **O texto atual é PLACEHOLDER** (`apps/api/src/legal/privacy-policy.ts`): precisa ser redigido/revisado por advogado antes de publicar.                                                                                                                                          |
| **Minimização**                 | Só são coletados telefone, nome e, para motoristas, CPF, nascimento, veículo e documentos.                                                                                                                                                                                                                                                |
| **Exclusão de conta**           | `DELETE /me`: apaga documentos (banco e arquivos), veículos, perfil, consentimentos, sessões e códigos OTP; anonimiza o usuário (telefone, nome e papéis removidos, `deletedAt` preenchido). Corridas e lançamentos financeiros permanecem **sem identificação** (obrigação contábil). O mesmo telefone pode abrir uma conta nova depois. |
| **Armazenamento de documentos** | Arquivo salvo com nome aleatório, validado pelos bytes (JPG/PNG/PDF, até 5 MB). Somente ADMIN consegue baixar. Em produção, usar bucket privado com criptografia.                                                                                                                                                                         |
| **Segredos**                    | OTP, refresh tokens e senhas nunca são guardados em texto: só hashes (HMAC / SHA-256).                                                                                                                                                                                                                                                    |

## Pendências (antes de produção)

- Texto jurídico definitivo, termos de uso e canal do encarregado (DPO).
- Prazos de retenção por tipo de dado e rotina de expurgo.
- Exportação dos dados do titular (direito de acesso/portabilidade).
- Registro de acesso dos administradores aos documentos (auditoria).

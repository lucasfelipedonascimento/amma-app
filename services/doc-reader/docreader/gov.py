"""Validação em bases oficiais (Receita Federal, Senatran/Detran).

Estado: PRONTO PARA CONECTAR, nenhum provedor contratado. Não existe API gratuita e aberta que confirme
CPF, CNH ou veículo (a consulta pública da Receita exige captcha e é proibida por robô). O caminho real é
um intermediário autorizado (Serpro Datavalid, Infosimples, etc. — ver docs/VALIDACAO_DOCUMENTOS.md).
O padrão é o mesmo dos outros provedores da AMMA: interface + simulado + registro `REAL_VALIDATORS`.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Callable, Protocol

log = logging.getLogger("docreader.gov")


class GovStatus(str, Enum):
    CONFIRMADO = "CONFIRMADO"  # a base oficial confirma os dados
    DIVERGENTE = "DIVERGENTE"  # a base existe mas os dados não batem
    NAO_ENCONTRADO = "NAO_ENCONTRADO"
    INDISPONIVEL = "INDISPONIVEL"  # base/intermediário fora do ar: NÃO é reprovação
    NAO_CONSULTADO = "NAO_CONSULTADO"  # dados locais já invalidaram; não gasta consulta paga


@dataclass
class GovResult:
    scope: str  # CPF | CNH | VEICULO
    provider: str
    status: GovStatus
    detail: str = ""

    def to_json(self) -> dict:
        return {
            "scope": self.scope,
            "provider": self.provider,
            "status": self.status.value,
            "detail": self.detail,
        }


class GovUnavailableError(Exception):
    """Timeout, 5xx ou limite do intermediário. Vira INDISPONIVEL, nunca reprovação."""


class GovernmentValidator(Protocol):
    name: str
    sandbox: bool

    def check_cpf(self, cpf: str, birth_date: date | None) -> GovResult:
        """Situação cadastral do CPF na Receita (regular) e, se vier, a data de nascimento."""

    def check_cnh(self, cpf: str, registration: str, valid_until: date | None) -> GovResult:
        """CNH existe, está vigente (não suspensa/cassada) e pertence a esse CPF."""

    def check_vehicle(self, plate: str, renavam: str, owner_cpf: str | None) -> GovResult:
        """Veículo existe, RENAVAM bate com a placa e não há restrição que impeça o trabalho."""


class SandboxValidator:
    """Simulado, sem rede e determinístico. Regras (para testar cada caminho):

    - CPF começando com 0 → não encontrado; com 9 → base indisponível; demais → confirmado.
    - CNH com registro começando em 8 → divergente; em 9 → indisponível; demais → confirmado.
    - Placa terminando em 0 → divergente; em 9 → indisponível; demais → confirmado.
    """

    name = "sandbox"
    sandbox = True

    def check_cpf(self, cpf: str, birth_date: date | None) -> GovResult:
        if cpf.startswith("0"):
            return GovResult("CPF", self.name, GovStatus.NAO_ENCONTRADO, "CPF não consta (simulado)")
        if cpf.startswith("9"):
            return GovResult("CPF", self.name, GovStatus.INDISPONIVEL, "Base fora do ar (simulado)")
        return GovResult("CPF", self.name, GovStatus.CONFIRMADO, "CPF regular (simulado)")

    def check_cnh(self, cpf: str, registration: str, valid_until: date | None) -> GovResult:
        if registration.startswith("8"):
            return GovResult("CNH", self.name, GovStatus.DIVERGENTE, "CNH não pertence ao CPF (simulado)")
        if registration.startswith("9"):
            return GovResult("CNH", self.name, GovStatus.INDISPONIVEL, "Base fora do ar (simulado)")
        return GovResult("CNH", self.name, GovStatus.CONFIRMADO, "CNH vigente (simulado)")

    def check_vehicle(self, plate: str, renavam: str, owner_cpf: str | None) -> GovResult:
        if plate.endswith("0"):
            return GovResult("VEICULO", self.name, GovStatus.DIVERGENTE, "RENAVAM não bate (simulado)")
        if plate.endswith("9"):
            return GovResult("VEICULO", self.name, GovStatus.INDISPONIVEL, "Base fora do ar (simulado)")
        return GovResult("VEICULO", self.name, GovStatus.CONFIRMADO, "Veículo regular (simulado)")


class SafeValidator:
    """Envolve um provedor real: erro vira INDISPONIVEL e o detalhe técnico vai só para o log
    (sem CPF, placa ou RENAVAM)."""

    def __init__(self, inner: GovernmentValidator):
        self.inner = inner
        self.name = inner.name
        self.sandbox = inner.sandbox

    def _run(self, scope: str, fn: Callable[[], GovResult]) -> GovResult:
        try:
            return fn()
        except GovUnavailableError:
            log.warning("consulta %s indisponível no provedor %s", scope, self.name)
        except Exception:  # noqa: BLE001 - qualquer falha do adaptador não pode derrubar a análise
            log.exception("erro inesperado na consulta %s no provedor %s", scope, self.name)
        return GovResult(scope, self.name, GovStatus.INDISPONIVEL, "Base oficial indisponível")

    def check_cpf(self, cpf, birth_date):
        return self._run("CPF", lambda: self.inner.check_cpf(cpf, birth_date))

    def check_cnh(self, cpf, registration, valid_until):
        return self._run("CNH", lambda: self.inner.check_cnh(cpf, registration, valid_until))

    def check_vehicle(self, plate, renavam, owner_cpf):
        return self._run("VEICULO", lambda: self.inner.check_vehicle(plate, renavam, owner_cpf))


# Provedores reais por `GOV_PROVIDER`. Implemente `GovernmentValidator` num módulo novo, registre aqui
# e siga docs/VALIDACAO_DOCUMENTOS.md. A fábrica lê as próprias chaves do ambiente e falha no boot se faltar.
REAL_VALIDATORS: dict[str, Callable[[dict[str, str]], GovernmentValidator]] = {}


def create_validator(env: dict[str, str] | None = None) -> GovernmentValidator:
    env = dict(os.environ) if env is None else env
    mode = env.get("GOV_PROVIDER", "sandbox")
    if mode == "sandbox":
        if env.get("APP_ENV") == "production":
            raise RuntimeError("GOV_PROVIDER=sandbox não pode ser usado em produção")
        log.warning("Usando validação governamental SIMULADA (GOV_PROVIDER=sandbox)")
        return SandboxValidator()
    factory = REAL_VALIDATORS.get(mode)
    if not factory:
        known = " | ".join(["sandbox", *REAL_VALIDATORS])
        raise RuntimeError(f"GOV_PROVIDER inválido: {mode} (disponíveis: {known})")
    return SafeValidator(factory(env))

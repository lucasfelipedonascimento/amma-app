"""Orquestra: lê o arquivo, interpreta, valida localmente e consulta a base oficial."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .gov import GovernmentValidator, GovResult, GovStatus
from .parsers import CnhFields, CrlvFields, classify, parse_cnh, parse_crlv
from .text import extract_text
from .validators import (
    is_valid_cnh_number,
    is_valid_cpf,
    is_valid_renavam,
    normalize_plate,
)

EXPECTED_KIND = {"CNH": "CNH", "DOCUMENTO_VEICULO": "CRLV"}


def sniff_mime(data: bytes) -> str | None:
    """Tipo pelo conteúdo (nunca pelo que o cliente declarou)."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


@dataclass
class Check:
    code: str
    ok: bool | None  # None = não deu para saber (campo não lido)
    detail: str = ""

    def to_json(self) -> dict:
        return {"code": self.code, "ok": self.ok, "detail": self.detail}


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _cnh_checks(f: CnhFields, today: date) -> list[Check]:
    return [
        Check("CPF_VALIDO", None if not f.cpf else is_valid_cpf(f.cpf), "Dígitos verificadores do CPF"),
        Check(
            "REGISTRO_VALIDO",
            None if not f.registration else is_valid_cnh_number(f.registration),
            "Dígitos verificadores do nº de registro",
        ),
        Check(
            "CNH_VIGENTE",
            None if not f.valid_until else f.valid_until >= today,
            "Validade da CNH não vencida",
        ),
        Check("CNH_EAR", f.has_ear, "Observação EAR (exerce atividade remunerada)"),
    ]


def _crlv_checks(f: CrlvFields, today: date) -> list[Check]:
    # O licenciamento do ano anterior ainda é aceito até o fim do ano corrente (prazo do Detran).
    return [
        Check("PLACA_VALIDA", None if not f.plate else normalize_plate(f.plate) is not None, "Formato da placa"),
        Check(
            "RENAVAM_VALIDO",
            None if not f.renavam else is_valid_renavam(f.renavam),
            "Dígito verificador do RENAVAM",
        ),
        Check(
            "CRLV_EM_DIA",
            None if not f.exercise_year else f.exercise_year >= today.year - 1,
            "Exercício (ano) do licenciamento",
        ),
    ]


def _government(
    kind: str, cnh: CnhFields | None, crlv: CrlvFields | None, checks: list[Check], v: GovernmentValidator
) -> list[GovResult]:
    ok = {c.code: c.ok for c in checks}
    out: list[GovResult] = []
    skipped = lambda scope, why: GovResult(scope, v.name, GovStatus.NAO_CONSULTADO, why)  # noqa: E731
    if kind == "CNH" and cnh:
        if ok.get("CPF_VALIDO") is True and cnh.cpf:
            out.append(v.check_cpf(cnh.cpf, cnh.birth_date))
        else:
            out.append(skipped("CPF", "CPF ilegível ou inválido"))
        if ok.get("CPF_VALIDO") is True and ok.get("REGISTRO_VALIDO") is True and cnh.cpf and cnh.registration:
            out.append(v.check_cnh(cnh.cpf, cnh.registration, cnh.valid_until))
        else:
            out.append(skipped("CNH", "Registro ilegível ou inválido"))
    elif kind == "CRLV" and crlv:
        if ok.get("PLACA_VALIDA") is True and ok.get("RENAVAM_VALIDO") is True and crlv.plate and crlv.renavam:
            out.append(v.check_vehicle(crlv.plate, crlv.renavam, crlv.owner_cpf))
        else:
            out.append(skipped("VEICULO", "Placa ou RENAVAM ilegível ou inválido"))
    return out


def analyze(
    data: bytes,
    expected: str,
    validator: GovernmentValidator,
    today: date | None = None,
) -> dict:
    """`expected` é o tipo que o motorista disse enviar (CNH | DOCUMENTO_VEICULO)."""
    today = today or date.today()
    mime = sniff_mime(data)
    base = {"kind": "UNKNOWN", "engine": "none", "readable": False, "fields": {}, "checks": [], "government": []}
    if mime is None:
        return base
    got = extract_text(data, mime)
    base["engine"] = got.engine
    if not got.text.strip():
        return base
    kind = classify(got.text)
    base.update(kind=kind, readable=True)
    checks = [Check("TIPO_CONFERE", kind == EXPECTED_KIND.get(expected), f"Lido como {kind}")]
    cnh = crlv = None
    if kind == "CNH":
        cnh = parse_cnh(got.text)
        checks += _cnh_checks(cnh, today)
        base["fields"] = {
            "name": cnh.name,
            "cpf": cnh.cpf,
            "birthDate": _iso(cnh.birth_date),
            "registration": cnh.registration,
            "category": cnh.category,
            "validUntil": _iso(cnh.valid_until),
            "firstLicense": _iso(cnh.first_license),
            "hasEar": cnh.has_ear,
        }
    elif kind == "CRLV":
        crlv = parse_crlv(got.text)
        checks += _crlv_checks(crlv, today)
        base["fields"] = {
            "plate": crlv.plate,
            "renavam": crlv.renavam,
            "chassis": crlv.chassis,
            "yearModel": crlv.year_model,
            "yearManufacture": crlv.year_manufacture,
            "exerciseYear": crlv.exercise_year,
            "ownerName": crlv.owner_name,
            "ownerCpf": crlv.owner_cpf,
        }
    # Só consulta a base oficial se o tipo bate com o esperado (não paga consulta de documento trocado).
    gov = _government(kind, cnh, crlv, checks, validator) if checks[0].ok else []
    base["checks"] = [c.to_json() for c in checks]
    base["government"] = [g.to_json() for g in gov]
    return base

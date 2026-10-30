"""Interpretação do texto de CNH e CRLV em campos. Só regras; nada de rede."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date

from .validators import normalize_plate, only_digits, parse_br_date

CPF_RE = r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}"
DATE_RE = r"\d{2}[/\-.]\d{2}[/\-.]\d{4}"
NAME_LINE = re.compile(r"^[A-ZÀ-Ý][A-ZÀ-Ý' .]{4,}$")


def fold(text: str) -> str:
    """Maiúsculas sem acento: OCR erra acentos e o PDF pode trazê-los decompostos."""
    nfd = unicodedata.normalize("NFD", text)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").upper()


def classify(text: str) -> str:
    t = fold(text)
    if "HABILITACAO" in t or "PERMISSAO PARA DIRIGIR" in t:
        return "CNH"
    if "CERTIFICADO DE REGISTRO" in t or "RENAVAM" in t or "CRLV" in t:
        return "CRLV"
    return "UNKNOWN"


def _after(text: str, label: str, pattern: str, window: int = 90) -> str | None:
    """Primeiro valor que casa `pattern` até `window` caracteres depois do rótulo."""
    m = re.search(label, text)
    if not m:
        return None
    found = re.search(pattern, text[m.end() : m.end() + window])
    return found.group(0) if found else None


def _name_after(text: str, label: str) -> str | None:
    """Nome na mesma linha do rótulo ou na primeira linha de nome logo abaixo."""
    lines = [ln.strip() for ln in text.splitlines()]
    for i, ln in enumerate(lines):
        m = re.fullmatch(label + r"\s*[:\-]?\s*(.*)", ln)
        if not m:
            continue
        same = m.group(1).strip()
        if same and NAME_LINE.match(same):
            return same
        for nxt in lines[i + 1 : i + 3]:
            if nxt and NAME_LINE.match(nxt) and not re.search(r"\d", nxt):
                return nxt
    return None


@dataclass
class CnhFields:
    name: str | None = None
    cpf: str | None = None
    birth_date: date | None = None
    registration: str | None = None
    category: str | None = None
    valid_until: date | None = None
    first_license: date | None = None
    has_ear: bool = False


@dataclass
class CrlvFields:
    plate: str | None = None
    renavam: str | None = None
    chassis: str | None = None
    year_model: int | None = None
    year_manufacture: int | None = None
    exercise_year: int | None = None
    owner_name: str | None = None
    owner_cpf: str | None = None
    notes: list[str] = field(default_factory=list)


def parse_cnh(raw: str) -> CnhFields:
    t = fold(raw)
    f = CnhFields()
    f.name = _name_after(t, r"NOME")
    cpf = _after(t, r"\bCPF\b", CPF_RE, 40) or re.search(CPF_RE, t)
    f.cpf = only_digits(cpf if isinstance(cpf, str) else cpf.group(0)) if cpf else None

    birth = _after(t, r"NASC\w*", DATE_RE, 60)
    f.birth_date = parse_br_date(birth) if birth else None

    reg = _after(t, r"REGISTRO", r"\b\d{11}\b", 60) or _after(t, r"REGISTRO", r"\d{11}", 60)
    f.registration = reg

    # Cabeçalho com vários rótulos numa linha e os valores na seguinte: as datas vêm em ordem.
    # Regra: validade = a data mais distante; 1ª habilitação = a mais antiga que não é o nascimento.
    others = [
        d
        for d in (parse_br_date(x) for x in re.findall(DATE_RE, t))
        if d and d != f.birth_date
    ]
    # "Data de emissão" não é validade nem 1ª habilitação.
    emissao = _after(t, r"EMISS\w*", DATE_RE, 40)
    emissao_d = parse_br_date(emissao) if emissao else None
    others = [d for d in others if d != emissao_d]
    if others:
        f.valid_until = max(others)
        rest = [d for d in others if d != f.valid_until]
        f.first_license = min(rest) if rest else None

    cat = _after(t, r"CAT\.?\s*HAB\.?", r"\b(?:ACC|AB|AC|AD|AE|A|B|C|D|E)\b", 40)
    f.category = cat
    f.has_ear = bool(re.search(r"\bEAR\b|EXERCE ATIVIDADE REMUNERADA", t))
    return f


def parse_crlv(raw: str) -> CrlvFields:
    t = fold(raw)
    f = CrlvFields()
    plate = _after(t, r"PLACA", r"[A-Z]{3}[- ]?\d[A-Z0-9]\d{2}", 60)
    f.plate = normalize_plate(plate) if plate else None
    if not f.plate:
        for m in re.finditer(r"\b[A-Z]{3}[- ]?\d[A-Z0-9]\d{2}\b", t):
            f.plate = normalize_plate(m.group(0))
            if f.plate:
                break
    f.renavam = _after(t, r"RENAVAM", r"\b\d{9,11}\b", 60)
    chassis = re.search(r"\b[A-HJ-NPR-Z0-9]{17}\b", t)
    f.chassis = chassis.group(0) if chassis else None

    def year(label: str) -> int | None:
        v = _after(t, label, r"\b(19|20)\d{2}\b", 40)
        return int(v) if v else None

    # Cabeçalho "ANO FABRICAÇÃO ANO MODELO" com os dois valores na linha de baixo, nessa ordem.
    pair = re.search(r"ANO\s*(?:DE\s*)?FABRICA\w*\s*(?:/\s*)?ANO\s*(?:DO\s*)?MODELO", t)
    if pair:
        years = re.findall(r"\b(?:19|20)\d{2}\b", t[pair.end() : pair.end() + 40])
        if len(years) >= 2:
            f.year_manufacture, f.year_model = int(years[0]), int(years[1])
    if f.year_model is None:
        f.year_model = year(r"ANO\s*(?:DO\s*)?MODELO")
    if f.year_manufacture is None:
        f.year_manufacture = year(r"ANO\s*(?:DE\s*)?FABRICA\w*")
    f.exercise_year = year(r"EXERCICIO")
    f.owner_name = _name_after(t, r"NOME")
    cpf = _after(t, r"CPF(?:\s*/\s*CNPJ)?", CPF_RE, 40)
    digits = only_digits(cpf) if cpf else ""
    # CNPJ (14 dígitos) pode casar um pedaço parecido com CPF: só aceita se não houver mais dígitos colados.
    f.owner_cpf = digits if len(digits) == 11 and not _cnpj_follows(t) else None
    return f


def _cnpj_follows(t: str) -> bool:
    return bool(re.search(r"CPF\s*/\s*CNPJ\s*[:\-]?\s*\d{2}\.?\d{3}\.?\d{3}/\d{4}", t))

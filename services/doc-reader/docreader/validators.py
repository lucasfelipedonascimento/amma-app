"""Validações locais (sem rede): dígitos verificadores e formatos."""

from __future__ import annotations

import re
from datetime import date


def only_digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def is_valid_cpf(value: str) -> bool:
    d = only_digits(value)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for length in (9, 10):
        total = sum(int(d[i]) * (length + 1 - i) for i in range(length))
        digit = (total * 10) % 11
        if digit == 10:
            digit = 0
        if digit != int(d[length]):
            return False
    return True


def normalize_plate(value: str) -> str | None:
    """Placa antiga (ABC1234) ou Mercosul (ABC1D23); None se não for uma delas."""
    p = re.sub(r"[\s-]", "", value or "").upper()
    if re.fullmatch(r"[A-Z]{3}\d{4}", p) or re.fullmatch(r"[A-Z]{3}\d[A-Z]\d{2}", p):
        return p
    return None


def is_valid_renavam(value: str) -> bool:
    """RENAVAM de 11 dígitos (os antigos de 9 ou 10 são completados com zeros à esquerda)."""
    d = only_digits(value)
    if not 9 <= len(d) <= 11:
        return False
    d = d.zfill(11)
    weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    total = sum(int(c) * w for c, w in zip(d[:10], weights))
    digit = (total * 10) % 11
    if digit == 10:
        digit = 0
    return digit == int(d[10])


def is_valid_cnh_number(value: str) -> bool:
    """Número de registro da CNH (11 dígitos) com os dois dígitos verificadores."""
    d = only_digits(value)
    if len(d) != 11 or d == d[0] * 11:
        return False
    dsc = 0
    total = 0
    for i, c in enumerate(d[:9]):
        total += int(c) * (9 - i)
    first = total % 11
    if first >= 10:
        first, dsc = 0, 2
    total = 0
    for i, c in enumerate(d[:9]):
        total += int(c) * (1 + i)
    x = total % 11
    second = 0 if x >= 10 else (x - dsc if x - dsc >= 0 else x - dsc + 11)
    if second >= 10:
        second = 0
    return first == int(d[9]) and second == int(d[10])


def parse_br_date(value: str) -> date | None:
    """Aceita DD/MM/AAAA, DD-MM-AAAA e DD.MM.AAAA; None se não existir no calendário."""
    m = re.fullmatch(r"\s*(\d{2})[/\-.](\d{2})[/\-.](\d{4})\s*", value or "")
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def mask_cpf(value: str) -> str:
    """123.456.789-09 → ***.456.789-** (o que o painel mostra; o CPF inteiro não é guardado)."""
    d = only_digits(value)
    return f"***.{d[3:6]}.{d[6:9]}-**" if len(d) == 11 else ""

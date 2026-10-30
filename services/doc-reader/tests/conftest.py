import io

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def make_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for ln in lines:
        c.drawString(40, y, ln)
        y -= 18
    c.save()
    return buf.getvalue()


CNH_LINES = [
    "REPUBLICA FEDERATIVA DO BRASIL",
    "CARTEIRA NACIONAL DE HABILITACAO",
    "NOME",
    "JOAO DA SILVA SANTOS",
    "CPF DATA NASCIMENTO",
    "529.982.247-25 01/02/1990",
    "CAT. HAB.",
    "AB",
    "No REGISTRO VALIDADE 1a HABILITACAO",
    "02650306461 10/05/2035 15/03/2012",
    "OBSERVACOES",
    "EAR",
]

CRLV_LINES = [
    "CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEICULO - DIGITAL",
    "EXERCICIO",
    "2026",
    "PLACA",
    "BRA2E15",
    "RENAVAM",
    "{renavam}",
    "ANO FABRICACAO ANO MODELO",
    "2020 2021",
    "CHASSI",
    "9BWZZZ377VT004251",
    "NOME",
    "JOAO DA SILVA SANTOS",
    "CPF / CNPJ",
    "529.982.247-25",
]


def renavam_ok(base: str = "0063936437") -> str:
    w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    dv = (sum(int(c) * k for c, k in zip(base, w)) * 10) % 11 % 10
    return base + str(dv)


@pytest.fixture
def cnh_pdf() -> bytes:
    return make_pdf(CNH_LINES)


@pytest.fixture
def crlv_pdf() -> bytes:
    return make_pdf([ln.format(renavam=renavam_ok()) for ln in CRLV_LINES])

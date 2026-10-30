from datetime import date

from conftest import CNH_LINES, make_pdf
from docreader.analysis import analyze
from docreader.gov import SandboxValidator

TODAY = date(2026, 10, 30)
V = SandboxValidator()


def checks(r):
    return {c["code"]: c["ok"] for c in r["checks"]}


def test_cnh_digital_lida_e_validada(cnh_pdf):
    r = analyze(cnh_pdf, "CNH", V, TODAY)
    assert r["kind"] == "CNH" and r["engine"] == "text-layer"
    f = r["fields"]
    assert f["name"] == "JOAO DA SILVA SANTOS"
    assert f["cpf"] == "52998224725"
    assert f["birthDate"] == "1990-02-01"
    assert f["registration"] == "02650306461"
    assert f["category"] == "AB"
    assert f["validUntil"] == "2035-05-10"
    assert f["firstLicense"] == "2012-03-15"
    assert f["hasEar"] is True
    assert all(checks(r).values())
    assert [g["status"] for g in r["government"]] == ["CONFIRMADO", "CONFIRMADO"]


def test_cnh_vencida(cnh_pdf):
    r = analyze(cnh_pdf, "CNH", V, date(2036, 1, 1))
    assert checks(r)["CNH_VIGENTE"] is False


def test_cnh_sem_ear():
    r = analyze(make_pdf([ln for ln in CNH_LINES if ln != "EAR"]), "CNH", V, TODAY)
    assert checks(r)["CNH_EAR"] is False


def test_cnh_com_cpf_invalido_nao_gasta_consulta_oficial():
    lines = [ln.replace("529.982.247-25", "529.982.247-24") for ln in CNH_LINES]
    r = analyze(make_pdf(lines), "CNH", V, TODAY)
    assert checks(r)["CPF_VALIDO"] is False
    assert {g["status"] for g in r["government"]} == {"NAO_CONSULTADO"}


def test_crlv_lido_e_validado(crlv_pdf):
    r = analyze(crlv_pdf, "DOCUMENTO_VEICULO", V, TODAY)
    f = r["fields"]
    assert r["kind"] == "CRLV"
    assert f["plate"] == "BRA2E15"
    assert f["chassis"] == "9BWZZZ377VT004251"
    assert (f["yearModel"], f["yearManufacture"], f["exerciseYear"]) == (2021, 2020, 2026)
    assert f["ownerName"] == "JOAO DA SILVA SANTOS"
    assert f["ownerCpf"] == "52998224725"
    assert all(checks(r).values())
    assert r["government"][0]["status"] == "CONFIRMADO"


def test_crlv_exercicio_antigo(crlv_pdf):
    r = analyze(crlv_pdf, "DOCUMENTO_VEICULO", V, date(2029, 3, 1))
    assert checks(r)["CRLV_EM_DIA"] is False


def test_documento_trocado_nao_consulta_base_oficial(cnh_pdf):
    r = analyze(cnh_pdf, "DOCUMENTO_VEICULO", V, TODAY)
    assert checks(r)["TIPO_CONFERE"] is False
    assert r["government"] == []


def test_arquivo_ilegivel_ou_formato_estranho():
    assert analyze(b"MZ\x90\x00 nao sou documento", "CNH", V, TODAY)["readable"] is False
    assert analyze(b"%PDF-1.4 quebrado", "CNH", V, TODAY)["readable"] is False
    # Foto sem tesseract/sem texto: não lê, mas não quebra.
    assert analyze(b"\xff\xd8\xff\xe0" + b"0" * 50, "CNH", V, TODAY)["kind"] == "UNKNOWN"

import pytest
from fastapi.testclient import TestClient

from conftest import CNH_LINES, make_pdf
from docreader.app import create_app
from docreader.gov import (
    REAL_VALIDATORS,
    GovResult,
    GovStatus,
    GovUnavailableError,
    SafeValidator,
    SandboxValidator,
    create_validator,
)

TOKEN = "t" * 40


def client(**kw):
    return TestClient(create_app(SandboxValidator(), token=TOKEN, **kw))


def post(c, data, expected="CNH", token=TOKEN):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return c.post("/v1/analyze", files={"file": ("x.pdf", data, "application/pdf")}, data={"expected": expected}, headers=headers)


def test_api_exige_token(cnh_pdf):
    c = client()
    assert post(c, cnh_pdf, token="").status_code == 401
    assert post(c, cnh_pdf, token="errado").status_code == 401
    r = post(c, cnh_pdf)
    assert r.status_code == 200 and r.json()["kind"] == "CNH"


def test_api_valida_entrada(cnh_pdf):
    c = client()
    assert post(c, cnh_pdf, expected="FOTO").status_code == 422
    assert post(c, b"0" * (5 * 1024 * 1024 + 10)).status_code == 413


def test_health_nao_vaza_nada_sensivel():
    assert set(client().get("/health").json()) == {"ok", "ocr", "govProvider", "sandbox"}


def test_sandbox_cobre_cada_caminho():
    v = SandboxValidator()
    assert v.check_cpf("52998224725", None).status is GovStatus.CONFIRMADO
    assert v.check_cpf("02998224725", None).status is GovStatus.NAO_ENCONTRADO
    assert v.check_cpf("92998224725", None).status is GovStatus.INDISPONIVEL
    assert v.check_cnh("1", "82650306461", None).status is GovStatus.DIVERGENTE
    assert v.check_vehicle("BRA2E10", "1", None).status is GovStatus.DIVERGENTE


class Quebrado(SandboxValidator):
    name = "quebrado"
    sandbox = False

    def check_cpf(self, cpf, birth_date):
        raise GovUnavailableError("timeout com 52998224725")

    def check_cnh(self, cpf, registration, valid_until):
        raise ValueError("bug no adaptador")


def test_falha_do_provedor_vira_indisponivel_sem_vazar_dado():
    s = SafeValidator(Quebrado())
    r = s.check_cpf("52998224725", None)
    assert r.status is GovStatus.INDISPONIVEL and "5299" not in r.detail
    assert s.check_cnh("1", "2", None).status is GovStatus.INDISPONIVEL


def test_configuracao():
    with pytest.raises(RuntimeError, match="produção"):
        create_validator({"GOV_PROVIDER": "sandbox", "APP_ENV": "production"})
    with pytest.raises(RuntimeError, match="inválido"):
        create_validator({"GOV_PROVIDER": "inexistente"})
    REAL_VALIDATORS["fake"] = lambda env: Quebrado()
    try:
        assert create_validator({"GOV_PROVIDER": "fake"}).name == "quebrado"
    finally:
        del REAL_VALIDATORS["fake"]


def test_producao_exige_token_forte(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="DOC_READER_TOKEN"):
        create_app(SandboxValidator(), token="curto")

"""API interna do leitor de documentos. Só a API da AMMA chama; nunca exposta à internet."""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from .analysis import analyze
from .gov import GovernmentValidator, create_validator
from .text import ocr_available

MAX_BYTES = 5 * 1024 * 1024
log = logging.getLogger("docreader")


def create_app(validator: GovernmentValidator | None = None, token: str | None = None) -> FastAPI:
    env = os.environ
    token = token if token is not None else env.get("DOC_READER_TOKEN", "")
    production = env.get("APP_ENV") == "production"
    if production and len(token) < 32:
        raise RuntimeError("DOC_READER_TOKEN (32+ caracteres) é obrigatório em produção")
    if not token:
        log.warning("DOC_READER_TOKEN vazio: serviço sem autenticação (só desenvolvimento)")
    validator = validator or create_validator()
    app = FastAPI(title="AMMA doc-reader", docs_url=None, redoc_url=None, openapi_url=None)

    def auth(authorization: str | None = Header(default=None)) -> None:
        if not token:
            return
        sent = (authorization or "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(sent.encode(), token.encode()):
            raise HTTPException(status_code=401, detail="Não autorizado")

    @app.get("/health")
    def health():
        return {"ok": True, "ocr": ocr_available(), "govProvider": validator.name, "sandbox": validator.sandbox}

    @app.post("/v1/analyze", dependencies=[Depends(auth)])
    def analyze_endpoint(file: UploadFile = File(...), expected: str = Form(...)):
        if expected not in ("CNH", "DOCUMENTO_VEICULO"):
            raise HTTPException(status_code=422, detail="expected deve ser CNH ou DOCUMENTO_VEICULO")
        data = file.file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Arquivo maior que 5 MB")
        # Nada do conteúdo ou dos campos lidos vai para o log (LGPD).
        return analyze(data, expected, validator)

    return app

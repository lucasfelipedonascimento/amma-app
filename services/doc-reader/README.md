# doc-reader

Serviço interno (Python/FastAPI) que lê CNH e CRLV, extrai os campos, valida dígitos verificadores e consulta bases oficiais. A API da AMMA é a única cliente. Guia completo: [`docs/VALIDACAO_DOCUMENTOS.md`](../../docs/VALIDACAO_DOCUMENTOS.md).

```bash
cd services/doc-reader
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q                 # testes
DOC_READER_TOKEN=<segredo> .venv/bin/python -m docreader   # sobe em 127.0.0.1:8001
```

OCR de **fotos** exige o programa `tesseract` com o idioma português (`apt install tesseract-ocr tesseract-ocr-por`). Sem ele, PDFs digitais (CRLV-e, CNH digital) continuam sendo lidos pela camada de texto; foto vira "não foi possível ler" e segue para análise manual.

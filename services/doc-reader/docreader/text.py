"""Texto do documento: camada de texto do PDF (digital) ou OCR (foto/escaneado)."""

from __future__ import annotations

import io
import shutil
from dataclasses import dataclass

from pypdf import PdfReader

MIN_TEXT_CHARS = 40  # abaixo disso o PDF é tratado como escaneado


@dataclass
class ExtractedText:
    text: str
    engine: str  # "text-layer" | "ocr" | "none"


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _ocr_image(data: bytes) -> str:
    import pytesseract
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img).convert("L")
        # Fotos de celular costumam ser enormes; limitar o lado maior evita estourar memória e tempo.
        img.thumbnail((2600, 2600))
        return pytesseract.image_to_string(img, lang="por", config="--psm 6", timeout=20)


def extract_text(data: bytes, mime: str) -> ExtractedText:
    """Nunca lança por arquivo ruim: devolve engine "none" quando não há como ler."""
    if mime == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                return ExtractedText("", "none")
            pages = list(reader.pages)[:4]
            text = "\n".join((p.extract_text() or "") for p in pages)
            if len(text.strip()) >= MIN_TEXT_CHARS:
                return ExtractedText(text, "text-layer")
            if ocr_available():
                chunks: list[str] = []
                for page in pages:
                    for image in page.images[:2]:
                        chunks.append(_ocr_image(image.data))
                if chunks:
                    return ExtractedText("\n".join(chunks), "ocr")
        except Exception:
            return ExtractedText("", "none")
        return ExtractedText("", "none")
    if ocr_available():
        try:
            return ExtractedText(_ocr_image(data), "ocr")
        except Exception:
            return ExtractedText("", "none")
    return ExtractedText("", "none")

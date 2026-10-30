import os

import uvicorn

from .app import create_app

if __name__ == "__main__":
    # Só escuta no loopback por padrão: o serviço é interno.
    uvicorn.run(create_app(), host=os.environ.get("DOC_READER_HOST", "127.0.0.1"), port=int(os.environ.get("DOC_READER_PORT", "8001")))

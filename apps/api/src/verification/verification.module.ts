import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOCUMENT_READER, createDocumentReader } from './reader';
import { VerificationService } from './verification.service';

/** Leitura e conferência automática de CNH e CRLV (docs/VALIDACAO_DOCUMENTOS.md). */
@Module({
  providers: [
    { provide: DOCUMENT_READER, inject: [ConfigService], useFactory: createDocumentReader },
    VerificationService,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}

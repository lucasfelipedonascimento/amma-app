/** Descobre o tipo real do arquivo pelos primeiros bytes (não confia no mimetype do cliente). */
export type AllowedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  return null;
}

/**
 * PDF com conteúdo ativo (JavaScript, ações automáticas, programas ou arquivos embutidos). Documento de
 * identificação não precisa disso, e é o vetor comum de PDF malicioso. Busca simples nos bytes: pode
 * recusar um PDF legítimo raro (o motorista envia foto), mas nunca deixa passar o óbvio.
 */
const ACTIVE_PDF = /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|SubmitForm)\b/;
export const hasActivePdfContent = (buf: Buffer): boolean =>
  ACTIVE_PDF.test(buf.toString('latin1'));

export const EXTENSION: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

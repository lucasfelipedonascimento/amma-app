import { describe, expect, it } from 'vitest';
import { sniffMime } from './file-type';

describe('sniffMime', () => {
  it('reconhece JPEG, PNG e PDF pelos bytes', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  });
  it('rejeita outros formatos (ex.: script, HTML, vazio)', () => {
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

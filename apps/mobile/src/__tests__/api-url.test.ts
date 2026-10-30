jest.mock('expo-file-system', () => ({ File: class {}, UploadType: {} }));
jest.mock('expo-secure-store', () => ({}));
import { resolveApiUrl } from '../api';

describe('resolveApiUrl', () => {
  it('em desenvolvimento aceita http e tem padrão local', () => {
    expect(resolveApiUrl(undefined, true)).toBe('http://localhost:3000');
    expect(resolveApiUrl('http://10.0.2.2:3000', true)).toBe('http://10.0.2.2:3000');
  });
  it('em produção exige https', () => {
    expect(resolveApiUrl('https://api.amma.app', false)).toBe('https://api.amma.app');
    expect(() => resolveApiUrl('http://api.amma.app', false)).toThrow(/https/);
    expect(() => resolveApiUrl(undefined, false)).toThrow(/https/);
  });
});

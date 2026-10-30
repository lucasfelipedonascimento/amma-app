import * as Location from 'expo-location';
import { LocationDeniedError, formatAddress, geocode, geocodeQuery, myPlace } from '../address';

describe('endereços', () => {
  it('acrescenta João Pessoa só quando a cidade não foi informada', () => {
    expect(geocodeQuery('Rua A, 10')).toBe('Rua A, 10, João Pessoa - PB');
    expect(geocodeQuery('Rua A, 10, Cabedelo - PB')).toBe('Rua A, 10, Cabedelo - PB');
    expect(geocodeQuery('Rua A, 10 - joao pessoa')).toBe('Rua A, 10 - joao pessoa');
  });

  it('geocode devolve o ponto com o texto digitado', async () => {
    expect(await geocode('  Rua A, 10 ')).toEqual({
      lat: -7.115,
      lng: -34.861,
      address: 'Rua A, 10',
    });
    expect(Location.geocodeAsync).toHaveBeenCalledWith('Rua A, 10, João Pessoa - PB');
  });

  it('endereço não encontrado → null', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    expect(await geocode('asdfgh')).toBeNull();
  });

  it('formata o endereço do aparelho', () => {
    expect(
      formatAddress({ street: 'Rua X', streetNumber: '5', district: 'Bessa', city: 'João Pessoa' }),
    ).toBe('Rua X, 5 - Bessa, João Pessoa');
    expect(formatAddress({})).toBe('');
  });

  it('minha localização: endereço do aparelho, ou texto genérico se não houver', async () => {
    expect((await myPlace()).address).toBe('Rua das Flores, 10 - Manaíra, João Pessoa');
    (Location.reverseGeocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    expect((await myPlace()).address).toBe('Minha localização');
  });

  it('sem permissão: erro claro', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
    });
    await expect(myPlace()).rejects.toBeInstanceOf(LocationDeniedError);
  });
});

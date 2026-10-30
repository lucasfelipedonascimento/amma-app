import { describeHours, formatKm } from '../labels';

describe('horário e distância em texto', () => {
  it('24 horas, faixa de dias seguidos e dias soltos', () => {
    expect(describeHours({ always: true, slots: [] })).toBe('24 horas');
    expect(
      describeHours({
        always: false,
        slots: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' }],
      }),
    ).toBe('seg–sex 08:00–18:00');
    expect(
      describeHours({
        always: false,
        slots: [
          { days: [1, 3], open: '08:00', close: '12:00' },
          { days: [6, 0], open: '09:00', close: '13:00' },
        ],
      }),
    ).toBe('seg, qua 08:00–12:00; dom, sáb 09:00–13:00');
  });

  it('distância em metros arredondados ou km', () => {
    expect(formatKm(87)).toBe('90 m');
    expect(formatKm(999)).toBe('1000 m');
    expect(formatKm(1250)).toBe('1,3 km');
  });
});

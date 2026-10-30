import { fireEvent, render, screen } from '@testing-library/react-native';
import { LOCATION_CONSENT_POINTS } from '@amma/shared';
import { LocationConsentScreen } from '../screens/LocationConsentScreen';

describe('LocationConsentScreen', () => {
  it('explica quando, para quê, segundo plano, o que não fazemos e como desligar', async () => {
    await render(<LocationConsentScreen onAccept={jest.fn()} onDecline={jest.fn()} />);
    expect(LOCATION_CONSENT_POINTS.length).toBeGreaterThanOrEqual(5);
    LOCATION_CONSENT_POINTS.forEach((p) => {
      expect(screen.getByText(p.title)).toBeTruthy();
      expect(screen.getByText(p.text)).toBeTruthy();
    });
    expect(screen.getByText(/Não guardamos o trajeto/)).toBeTruthy();
  });

  it('concordar e recusar são ações separadas', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    await render(<LocationConsentScreen onAccept={onAccept} onDecline={onDecline} />);
    await fireEvent.press(screen.getByText('Agora não'));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Concordo e continuar'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('mostra erro (ex.: permissão negada)', async () => {
    await render(
      <LocationConsentScreen
        error="Sem permissão de localização."
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );
    expect(screen.getByText('Sem permissão de localização.')).toBeTruthy();
  });
});

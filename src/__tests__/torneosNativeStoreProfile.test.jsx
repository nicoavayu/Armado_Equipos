import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import PremiumUpsell from '../features/torneos/components/PremiumUpsell';
import PremiumFeatureGate from '../features/torneos/components/PremiumFeatureGate';
import { ShareCallButton, publicTournamentUrl } from '../features/torneos/components/connected/CatalogCallPage';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
import {
  NATIVE_PREMIUM_NOTICE,
  isNativeCommerceBlocked,
  nativePremiumNotice,
} from '../features/torneos/domain/nativeCommerce';
import { shareLink } from '../utils/shareLink';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

jest.mock('@capacitor/share', () => ({ Share: { share: jest.fn() } }));

const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto' };
const season = { id: '20000000-0000-4000-8000-000000000001', name: 'Temporada 2026' };

// The runtime the app reads (utils/runtimePlatform): Capacitor's own bridge answers.
function runOn(platform) {
  jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
  jest.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
}

const originalShare = navigator.share;
const originalClipboard = navigator.clipboard;
afterEach(() => {
  jest.restoreAllMocks();
  Share.share.mockReset();
  Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
});

function showPlan(plan) {
  const service = {
    loadCompetitionContext: jest.fn().mockResolvedValue({ seasons: [season], tournaments: [], preference: { activeSeasonId: season.id } }),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadSeasonEntitlements: jest.fn(async ({ seasonId }) => tournamentEntitlementsFixture({ seasonId, plan })),
  };
  render(
    <MemoryRouter>
      <TorneosFeaturesProvider features={stagingV1FeaturesFor('off', { planRead: true })}>
        <TorneosCompetitionProvider organizationId={org.id} service={service}>
          <PlanExperiencePage organization={org} />
        </TorneosCompetitionProvider>
      </TorneosFeaturesProvider>
    </MemoryRouter>,
  );
}

describe('native commerce guard', () => {
  test('blocks selling only in the native shells', () => {
    expect(isNativeCommerceBlocked({ isNative: true })).toBe(true);
    expect(isNativeCommerceBlocked({ isNative: false })).toBe(false);
    runOn('android');
    expect(isNativeCommerceBlocked()).toBe(true);
    runOn('web');
    expect(isNativeCommerceBlocked()).toBe(false);
  });

  test('the native notice is a neutral fact: no price, purchase, link or web redirection', () => {
    expect(NATIVE_PREMIUM_NOTICE).toBe('Disponible con Premium.');
    expect(nativePremiumNotice('Más colaboradores')).toBe('Más colaboradores: disponible con Premium.');
    expect(NATIVE_PREMIUM_NOTICE).not.toMatch(/compr|preci|\$|pag|web|http|ver premium|mejor/i);
  });

  test.each(['android', 'ios'])('PremiumUpsell on %s is a note without button or dialog', (platform) => {
    runOn(platform);
    const { container } = render(<MemoryRouter><PremiumUpsell feature="Más colaboradores" organizationId={org.id} seasonId={season.id} /></MemoryRouter>);
    expect(screen.getByRole('note')).toHaveTextContent('Más colaboradores: disponible con Premium.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(container).not.toHaveTextContent(/Ver Premium|Comprar|precio/i);
  });

  test('PremiumUpsell announces nothing in the native shells for what is not available yet', () => {
    runOn('ios');
    const { container } = render(<MemoryRouter><PremiumUpsell feature="Ampliar galería" organizationId={org.id} soon /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  test('PremiumUpsell on the web keeps its button and «Ver Premium» dialog', () => {
    runOn('web');
    render(<MemoryRouter><PremiumUpsell feature="Más colaboradores" organizationId={org.id} seasonId={season.id} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Más colaboradores · Premium/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver Premium' })).toBeInTheDocument();
  });

  test('PremiumFeatureGate in the native shells only states the fact and closes', () => {
    runOn('android');
    const onViewPremium = jest.fn();
    render(<PremiumFeatureGate open feature="Más colaboradores" onClose={() => {}} onViewPremium={onViewPremium} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Esta función está incluida en Premium.');
    expect(dialog).toHaveTextContent('El plan de esta temporada no la incluye.');
    expect(screen.queryByRole('button', { name: 'Ver Premium' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Cerrar', 'Cerrar']);
    expect(dialog).not.toHaveTextContent(/Consultá qué agrega/);
  });

  test.each(['FREE', 'PREMIUM'])('Mi plan in the native shells shows the %s plan as a fact, without selling', async (plan) => {
    runOn('ios');
    showPlan(plan);
    expect(await screen.findByRole('heading', { name: `${plan} · Temporada 2026` })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Inclusiones actuales' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver Premium' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Qué agrega Premium' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Próximamente' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/FREE VS PREMIUM|Comprar|compra de Premium|precio|Mercado Pago/i);
  });

  test('Mi plan on the web keeps «Ver Premium» and the FREE vs PREMIUM table', async () => {
    runOn('web');
    showPlan('FREE');
    await screen.findByRole('heading', { name: 'FREE · Temporada 2026' });
    expect(screen.getByRole('button', { name: 'Ver Premium' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Qué agrega Premium' })).toBeInTheDocument();
  });
});

describe('sharing a call from the app', () => {
  test.each(['android', 'ios'])('on %s the link is the public web address, never the WebView origin', (platform) => {
    runOn(platform);
    expect(publicTournamentUrl('liga devoto')).toBe('https://app.arma2.com.ar/torneos/publico/liga%20devoto');
    expect(publicTournamentUrl('x', { isNative: false, currentOrigin: 'capacitor://localhost' })).toBe('https://app.arma2.com.ar/torneos/publico/x');
    expect(publicTournamentUrl('x', { isNative: false, currentOrigin: 'https://localhost' })).toBe('https://app.arma2.com.ar/torneos/publico/x');
  });

  test('on the web the link keeps the current origin', () => {
    expect(publicTournamentUrl('x', { isNative: false, currentOrigin: 'http://localhost:3000' })).toBe('http://localhost:3000/torneos/publico/x');
  });

  test('ShareCallButton opens the native share sheet with the web URL', async () => {
    runOn('android');
    const webShare = jest.fn();
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare });
    Share.share.mockResolvedValue({});
    render(<ShareCallButton publicSlug="apertura-2026" tournamentName="Apertura" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compartir convocatoria' })); });
    expect(Share.share).toHaveBeenCalledWith({
      title: 'Apertura',
      text: 'Convocatoria: Apertura',
      url: 'https://app.arma2.com.ar/torneos/publico/apertura-2026',
      dialogTitle: 'Apertura',
    });
    expect(webShare).not.toHaveBeenCalled();
  });

  test('a cancelled native share leaves the button as it was', async () => {
    runOn('ios');
    Share.share.mockRejectedValue(new Error('Share canceled'));
    render(<ShareCallButton publicSlug="apertura-2026" tournamentName="Apertura" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compartir convocatoria' })); });
    expect(screen.getByRole('button', { name: 'Compartir convocatoria' })).toBeInTheDocument();
  });

  test('on the web it uses Web Share, or copies the link when there is none', async () => {
    runOn('web');
    const webShare = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare });
    await expect(shareLink({ title: 't', text: 'x', url: 'https://app.arma2.com.ar/a' })).resolves.toBe('shared');
    expect(webShare).toHaveBeenCalledWith({ title: 't', text: 'x', url: 'https://app.arma2.com.ar/a' });
    expect(Share.share).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ShareCallButton publicSlug="apertura-2026" tournamentName="Apertura" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compartir convocatoria' })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enlace copiado' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/torneos/publico/apertura-2026`);
  });
});

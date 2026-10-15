// PREMIUM SPONSORS (0020) — Configuración → Sponsors: the server's answer decides what the page offers. Premium +
// organization.update: list, add (name + logo), edit, archive with confirmation. Without Premium: the rows stay, read-only
// (archive still allowed) behind the Premium explanation. Without the role: read-only. Without the branding composition:
// no Sponsors section at all.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import OrganizationSponsorsPage from '../features/torneos/components/OrganizationSponsorsPage';
import OrganizationSettingsNav from '../features/torneos/components/OrganizationSettingsNav';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';

let mockWorkspace;
jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => mockWorkspace,
  useOptionalTorneosWorkspace: () => mockWorkspace,
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useOptionalTorneosCompetition: () => ({ activeSeason: { id: '20000000-0000-4000-8000-000000000001' } }),
  useTorneosCompetition: () => ({ activeSeason: { id: '20000000-0000-4000-8000-000000000001' } }),
}));

const ORG = '10000000-0000-4000-8000-000000000001';
const S1 = '70000000-0000-4000-8000-000000000001';
const S2 = '70000000-0000-4000-8000-000000000002';
const P1 = `${ORG}/organizations/${ORG}/71000000-0000-4000-8000-000000000001.png`;
const P2 = `${ORG}/organizations/${ORG}/71000001-0000-4000-8000-000000000001.png`;
const organization = { id: ORG, name: 'Liga Primavera', slug: 'liga-primavera', capabilities: [] };

function answer({ entitled = true, canManage = true, sponsors } = {}) {
  return {
    organizationId: ORG,
    seasonId: null,
    canManage,
    entitled,
    limits: { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 },
    sponsors: sponsors || [
      { id: S1, name: 'Ferretería El Tornillo', logoPath: P1, logoUrl: 'blob:logo-1', sortOrder: 0 },
      { id: S2, name: 'Panadería La Espiga', logoPath: P2, logoUrl: 'blob:logo-2', sortOrder: 1 },
    ],
  };
}

function setup({ list = answer(), features = null, service: override = null } = {}) {
  const calls = { load: [], save: [], archive: [] };
  const service = override || {
    loadOrganizationSponsors: async (input) => { calls.load.push(input); return typeof list === 'function' ? list() : list; },
    saveOrganizationSponsor: async (input) => { calls.save.push(input); if (calls.saveError) throw calls.saveError; return { sponsor: { id: S1 }, previousLogoPath: null }; },
    archiveOrganizationSponsor: async (input) => { calls.archive.push(input); return { sponsorId: input.sponsorId, archived: true, previousLogoPath: P1 }; },
  };
  mockWorkspace = { service };
  render(
    <TorneosFeaturesProvider features={features}>
      <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/configuracion/sponsors`]}>
        <Routes>
          <Route path="/torneos/organizacion/:organizationId" element={<Outlet context={{ organization }} />}>
            <Route path="configuracion/sponsors" element={<OrganizationSponsorsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TorneosFeaturesProvider>,
  );
  return calls;
}

const logoFile = (name = 'logo.png', type = 'image/png') => new File(['logo-bytes'], name, { type });

beforeAll(() => {
  global.URL.createObjectURL = () => 'blob:preview';
  global.URL.revokeObjectURL = () => {};
});

test('Premium owner: the list (logo, name, order), limits, and the four settings sections', async () => {
  const calls = setup();
  const list = await screen.findByRole('list', { name: 'Sponsors de la organización' });
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText('Ferretería El Tornillo')).toBeInTheDocument();
  expect(within(items[0]).getByLabelText('Posición 1')).toBeInTheDocument();
  expect(items[0].querySelector('img').getAttribute('src')).toBe('blob:logo-1');
  expect(screen.getByText('2 de 20 sponsors activos · hasta 3 por placa')).toBeInTheDocument();
  expect(calls.load).toEqual([{ organizationId: ORG }]);
  const nav = screen.getByRole('navigation', { name: 'Secciones de configuración' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['General', 'Mi plan', 'Miembros', 'Sponsors']);
  expect(screen.queryByText(/función Premium/)).not.toBeInTheDocument();
});

test('add: name and logo are required; the logo uses the branding validation; the save carries both and reloads', async () => {
  const calls = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar sponsor' }));
  const form = screen.getByRole('form', { name: 'Nuevo sponsor' });
  fireEvent.click(within(form).getByRole('button', { name: 'Guardar sponsor' }));
  expect(await within(form).findByText('Elegí el logo del sponsor.')).toBeInTheDocument();
  expect(within(form).getByText('Escribí el nombre del sponsor.')).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText('Elegir logo del sponsor'), { target: { files: [logoFile('logo.svg', 'image/svg+xml')] } });
  expect(within(form).getByText('Formato no admitido. Usá PNG, JPEG o WebP.')).toBeInTheDocument();
  expect(calls.save).toEqual([]);

  const file = logoFile();
  fireEvent.change(within(form).getByLabelText('Elegir logo del sponsor'), { target: { files: [file] } });
  fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: '  Gimnasio Fénix  ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Guardar sponsor' }));
  await screen.findByText('Sumamos a Gimnasio Fénix.');
  expect(calls.save).toEqual([{ organizationId: ORG, sponsorId: null, name: 'Gimnasio Fénix', file, logoPath: null, sortOrder: null }]);
  await waitFor(() => expect(calls.load).toHaveLength(2));
});

test('edit: renaming keeps the current logo (full replacement with the same path) and the order', async () => {
  const calls = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Editar Panadería La Espiga' }));
  const form = screen.getByRole('form', { name: 'Editar Panadería La Espiga' });
  fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Panadería La Espiga Dorada' } });
  fireEvent.change(within(form).getByLabelText('Orden (opcional)'), { target: { value: '5' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Guardar sponsor' }));
  await screen.findByText('Guardamos los cambios de Panadería La Espiga Dorada.');
  expect(calls.save).toEqual([{ organizationId: ORG, sponsorId: S2, name: 'Panadería La Espiga Dorada', file: null, logoPath: P2, sortOrder: 5 }]);
});

test('a refused save shows the server copy and keeps the form', async () => {
  const calls = setup();
  calls.saveError = Object.assign(new Error('Llegaste al máximo de 20 sponsors activos. Archivá uno para sumar otro.'), { code: 'TORNEOS_SPONSOR_LIMIT_REACHED' });
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar sponsor' }));
  const form = screen.getByRole('form', { name: 'Nuevo sponsor' });
  fireEvent.change(within(form).getByLabelText('Elegir logo del sponsor'), { target: { files: [logoFile()] } });
  fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Kiosco Doble Siete' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Guardar sponsor' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Llegaste al máximo de 20 sponsors activos.');
  expect(screen.getByRole('form', { name: 'Nuevo sponsor' })).toBeInTheDocument();
});

test('archive asks for confirmation; cancel sends nothing; confirm archives and reloads', async () => {
  const calls = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Archivar Ferretería El Tornillo' }));
  const confirm = screen.getByRole('group', { name: 'Confirmar archivo de Ferretería El Tornillo' });
  expect(confirm).toHaveTextContent('Deja de aparecer en el Estudio Social');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
  expect(calls.archive).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Archivar Ferretería El Tornillo' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Confirmar archivo de Ferretería El Tornillo' })).getByRole('button', { name: 'Confirmar archivo' }));
  await screen.findByText('Archivamos a Ferretería El Tornillo. Ya no aparece en el Estudio Social.');
  expect(calls.archive).toEqual([{ organizationId: ORG, sponsorId: S1 }]);
  await waitFor(() => expect(calls.load).toHaveLength(2));
});

test('without Premium: the Premium explanation and gate, the rows kept read-only, archive still allowed', async () => {
  setup({ list: answer({ entitled: false }) });
  expect(await screen.findByText('Sponsors es una función Premium.')).toBeInTheDocument();
  expect(screen.getByText(/quedan guardados/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Agregar sponsor' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archivar Ferretería El Tornillo' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Sponsors · Premium/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Esta función está incluida en Premium.');
});

test('without organization.update: read-only, no action at all', async () => {
  setup({ list: answer({ canManage: false }) });
  expect(await screen.findByText(/Modo lectura · Tu rol no permite gestionar los sponsors/)).toBeInTheDocument();
  expect(screen.getByText('Ferretería El Tornillo')).toBeInTheDocument();
  for (const name of [/Agregar sponsor/, /^Editar/, /^Archivar/]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
});

test('a composition without the sponsor aliases makes no request', async () => {
  setup({ service: {} });
  expect(await screen.findByText('Los sponsors no están disponibles en esta versión de Torneos.')).toBeInTheDocument();
});

test('the Sponsors section exists only with the branding composition', () => {
  const renderNav = (features) => render(
    <TorneosFeaturesProvider features={features}>
      <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/configuracion`]}>
        <Routes><Route path="/torneos/organizacion/:organizationId/configuracion" element={<OrganizationSettingsNav />} /></Routes>
      </MemoryRouter>
    </TorneosFeaturesProvider>,
  );
  const off = renderNav(stagingV1FeaturesFor('off', { planRead: true }));
  expect(screen.queryByRole('link', { name: 'Sponsors' })).not.toBeInTheDocument();
  off.unmount();
  renderNav(stagingV1FeaturesFor('off', { planRead: true, branding: true }));
  expect(screen.getByRole('link', { name: 'Sponsors' })).toHaveAttribute('href', `/torneos/organizacion/${ORG}/configuracion/sponsors`);
});

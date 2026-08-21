import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom';
import MediaAdminPage from '../features/torneos/components/MediaAdminPage';
import {
  MEDIA_GALLERY_CLOSED_STATES,
  MEDIA_GALLERY_CURATION_STATES,
  resolveMediaAssetActions,
  resolveMediaGalleryActions,
} from '../features/torneos/domain/mediaGalleryActions';

/**
 * FPR-001.1 — el estado de la galería decide qué acciones existen.
 *
 * La contradicción que abrió este hito era exactamente ésta: la pantalla decía
 * «la galería publicada ya no admite edición directa» y debajo ofrecía portada,
 * ocultar, subir, bajar y eliminar. Estos tests no miran píxeles: afirman qué
 * controles se renderizan para cada combinación de estado y capability, que es
 * el contrato que el backend ya aplicaba por su cuenta.
 *
 * La referencia no es una opinión de diseño. Cada expectativa de abajo tiene su
 * gemela en PostgreSQL:
 *
 *   - `set_tournament_media_cover`      → `GALLERY_IMMUTABLE` fuera de borrador
 *   - `reorder_tournament_media_item`   → `GALLERY_IMMUTABLE` fuera de borrador
 *   - `update_tournament_media_gallery` → `GALLERY_IMMUTABLE` fuera de borrador
 *   - `transition_…_asset` (hide)       → sin puerta de galería, capability
 *                                          `media.revoke`, con rama explícita
 *                                          para `published`
 *   - `begin_…_asset_delete`            → sin puerta de galería: borrar responde
 *                                          a un pedido de privacidad
 *   - `report_…_asset`                  → sólo sobre una foto `published`
 */

let mockContextService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockContextService }),
}));

const FULL_CAPABILITIES = Object.freeze([
  'media.read', 'media.create_gallery', 'media.update_gallery', 'media.upload',
  'media.review', 'media.publish', 'media.archive', 'media.revoke',
  'media.set_cover', 'media.tag_team', 'media.tag_player',
  'media.manage_consent', 'media.handle_reports',
]);
const READ_ONLY_CAPABILITIES = Object.freeze(['media.read']);

const photo = (id, overrides = {}) => ({
  id,
  safeName: `foto-${id}.jpg`,
  width: 1600,
  height: 900,
  byteSize: 2048,
  status: 'published',
  sortOrder: 0,
  variantsReady: 4,
  ...overrides,
});

function gallery(status, overrides = {}) {
  return {
    id: 'gallery-a',
    title: 'FPR-001 QA · publicación MVP_SIMPLE',
    description: 'Selección de la fecha.',
    status,
    visibility: 'tournament_participants',
    coverAssetId: 'asset-cover',
    assets: [
      photo('asset-cover', { sortOrder: 0 }),
      photo('asset-b', { sortOrder: 1 }),
    ],
    ...overrides,
  };
}

function renderAdmin(status, capabilities = FULL_CAPABILITIES, galleryOverrides = {}) {
  mockContextService = {
    loadMediaAdminContext: jest.fn().mockResolvedValue({
      storage: {
        bucket: 'tournament-media', private: true, certified: true,
        uploadReady: true, requiresStagingGate: false,
        maxFileBytes: 12582912, maxPixels: 36000000, maxBatchFiles: 40,
      },
      capabilities,
      tournaments: [{ id: 'tournament-a', name: 'Copa Horizonte', categories: [], matches: [] }],
      galleries: [gallery(status, galleryOverrides)],
      reports: [],
    }),
    signMediaReadUrls: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn().mockReturnValue('key-a'),
    transitionMediaAsset: jest.fn(),
    setMediaCover: jest.fn(),
    reorderMediaItem: jest.fn(),
    publishMediaGallery: jest.fn(),
    changeMediaGalleryState: jest.fn(),
    deleteMediaAsset: jest.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/torneos/organizacion/org-a/multimedia']}>
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId/multimedia"
          element={<MediaAdminPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const DIRECT_EDIT_CONTROLS = [/^Portada$/, /hacia arriba/i, /hacia abajo/i];

describe('FPR-001.1 · galería publicada: inmutable de verdad', () => {
  test('no renderiza ningún control de edición directa', async () => {
    renderAdmin('published');
    await screen.findByText('Galería publicada');

    DIRECT_EDIT_CONTROLS.forEach((label) => {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    });
    // Y tampoco el panel de carga, que también es composición.
    expect(screen.queryByLabelText('Seleccionar fotos')).toBeNull();
    expect(screen.queryByRole('button', { name: /Publicar galería/ })).toBeNull();
  });

  test('conserva la portada como información, no como acción', async () => {
    renderAdmin('published');
    await screen.findByText('Galería publicada');
    // El distintivo sigue; el botón para cambiarla, no.
    expect(screen.getByText('Portada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Portada$/ })).toBeNull();
  });

  test('conserva moderación y borrado, que el backend sí permite publicada', async () => {
    renderAdmin('published');
    await screen.findByText('Galería publicada');
    expect(screen.getAllByRole('button', { name: /Ocultar/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Eliminar definitivamente/ })).toHaveLength(2);
  });

  test('conserva Archivar cuando el actor tiene la capability', async () => {
    renderAdmin('published');
    expect(await screen.findByRole('button', { name: /Archivar galería/ })).toBeInTheDocument();
  });

  test('sin `media.archive` no ofrece archivar ni ninguna otra acción de ciclo', async () => {
    renderAdmin('published', FULL_CAPABILITIES.filter((name) => name !== 'media.archive'));
    await screen.findByText('Galería publicada');
    expect(screen.queryByRole('button', { name: /Archivar/ })).toBeNull();
  });

  test('el mensaje de estado describe lo que la pantalla realmente ofrece', async () => {
    renderAdmin('published');
    const notice = await screen.findByRole('note');
    expect(notice).toHaveTextContent('Galería publicada');
    expect(notice).toHaveTextContent(/no admite cambios de portada ni de orden/i);
    // Sin enums crudos en ninguna parte de la pantalla.
    expect(document.body.textContent).not.toMatch(/under_review|pending_review|do_not_want_to_appear/);
  });
});

describe('FPR-001.1 · borrador: la edición legítima sigue intacta', () => {
  test('renderiza portada, orden, moderación, carga y publicación', async () => {
    renderAdmin('draft', FULL_CAPABILITIES, {
      assets: [
        photo('asset-cover', { status: 'approved', sortOrder: 0 }),
        photo('asset-b', { status: 'approved', sortOrder: 1 }),
        photo('asset-c', { status: 'pending_review', sortOrder: 2 }),
      ],
    });
    await screen.findByText('Borrador en preparación');

    expect(screen.getAllByRole('button', { name: /^Portada$/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /hacia arriba/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /hacia abajo/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Aprobar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Seleccionar fotos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publicar galería/ })).toBeInTheDocument();
  });

  test('los extremos del orden se deshabilitan en los dos sentidos', async () => {
    renderAdmin('draft', FULL_CAPABILITIES, {
      assets: [
        photo('asset-cover', { status: 'approved', sortOrder: 0 }),
        photo('asset-b', { status: 'approved', sortOrder: 1 }),
      ],
    });
    await screen.findByText('Borrador en preparación');
    const up = screen.getAllByRole('button', { name: /hacia arriba/i });
    const down = screen.getAllByRole('button', { name: /hacia abajo/i });
    expect(up[0]).toBeDisabled();
    expect(down[down.length - 1]).toBeDisabled();
    expect(down[0]).toBeEnabled();
  });
});

describe('FPR-001.1 · archivada: histórica, sin restaurar ni republicar', () => {
  test('no inventa restaurar, republicar ni duplicar', async () => {
    renderAdmin('archived', FULL_CAPABILITIES, {
      assets: [
        photo('asset-cover', { status: 'hidden', sortOrder: 0 }),
        photo('asset-b', { status: 'hidden', sortOrder: 1 }),
      ],
    });
    await screen.findByText('Galería archivada');

    ['Restaurar', 'Republicar', 'Duplicar', 'Publicar', 'Portada', 'Archivar'].forEach((label) => {
      expect(screen.queryByRole('button', { name: new RegExp(label) })).toBeNull();
    });
  });

  test('el borrado por privacidad sobrevive, porque el backend no lo cierra', async () => {
    renderAdmin('archived', FULL_CAPABILITIES, {
      assets: [photo('asset-cover', { status: 'hidden', sortOrder: 0 })],
    });
    await screen.findByText('Galería archivada');
    expect(screen.getByRole('button', { name: /Eliminar definitivamente/ })).toBeInTheDocument();
  });
});

describe('FPR-001.1 · un actor sin capability no ve acciones ajenas', () => {
  test('modo lectura: ni una sola acción sobre foto o galería', async () => {
    renderAdmin('published', READ_ONLY_CAPABILITIES);
    await screen.findByText('Modo lectura');

    ['Portada', 'Ocultar', 'Eliminar definitivamente', 'Archivar', 'Publicar', 'Crear galería']
      .forEach((label) => {
        expect(screen.queryByRole('button', { name: new RegExp(label) })).toBeNull();
      });
    // Pero la información sigue siendo suya: ve las fotos y el estado.
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Galería publicada'));
  });
});

describe('FPR-001.1 · el resolutor nombra la capability que pide cada RPC', () => {
  const covered = (capabilities, status, assetOverrides = {}) => resolveMediaAssetActions(
    photo('asset-b', assetOverrides), gallery(status), capabilities, { isCover: false },
  );

  test('portada exige `media.set_cover`, no `media.review`', () => {
    expect(covered(FULL_CAPABILITIES, 'draft', { status: 'approved' }).cover).toBe(true);
    expect(covered(
      FULL_CAPABILITIES.filter((name) => name !== 'media.set_cover'), 'draft', { status: 'approved' },
    ).cover).toBe(false);
  });

  test('ocultar exige `media.revoke`, que es lo que el RPC comprueba', () => {
    expect(covered(FULL_CAPABILITIES, 'published').hide).toBe(true);
    expect(covered(
      FULL_CAPABILITIES.filter((name) => name !== 'media.revoke'), 'published',
    ).hide).toBe(false);
  });

  test('ordenar exige `media.update_gallery` y un estado de curaduría', () => {
    expect(covered(FULL_CAPABILITIES, 'draft', { status: 'approved' }).reorder).toBe(true);
    expect(covered(FULL_CAPABILITIES, 'published').reorder).toBe(false);
    expect(covered(
      FULL_CAPABILITIES.filter((name) => name !== 'media.update_gallery'), 'draft',
    ).reorder).toBe(false);
  });

  test('una foto todavía en tránsito no se puede borrar', () => {
    expect(covered(FULL_CAPABILITIES, 'draft', { status: 'processing' }).remove).toBe(false);
    expect(covered(FULL_CAPABILITIES, 'draft', { status: 'uploading' }).remove).toBe(false);
    expect(covered(FULL_CAPABILITIES, 'published').remove).toBe(true);
  });

  test('los estados de curaduría y los cerrados son los que declara el backend', () => {
    expect([...MEDIA_GALLERY_CURATION_STATES]).toEqual(['draft', 'under_review']);
    expect([...MEDIA_GALLERY_CLOSED_STATES]).toEqual(['archived', 'revoked']);
    ['published', 'archived', 'revoked'].forEach((status) => {
      expect(resolveMediaGalleryActions(gallery(status), FULL_CAPABILITIES).editable).toBe(false);
    });
    MEDIA_GALLERY_CURATION_STATES.forEach((status) => {
      expect(resolveMediaGalleryActions(gallery(status), FULL_CAPABILITIES).editable).toBe(true);
    });
  });

  test('sin capabilities, todo cerrado: el default es no ofrecer nada', () => {
    const actions = resolveMediaAssetActions(photo('asset-b'), gallery('draft'), []);
    expect(Object.values(actions).every((allowed) => allowed === false)).toBe(true);
  });
});

describe('FPR-001.1 · los motivos de un reporte se leen, no se deducen', () => {
  test('la bandeja de moderación no muestra el enum crudo', async () => {
    mockContextService = {
      loadMediaAdminContext: jest.fn().mockResolvedValue({
        storage: { bucket: 'tournament-media', private: true, certified: true, uploadReady: true },
        capabilities: FULL_CAPABILITIES,
        tournaments: [],
        galleries: [gallery('published')],
        reports: [
          { id: 'report-a', reason: 'do_not_want_to_appear', detail: '', requestHide: true },
          { id: 'report-b', reason: 'incorrect_identification', detail: 'No soy yo.', requestHide: false },
        ],
      }),
      signMediaReadUrls: jest.fn().mockResolvedValue({}),
      createIdempotencyKey: jest.fn().mockReturnValue('key-a'),
      handleMediaReport: jest.fn(),
    };
    render(
      <MemoryRouter initialEntries={['/torneos/organizacion/org-a/multimedia']}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/multimedia"
            element={<MediaAdminPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('No quiere aparecer')).toBeInTheDocument();
    expect(screen.getByText('Identificación incorrecta')).toBeInTheDocument();
    expect(screen.queryByText(/do_not_want_to_appear|incorrect_identification/)).toBeNull();
    // Ni el enum con los guiones bajos frotados, que era el estado anterior.
    expect(screen.queryByText(/do not want to appear/i)).toBeNull();
  });
});

describe('FPR-001.1 · `Reportar foto` es una acción del sistema, no un estilo suelto', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/features/torneos/components/ParticipantMediaGallery.module.css'),
    'utf8',
  );
  const rule = css.match(/\.lightbox \.reportAction \{([\s\S]*?)\n\}/);

  test('toma la geometría y la tipografía del sistema de botones de Torneos', () => {
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/min-height:\s*var\(--torneos-action-height/);
    expect(rule[1]).toMatch(/border-radius:\s*var\(--torneos-action-radius/);
    expect(rule[1]).toMatch(/padding:\s*0 var\(--torneos-action-padding-x/);
    expect(rule[1]).toMatch(/font-family:\s*var\(--torneos-ui-font/);
    expect(rule[1]).toMatch(/font-weight:\s*var\(--torneos-action-font-weight/);
  });

  test('es secundaria: no hereda el degradado del CTA ni el rojo de destructivo', () => {
    expect(rule[1]).not.toMatch(/--torneos-cta\b/);
    expect(rule[1]).toMatch(/var\(--torneos-control-bg/);
    // El CTA vive en el panel, sobre el submit, que es donde se envía algo.
    expect(css).toMatch(/\.reportForm \.reportSubmit \{[\s\S]*?--torneos-cta/);
  });

  test('el anillo de foco es el del sistema y no un color inventado', () => {
    expect(css).toMatch(/outline:\s*var\(--torneos-focus-ring/);
    expect(css).not.toMatch(/outline:\s*3px solid #63eed0/);
  });

  test('en mobile no se estira como un CTA ni parte el rótulo', () => {
    expect(rule[1]).toMatch(/white-space:\s*nowrap/);
    expect(css).not.toMatch(/\.lightbox > footer button \{ width: 100%; \}/);
    expect(css).toMatch(/\.lightbox \.reportAction \{ align-self: flex-start; width: auto; \}/);
  });
});

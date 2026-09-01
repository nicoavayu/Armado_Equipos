import { supabase } from '../services/api/supabase';
import {
  loadRosterPortraits,
  removePlayerPortrait,
  resolvePlayerPortrait,
  setPlayerPortraitCrop,
  uploadPlayerPortrait,
} from '../features/torneos/api/tournamentPlayerPortraitService';
import { preparePlayerPortraitFile } from '../features/torneos/domain/playerPortraits';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

jest.mock('../features/torneos/domain/playerPortraits', () => ({
  ...jest.requireActual('../features/torneos/domain/playerPortraits'),
  preparePlayerPortraitFile: jest.fn(),
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const ROSTER_PLAYER = '22222222-2222-4222-8222-222222222222';
const PORTRAIT = '33333333-3333-4333-8333-333333333333';
const NEXT_PORTRAIT = '44444444-4444-4444-8444-444444444444';
const REF = { kind: 'player_portrait', id: PORTRAIT, variant: 'original' };

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

describe('tournament player portrait service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REACT_APP_SUPABASE_URL = 'http://127.0.0.1:57321';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'local-anon';
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'local-access-token' } },
    });
    preparePlayerPortraitFile.mockResolvedValue({
      source: new Blob(['jpeg']), mime: 'image/jpeg', width: 900, height: 1200,
    });
    global.fetch = jest.fn();
  });

  test('reads one roster capability map instead of one query per card', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        players: [
          { rosterPlayerId: ROSTER_PLAYER, canManage: true, portrait: null },
          {
            rosterPlayerId: 'ff000000-0000-4000-8000-00000000000f',
            canManage: false,
            portrait: {
              ref: REF, focalX: '0.2500', focalY: '0.3000', cropZoom: '1.6000',
              width: 900, height: 1200,
              editorialStatus: 'pending_review', publicationConsent: 'unknown',
            },
          },
        ],
      },
      error: null,
    });
    const map = await loadRosterPortraits({ organizationId: ORG, teamEntryId: 'entry' });
    expect(supabase.rpc).toHaveBeenCalledWith('list_tournament_player_portrait_refs', {
      p_organization_id: ORG, p_team_entry_id: 'entry',
    });
    expect(map.get(ROSTER_PLAYER)).toMatchObject({ canManage: true, portrait: null });
    expect(map.get('ff000000-0000-4000-8000-00000000000f')).toMatchObject({
      canManage: false,
      portrait: {
        crop: { x: 0.25, y: 0.3, zoom: 1.6 },
        width: 900,
        height: 1200,
        editorialStatus: 'pending_review',
      },
    });
  });

  test('translates a server permission refusal into product language', async () => {
    supabase.rpc.mockResolvedValue({
      data: null, error: { message: 'TORNEOS_PORTRAIT_FORBIDDEN' },
    });
    await expect(loadRosterPortraits({ organizationId: ORG, teamEntryId: 'entry' }))
      .rejects.toThrow('No tenés permiso para administrar la foto de este jugador.');
  });

  test('resolves a signed URL against the configured origin and never persists it', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, {
      ref: REF,
      url: '/storage/v1/object/sign/tournament-player-portraits/o/p.jpg?token=abc',
      ttlSeconds: 300, focalX: '0.4000', focalY: '0.2000',
    }));
    const resolved = await resolvePlayerPortrait(REF);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:57321/functions/v1/tournament-player-portraits');
    expect(JSON.parse(init.body)).toEqual({
      action: 'resolve', ref: REF, audience: 'authenticated_roster',
    });
    expect(resolved.url).toBe(
      'http://127.0.0.1:57321/storage/v1/object/sign/tournament-player-portraits/o/p.jpg?token=abc',
    );
    expect(resolved.ttlSeconds).toBe(300);
    expect(resolved.focal).toEqual({ x: 0.4, y: 0.2 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('refuses to resolve anything that is not a portrait ImageRef', async () => {
    await expect(resolvePlayerPortrait({ kind: 'media_asset', id: PORTRAIT, variant: 'original' }))
      .rejects.toThrow('La referencia de la foto no es válida.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('uploads to a fresh versioned object and then saves the crop', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, {
      imageRef: { kind: 'player_portrait', id: NEXT_PORTRAIT, variant: 'original' },
      replacedPortraitId: PORTRAIT,
    }));
    supabase.rpc.mockResolvedValue({
      data: {
        portraitId: NEXT_PORTRAIT, focalX: '0.3000', focalY: '0.2000', cropZoom: '2.5000',
      },
      error: null,
    });
    const result = await uploadPlayerPortrait({
      organizationId: ORG, rosterPlayerId: ROSTER_PLAYER,
      file: { name: 'f.jpg', type: 'image/jpeg', size: 10 },
      crop: { x: 0.3, y: 0.2, zoom: 2.5 },
    });
    const [url, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(url).toContain('action=upload');
    expect(url).toContain(`rosterPlayerId=${ROSTER_PLAYER}`);
    expect(init.headers['x-image-width']).toBe('900');
    expect(result.ref.id).toBe(NEXT_PORTRAIT);
    expect(result.replacedPortraitId).toBe(PORTRAIT);
    expect(result.cropSaved).toBe(true);
    expect(result.crop).toEqual({ x: 0.3, y: 0.2, zoom: 2.5 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'set_tournament_player_portrait_crop',
      expect.objectContaining({ p_focal_x: 0.3, p_focal_y: 0.2, p_zoom: 2.5 }),
    );
  });

  test('keeps the previous portrait when the replacement upload is rejected', async () => {
    global.fetch.mockResolvedValue(jsonResponse(422, { error: 'file_invalid' }));
    await expect(uploadPlayerPortrait({
      organizationId: ORG, rosterPlayerId: ROSTER_PLAYER,
      file: { name: 'f.jpg', type: 'image/jpeg', size: 10 },
      crop: { x: 0.5, y: 0.5, zoom: 1 },
    })).rejects.toThrow('La imagen no cumple el formato o el tamaño permitidos.');
    // Nada llegó a activarse: la referencia anterior sigue siendo la vigente.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('does not lose an accepted upload because the crop failed', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, {
      imageRef: { kind: 'player_portrait', id: NEXT_PORTRAIT, variant: 'original' },
    }));
    supabase.rpc.mockResolvedValue({
      data: null, error: { message: 'TORNEOS_PORTRAIT_FOCAL_INVALID' },
    });
    const result = await uploadPlayerPortrait({
      organizationId: ORG, rosterPlayerId: ROSTER_PLAYER,
      file: { name: 'f.jpg', type: 'image/jpeg', size: 10 },
      crop: { x: 0.5, y: 0.5, zoom: 1 },
    });
    expect(result.ref.id).toBe(NEXT_PORTRAIT);
    expect(result.cropSaved).toBe(false);
  });

  test('clamps the whole crop before it reaches the database', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        portraitId: PORTRAIT, focalX: '1.0000', focalY: '0.0000', cropZoom: '4.0000',
      },
      error: null,
    });
    const saved = await setPlayerPortraitCrop({
      organizationId: ORG, portraitId: PORTRAIT, crop: { x: 4, y: -2, zoom: 99 },
    });
    expect(supabase.rpc).toHaveBeenCalledWith('set_tournament_player_portrait_crop', {
      p_organization_id: ORG,
      p_portrait_id: PORTRAIT,
      p_focal_x: 1,
      p_focal_y: 0,
      p_zoom: 4,
    });
    expect(saved.crop).toEqual({ x: 1, y: 0, zoom: 4 });
  });

  test('a portrait without a stored zoom still describes a covering crop', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        players: [{
          rosterPlayerId: ROSTER_PLAYER,
          canManage: true,
          portrait: { ref: REF, focalX: '0.5000', focalY: '0.5000', width: 900, height: 1200 },
        }],
      },
      error: null,
    });
    const map = await loadRosterPortraits({ organizationId: ORG, teamEntryId: 'entry' });
    expect(map.get(ROSTER_PLAYER).portrait.crop).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  test('deletes only the portrait, by durable id', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { portraitId: PORTRAIT, deleted: true }));
    const result = await removePlayerPortrait({ portraitId: PORTRAIT });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body))
      .toEqual({ action: 'delete', portraitId: PORTRAIT });
    expect(result).toEqual({ portraitId: PORTRAIT, deleted: true });
  });

  test('reports a failed delete instead of pretending the photo is gone', async () => {
    global.fetch.mockResolvedValue(jsonResponse(502, { error: 'delete_storage_failed' }));
    await expect(removePlayerPortrait({ portraitId: PORTRAIT }))
      .rejects.toThrow('No pudimos borrar la foto. Reintentá en un momento.');
  });

  test('requires a live session before touching the portrait service', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(resolvePlayerPortrait(REF)).rejects.toThrow(/sesión venció/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

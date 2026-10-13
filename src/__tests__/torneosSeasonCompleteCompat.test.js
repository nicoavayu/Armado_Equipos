// Finishing a season from the #204 web on a database BEFORE 0018: the 10-argument update_tournament_season does not exist
// there yet (PostgREST PGRST202), and nothing is removed when a season ends. The web then finishes it as it always did
// (no p_confirm_media_deletion), so publishing the web before 0018 never blocks an organizer. Any other error stands.
import { createStagingV1WorkspaceService } from '../features/torneos/stagingV1/stagingV1WorkspaceService';
import { TorneosBoundaryError } from '../features/torneos/foundation/errors';

const ORG = '11111111-1111-4111-8111-111111111111';
const SEASON = '22222222-2222-4222-8222-222222222222';
const pgrst202 = () => new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
  status: 404,
  rpcError: { code: 'PGRST202', message: 'Could not find the function public.update_tournament_season(...) in the schema cache', details: null, hint: null },
});

function serviceWith(answer) {
  const sent = [];
  const transport = {
    rpc: async (name, params) => { sent.push({ name, params }); return answer(params, sent.length); },
    select: async () => [],
    clear() {},
    dispose() {},
  };
  return { sent, service: createStagingV1WorkspaceService({ transport }) };
}

test('before 0018 (PGRST202) a confirmed finish is sent again without the new argument', async () => {
  const { sent, service } = serviceWith((params) => {
    if ('p_confirm_media_deletion' in params) throw pgrst202();
    return { id: SEASON, status: 'completed' };
  });
  await expect(service.updateSeason({ organizationId: ORG, seasonId: SEASON, status: 'completed', confirmMediaDeletion: true }))
    .resolves.toEqual({ id: SEASON, status: 'completed' });
  expect(sent).toHaveLength(2);
  expect(sent[0].params.p_confirm_media_deletion).toBe(true);
  expect('p_confirm_media_deletion' in sent[1].params).toBe(false);
  expect(sent[1].params.p_status).toBe('completed');
});

test('with 0018 the confirmation goes once and is never dropped', async () => {
  const { sent, service } = serviceWith(() => ({ id: SEASON, status: 'completed' }));
  await service.updateSeason({ organizationId: ORG, seasonId: SEASON, status: 'completed', confirmMediaDeletion: true });
  expect(sent).toHaveLength(1);
  expect(sent[0].params.p_confirm_media_deletion).toBe(true);
});

test('any other refusal (e.g. the 0018 confirmation rule) is not retried without the argument', async () => {
  const { sent, service } = serviceWith(() => {
    throw new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
      status: 400, rpcError: { code: 'P0001', message: 'TORNEOS_SEASON_MEDIA_DELETION_CONFIRMATION_REQUIRED', details: null, hint: null },
    });
  });
  await expect(service.updateSeason({ organizationId: ORG, seasonId: SEASON, status: 'completed', confirmMediaDeletion: true })).rejects.toBeTruthy();
  expect(sent).toHaveLength(1);
});

test('an update without the confirmation never carries the argument', async () => {
  const { sent, service } = serviceWith(() => ({ id: SEASON }));
  await service.updateSeason({ organizationId: ORG, seasonId: SEASON, name: 'Apertura' });
  expect(sent).toHaveLength(1);
  expect('p_confirm_media_deletion' in sent[0].params).toBe(false);
});

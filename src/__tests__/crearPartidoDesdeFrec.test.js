import { crearPartidoDesdeFrec } from '../services/db/frequentMatches';
import { createMatchLinkedToTemplate } from '../services/db/templateMatchLink';

import { supabase } from '../lib/supabaseClient';
import { findDuplicateTemplateMatch } from '../services/db/matchScheduling';
import { updateJugadoresPartido } from '../services/db/matches';

jest.mock('../lib/supabaseClient', () => ({ supabase: { auth: { getUser: jest.fn() } } }));
jest.mock('../services/db/matchScheduling', () => ({ findDuplicateTemplateMatch: jest.fn() }));
jest.mock('../services/db/openMatches', () => ({ QUIERO_JUGAR_OPEN_MATCHES_VIEW: 'v' }));
jest.mock('../services/db/matches', () => ({ updateJugadoresPartido: jest.fn() }));
jest.mock('../services/db/templateMatchLink', () => ({ createMatchLinkedToTemplate: jest.fn() }));

const TEMPLATE = { id: 1, nombre: 'Martes de Lab', hora: '21:00', sede: 'Cancha', modalidad: 'F5' };

beforeEach(() => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } });
  findDuplicateTemplateMatch.mockResolvedValue(null);
  updateJugadoresPartido.mockResolvedValue([]);
});

test('links the creator and the template in the creation, and reports the link state', async () => {
  createMatchLinkedToTemplate.mockResolvedValue({ partido: { id: 385 }, link: { linked: true, status: 'linked' } });
  const partido = await crearPartidoDesdeFrec(TEMPLATE, '2026-10-14', 'F5', 10);
  expect(createMatchLinkedToTemplate).toHaveBeenCalledTimes(1);
  const [payload, templateId] = createMatchLinkedToTemplate.mock.calls[0];
  expect(payload.creado_por).toBe('owner-1');
  expect(templateId).toBe(1);
  expect(partido.template_id).toBe(1);
  expect(partido.templateLink.linked).toBe(true);
});

test('a created match whose link was not confirmed is never created again, nor claimed as linked', async () => {
  createMatchLinkedToTemplate.mockResolvedValue({ partido: { id: 386 }, link: { linked: false, status: 'unverified' } });
  const partido = await crearPartidoDesdeFrec(TEMPLATE, '2026-10-14', 'F5', 10);
  expect(createMatchLinkedToTemplate).toHaveBeenCalledTimes(1);
  expect(partido.id).toBe(386);
  expect(partido.template_id).toBeNull();
  expect(partido.templateLink.status).toBe('unverified');
});

test('a non-schema error (permissions, network) stops: no second attempt', async () => {
  const rls = { code: '42501', message: 'row-level security' };
  createMatchLinkedToTemplate.mockRejectedValue(rls);
  await expect(crearPartidoDesdeFrec(TEMPLATE, '2026-10-14', 'F5', 10)).rejects.toBe(rls);
  expect(createMatchLinkedToTemplate).toHaveBeenCalledTimes(1);
});

test('a missing column (nothing created) may try the next, smaller payload', async () => {
  createMatchLinkedToTemplate
    .mockRejectedValueOnce({ code: 'PGRST204', message: "Could not find the 'precio_cancha_por_persona' column" })
    .mockResolvedValueOnce({ partido: { id: 387 }, link: { linked: true, status: 'linked' } });
  const partido = await crearPartidoDesdeFrec({ ...TEMPLATE, precio_cancha_por_persona: 6000 }, '2026-10-14', 'F5', 10);
  expect(createMatchLinkedToTemplate).toHaveBeenCalledTimes(2);
  expect(createMatchLinkedToTemplate.mock.calls[1][0].precio_cancha_por_persona).toBeUndefined();
  expect(partido.id).toBe(387);
});

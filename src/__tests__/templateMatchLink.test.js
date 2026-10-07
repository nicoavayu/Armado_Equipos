import {
  TEMPLATE_LINK_STATUS,
  createMatchLinkedToTemplate,
  templateLinkFailureMessage,
  verifyTemplateLink,
} from '../services/db/templateMatchLink';
import { crearPartido } from '../services/db/matches';
import { supabase } from '../lib/supabaseClient';

jest.mock('../services/db/matches', () => ({ crearPartido: jest.fn() }));
jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

// partidos read-back (select … maybeSingle) and relink (update … eq) answers, in order.
const mockPartidos = ({ reads = [], updates = [] }) => {
  supabase.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => reads.shift() }) }),
    update: () => ({ eq: async () => updates.shift() }),
  }));
};

const PAYLOAD = { nombre: 'Martes', creado_por: 'u-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates the match with the link in the same insert and confirms it', async () => {
  crearPartido.mockResolvedValue({ id: 10 });
  mockPartidos({ reads: [{ data: { id: 10, template_id: 5 }, error: null }] });

  const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);

  expect(crearPartido).toHaveBeenCalledTimes(1);
  expect(crearPartido).toHaveBeenCalledWith({ ...PAYLOAD, template_id: 5 });
  expect(partido.id).toBe(10);
  expect(link).toEqual({ linked: true, status: TEMPLATE_LINK_STATUS.LINKED });
});

test('a link that did not stick is retried once and recovered', async () => {
  crearPartido.mockResolvedValue({ id: 11 });
  mockPartidos({
    reads: [{ data: { id: 11, template_id: null }, error: null }, { data: { id: 11, template_id: 5 }, error: null }],
    updates: [{ error: null }],
  });

  const { link } = await createMatchLinkedToTemplate(PAYLOAD, 5);
  expect(link.linked).toBe(true);
});

test('a link the server keeps clearing (not the organizer\'s template) is reported, never a success', async () => {
  crearPartido.mockResolvedValue({ id: 12 });
  mockPartidos({
    reads: [{ data: { id: 12, template_id: null }, error: null }, { data: { id: 12, template_id: null }, error: null }],
    updates: [{ error: null }],
  });

  const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);
  expect(partido.id).toBe(12);
  expect(link).toEqual({ linked: false, status: TEMPLATE_LINK_STATUS.NOT_SAVED });
  expect(templateLinkFailureMessage(link, 'Martes de Lab')).toMatch(/se creó, pero no se pudo guardar en el historial de “Martes de Lab”/);
});

test('a database without the column still creates the match and says history is unavailable', async () => {
  const missing = { code: 'PGRST204', message: "Could not find the 'template_id' column of 'partidos' in the schema cache" };
  crearPartido.mockRejectedValueOnce(missing).mockResolvedValueOnce({ id: 13 });

  const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);
  expect(crearPartido).toHaveBeenLastCalledWith(PAYLOAD);
  expect(partido.id).toBe(13);
  expect(link.status).toBe(TEMPLATE_LINK_STATUS.UNSUPPORTED);
  expect(templateLinkFailureMessage(link)).toMatch(/no está disponible/);
});

test('any other creation error is not swallowed (permissions stay enforced)', async () => {
  const rls = { code: '42501', message: 'new row violates row-level security policy for table "partidos"' };
  crearPartido.mockRejectedValue(rls);
  await expect(createMatchLinkedToTemplate(PAYLOAD, 5)).rejects.toBe(rls);
  expect(crearPartido).toHaveBeenCalledTimes(1);
});

test('a read-back failure is "unverified", not linked', async () => {
  mockPartidos({ reads: [{ data: null, error: { code: '500', message: 'timeout' } }] });
  await expect(verifyTemplateLink(14, 5)).resolves.toMatchObject({ linked: false, status: TEMPLATE_LINK_STATUS.UNVERIFIED });
});

test('a template id is required', async () => {
  await expect(createMatchLinkedToTemplate(PAYLOAD, null)).rejects.toThrow(/templateId is required/);
});

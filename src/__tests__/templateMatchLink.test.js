import {
  TEMPLATE_LINK_STATUS,
  confirmTemplateLink,
  createMatchLinkedToTemplate,
  templateLinkNotice,
} from '../services/db/templateMatchLink';
import { crearPartido } from '../services/db/matches';
import { supabase } from '../lib/supabaseClient';

jest.mock('../services/db/matches', () => ({ crearPartido: jest.fn() }));
jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

// Every read-back (select … maybeSingle) and relink (update … eq) of partidos, recorded.
let reads;
let updates;
const mockPartidos = ({ readAnswers = [], updateAnswers = [] }) => {
  reads = [];
  updates = [];
  supabase.from.mockImplementation(() => ({
    select: () => ({
      eq: (_col, id) => ({
        maybeSingle: async () => {
          reads.push(id);
          const next = readAnswers.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      }),
    }),
    update: (values) => ({
      eq: async (_col, id) => {
        updates.push({ id, values });
        const next = updateAnswers.shift();
        if (next instanceof Error) throw next;
        return next || { error: null };
      },
    }),
  }));
};
const row = (id, templateId) => ({ data: { id, template_id: templateId }, error: null });
const readError = { data: null, error: { code: '500', message: 'timeout' } };

const PAYLOAD = { nombre: 'Martes', creado_por: 'u-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createMatchLinkedToTemplate', () => {
  test('creates the match once, with the link in the same insert, and confirms it', async () => {
    crearPartido.mockResolvedValue({ id: 10 });
    mockPartidos({ readAnswers: [row(10, 5)] });

    const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);

    expect(crearPartido).toHaveBeenCalledTimes(1);
    expect(crearPartido).toHaveBeenCalledWith({ ...PAYLOAD, template_id: 5 });
    expect(partido.id).toBe(10);
    expect(link).toEqual({ linked: true, status: TEMPLATE_LINK_STATUS.LINKED });
    expect(updates).toEqual([]);
  });

  test('a database without the column still creates exactly one match', async () => {
    const missing = { code: 'PGRST204', message: "Could not find the 'template_id' column of 'partidos' in the schema cache" };
    crearPartido.mockRejectedValueOnce(missing).mockResolvedValueOnce({ id: 13 });

    const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);
    expect(crearPartido).toHaveBeenCalledTimes(2);
    expect(crearPartido).toHaveBeenLastCalledWith(PAYLOAD);
    expect(partido.id).toBe(13);
    expect(link.status).toBe(TEMPLATE_LINK_STATUS.UNSUPPORTED);
  });

  test('any other creation error is not swallowed and nothing is retried (permissions stay enforced)', async () => {
    const rls = { code: '42501', message: 'new row violates row-level security policy for table "partidos"' };
    crearPartido.mockRejectedValue(rls);
    await expect(createMatchLinkedToTemplate(PAYLOAD, 5)).rejects.toBe(rls);
    expect(crearPartido).toHaveBeenCalledTimes(1);
  });

  test('a failure after the match exists never creates another one', async () => {
    crearPartido.mockResolvedValue({ id: 15 });
    mockPartidos({ readAnswers: [new Error('network down'), new Error('network down')] });

    const { partido, link } = await createMatchLinkedToTemplate(PAYLOAD, 5);
    expect(crearPartido).toHaveBeenCalledTimes(1);
    expect(partido.id).toBe(15);
    expect(link.status).toBe(TEMPLATE_LINK_STATUS.UNVERIFIED);
  });

  test('a template id is required', async () => {
    await expect(createMatchLinkedToTemplate(PAYLOAD, null)).rejects.toThrow(/templateId is required/);
    expect(crearPartido).not.toHaveBeenCalled();
  });
});

describe('confirmTemplateLink (recovery acts on the same match)', () => {
  test('a link verified as missing is written again on the same match and confirmed', async () => {
    mockPartidos({ readAnswers: [row(11, null), row(11, 5)] });
    const link = await confirmTemplateLink(11, 5);
    expect(link.linked).toBe(true);
    expect(updates).toEqual([{ id: 11, values: { template_id: 5 } }]);
    expect(reads).toEqual([11, 11]);
  });

  test('a link the server keeps clearing (not the organizer\'s template) stays NOT_SAVED', async () => {
    mockPartidos({ readAnswers: [row(12, null), row(12, null)] });
    const link = await confirmTemplateLink(12, 5);
    expect(link).toEqual({ linked: false, status: TEMPLATE_LINK_STATUS.NOT_SAVED });
    expect(updates.map((u) => u.id)).toEqual([12]);
  });

  test('a failed read is read again, not treated as missing, and nothing is written', async () => {
    mockPartidos({ readAnswers: [readError, row(14, 5)] });
    await expect(confirmTemplateLink(14, 5)).resolves.toMatchObject({ linked: true });
    expect(updates).toEqual([]);

    mockPartidos({ readAnswers: [readError, readError] });
    await expect(confirmTemplateLink(14, 5)).resolves.toMatchObject({ linked: false, status: TEMPLATE_LINK_STATUS.UNVERIFIED });
    expect(updates).toEqual([]);
  });

  test('a failed relink write does not decide the state: the read after it does', async () => {
    mockPartidos({ readAnswers: [row(16, null), readError], updateAnswers: [new Error('write failed')] });
    await expect(confirmTemplateLink(16, 5)).resolves.toMatchObject({ status: TEMPLATE_LINK_STATUS.UNVERIFIED });
    expect(updates.map((u) => u.id)).toEqual([16]);
  });
});

describe('templateLinkNotice', () => {
  test('nothing to say when linked', () => {
    expect(templateLinkNotice({ linked: true, status: TEMPLATE_LINK_STATUS.LINKED }, 'Martes')).toBeNull();
  });

  test('"sin historial" only when the link was verified as missing', () => {
    const notice = templateLinkNotice({ linked: false, status: TEMPLATE_LINK_STATUS.NOT_SAVED }, 'Martes de Lab');
    expect(notice.title).toBe('Partido creado sin historial');
    expect(notice.message).toMatch(/no quedó guardado en el historial de “Martes de Lab”/);
  });

  test('when it could not be checked: the match exists, history unconfirmed, never "missing"', () => {
    const notice = templateLinkNotice({ linked: false, status: TEMPLATE_LINK_STATUS.UNVERIFIED }, 'Martes de Lab');
    expect(notice.title).toBe('Partido creado');
    expect(notice.message).toMatch(/se creó, pero no pudimos comprobar si quedó en el historial de “Martes de Lab”/);
    expect(`${notice.title} ${notice.message}`).not.toMatch(/sin historial|no quedó|falta/i);
  });

  test('a server without the column says the history is not available', () => {
    const notice = templateLinkNotice({ linked: false, status: TEMPLATE_LINK_STATUS.UNSUPPORTED });
    expect(notice.title).toBe('Partido creado sin historial');
    expect(notice.message).toMatch(/todavía no está disponible/);
  });
});

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FormularioNuevoPartidoFlow from '../pages/FormularioNuevoPartidoFlow';
import {
  formatWizardDateDisplay,
  toTwentyFourHourTime,
  toTwelveHourParts,
} from '../pages/FormularioNuevoPartidoFlow';
import { crearPartido } from '../supabase';
import { insertPartidoFrecuenteFromPartido } from '../services/db/frequentMatches';
import { addDaysToYmd, todayYmdLocal } from '../utils/frequentTemplateDate';

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

jest.mock('../components/AutocompleteSede', () => ({
  __esModule: true,
  default: ({ value, onChange }) => (
    <input
      aria-label="Cancha, sede o dirección"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock('../supabase', () => ({
  crearPartido: jest.fn(),
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../services/db/frequentMatches', () => ({
  insertPartidoFrecuenteFromPartido: jest.fn(),
}));

jest.mock('../hooks/useScrollReset', () => ({
  useScrollResetOnChange: jest.fn(),
}));

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: () => 'match-ref-test',
}));

const EXPECTED_CREATE_PAYLOAD_KEYS = [
  'creado_por',
  'cupo_jugadores',
  'falta_jugadores',
  'fecha',
  'hora',
  'match_ref',
  'modalidad',
  'nombre',
  'precio_cancha_por_persona',
  'sede',
  'sedeMaps',
  'sede_direccion_normalizada',
  'sede_latitud',
  'sede_longitud',
  'sede_place_id',
  'tipo_partido',
].sort();

const renderWizard = (props = {}) => {
  const onConfirmar = jest.fn(async (partido) => partido);
  const onVolver = jest.fn();

  render(
    <FormularioNuevoPartidoFlow
      onConfirmar={onConfirmar}
      onVolver={onVolver}
      {...props}
    />,
  );

  return { onConfirmar, onVolver };
};

const finishTransition = () => {
  const outgoingPanel = screen.queryByTestId('wizard-step-outgoing');
  if (outgoingPanel) fireEvent.animationEnd(outgoingPanel);
};

const clickAndFinishTransition = async (user, button) => {
  await user.click(button);
  finishTransition();
};

const selectTime = async (user, {
  hour = '9',
  minute = '30',
  period = 'PM',
} = {}) => {
  await user.selectOptions(screen.getByLabelText('Hora'), hour);
  await user.selectOptions(screen.getByLabelText('Minutos'), minute);
  await user.selectOptions(screen.getByLabelText('AM o PM'), period);
};

const advanceToReview = async (user, {
  name = 'Fútbol viernes',
  format = 'F7',
  type = 'Femenino',
  time = '21:30',
  venue = 'Cancha Devoto Fútbol',
} = {}) => {
  await user.type(screen.getByLabelText('Nombre del partido'), name);
  await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

  await user.click(screen.getByRole('button', { name: `Formato ${format}` }));
  await user.click(screen.getByRole('button', { name: type }));
  await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

  await user.click(screen.getByRole('button', { name: 'Mañana' }));
  const timeParts = toTwelveHourParts(time);
  await selectTime(user, timeParts);
  await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

  await user.type(screen.getByLabelText('Cancha, sede o dirección'), venue);
  await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

  await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
};

describe('nuevo partido gamer wizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    crearPartido.mockResolvedValue({
      id: 123,
      match_ref: 'created-match-ref',
      nombre: 'Fútbol viernes',
    });
    insertPartidoFrecuenteFromPartido.mockResolvedValue({ id: 99 });
  });

  test('renderiza el paso 1 y no permite avanzar sin nombre', async () => {
    const user = userEvent;
    renderWizard();

    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    expect(screen.getByText('PONÉ NOMBRE AL PARTIDO')).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: 'Siguiente' });
    expect(nextButton).toBeDisabled();
    await user.click(nextButton);
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
  });

  test('avanza con nombre válido y permite elegir formato y tipo', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), '  Partido real  ');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Formato F9' }));
    await user.click(screen.getByRole('button', { name: 'Mixto' }));

    expect(screen.getByRole('button', { name: 'Formato F9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mixto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('18 jugadores')).toBeInTheDocument();
    expect(screen.getByTestId('match-format-block')).toHaveTextContent('Formato');
    expect(screen.getByTestId('match-type-block')).toHaveTextContent('Tipo de partido');
    expect(screen.getByTestId('match-type-block')).toHaveClass('border-t');
  });

  test('el paso 3 muestra sólo Hoy, Mañana y Elegir fecha', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido del miércoles');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mañana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir fecha' })).toBeInTheDocument();
    expect(screen.queryByText('Este finde')).not.toBeInTheDocument();
  });

  test('el header queda limpio y el stepper mantiene el progreso debajo', async () => {
    const user = userEvent;
    renderWizard();

    const header = screen.getByTestId('wizard-header');
    const stepper = screen.getByTestId('wizard-stepper');
    expect(within(header).getByRole('heading', { name: 'Nuevo partido' })).toBeInTheDocument();
    expect(header).not.toHaveTextContent(/Paso\s*\d/i);
    expect(header).not.toHaveTextContent(/\d+\s+de\s+\d+/i);
    expect(header).not.toContainElement(stepper);
    expect(header.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido sin contador');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    expect(header).not.toHaveTextContent(/Paso\s*2/i);
    expect(header).not.toHaveTextContent(/2\s+de\s+6/i);
    expect(stepper).toHaveAttribute('aria-label', 'Paso 2 de 6');
  });

  test('el paso de sede mantiene el autocomplete por encima y separado del precio', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido con sede');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Mañana' }));
    await selectTime(user);
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByTestId('venue-card')).toHaveClass('z-20', 'overflow-visible');
    expect(screen.getByTestId('price-card')).toHaveClass('z-10', 'mt-5');
  });

  test('Hoy y Mañana muestran el día real en grande', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido con fecha');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    const today = todayYmdLocal();
    const tomorrow = addDaysToYmd(today, 1);
    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(screen.getByTestId('selected-date-display')).toHaveTextContent(
      formatWizardDateDisplay({ fecha: today, today, tomorrow }),
    );

    await user.click(screen.getByRole('button', { name: 'Mañana' }));
    expect(screen.getByTestId('selected-date-display')).toHaveTextContent(
      formatWizardDateDisplay({ fecha: tomorrow, today, tomorrow }),
    );
  });

  test('la fecha manual se muestra con día, número y mes formateados', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido manual');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    const today = todayYmdLocal();
    const tomorrow = addDaysToYmd(today, 1);
    const customDate = addDaysToYmd(today, 4);
    await user.click(screen.getByRole('button', { name: 'Elegir fecha' }));
    fireEvent.change(screen.getByLabelText('Fecha personalizada'), {
      target: { value: customDate },
    });

    expect(screen.getByTestId('selected-date-display')).toHaveTextContent(
      formatWizardDateDisplay({ fecha: customDate, today, tomorrow }),
    );
  });

  test('la hora usa 12h y restringe minutos a intervalos de 15', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido nocturno');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Mañana' }));

    expect(screen.getAllByLabelText('Minutos')[0]).toHaveTextContent('00');
    expect(screen.getAllByLabelText('Minutos')[0]).toHaveTextContent('15');
    expect(screen.getAllByLabelText('Minutos')[0]).toHaveTextContent('30');
    expect(screen.getAllByLabelText('Minutos')[0]).toHaveTextContent('45');
    expect(screen.getAllByLabelText('Minutos')[0]).not.toHaveTextContent('10');

    await selectTime(user, { hour: '9', minute: '30', period: 'PM' });
    expect(toTwentyFourHourTime({ hour: '9', minute: '30', period: 'PM' })).toBe('21:30');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  test('el cupo sugerido cambia según el formato', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido de prueba');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByText('10 jugadores')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Formato F11' }));
    expect(screen.getByText('22 jugadores')).toBeInTheDocument();
  });

  test('volver atrás conserva los datos ingresados', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Fútbol del barrio');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByTestId('wizard-step-panel')).toHaveAttribute('data-transition-direction', 'forward');
    finishTransition();
    await user.click(screen.getByRole('button', { name: 'Volver al paso anterior' }));

    expect(screen.getByTestId('wizard-step-panel')).toHaveAttribute('data-transition-direction', 'backward');
    finishTransition();
    expect(screen.getByLabelText('Nombre del partido')).toHaveValue('Fútbol del barrio');
  });

  test('el paso de cupo conserva la convocatoria sin permisos de invitación nuevos', async () => {
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Partido abierto');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Mañana' }));
    await selectTime(user);
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    await user.type(screen.getByLabelText('Cancha, sede o dirección'), 'Cancha segura');
    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));

    const openCallToggle = screen.getByRole('checkbox', { name: /Abrir convocatoria/i });
    expect(openCallToggle).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Permitir invitados/i })).not.toBeInTheDocument();
    await user.click(openCallToggle);
    expect(openCallToggle).toBeChecked();

    await clickAndFinishTransition(user, screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Abierta')).toBeInTheDocument();
  });

  test('el resumen final muestra los datos correctos y permite editarlos', async () => {
    const user = userEvent;
    renderWizard();
    await advanceToReview(user);

    expect(screen.getByTestId('wizard-step-6')).toBeInTheDocument();
    expect(screen.getByText('Fútbol viernes')).toBeInTheDocument();
    expect(screen.getByText('F7 · Femenino')).toBeInTheDocument();
    expect(screen.getByText('Mañana, 9:30 PM')).toBeInTheDocument();
    expect(screen.getByText('Cancha Devoto Fútbol')).toBeInTheDocument();
    expect(screen.getByText('14 jugadores')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar nombre' }));
    finishTransition();
    const nameInput = screen.getByLabelText('Nombre del partido');
    expect(nameInput).toHaveValue('Fútbol viernes');
    await user.clear(nameInput);
    await user.type(nameInput, 'Fútbol sábado');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    finishTransition();

    expect(screen.getByTestId('wizard-step-6')).toBeInTheDocument();
    expect(screen.getByText('Fútbol sábado')).toBeInTheDocument();
  });

  test('muestra el toggle frecuente y conserva la lógica actual al crear', async () => {
    const user = userEvent;
    const { onConfirmar } = renderWizard();
    await advanceToReview(user);

    const frequentToggle = screen.getByRole('checkbox', { name: /Guardar como partido frecuente/i });
    expect(frequentToggle).toBeInTheDocument();
    expect(frequentToggle).not.toBeChecked();
    await user.click(frequentToggle);
    expect(frequentToggle).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Crear partido' }));

    await waitFor(() => {
      expect(crearPartido).toHaveBeenCalledWith(expect.objectContaining({
        match_ref: 'match-ref-test',
        nombre: 'Fútbol viernes',
        modalidad: 'F7',
        cupo_jugadores: 14,
        tipo_partido: 'Femenino',
        fecha: expect.any(String),
        hora: '21:30',
        sede: 'Cancha Devoto Fútbol',
        falta_jugadores: false,
      }));
      expect(Object.keys(crearPartido.mock.calls[0][0]).sort()).toEqual(EXPECTED_CREATE_PAYLOAD_KEYS);
      expect(insertPartidoFrecuenteFromPartido).toHaveBeenCalledWith('created-match-ref');
      expect(onConfirmar).toHaveBeenCalledWith(expect.objectContaining({ id: 123 }));
    });
  });

  test('no guarda como frecuente cuando el toggle queda apagado', async () => {
    const user = userEvent;
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByRole('button', { name: 'Crear partido' }));

    expect(crearPartido).toHaveBeenCalledTimes(1);
    expect(insertPartidoFrecuenteFromPartido).not.toHaveBeenCalled();
  });

  test('la convocatoria impacta el payload final sin agregar permisos de invitación', async () => {
    const user = userEvent;
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByRole('button', { name: 'Editar convocatoria' }));
    finishTransition();
    await user.click(screen.getByRole('checkbox', { name: /Abrir convocatoria/i }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    finishTransition();
    await user.click(screen.getByRole('button', { name: 'Crear partido' }));

    await waitFor(() => {
      expect(crearPartido).toHaveBeenCalledWith(expect.objectContaining({
        falta_jugadores: true,
      }));
      expect(Object.keys(crearPartido.mock.calls[0][0]).sort()).toEqual(EXPECTED_CREATE_PAYLOAD_KEYS);
    });
  });

  test('reduced motion cambia de paso sin dejar transición pendiente', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    const user = userEvent;
    renderWizard();

    await user.type(screen.getByLabelText('Nombre del partido'), 'Sin movimiento');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-panel')).toHaveAttribute('data-transitioning', 'false');
    expect(screen.queryByTestId('wizard-step-outgoing')).not.toBeInTheDocument();
    window.matchMedia = originalMatchMedia;
  });

  test('no duplica el submit aunque se dispare dos veces seguidas', async () => {
    const user = userEvent;
    let resolveCreate;
    crearPartido.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    renderWizard();
    await advanceToReview(user);

    const createButton = screen.getByRole('button', { name: 'Crear partido' });
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    expect(crearPartido).toHaveBeenCalledTimes(1);

    resolveCreate({ id: 123, match_ref: 'created-match-ref' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear partido' })).toBeEnabled());
  });
});

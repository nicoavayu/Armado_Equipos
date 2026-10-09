import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SurveyYesNo, { SURVEY_CHOICE_ADVANCE_MS } from '../components/survey/SurveyYesNo';
import SurveyPlayerGrid from '../components/survey/SurveyPlayerGrid';
import SurveyStepHeader from '../components/survey/SurveyStepHeader';
import SurveySavedCelebration from '../components/survey/SurveySavedCelebration';
import { SurveySelectionSummary } from '../components/survey/SurveyActionBar';

jest.mock('../components/survey/surveyHaptics', () => ({ surveyHaptic: jest.fn() }));

const players = [
  { uuid: 'p1', nombre: 'Sofía Ruiz', avatar_url: 'https://example.test/sofia.jpg' },
  { uuid: 'p2', nombre: 'Diego Sosa' },
  { uuid: 'p3', nombre: 'Lucía Organizadora Con Un Nombre Largo' },
];

describe('SurveyYesNo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('lights the choice up at once and advances once, even on a double tap', () => {
    const onYes = jest.fn();
    const onNo = jest.fn();
    render(<SurveyYesNo onYes={onYes} onNo={onNo} />);

    const yes = screen.getByRole('button', { name: 'SÍ' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    fireEvent.click(screen.getByRole('button', { name: 'NO' }));
    expect(yes).toHaveAttribute('aria-pressed', 'true');
    expect(onYes).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(SURVEY_CHOICE_ADVANCE_MS); });
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).not.toHaveBeenCalled();
  });

  test('shows a previous answer as chosen when coming back', () => {
    render(<SurveyYesNo value="no" onYes={() => {}} onNo={() => {}} />);
    expect(screen.getByRole('button', { name: 'NO' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'SÍ' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SurveyPlayerGrid', () => {
  test('every player is a named toggle; the photo or the initials are shown; selecting calls back', () => {
    const onSelect = jest.fn();
    render(<SurveyPlayerGrid players={players} isSelected={(uuid) => uuid === 'p2'} onSelect={onSelect} />);

    expect(screen.getByRole('button', { name: 'Diego Sosa' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sofía Ruiz' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sofía Ruiz' }).querySelector('img')).toHaveAttribute('src', 'https://example.test/sofia.jpg');
    expect(screen.getByText('DS')).toBeInTheDocument();
    expect(screen.getByText('Lucía Organizadora Con Un Nombre Largo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sofía Ruiz' }));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });
});

describe('SurveyStepHeader', () => {
  test('says which step of how many, and offers back only when there is a previous step', () => {
    const onBack = jest.fn();
    const { rerender } = render(<SurveyStepHeader matchLabel="Picadito" stepNumber={3} stepCount={6} onBack={onBack} onClose={() => {}} />);
    expect(screen.getByText('Paso 3 de 6')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la pregunta anterior' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(<SurveyStepHeader matchLabel="Picadito" stepNumber={1} stepCount={6} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Volver a la pregunta anterior' })).not.toBeInTheDocument();
  });
});

describe('Survey summary and saved screen', () => {
  test('repeats the pick back (one name, or a count)', () => {
    const { rerender } = render(<SurveySelectionSummary players={[players[0]]} />);
    expect(screen.getByText('Sofía Ruiz')).toBeInTheDocument();
    rerender(<SurveySelectionSummary players={[players[0], players[1]]} />);
    expect(screen.getByText('2 jugadores')).toBeInTheDocument();
  });

  test('the saved screen says it was saved and lists the vote', () => {
    const onHome = jest.fn();
    render(
      <SurveySavedCelebration
        justSaved
        title="¡GRACIAS POR CALIFICAR!"
        message="Tus respuestas quedaron guardadas."
        recap={[{ label: 'Mejor jugador', value: 'Sofía Ruiz', player: players[0] }, { label: 'Resultado', value: 'Empate' }]}
        onHome={onHome}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Tus respuestas quedaron guardadas.');
    expect(screen.getByText('Mejor jugador')).toBeInTheDocument();
    expect(screen.getByText('Empate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'VOLVER AL INICIO' }));
    expect(onHome).toHaveBeenCalled();
  });
});

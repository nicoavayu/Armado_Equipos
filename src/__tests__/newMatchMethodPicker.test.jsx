import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PencilLine } from 'lucide-react';

// The picker view pulls in the two heavy flows and the animated-nav hook; stub
// them so we can exercise the chooser in isolation and assert navigation wiring.
jest.mock('../pages/FormularioNuevoPartidoFlow', () => ({
  __esModule: true,
  default: () => <div data-testid="manual-flow">flujo manual</div>,
}));

jest.mock('../components/WhatsAppMatchImportFlow', () => ({
  __esModule: true,
  default: () => <div data-testid="whatsapp-flow">flujo whatsapp</div>,
}));

jest.mock('../components/PageTitle', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="page-title">{children}</div>,
}));

jest.mock('../hooks/useAnimatedNavigation', () => ({
  useAnimatedNavigation: () => ({ navigateWithAnimation: jest.fn() }),
}));

// eslint-disable-next-line import/first
import NuevoPartidoPage, { MethodTile, NewMatchMethodPicker } from '../pages/NuevoPartidoPage';

const renderPicker = () => render(
  <NewMatchMethodPicker onManual={jest.fn()} onWhatsApp={jest.fn()} onBack={jest.fn()} />,
);

describe('NewMatchMethodPicker', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renderiza exactamente dos opciones con labels compactos', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: 'Crear manual' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar WhatsApp' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^method-tile-/)).toHaveLength(2);
  });

  test('dispone las opciones en una grilla de dos columnas (nunca una sola)', () => {
    renderPicker();
    const grid = screen.getByTestId('method-picker-grid');
    expect(grid).toHaveClass('grid', 'grid-cols-2');
    expect(grid.className).not.toMatch(/grid-cols-1/);
    // Width is capped so the two tiles never grow past a comfortable size.
    expect(grid.className).toMatch(/max-w-\[440px\]/);
  });

  test('elimina los subtítulos y la flecha circular anteriores', () => {
    renderPicker();
    expect(screen.queryByText('Flujo clásico')).not.toBeInTheDocument();
    expect(screen.queryByText('Asistente de creación')).not.toBeInTheDocument();
    expect(screen.queryByText('CREAR MANUALMENTE')).not.toBeInTheDocument();
    expect(screen.queryByText('IMPORTAR DESDE WHATSAPP')).not.toBeInTheDocument();
  });

  test('cada bloque es un único botón presionable (toda la superficie)', () => {
    renderPicker();
    const manual = screen.getByTestId('method-tile-manual');
    const whatsapp = screen.getByTestId('method-tile-whatsapp');
    expect(manual.tagName).toBe('BUTTON');
    expect(whatsapp.tagName).toBe('BUTTON');
    // Square, equal-size, touch-friendly, no min-width overflow.
    [manual, whatsapp].forEach((tile) => {
      expect(tile.className).toMatch(/aspect-square/);
      expect(tile.className).toMatch(/w-full/);
      expect(tile.className).toMatch(/min-w-0/);
    });
  });

  test('mantiene feedback de pressed y respeta reduced-motion', () => {
    render(<MethodTile testId="tile" icon={<PencilLine />} title="Crear manual" onClick={jest.fn()} />);
    const tile = screen.getByTestId('tile');
    expect(tile.className).toMatch(/active:scale-\[0\.97\]/);
    expect(tile.className).toMatch(/motion-reduce:active:scale-100/);
    expect(tile.className).toMatch(/motion-reduce:transition-none/);
  });

  test('soporta estado disabled sin disparar la acción', async () => {
    const onClick = jest.fn();
    render(<MethodTile testId="tile" icon={<PencilLine />} title="Crear manual" onClick={onClick} disabled />);
    const tile = screen.getByTestId('tile');
    expect(tile).toBeDisabled();
    expect(tile.className).toMatch(/opacity-45/);
    fireEvent.click(tile);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('NuevoPartidoPage — navegación de cada método', () => {
  beforeEach(() => jest.clearAllMocks());

  test('“Crear manual” abre el flujo manual', async () => {
    render(<NuevoPartidoPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear manual' }));
    expect(screen.getByTestId('manual-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('whatsapp-flow')).not.toBeInTheDocument();
  });

  test('“Importar WhatsApp” abre el flujo de importación', async () => {
    render(<NuevoPartidoPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Importar WhatsApp' }));
    expect(screen.getByTestId('whatsapp-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-flow')).not.toBeInTheDocument();
  });
});

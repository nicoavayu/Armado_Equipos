import React from 'react';
import { render, screen } from '@testing-library/react';
import Modal from '../components/Modal';
import PageTitle from '../components/PageTitle';

describe('PageTitle visual polish', () => {
  test('uses the shared Nuevo partido title treatment on screen titles', () => {
    render(<PageTitle title="DESAFÍOS" position="static" />);

    const heading = screen.getByRole('heading', { name: 'Desafíos' });
    expect(heading).toHaveClass('app-page-title-text');
    expect(heading).toHaveClass('font-oswald');
    expect(heading).toHaveClass('tracking-[0.14em]');
    expect(heading).toHaveClass('uppercase');
  });

  test('keeps accents intact when normalizing page titles', () => {
    render(<PageTitle position="static">ESTADÍSTICAS</PageTitle>);

    expect(screen.getByRole('heading', { name: 'Estadísticas' })).toBeInTheDocument();
  });

  test('does not apply the page title class to inner card titles', () => {
    render(
      <div>
        <PageTitle position="static">MIS PARTIDOS</PageTitle>
        <article>
          <h3>Próximos partidos</h3>
        </article>
      </div>,
    );

    expect(screen.getByRole('heading', { name: 'Mis partidos' })).toHaveClass('app-page-title-text');
    expect(screen.getByRole('heading', { name: 'Próximos partidos' })).not.toHaveClass('app-page-title-text');
  });

  test('does not apply the page title treatment to modal titles or modal body text', () => {
    render(
      <Modal
        isOpen
        onClose={() => {}}
        title="Crear equipo"
      >
        <h3>Colores opcionales</h3>
      </Modal>,
    );

    expect(screen.getByRole('heading', { name: 'Crear equipo' })).not.toHaveClass('app-page-title-text');
    expect(screen.getByRole('heading', { name: 'Colores opcionales' })).not.toHaveClass('app-page-title-text');
  });
});

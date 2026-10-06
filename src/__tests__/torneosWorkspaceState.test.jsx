import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  SESSION_CHECK_DETAIL,
  WorkspaceError,
  WorkspaceLoading,
} from '../features/torneos/components/WorkspaceState';

describe('Torneos shared loading and error states', () => {
  test('a screen loading its data says what it loads, without claiming to check the session', () => {
    render(<WorkspaceLoading label="Cargando tus partidos…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando tus partidos…');
    expect(screen.queryByText(SESSION_CHECK_DETAIL)).not.toBeInTheDocument();
  });

  test('an access guard explains that it is confirming the session', () => {
    render(<WorkspaceLoading label="Confirmando el torneo…" detail={SESSION_CHECK_DETAIL} />);
    expect(screen.getByText(SESSION_CHECK_DETAIL)).toBeInTheDocument();
  });

  test('a failed screen names the screen, keeps the reason and offers a retry', () => {
    const retry = jest.fn();
    render(<WorkspaceError message="Torneos no está disponible en este momento." onRetry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar esta pantalla');
    expect(alert).toHaveTextContent('Torneos no está disponible en este momento.');
    expect(alert).not.toHaveTextContent('No pudimos abrir Torneos');
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('an access guard keeps the Torneos-level title', () => {
    render(<WorkspaceError title="No pudimos abrir Torneos" message="x" />);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos abrir Torneos');
  });
});

// A page whose root is a grid with an implicit `auto` column grows to its longest unbreakable child (a long team
// name, a row of tabs) and pushes everything past a phone screen. Every Torneos page root declares a shrinkable track.
describe('Torneos page roots never widen past the screen', () => {
  const directory = path.join(__dirname, '../features/torneos/components');
  const pageRoot = /^\.([a-zA-Z]*(?:page|Page))\s*\{([^}]*)\}/gm;
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.module.css'));

  test.each(files)('%s', (name) => {
    const css = fs.readFileSync(path.join(directory, name), 'utf8');
    const offenders = [];
    for (const [, selector, body] of css.matchAll(pageRoot)) {
      if (/display:\s*grid/.test(body) && !/grid-template-columns/.test(body)) offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  PREVIEW_WORKSPACES,
  TORNEOS_WORKSPACE_STORAGE_KEY,
  TorneosWorkspaceProvider,
  useTorneosWorkspace,
} from '../features/torneos/context/TorneosWorkspaceContext';

function WorkspaceProbe() {
  const {
    activeWorkspace,
    isAuthoritative,
    selectWorkspace,
  } = useTorneosWorkspace();

  return (
    <div>
      <span>{activeWorkspace?.name}</span>
      <span>{isAuthoritative ? 'authoritative' : 'preview-only'}</span>
      <button
        type="button"
        onClick={() => selectWorkspace(PREVIEW_WORKSPACES[1].id)}
      >
        Cambiar
      </button>
      <button
        type="button"
        onClick={() => selectWorkspace('workspace-falsificado')}
      >
        Falsificar
      </button>
    </div>
  );
}

function createMemoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue) values.set(TORNEOS_WORKSPACE_STORAGE_KEY, initialValue);

  return {
    getItem: jest.fn((key) => values.get(key) || null),
    setItem: jest.fn((key, value) => values.set(key, value)),
  };
}

describe('TorneosWorkspaceProvider', () => {
  test('restores a known workspace and persists a valid change', () => {
    const storage = createMemoryStorage(PREVIEW_WORKSPACES[0].id);

    render(
      <TorneosWorkspaceProvider storage={storage}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    expect(screen.getByText('Liga Devoto')).toBeInTheDocument();
    expect(screen.getByText('preview-only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByText('Copa El Potrero')).toBeInTheDocument();
    expect(storage.setItem).toHaveBeenLastCalledWith(
      TORNEOS_WORKSPACE_STORAGE_KEY,
      PREVIEW_WORKSPACES[1].id,
    );
  });

  test('rejects a workspace id that is not in the available set', () => {
    const storage = createMemoryStorage();

    render(
      <TorneosWorkspaceProvider storage={storage}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Falsificar' }));
    expect(screen.getByText('Liga Devoto')).toBeInTheDocument();
    expect(storage.setItem).not.toHaveBeenCalledWith(
      TORNEOS_WORKSPACE_STORAGE_KEY,
      'workspace-falsificado',
    );
  });
});

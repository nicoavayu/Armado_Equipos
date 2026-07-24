import React from 'react';
import { TorneosWorkspaceProvider } from './context/TorneosWorkspaceContext';
import TorneosShell from './components/TorneosShell';

export default function TorneosApp() {
  return (
    <TorneosWorkspaceProvider>
      <TorneosShell />
    </TorneosWorkspaceProvider>
  );
}

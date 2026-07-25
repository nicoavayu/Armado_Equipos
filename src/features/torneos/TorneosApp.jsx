import React from 'react';
import { TorneosWorkspaceProvider } from './context/TorneosWorkspaceContext';
import TorneosShell from './components/TorneosShell';

export default function TorneosApp({ service }) {
  return (
    <TorneosWorkspaceProvider service={service}>
      <TorneosShell />
    </TorneosWorkspaceProvider>
  );
}

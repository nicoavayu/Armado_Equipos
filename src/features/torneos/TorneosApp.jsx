import React from 'react';
import { TorneosWorkspaceProvider } from './context/TorneosWorkspaceContext';
import TorneosShell from './components/TorneosShell';
import { localReviewWorkspaceService } from './api/localReviewWorkspaceService';

export default function TorneosApp({ service }) {
  const effectiveService = service || (
    process.env.NODE_ENV === 'development'
      && process.env.REACT_APP_LOCAL_EDIT_MODE !== 'false'
      ? localReviewWorkspaceService
      : undefined
  );

  return (
    <TorneosWorkspaceProvider service={effectiveService}>
      <TorneosShell />
    </TorneosWorkspaceProvider>
  );
}

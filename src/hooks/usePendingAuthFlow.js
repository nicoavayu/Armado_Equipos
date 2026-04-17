import { useEffect, useState } from 'react';
import {
  readPendingAuthFlow,
  subscribeAuthFlowState,
} from '../utils/authFlowState';

export default function usePendingAuthFlow() {
  const [pendingAuthFlow, setPendingAuthFlow] = useState(() => readPendingAuthFlow());

  useEffect(() => {
    const syncPendingFlow = () => {
      setPendingAuthFlow(readPendingAuthFlow());
    };

    syncPendingFlow();
    return subscribeAuthFlowState(() => {
      syncPendingFlow();
    });
  }, []);

  return pendingAuthFlow;
}

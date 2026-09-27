import React, { createContext, useContext } from 'react';
import { legacyCommerce } from '../api/legacyCommerceAdapter';
import { TournamentWorkspaceError } from '../api/tournamentWorkspaceErrors';

// Where the Plan and purchase status pages get commerce from (MP-A5).
//
//   no provider  the legacy composition: the legacy adapter, as before
//   provider     a composition that decided: the hybrid one passes its staging-v1 commerce
//                (service → transport → gateway) or, with billing off, the disabled one.
//                A provider never falls back to the legacy adapter.
const TorneosCommerceContext = createContext(legacyCommerce);

const refuse = () => Promise.reject(new TournamentWorkspaceError(
  'TORNEOS_BILLING_DISABLED',
  'La compra no está habilitada en este entorno.',
));

export const disabledCommerce = Object.freeze({
  source: 'disabled',
  entitlementsAuthority: true,
  loadSeasonEntitlements: refuse,
  loadPurchase: refuse,
  createCheckout: refuse,
  createIdempotencyKey: () => null,
  redirect: null,
});

export function TorneosCommerceProvider({ commerce, children }) {
  return (
    <TorneosCommerceContext.Provider value={commerce || disabledCommerce}>
      {children}
    </TorneosCommerceContext.Provider>
  );
}

export function useTorneosCommerce() {
  return useContext(TorneosCommerceContext);
}

import {
  createIdempotencyKey,
  createTournamentCheckout,
  loadTournamentPurchase,
} from './tournamentWorkspaceService';

// Commerce of the legacy composition (single-project LOCAL QA): exactly the functions the
// Plan and purchase status pages imported before MP-A5, behind the context interface. The
// hybrid composition always provides its own commerce and never reaches this module.
export const legacyCommerce = Object.freeze({
  source: 'legacy',
  // Unchanged legacy semantics: the purchase projection decides what the status page shows.
  entitlementsAuthority: false,
  createIdempotencyKey: () => createIdempotencyKey(),
  createCheckout: (input) => createTournamentCheckout(input),
  loadPurchase: (input) => loadTournamentPurchase(input),
  redirect: null,
});

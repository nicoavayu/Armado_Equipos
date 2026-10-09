import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PremiumUpsell from '../../../src/features/torneos/components/PremiumUpsell';
import TorneosShell from '../../../src/features/torneos/components/TorneosShell';
import { TorneosWorkspaceProvider } from '../../../src/features/torneos/context/TorneosWorkspaceContext';
import { TorneosFeaturesProvider } from '../../../src/features/torneos/context/TorneosFeaturesContext';
import { TorneosCommerceProvider, disabledCommerce } from '../../../src/features/torneos/context/TorneosCommerceContext';
import { stagingV1Features, stagingV1FeaturesFor } from '../../../src/features/torneos/stagingV1/stagingV1Features';
import { tournamentEntitlementsFixture } from '../../../src/testUtils/tournamentEntitlementsFixture';
const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', capabilities: ['organization.read', 'workspace.access', 'workspace.manage'] };
const args = new URLSearchParams(window.location.search);
const state = args.get('state') || 'free';
// `planRead=off` mounts the hybrid map without REACT_APP_TORNEOS_PLAN_READ_MODE=on (Production today).
const planRead = args.get('planRead') !== 'off';
// COMMERCE-PRODUCTION: `billing=production|test` mounts the purchase overlay with an offline hybrid commerce;
// `purchase=none|open|pending|approved|refunded|charged_back` is the latest purchase of the season, `role` the user's.
const billing = ['production', 'test'].includes(args.get('billing')) ? args.get('billing') : null;
const features = billing ? stagingV1FeaturesFor(billing, { planRead: true }) : planRead ? stagingV1FeaturesFor('off', { planRead: true }) : stagingV1Features;
const purchaseKind = args.get('purchase') || 'none';
if (args.get('role')) org.role = args.get('role');
const initialPath = args.get('path');
const count = Number(args.get('seasons') ?? 2);
const seasons = Array.from({length: count}, (_, i) => ({id: `20000000-0000-4000-8000-00000000000${i+1}`, name: `Temporada ${2026+i}`}));
const tournaments = seasons.map((s, i) => ({id: `30000000-0000-4000-8000-00000000000${i+1}`, seasonId: s.id, organizationId: org.id, name: i ? 'Clausura' : 'Apertura'}));
const service = {
 loadContext: async () => ({organizations:[org], preference:{activeOrganizationId:org.id}}),
 loadCompetitionContext: async () => ({seasons, tournaments, preference:{activeSeasonId:seasons[0]?.id, activeTournamentId:tournaments[0]?.id}}),
 setTournamentContext: async () => ({}),
 createIdempotencyKey: () => 'offline',
 ...(state === 'unavailable' ? {} : {loadSeasonEntitlements: async ({seasonId}) => {
  if(state === 'loading') return new Promise(() => {});
  if(state === 'error') throw new Error('INTERNAL_CODE_DO_NOT_SHOW');
  return tournamentEntitlementsFixture({seasonId:state === 'mismatch' ? 'other-season' : seasonId, tournamentId:null, plan: state === 'premium' || seasonId === seasons[1]?.id ? 'PREMIUM' : 'FREE'});
 }}),
};
const purchaseOf = (status, extra = {}) => ({ id: '50000000-0000-4000-8000-000000000001', organizationId: org.id, seasonId: seasons[0]?.id, status, provider: 'MERCADO_PAGO', providerEnvironment: billing || 'production',
  productCode: 'torneos_premium', amount: 39900, listAmount: 49900, currency: 'ARS', createdAt: '2026-10-07T12:00:00Z', boughtByMe: true, ...extra });
const PURCHASES = {
  none: [],
  open: [purchaseOf('preference_created', { preferenceExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString() })],
  pending: [purchaseOf('pending')],
  approved: [purchaseOf('approved', { approvedAt: '2026-10-07T12:05:00Z' })],
  refunded: [purchaseOf('refunded', { refundedAt: '2026-10-08T10:00:00Z' })],
  charged_back: [purchaseOf('charged_back')],
};
const commerce = billing ? Object.freeze({
  source: 'hybrid', environment: billing, entitlementsAuthority: true,
  loadSeasonEntitlements: service.loadSeasonEntitlements,
  loadPurchase: async () => PURCHASES[purchaseKind][0],
  loadSeasonPurchases: async ({ organizationId, seasonId }) => ({ schemaVersion: 1, organizationId, seasonId,
    canManageBilling: ['owner', 'admin'].includes(org.role), checkoutAvailable: args.get('available') !== 'no', purchases: PURCHASES[purchaseKind] || [] }),
  refreshPurchase: async () => ({ purchase: PURCHASES[purchaseKind][0], refresh: 'no_payment' }),
  createCheckout: async () => { throw Object.assign(new Error('Laboratorio sin conexión: no se realizó ningún cobro.'), { code: 'TORNEOS_PAYMENTS_UNAVAILABLE' }); },
  createIdempotencyKey: () => '40000000-0000-4000-8000-000000000001',
  redirect: () => {},
}) : disabledCommerce;
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[`/torneos/organizacion/${org.id}/${initialPath || (seasons.length ? `temporada/${seasons[0].id}/plan` : 'mi-plan')}`]}><TorneosFeaturesProvider features={features}><TorneosCommerceProvider commerce={commerce}><TorneosWorkspaceProvider service={service}><Routes><Route path="/torneos/*" element={<TorneosShell />} /></Routes>{args.has('upsell') && <div style={{padding: '24px 24px 160px'}}><PremiumUpsell feature="Más colaboradores" organizationId={org.id} seasonId={seasons[0]?.id} /></div>}</TorneosWorkspaceProvider></TorneosCommerceProvider></TorneosFeaturesProvider></MemoryRouter>);

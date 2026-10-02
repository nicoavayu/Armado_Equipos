import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PremiumUpsell from '../../../src/features/torneos/components/PremiumUpsell';
import TorneosShell from '../../../src/features/torneos/components/TorneosShell';
import { TorneosWorkspaceProvider } from '../../../src/features/torneos/context/TorneosWorkspaceContext';
import { TorneosFeaturesProvider } from '../../../src/features/torneos/context/TorneosFeaturesContext';
import { stagingV1Features, stagingV1FeaturesFor } from '../../../src/features/torneos/stagingV1/stagingV1Features';
import { tournamentEntitlementsFixture } from '../../../src/testUtils/tournamentEntitlementsFixture';
const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', capabilities: ['organization.read', 'workspace.access', 'workspace.manage'] };
const args = new URLSearchParams(window.location.search);
const state = args.get('state') || 'free';
// `planRead=off` mounts the hybrid map without REACT_APP_TORNEOS_PLAN_READ_MODE=on (Production today).
const planRead = args.get('planRead') !== 'off';
const features = planRead ? stagingV1FeaturesFor('off', { planRead: true }) : stagingV1Features;
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
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[`/torneos/organizacion/${org.id}/${initialPath || (seasons.length ? `temporada/${seasons[0].id}/plan` : 'mi-plan')}`]}><TorneosFeaturesProvider features={features}><TorneosWorkspaceProvider service={service}><Routes><Route path="/torneos/*" element={<TorneosShell />} /></Routes>{args.has('upsell') && <div style={{padding: '24px 24px 160px'}}><PremiumUpsell feature="Más colaboradores" organizationId={org.id} seasonId={seasons[0]?.id} /></div>}</TorneosWorkspaceProvider></TorneosFeaturesProvider></MemoryRouter>);

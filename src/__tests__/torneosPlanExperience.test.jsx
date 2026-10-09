import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import PremiumUpsell from '../features/torneos/components/PremiumUpsell';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { createTorneosClient } from '../features/torneos/foundation/torneosClient';
import { createStagingV1WorkspaceService, withoutCommerce } from '../features/torneos/stagingV1/stagingV1WorkspaceService';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
const org = {id:'10000000-0000-4000-8000-000000000001', name:'Liga Devoto'};
const seasons = [1,2].map(i => ({id:`20000000-0000-4000-8000-00000000000${i}`,name:`Temporada ${2025+i}`}));
function show({count=2, load=async ({seasonId})=>tournamentEntitlementsFixture({seasonId}), pinned=null, features=null}={}) {
 const service={loadCompetitionContext:jest.fn().mockResolvedValue({seasons:seasons.slice(0,count),tournaments:[],preference:{activeSeasonId:count ? seasons[0].id:null}}),setTournamentContext:jest.fn().mockResolvedValue({}),...(load ? {loadSeasonEntitlements:jest.fn(load)} : {})};
 const page=(seasonId)=> <TorneosCompetitionProvider organizationId={org.id} routeSeasonId={seasonId} service={service}><PlanExperiencePage organization={org}/></TorneosCompetitionProvider>;
 const element=(seasonId)=> <MemoryRouter>{features ? <TorneosFeaturesProvider features={features}>{page(seasonId)}</TorneosFeaturesProvider> : page(seasonId)}</MemoryRouter>;
 const rendered=render(element(pinned));
 return {service,rerender:(id)=>rendered.rerender(element(id))};
}
test.each(['FREE','PREMIUM'])('%s is confirmed for its season; no checkout is offered', async plan=>{
 show({load:async ({seasonId})=>tournamentEntitlementsFixture({seasonId,plan})});
 expect(await screen.findByRole('heading',{name:`${plan} · Temporada 2026`})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Mi plan'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Ver Premium'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Comprar/})).not.toBeInTheDocument();
 expect(screen.getByText('Propietario + 1')).toBeInTheDocument();
 expect(screen.getByText('Propietario + 10')).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Próximamente'})).toBeInTheDocument();
});
// Production's composition (plan read on; Social, galería and logos off). Without a provider the legacy composition
// turns every surface on, logo upload included, so Mi plan rightly lists Logos y escudos as available there.
test('the FREE vs PREMIUM comparison lists only what works today; future capabilities live apart',async()=>{
 show({features:stagingV1FeaturesFor('off',{planRead:true})});
 await screen.findByRole('heading',{name:'FREE · Temporada 2026'});
 const rows=screen.getAllByRole('row').slice(1).map(row=>row.querySelector('th').textContent);
 expect(rows).toEqual(['Fixture, partidos, actas y tabla','Página pública y comunicados','Colaboradores por temporada']);
 const comparison=screen.getByRole('region',{name:'Qué agrega Premium'});
 expect(comparison).not.toHaveTextContent(/Estudio|Galería|Logo|escudo|Próximamente/);
 const included=screen.getByRole('region',{name:'Inclusiones actuales'});
 expect(included).not.toHaveTextContent(/Logo|Galería|Estudio/);
 const upcoming=screen.getByRole('region',{name:'Próximamente'});
 expect(upcoming).toHaveTextContent('Estas funciones todavía no están disponibles.');
 for(const name of ['Estudio Social','Galería de fotos','Logos y escudos']) expect(within(upcoming).getByRole('region',{name})).toBeInTheDocument();
});
test('Próximamente explains the Estudio Social in human terms, without internal names',async()=>{
 show();
 await screen.findByRole('heading',{name:'FREE · Temporada 2026'});
 expect(document.body).not.toHaveTextContent(/famili|Social Studio|social_studio|round_results|next_fixture|branding_assets/i);
 const studio=screen.getByRole('region',{name:'Estudio Social'});
 const tier=(name)=>within(studio).getByRole('heading',{name}).parentElement.querySelectorAll('li');
 expect([...tier('FREE')].map(li=>li.textContent)).toEqual(['Estilo Base','Resultados','Tabla de posiciones','Próxima fecha']);
 expect([...tier('PREMIUM')].map(li=>li.textContent)).toEqual(['Todas las placas','5 estilos: Base, Heritage, Street, Scoreboard y Editorial','Posibilidad de quitar la firma Arma2']);
 const gallery=screen.getByRole('region',{name:'Galería de fotos'});
 expect(gallery).toHaveTextContent('Hasta 25 archivos');
 expect(gallery).toHaveTextContent('Hasta 1.000 archivos');
});
test.each([0,1,2])('%i seasons can be inspected',async count=>{
 show({count});
 if(!count) expect(await screen.findByRole('heading',{name:'Sin temporada'})).toBeInTheDocument();
 else expect(await screen.findByRole('heading',{name:'FREE · Temporada 2026'})).toBeInTheDocument();
});
test('loading never asserts Free',async()=>{
 show({load:()=>new Promise(()=>{})});
 expect(await screen.findByRole('heading',{name:'Cargando plan…'})).toBeInTheDocument();
 expect(screen.queryByText(/FREE confirmado/)).not.toBeInTheDocument();
});
test('unavailable read never asserts Free',async()=>{
 show({load:null});
 expect(await screen.findByRole('heading',{name:'Lectura no disponible'})).toBeInTheDocument();
 expect(screen.queryByText(/FREE confirmado/)).not.toBeInTheDocument();
});
test('transient error is sanitized and retry reads again',async()=>{
 const {service}=show({load:()=>Promise.reject(new Error('SECRET_INTERNAL_CODE'))});
 expect(await screen.findByRole('heading',{name:'Error transitorio'})).toBeInTheDocument();
 expect(screen.queryByText(/SECRET_INTERNAL_CODE/)).not.toBeInTheDocument();
 service.loadSeasonEntitlements.mockResolvedValue(tournamentEntitlementsFixture({seasonId:seasons[0].id}));
 fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
 expect(await screen.findByRole('heading',{name:'FREE · Temporada 2026'})).toBeInTheDocument();
});
test('wrong season or org from resolver never confirms a plan',async()=>{
 show({load:()=>Promise.resolve(tournamentEntitlementsFixture({seasonId:seasons[1].id,plan:'PREMIUM'}))});
 expect(await screen.findByRole('heading',{name:'Error transitorio'})).toBeInTheDocument();
 expect(screen.queryByText(/PREMIUM confirmado/)).not.toBeInTheDocument();
});
test('late response from previous season cannot replace current season',async()=>{
 let oldResolve;
 const {rerender}=show({pinned:seasons[0].id,load:({seasonId})=>seasonId===seasons[0].id ? new Promise(r=>{oldResolve=r;}) : Promise.resolve(tournamentEntitlementsFixture({seasonId,plan:'PREMIUM'}))});
 await screen.findByRole('heading',{name:'Cargando plan…'});
 await waitFor(()=>expect(oldResolve).toBeDefined());
 rerender(seasons[1].id);
 expect(await screen.findByRole('heading',{name:'PREMIUM · Temporada 2027'})).toBeInTheDocument();
 await act(async()=>oldResolve(tournamentEntitlementsFixture({seasonId:seasons[0].id})));
 expect(screen.getByRole('heading',{name:'PREMIUM · Temporada 2027'})).toBeInTheDocument();
});
test('season switch discards the old Premium while resolving Free',async()=>{
 let release;
 const {rerender}=show({pinned:seasons[0].id,load:({seasonId})=>seasonId===seasons[0].id ? Promise.resolve(tournamentEntitlementsFixture({seasonId,plan:'PREMIUM'})) : new Promise(r=>{release=r;})});
 await screen.findByRole('heading',{name:'PREMIUM · Temporada 2026'});
 rerender(seasons[1].id);
 expect(screen.queryByRole('heading',{name:'PREMIUM · Temporada 2027'})).not.toBeInTheDocument();
 await screen.findByRole('heading',{name:'Cargando plan…'});
 await act(async()=>release(tournamentEntitlementsFixture({seasonId:seasons[1].id})));
 await screen.findByRole('heading',{name:'FREE · Temporada 2027'});
});
test('read-only client permits just season entitlements and refuses purchases and checkout',async()=>{
 const transport={rpc:jest.fn().mockResolvedValue({}),commerce:jest.fn()};
 const client=createTorneosClient({transport,planRead:true});
 await client.execute('get_effective_tournament_season_entitlements');
 await expect(client.execute('get_tournament_purchase')).rejects.toThrow();
 await expect(client.checkout({})).rejects.toThrow();
 expect(transport.commerce).not.toHaveBeenCalled();
 const service=createStagingV1WorkspaceService({transport,planRead:true});
 expect(service.loadSeasonEntitlements).toBeInstanceOf(Function);
 await service.loadSeasonEntitlements({organizationId:org.id,seasonId:seasons[0].id});
 expect(transport.rpc).toHaveBeenLastCalledWith('get_effective_tournament_season_entitlements', {p_organization_id:org.id,p_season_id:seasons[0].id}, {});
 expect(service.createCheckout).toBeUndefined();
 const stripped=withoutCommerce({...service,createCheckout:jest.fn(),loadPurchase:jest.fn()},{planRead:true});
 expect(stripped.loadSeasonEntitlements).toBeInstanceOf(Function);
 expect(stripped.createCheckout).toBeUndefined();
 expect(withoutCommerce(service).loadSeasonEntitlements).toBeUndefined();
});
test('contextual upsell explains Premium, supports Escape and returns focus',async()=>{
 render(<MemoryRouter><PremiumUpsell feature="Más colaboradores" organizationId={org.id} seasonId={seasons[0].id}/></MemoryRouter>);
 const trigger=screen.getByRole('button',{name:/Más colaboradores/});trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog')).toHaveTextContent('Esta función está incluida en Premium.');
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});

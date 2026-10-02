const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
// The fixture server's port (default 3187); another worktree's fixture may already hold the default.
const PORT = process.env.PLAN_UX_PORT || '3187';
(async () => {
 const browser = await chromium.launch({headless:true});
 const results=[];
 for(const [viewportName,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
  for(const [state,count,label] of [['free',2,'FREE · Temporada 2026'],['premium',2,'PREMIUM · Temporada 2026'],['free',0,'Sin temporada'],['free',1,'FREE · Temporada 2026'],['loading',2,'Cargando plan…'],['unavailable',2,'Lectura no disponible'],['error',2,'Error transitorio'],['mismatch',2,'Error transitorio']]) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=> {const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port===PORT) return route.continue();remote.push(url.origin);return route.abort();});
   await page.goto(`http://127.0.0.1:${PORT}?state=${state}&seasons=${count}`);
   await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible();
   await expect(page.locator('#torneos-plan-context a')).toBeVisible();
   await expect(page.getByRole('button',{name:'Ver Premium',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:/Comprar|Checkout/})).toHaveCount(0);
   const copy=await page.locator('#torneos-main').innerText();
   if(/Plan no verificado|Plan comercial|en este entorno|INTERNAL_CODE_DO_NOT_SHOW/.test(copy)) throw new Error(`Forbidden copy: ${state}`);
   if(!['free','premium'].includes(state) && /(?:FREE|PREMIUM) confirmado/.test(copy)) throw new Error('Unconfirmed plan shown');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`Horizontal overflow at ${width}`);
   // Future capabilities never share the FREE vs PREMIUM table: they live in their own Próximamente section,
   // after it, and every block of it fits the viewport.
   const comparison=await page.locator('section[aria-labelledby="plan-comparison-title"]').innerText();
   if(/Estudio|Galería|Logo|escudo|Próximamente/.test(comparison)) throw new Error(`Future capability in the comparison at ${width}`);
   const upcoming=page.locator('section[aria-labelledby="plan-upcoming-title"]');
   await expect(upcoming.getByRole('heading',{name:'Próximamente',exact:true})).toBeVisible();
   for(const name of ['Estudio Social','Galería de fotos','Logos y escudos']) await expect(upcoming.getByRole('heading',{name,exact:true})).toBeVisible();
   if(await upcoming.evaluate(section=>[...section.querySelectorAll('*')].some(el=>el.getBoundingClientRect().right>window.innerWidth+0.5 || (el.scrollWidth>el.clientWidth+1 && getComputedStyle(el).overflowX==='hidden')))) throw new Error(`Próximamente overflows at ${width}`);
   if(errors.length || remote.length) throw new Error(JSON.stringify({errors,remote}));
   if(width!==320) await page.screenshot({path:path.join('artifacts/plan-ux',`after-${viewportName}-${state}-${count}.png`),fullPage:true});
   if(state==='free' && count===2){
    if(width===1440){const labels=await page.getByRole('navigation',{name:'Navegación de la organización',exact:true}).getByRole('link').allTextContents();if(labels.indexOf('Mi plan')!==labels.indexOf('Configuración')-1)throw new Error('Navigation order');}
    await page.getByLabel('Temporada activa').selectOption('20000000-0000-4000-8000-000000000002');
    await expect(page.getByRole('heading',{name:'PREMIUM · Temporada 2027',exact:true})).toBeVisible();
    await expect(page.locator('#torneos-plan-context a')).toContainText('PREMIUM · Temporada 2027');
    await page.locator('#torneos-plan-context a').click();
    await expect(page.getByRole('heading',{name:'PREMIUM · Temporada 2027',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Ver Premium',exact:true}).click();
    await expect(page.locator('section[aria-labelledby="plan-comparison-title"]')).toBeFocused();
   }
   results.push({viewport:viewportName,state,seasons:count,passed:true,remoteRequests:remote.length});
   await page.close();
  }
 }
 // Mobile discoverability: the header names Mi plan above the fold with its badge; the bottom bar
 // keeps its operational order (Mi plan stays in it) and shows it when it is the current section.
 for(const [viewportName,width,height] of [['mobile',390,844],['small-mobile',320,740]]) {
  for(const [state,route,badge] of [['free','inicio','FREE'],['premium','partidos','PREMIUM'],['free','mi-plan','FREE']]) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=> {const url=new URL(r.request().url());if(url.hostname==='127.0.0.1' && url.port===PORT) return r.continue();remote.push(url.origin);return r.abort();});
   await page.goto(`http://127.0.0.1:${PORT}?state=${state}&seasons=2&path=${route}`);
   const entry=page.locator('#torneos-plan-context').getByRole('link',{name:`Mi plan: ${badge} · Temporada 2026`,exact:true});
   await expect(entry).toBeVisible();
   await expect(entry).toContainText('Mi plan');
   await expect(entry.locator('strong')).toHaveText(badge);
   const box=await entry.boundingBox();
   if(box.y+box.height>height/3 || box.height<44) throw new Error(`Mi plan header entry not above the fold at ${width}`);
   const bar=page.getByRole('navigation',{name:'Navegación móvil de la organización',exact:true});
   const labels=await bar.getByRole('link').allTextContents();
   if(labels.slice(0,5).join()!=='Inicio,Torneos,Equipos,Fixture,Partidos' || !labels.includes('Mi plan')) throw new Error(`Mobile bar changed at ${width}: ${labels}`);
   if(route==='mi-plan'){
    // MemoryRouter: the redirect to the season plan shows as its heading, not in the URL.
    await expect(page.getByRole('heading',{name:`${badge} · Temporada 2026`,exact:true})).toBeVisible();
    const item=await bar.getByRole('link',{name:'Mi plan',exact:true}).boundingBox();
    const navBox=await bar.boundingBox();
    if(item.x<navBox.x || item.x+item.width>navBox.x+navBox.width+1) throw new Error(`Current Mi plan not shown in the bar at ${width}`);
   } else {
    await entry.click();
    await expect(page.getByRole('heading',{name:`${badge} · Temporada 2026`,exact:true})).toBeVisible();
   }
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`Horizontal overflow at ${width}`);
   if(errors.length || remote.length) throw new Error(JSON.stringify({errors,remote}));
   if(width!==320) await page.screenshot({path:path.join('artifacts/plan-ux',`discover-${viewportName}-${route}.png`)});
   results.push({viewport:viewportName,discoverability:route,state,passed:true,remoteRequests:remote.length});
   await page.close();
  }
 }
 // Plan seal: visible at every width, phones included. A hidden or collapsed seal fails before anything is
 // measured: display:none, visibility:hidden, opacity 0 or a 0×0 box never count as "centered".
 for(const [viewportName,width,height] of [['desktop',1440,1000],['laptop',1024,768],['tablet',700,900],['narrow',540,900],['mobile',390,844],['small-mobile',320,740]]) {
  for(const plan of ['FREE','PREMIUM']) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=> {const url=new URL(r.request().url());if(url.hostname==='127.0.0.1' && url.port===PORT) return r.continue();remote.push(url.origin);return r.abort();});
   await page.goto(`http://127.0.0.1:${PORT}?state=${plan.toLowerCase()}&seasons=2`);
   await expect(page.getByRole('heading',{name:`${plan} · Temporada 2026`,exact:true})).toBeVisible();
   await expect(page.locator('#torneos-plan-context').getByRole('link',{name:`Mi plan: ${plan} · Temporada 2026`,exact:true})).toBeVisible();
   const card=page.locator('section[aria-label="Plan actual"]');
   const seal=card.locator(':scope > [aria-hidden="true"]');
   await expect(seal).toHaveCount(1);
   await expect(seal,`plan seal hidden at ${width}`).toBeVisible({timeout:5000});
   await seal.scrollIntoViewIfNeeded();
   if(!await page.evaluate(async()=>{await document.fonts.load('34px "Bebas Neue"');await document.fonts.ready;return [...document.fonts].some(f=>f.family.replace(/["']/g,'')==='Bebas Neue'&&f.status==='loaded');})) throw new Error(`Bebas Neue not loaded at ${width}`);
   const m=await card.evaluate(section=>{
    const seal=section.firstElementChild,mark=seal.firstElementChild,label=mark.lastElementChild,copy=section.children[1];
    const shown=el=>{for(let n=el;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<0.99)return false;}return true;};
    const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
    const sb=box(seal),hit=document.elementFromPoint(sb.cx,sb.cy);
    return {shown:[seal,mark,label].every(shown),seal:sb,mark:box(mark),label:box(label),card:box(section),copy:box(copy),text:label.textContent,fontSize:parseFloat(getComputedStyle(label).fontSize),uncovered:!!hit&&seal.contains(hit)};
   });
   const fail=msg=>{throw new Error(`Seal ${plan} at ${width}: ${msg} ${JSON.stringify(m)}`);};
   if(!m.shown) fail('hidden (display/visibility/opacity)');
   for(const k of ['seal','mark','label']) if(!(m[k].w>0 && m[k].h>0)) fail(`${k} has a 0×0 box`);
   if(m.text!==plan) fail('wrong label');
   if(m.seal.w<88 || Math.abs(m.seal.w-m.seal.h)>1) fail('not a legible circle');
   if(m.fontSize<16) fail('label too small');
   if(Math.abs(m.mark.cx-m.seal.cx)>1.5 || Math.abs(m.mark.cy-m.seal.cy)>1.5) fail('emblem not centered in the circle');
   const r=m.seal.w/2;
   if([[m.label.x,m.label.y],[m.label.x+m.label.w,m.label.y],[m.label.x,m.label.y+m.label.h],[m.label.x+m.label.w,m.label.y+m.label.h]].some(([x,y])=>Math.hypot(x-m.seal.cx,y-m.seal.cy)>r-4)) fail('label spills out of the circle');
   if(m.seal.x<m.card.x || m.seal.y<m.card.y || m.seal.x+m.seal.w>m.card.x+m.card.w || m.seal.y+m.seal.h>m.card.y+m.card.h) fail('clipped by the card');
   if(!(m.seal.x+m.seal.w<=m.copy.x || m.copy.x+m.copy.w<=m.seal.x || m.seal.y+m.seal.h<=m.copy.y || m.copy.y+m.copy.h<=m.seal.y)) fail('overlaps the plan copy');
   if(!m.uncovered) fail('covered by another element');
   if(width<=520 && (Math.abs(m.seal.cx-m.card.cx)>1.5 || m.seal.h>120)) fail('not a compact centered emblem on phones');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`Horizontal overflow at ${width}`);
   if(errors.length || remote.length) throw new Error(JSON.stringify({errors,remote}));
   await card.screenshot({path:path.join('artifacts/plan-ux',`seal-${width}-${plan.toLowerCase()}.png`)});
   results.push({viewport:viewportName,width,seal:plan,passed:true,circle:Math.round(m.seal.w),card:Math.round(m.card.h),offset:[+(m.mark.cx-m.seal.cx).toFixed(2),+(m.mark.cy-m.seal.cy).toFixed(2)],remoteRequests:remote.length});
   await page.close();
  }
 }
 // PLAN READ OFF: no Mi plan in nav, no header context, no badge, no plan read; the plan routes are closed.
 for(const [viewportName,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
  for(const [route,closed] of [['inicio',false],['temporada/20000000-0000-4000-8000-000000000001/plan',true],['mi-plan',true]]) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=> {const url=new URL(r.request().url());if(url.hostname==='127.0.0.1' && url.port===PORT) return r.continue();remote.push(url.origin);return r.abort();});
   await page.goto(`http://127.0.0.1:${PORT}?planRead=off&state=premium&seasons=2&path=${encodeURIComponent(route)}`);
   // Desktop and mobile navs (the hidden one included): none may offer Mi plan.
   const navLinks=page.locator('nav[aria-label$="de la organización"] a');
   await expect(page.getByRole('navigation',{name:/^Navegación (móvil )?de la organización$/}).first()).toBeVisible();
   if(closed) await expect(page.getByText(/todavía no está habilitada/).first()).toBeVisible();
   const labels=await navLinks.allTextContents();
   if(labels.length<5 || labels.some(l=>/Mi plan/.test(l))) throw new Error(`Mi plan visible with PLAN READ OFF at ${width}`);
   await expect(page.locator('#torneos-plan-context')).toHaveCount(0);
   await expect(page.locator('[aria-label^="Mi plan:"]')).toHaveCount(0);
   await expect(page.locator('[data-plan]')).toHaveCount(0);
   if(/PREMIUM|FREE ·|Lectura no disponible/.test(await page.locator('body').innerText())) throw new Error(`Plan state shown with PLAN READ OFF at ${width}`);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`Horizontal overflow at ${width}`);
   if(errors.length || remote.length) throw new Error(JSON.stringify({errors,remote}));
   if(width!==320) await page.screenshot({path:path.join('artifacts/plan-ux',`off-${viewportName}-${route.split('/')[0]}.png`),fullPage:true});
   results.push({viewport:viewportName,planRead:'off',route,passed:true,remoteRequests:remote.length});
   await page.close();
  }
 }
 fs.writeFileSync('artifacts/plan-ux/browser-results.json',JSON.stringify(results,null,2));
 await browser.close();console.log(`${results.length} browser scenarios passed; no remote requests`);
})().catch(e=>{console.error(e);process.exit(1)});

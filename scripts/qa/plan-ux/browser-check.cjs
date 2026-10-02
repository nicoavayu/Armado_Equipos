const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
(async () => {
 const browser = await chromium.launch({headless:true});
 const results=[];
 for(const [viewportName,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
  for(const [state,count,label] of [['free',2,'FREE · Temporada 2026'],['premium',2,'PREMIUM · Temporada 2026'],['free',0,'Sin temporada'],['free',1,'FREE · Temporada 2026'],['loading',2,'Cargando plan…'],['unavailable',2,'Lectura no disponible'],['error',2,'Error transitorio'],['mismatch',2,'Error transitorio']]) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=> {const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port==='3187') return route.continue();remote.push(url.origin);return route.abort();});
   await page.goto(`http://127.0.0.1:3187?state=${state}&seasons=${count}`);
   await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible();
   await expect(page.locator('#torneos-plan-context a')).toBeVisible();
   await expect(page.getByRole('button',{name:'Ver Premium',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:/Comprar|Checkout/})).toHaveCount(0);
   const copy=await page.locator('#torneos-main').innerText();
   if(/Plan no verificado|Plan comercial|en este entorno|INTERNAL_CODE_DO_NOT_SHOW/.test(copy)) throw new Error(`Forbidden copy: ${state}`);
   if(!['free','premium'].includes(state) && /(?:FREE|PREMIUM) confirmado/.test(copy)) throw new Error('Unconfirmed plan shown');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`Horizontal overflow at ${width}`);
   if(errors.length || remote.length) throw new Error(JSON.stringify({errors,remote}));
   if(width!==320) await page.screenshot({path:path.join('artifacts/plan-ux',`after-${viewportName}-${state}-${count}.png`),fullPage:true});
   if(state==='free' && count===2){
    if(width===1440){const labels=await page.getByRole('navigation',{name:'Navegación de la organización',exact:true}).getByRole('link').allTextContents();if(labels.indexOf('Mi plan')!==labels.indexOf('Configuración')-1)throw new Error('Navigation order');}
    await page.getByLabel('Temporada activa').selectOption('20000000-0000-4000-8000-000000000002');
    await expect(page.getByRole('heading',{name:'PREMIUM · Temporada 2027',exact:true})).toBeVisible();
    await expect(page.locator('#torneos-plan-context a')).toHaveText('PREMIUM · Temporada 2027');
    await page.locator('#torneos-plan-context a').click();
    await expect(page.getByRole('heading',{name:'PREMIUM · Temporada 2027',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Ver Premium',exact:true}).click();
    await expect(page.locator('section[aria-labelledby="plan-comparison-title"]')).toBeFocused();
   }
   results.push({viewport:viewportName,state,seasons:count,passed:true,remoteRequests:remote.length});
   await page.close();
  }
 }
 // PLAN READ OFF: no Mi plan in nav, no header context, no badge, no plan read; the plan routes are closed.
 for(const [viewportName,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
  for(const [route,closed] of [['inicio',false],['temporada/20000000-0000-4000-8000-000000000001/plan',true],['mi-plan',true]]) {
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=> {const url=new URL(r.request().url());if(url.hostname==='127.0.0.1' && url.port==='3187') return r.continue();remote.push(url.origin);return r.abort();});
   await page.goto(`http://127.0.0.1:3187?planRead=off&state=premium&seasons=2&path=${encodeURIComponent(route)}`);
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

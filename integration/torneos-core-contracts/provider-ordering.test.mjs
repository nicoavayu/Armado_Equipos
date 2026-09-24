// MP-B1.2: real database ordering contract. BASELINE=1 reproduces RED on 0000..0002.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPurchase, asPay, lit, j, purchaseRow, grantEvents, snapshot, admin, cfg } from './payments-lab.mjs';
import { inGateway } from './lab.mjs';
const commercialSnapshot = id => JSON.stringify([purchaseRow(id),grantEvents(id)]);
const audit = (id,type) => j(admin(`select coalesce(json_agg(metadata order by id),'[]') from public.tournament_purchase_events where purchase_id=${lit(id)} and event_type=${lit(type)}`));
const watermark = id => j(admin(`select to_jsonb(w) from public.tournament_payment_provider_watermarks w where purchase_id=${lit(id)} limit 1`));
const baseline = process.env.MP_ORDERING_BASELINE === '1';
const stamp = n => `2026-09-20T00:00:${String(n).padStart(2, '0')}.000Z`;
function query(p, state, n, payment = '123456') {
  const actions = { disputed: 'chargeback_disputed', restored: 'chargeback_restored', refunded: 'refund', settled: 'chargeback_buyer_won' };
  const action = actions[state];
  const status = state === 'disputed' || state === 'restored' || state === 'settled' ? 'charged_back' : state;
  return `select public.apply_verified_tournament_payment_${action ? 'reversal' : 'status'}(${lit(p.id)}, 'MERCADO_PAGO', 'test', ${lit(action ?? state)}, ${lit(status)}, ${lit(state === 'restored' ? 'reimbursed' : state === 'settled' ? 'settled' : null)}, ${lit(payment)}${baseline ? '' : `, ${lit(stamp(n))}::timestamptz`})`;
}
const apply = (p, state, n, payment) => j(asPay(query(p, state, n, payment)));
function ready(label) {
  const p = newPurchase(label);
  asPay(`select public.record_tournament_purchase_preference(${lit(p.id)}, 'MERCADO_PAGO', 'test', ${lit('pref-' + p.id)}, now() + interval '30 minutes')`);
  return p;
}
for (const [label, steps, expected] of [
  ['restored-old-dispute', [['approved',1],['disputed',2],['restored',3],['disputed',2]], 'approved'],
  ['approved-old-pending', [['approved',3],['pending',1]], 'approved'],
  ['approved-old-rejected', [['approved',3],['rejected',1]], 'approved'],
  ['refund-old-approved', [['approved',1],['refunded',3],['approved',1]], 'refunded'],
  ['duplicate-approved', [['approved',1],['approved',1]], 'approved'],
  ['duplicate-dispute', [['approved',1],['disputed',2],['disputed',2]], 'charged_back'],
  ['duplicate-restored', [['approved',1],['disputed',2],['restored',3],['restored',3]], 'approved'],
  ['duplicate-refund', [['approved',1],['refunded',3],['refunded',3]], 'refunded'],
]) test(label, () => {
  const p = ready(label);
  // Each purchase needs its own provider payment ID (global approval binding).
  const id = p.id.replaceAll('-', '');
  for (const [s,n] of steps.slice(0,-1)) apply(p,s,n,id);
  const before = commercialSnapshot(p.id);
  const beforeAudit = snapshot(p.id);
  const [s,n] = steps.at(-1); apply(p,s,n,id);
  assert.equal(purchaseRow(p.id).status, expected);
  assert.equal(commercialSnapshot(p.id), before, 'stale/equal must be an exact commercial no-op');
  if (label.startsWith('duplicate-')) assert.equal(snapshot(p.id),beforeAudit,'equal replay adds no audit');
  assert.equal(grantEvents(p.id).filter(x => x === 'granted').length, 1);
});
test('equal version incompatible state fails closed', () => {
  const p = ready('equal-conflict'), id = p.id.replaceAll('-','');
  apply(p,'approved',1,id); const before = commercialSnapshot(p.id);
  const r = apply(p,'disputed',1,id);
  assert.equal(r.outcome, 'provider_ordering_anomaly');
  assert.equal(r.requiresManualReview, true);
  assert.equal(commercialSnapshot(p.id), before);
});
test('concurrent fetched-old snapshot waits for newer transaction and cannot undo restoration', () => {
  const p = ready('concurrent'), id = p.id.replaceAll('-','');
  apply(p,'approved',1,id); apply(p,'disputed',2,id);
  const oldFetchedSnapshot = query(p,'disputed',2,id);
  const newerSnapshot = query(p,'restored',3,id);
  const url = `postgres://lab_payment_service:${cfg.paymentServicePassword}@torneos-db:5432/postgres`;
  const result = inGateway(`import pg from 'pg';
    const a = new pg.Client({connectionString:${JSON.stringify(url)}}), b = new pg.Client({connectionString:${JSON.stringify(url)}});
    await a.connect(); await b.connect();
    await a.query('BEGIN'); await a.query('SET LOCAL ROLE torneos_payment_service');
    await a.query(${JSON.stringify(newerSnapshot)});
    await b.query('SET ROLE torneos_payment_service');
    const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const delayed = b.query(${JSON.stringify(oldFetchedSnapshot)});
    let blocked = false;
    for(let i=0;i<100;i++) {
      blocked = (await a.query('select exists(select 1 from pg_locks where pid=$1 and not granted) blocked',[pid])).rows[0].blocked;
      if(blocked) break;
      await new Promise(r=>setTimeout(r,10));
    }
    if(!blocked) throw new Error('old transaction did not contend on the purchase lock');
    await a.query('COMMIT'); await delayed;
    await a.end(); await b.end(); console.log('done');`);
  assert.match(result,/done/);
  assert.equal(purchaseRow(p.id).status,'approved');
  assert.deepEqual(grantEvents(p.id),['granted','suspended','restored']);
});

test('watermarks are private; exactly four payment EXECUTEs and no legacy bypass', () => {
  assert.equal(admin(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('torneos_payment_service',p.oid,'EXECUTE')`).trim(),'4');
  for (const role of ['authenticated','anon','service_role','torneos_payment_service']) {
    assert.equal(admin(`select has_table_privilege('${role}','public.tournament_payment_provider_watermarks','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`).trim(),'f');
    for (const fn of ['unordered_tournament_payment_status','unordered_tournament_payment_reversal']) {
      assert.equal(admin(`select has_function_privilege('${role}','public.${fn}(uuid,text,text,text,text,text,text)','EXECUTE')`).trim(),'f');
    }
  }
});

test('null/infinite provider ordering metadata fails closed; transaction rollback includes watermark', () => {
  const p=ready('invalid-ordering'), id=p.id.replaceAll('-','');
  const before=commercialSnapshot(p.id);
  for (const value of ['null',"'infinity'", "'-infinity'"]) {
    assert.throws(()=>asPay(query(p,'approved',1,id).replace(lit(stamp(1))+'::timestamptz',value+'::timestamptz')),/TORNEOS_PROVIDER_ORDERING_REQUIRED/);
    assert.equal(commercialSnapshot(p.id),before);
  }
  admin(`begin; ${query(p,'approved',1,id)}; rollback;`);
  assert.equal(commercialSnapshot(p.id),before);
  assert.equal(admin(`select count(*) from public.tournament_payment_provider_watermarks where purchase_id=${lit(p.id)}`).trim(),'0');
});

test('separate payment attempts have independent provider watermarks', () => {
  const p=ready('attempt-watermarks'), id=p.id.replaceAll('-','');
  apply(p,'rejected',9,id+'A');
  apply(p,'approved',1,id+'B');
  assert.equal(purchaseRow(p.id).status,'approved');
});

test('two service instances: old fetched first, applied last; only re-fetch supplies ordering', async () => {
  const { createPaymentsService } = await import('../../backend/torneos/supabase/functions/torneos-payments/handler.ts');
  const { UNIT_ENV } = await import('./payments-unit-env.mjs');
  const { createHmac } = await import('node:crypto');
  const p=ready('workers'), id=String(Date.now());
  apply(p,'approved',1,id); apply(p,'disputed',2,id);
  const projection=j(asPay(`select public.get_provider_tournament_purchase(${lit(p.externalReference)},'MERCADO_PAGO','test')`));
  let release, fetched, didPause = false;
  const paused=new Promise(r=>{fetched=r;});
  const resume=new Promise(r=>{release=r;});
  function service(state,n,hold=false) {
    return createPaymentsService({env:UNIT_ENV,log:()=>{},connectDb:()=>({async call(name,args) {
      if(name==='get_provider_tournament_purchase') return projection;
      assert.equal(args[7],stamp(n),'provider time must survive forged webhook timestamp');
      if(hold) { didPause = true; fetched(); await resume; }
      return j(asPay(`select public.${name}(${args.map(lit).join(',')})`));
    }}),fetcher:async url=>new Response(JSON.stringify(String(url).includes('/v1/payments/') ? {
      id,status:'charged_back',status_detail:state==='restored'?'reimbursed':null,date_last_updated:stamp(n),
      external_reference:p.externalReference,currency_id:p.currency,transaction_amount:p.amount,
      collector_id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID,metadata:{purchase_id:p.id},live_mode:false,
      order:{id:'999',type:'mercadopago'},
    } : {id:'999',preference_id:'pref-'+p.id,external_reference:p.externalReference,
      collector:{id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID},payments:[{id}]}))});
  }
  function request() {
    const ts='1790000000', requestId='ordering-workers';
    const signature=createHmac('sha256',UNIT_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
    return new Request(`http://unit.invalid/torneos-payments/webhooks/mercadopago/v1?data.id=${id}&type=payment`,{
      method:'POST',headers:{'content-type':'application/json','x-request-id':requestId,'x-signature':`ts=${ts},v1=${signature}`},
      body:JSON.stringify({type:'payment',data:{id},date_last_updated:stamp(59),date_created:stamp(59),live_mode:false,user_id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID}),
    });
  }
  const old=service('disputed',2,true)(request());
  await Promise.race([paused, old.then(async r => { if (!didPause) throw new Error('old worker never paused: '+r.status+' '+await r.text()); })]);
  const newer=await service('restored',3)(request()); assert.equal(newer.status,200);
  release(); const stale=await old; assert.equal(stale.status,200);
  assert.equal((await stale.json()).outcome,'stale_ignored');
  assert.equal(purchaseRow(p.id).status,'approved');
  assert.deepEqual(grantEvents(p.id),['granted','suspended','restored']);
});

test('equal-version replay preserves existing manual-refund policy flags', () => {
  const p=ready('manual-flag'), id=p.id.replaceAll('-','');
  apply(p,'approved',1,id+'A');
  const original=apply(p,'approved',2,id+'B');
  assert.equal(original.requiresManualRefund,true);
  const before=commercialSnapshot(p.id);
  const duplicate=apply(p,'approved',2,id+'B');
  assert.equal(duplicate.requiresManualRefund,true);
  assert.equal(commercialSnapshot(p.id),before);
});

test('timezone equivalence and microsecond ordering are compared by PostgreSQL', () => {
  const p=ready('timestamp-precision'), id=p.id.replaceAll('-','');
  apply(p,'approved',1,id);
  const at=(state,time)=>j(asPay(query(p,state,2,id).replace(lit(stamp(2)),lit(time))));
  at('disputed','2026-09-20T00:00:02.000001Z');
  at('restored','2026-09-20T00:00:02.000002Z');
  const before=commercialSnapshot(p.id);
  assert.equal(at('restored','2026-09-19T20:00:02.000002-04:00').outcome,'provider_snapshot_duplicate');
  assert.equal(at('disputed','2026-09-20T00:00:02.000001Z').outcome,'stale_ignored');
  assert.equal(commercialSnapshot(p.id),before);
});

test('equal pending/approved timestamp: durable review, sanitized audit, sticky replays', () => {
  const p=ready('durable-anomaly'), id=p.id.replaceAll('-','');
  apply(p,'pending',1,id);
  const before=commercialSnapshot(p.id);
  const conflict=apply(p,'approved',1,id);
  assert.equal(conflict.requiresManualReview,true);
  assert.equal(commercialSnapshot(p.id),before);
  assert.equal(watermark(p.id).requires_manual_review,true);
  const events=audit(p.id,'payment.provider_ordering_anomaly');
  assert.equal(events.length,1);
  assert.deepEqual(events[0].incomingState,['status','approved']);
  assert.deepEqual(events[0].storedState,['status','pending']);
  const after=snapshot(p.id);
  assert.equal(apply(p,'approved',1,id).requiresManualReview,true);
  assert.equal(apply(p,'pending',1,id).requiresManualReview,true);
  assert.equal(snapshot(p.id),after,'replays add no audit event');
  assert.equal(apply(p,'approved',2,id).requiresManualReview,true,'later versions cannot silently clear review');
  assert.equal(watermark(p.id).requires_manual_review,true);
});

test('stale audit is preserved once without marking legitimate retries for review', () => {
  const p=ready('stale-audit'), id=p.id.replaceAll('-','');
  apply(p,'approved',3,id);
  const before=commercialSnapshot(p.id);
  assert.equal(apply(p,'pending',1,id).requiresManualReview,false);
  assert.equal(commercialSnapshot(p.id),before);
  assert.equal(audit(p.id,'payment.stale_status_ignored').length,1);
  const after=snapshot(p.id);
  assert.equal(apply(p,'pending',1,id).requiresManualReview,false);
  assert.equal(snapshot(p.id),after);
});

test('business NOT_READY rolls back watermark; recording preference then retrying same T works', () => {
  const p=newPurchase('not-ready-rollback'), id=p.id.replaceAll('-','');
  assert.throws(()=>apply(p,'approved',1,id),/TORNEOS_PURCHASE_NOT_READY/);
  assert.equal(admin(`select count(*) from public.tournament_payment_provider_watermarks where purchase_id=${lit(p.id)}`).trim(),'0');
  assert.equal(purchaseRow(p.id).status,'created');
  asPay(`select public.record_tournament_purchase_preference(${lit(p.id)},'MERCADO_PAGO','test',${lit('pref-'+p.id)},now()+interval '30 minutes')`);
  assert.equal(apply(p,'approved',1,id).outcome,'approved');
  assert.equal(grantEvents(p.id).filter(x=>x==='granted').length,1);
});

test('settled revocation stays final for stale dispute/restore/approve and NEW restoration', () => {
  const p=ready('settled-final'), id=p.id.replaceAll('-','');
  apply(p,'approved',1,id); apply(p,'disputed',2,id); apply(p,'settled',4,id);
  const before=commercialSnapshot(p.id);
  for(const state of ['disputed','restored','approved']) {
    assert.equal(apply(p,state,3,id).outcome,'stale_ignored');
    assert.equal(commercialSnapshot(p.id),before);
  }
  assert.equal(apply(p,'restored',5,id).outcome,'reversal_ignored_after_revocation');
  assert.equal(commercialSnapshot(p.id),before);
  assert.equal(grantEvents(p.id).filter(x=>x==='revoked').length,1);
});

test('legacy 7-argument RPC does not exist and cannot mutate state', () => {
  const p=ready('old-caller'), id=p.id.replaceAll('-',''), before=snapshot(p.id);
  assert.equal(admin(`select to_regprocedure('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)') is null`).trim(),'t');
  assert.throws(()=>asPay(query(p,'approved',1,id).replace(`, ${lit(stamp(1))}::timestamptz`,'')),/42883|does not exist/);
  assert.equal(snapshot(p.id),before);
  assert.equal(apply(p,'approved',1,id).outcome,'approved');
});

test('HTTP provider timestamp formats and unsupported precision/timezone fail closed; old DB caller stays retryable', async () => {
  const {createPaymentsService}=await import('../../backend/torneos/supabase/functions/torneos-payments/handler.ts');
  const {DbError}=await import('../../backend/torneos/supabase/functions/torneos-payments/rpc.ts');
  const {UNIT_ENV}=await import('./payments-unit-env.mjs');
  const {createHmac}=await import('node:crypto');
  const p=ready('http-times'), id='123456789012345';
  const projection=j(asPay(`select public.get_provider_tournament_purchase(${lit(p.externalReference)},'MERCADO_PAGO','test')`));
  async function call(time,oldCaller=false) {
    let applied=0,receivedTime;
    const service=createPaymentsService({env:UNIT_ENV,log:()=>{},connectDb:()=>({async call(name,args) {
      if(name==='get_provider_tournament_purchase') return projection;
      applied++;receivedTime=args[7];
      if(oldCaller) throw new DbError('42883','DB_ERROR');
      return {outcome:'approved'};
    }}),fetcher:async url=>new Response(JSON.stringify(String(url).includes('/v1/payments/')?{
      id,status:'approved',date_last_updated:time,external_reference:p.externalReference,transaction_amount:p.amount,currency_id:p.currency,
      collector_id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID,metadata:{purchase_id:p.id},live_mode:false,order:{id:'999',type:'mercadopago'},
    }:{id:'999',preference_id:'pref-'+p.id,external_reference:p.externalReference,collector:{id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID},payments:[{id}]}))});
    const ts='1790000000',requestId='http-time';
    const signature=createHmac('sha256',UNIT_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
    const response=await service(new Request(`http://unit.invalid/torneos-payments/webhooks/mercadopago/v1?data.id=${id}&type=payment`,{
      method:'POST',headers:{'content-type':'application/json','x-request-id':requestId,'x-signature':`ts=${ts},v1=${signature}`},
      body:JSON.stringify({type:'payment',data:{id},live_mode:false,user_id:UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID,date_last_updated:'2099-01-01T00:00:00Z'}),
    }));
    return {status:response.status,applied,receivedTime};
  }
  for(const time of ['2017-06-28T19:39:41.000-04:00','2017-06-28T23:39:41Z','2017-06-28T23:39:41.1Z','2017-06-28T23:39:41.123456Z']) {
    assert.deepEqual(await call(time),{status:200,applied:1,receivedTime:time});
  }
  for(const time of [null,undefined,'2017-06-28T23:39:41.1234567Z','2017-06-28T23:39:41+25:00','2017-06-28T23:39:41+03:99','2017-06-28T23:39:41','not-a-time']) {
    assert.deepEqual(await call(time),{status:422,applied:0,receivedTime:undefined});
  }
  assert.equal((await call('2017-06-28T23:39:41Z',true)).status,503,'undefined RPC during old/new caller mismatch is retryable');
});

test('equal timestamp with same normalized state is idempotent despite equivalent provider status labels', () => {
  const p=ready('normalized-equality'),id=p.id.replaceAll('-','');
  apply(p,'pending',1,id);const before=snapshot(p.id);
  const r=j(asPay(query(p,'pending',1,id).replace("'pending', 'pending'","'pending', 'authorized'")));
  assert.equal(r.outcome,'provider_snapshot_duplicate');
  assert.equal(r.requiresManualReview,false);
  assert.equal(snapshot(p.id),before);
});

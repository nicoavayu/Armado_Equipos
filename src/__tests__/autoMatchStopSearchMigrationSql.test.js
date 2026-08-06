import fs from 'fs';
import path from 'path';

const migration = path.join(
  process.cwd(),
  'supabase/migrations/20260806120000_auto_match_stop_search_atomic_exit.sql',
);
const sql = fs.readFileSync(migration, 'utf8');

// Migración donde vive el matcher canónico: de ahí sale el advisory lock que la
// baja tiene que compartir.
const matcherSql = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260716120000_auto_match_real_conflict_slots_and_invite_capacity_race.sql',
  ),
  'utf8',
);

const rollbackSql = fs.readFileSync(
  path.join(process.cwd(), 'scripts/auto-match-stop-search/rollback_20260806120000.sql'),
  'utf8',
);

const dryRunSql = fs.readFileSync(
  path.join(process.cwd(), 'scripts/auto-match-stop-search/readonly_dry_run.sql'),
  'utf8',
);

const bodyIn = (source, name) => source.match(
  new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
)?.[0] || '';

const functionBody = (name) => bodyIn(sql, name);

// La última definición de una función a lo largo de TODAS las migraciones: es
// la que queda vigente en la base.
const latestDefinition = (name) => {
  const dir = path.join(process.cwd(), 'supabase/migrations');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  let latest = '';
  for (const file of files) {
    const found = bodyIn(fs.readFileSync(path.join(dir, file), 'utf8'), name);
    if (found) latest = found;
  }
  return latest;
};

// SQL sin comentarios: los bloques explicativos mencionan a propósito palabras
// como "update" o "drop" que no deben contar como sentencias.
const withoutComments = (source) => source
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('migración: dejar de buscar es una baja atómica', () => {
  test('es aditiva: sin DDL destructiva, sin RLS y sin tocar el cron', () => {
    expect(sql).not.toMatch(/drop\s+(table|column|index|constraint|policy)/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/truncate\s+(?!tmp_)/i);
    expect(sql).not.toMatch(/(enable|disable)\s+row level security|create\s+policy|alter\s+policy/i);
    expect(sql).not.toMatch(/cron\.(schedule|unschedule|alter_job)/i);
    expect(sql).not.toMatch(/create or replace function public\.auto_match_scheduled_sweep/i);
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });

  test('no dropea ninguna función: ningún contrato publicado se rompe', () => {
    expect(withoutComments(sql)).not.toMatch(/drop\s+function/i);
  });

  test('toda función redefinida fija un search_path explícito', () => {
    const defs = sql.match(/create or replace function[\s\S]*?\$\$;/gi) || [];
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def).toMatch(/set search_path = public/i);
    }
  });

  test('no ejecuta la limpieza histórica ni escribe en el partido real', () => {
    expect(sql).not.toMatch(/(perform|select)\s+public\.prune_ineligible_auto_match_members/i);
    // Ningún camino de esta migración puede modificar el plantel de un partido.
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.jugadores/i);
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.partidos/i);
  });

  // -------------------------------------------------------------------------
  // El invariante: nadie vuelve a agregar a quien apagó la búsqueda.
  // -------------------------------------------------------------------------
  describe('garantía de exclusión mutua por usuario', () => {
    const lockKey = functionBody('auto_match_user_lock_key');
    const tryLock = functionBody('auto_match_try_lock_user');
    const blockingLock = functionBody('auto_match_lock_user');
    const trigger = functionBody('enforce_auto_match_member_eligibility');
    const backfill = functionBody('backfill_auto_match_proposal_members');
    const cancel = functionBody('auto_match_cancel_search');

    test('la clave del lock es literalmente la que ya usa el matcher', () => {
      expect(lockKey).toMatch(/hashtext\('auto_match_sync:' \|\| p_user_id::text\)::bigint/i);
      // Y el matcher sigue tomando esa misma expresión, sin `::bigint` porque
      // pg_advisory_xact_lock(bigint) promueve el int4 al mismo valor.
      expect(bodyIn(matcherSql, 'sync_my_auto_match_gestations'))
        .toMatch(/pg_advisory_xact_lock\(hashtext\('auto_match_sync:' \|\| auth\.uid\(\)::text\)\)/i);
    });

    test('el try-lock nunca espera (no puede introducir deadlocks)', () => {
      expect(tryLock).toMatch(/pg_try_advisory_xact_lock\(public\.auto_match_user_lock_key\(p_user_id\)\)/i);
      expect(tryLock).not.toMatch(/pg_advisory_xact_lock\(/i);
      expect(blockingLock).toMatch(/pg_advisory_xact_lock\(public\.auto_match_user_lock_key\(p_user_id\)\)/i);
    });

    test('el trigger es el punto de estrangulamiento: exige el lock en TODO alta activa', () => {
      // Rama INSERT: sin el lock retenido, la fila no entra.
      expect(trigger).toMatch(
        /if tg_op = 'INSERT' then[\s\S]*?if not public\.auto_match_try_lock_user\(new\.user_id\) then\s*\n\s*return null;/i,
      );
      // Y revalida contra la versión VIVA, no contra el snapshot.
      expect(trigger).toMatch(/public\.auto_match_availability_is_eligible_locked\(new\.availability_id\)/i);
      // El try-lock va ANTES de la revalidación: primero exclusión, después leer.
      expect(trigger.indexOf('auto_match_try_lock_user'))
        .toBeLessThan(trigger.indexOf('auto_match_availability_is_eligible_locked'));
    });

    test('el trigger también cubre las REACTIVACIONES desde un estado terminal', () => {
      expect(trigger).toMatch(
        /if old\.response in \('declined', 'expired', 'waitlisted'\)\s*\n\s*and auth\.uid\(\) is distinct from new\.user_id then/i,
      );
      expect(trigger).toMatch(/if not public\.auto_match_user_search_is_active\(new\.user_id\) then\s*\n\s*return null;/i);
    });

    test('la revalidación bajo lock usa for share (independiente del nivel de aislamiento)', () => {
      const locked = functionBody('auto_match_availability_is_eligible_locked');
      expect(locked).toMatch(/from public\.player_availability a\s*\n\s*where a\.id = p_availability_id\s*\n\s*for share;/i);
      expect(locked).toMatch(/language plpgsql\s*\n\s*volatile/i);
      const perUser = functionBody('auto_match_user_search_is_active');
      expect(perUser).toMatch(/for share;/i);
    });

    test('el backfill toma el lock por candidato ANTES de insertar', () => {
      expect(backfill).toMatch(
        /if not public\.auto_match_try_lock_user\(v_candidate\.user_id\) then\s*\n\s*continue;/i,
      );
      expect(backfill).toMatch(
        /if not public\.auto_match_availability_is_eligible_locked\(v_candidate\.availability_id\) then\s*\n\s*continue;/i,
      );
      expect(backfill.indexOf('auto_match_try_lock_user'))
        .toBeLessThan(backfill.indexOf('insert into public.auto_match_proposal_members'));
    });

    test('la estrategia de "hasta tres pasadas" quedó eliminada', () => {
      expect(cancel).not.toMatch(/for v_pass in 1\.\.3 loop/i);
      expect(cancel).not.toMatch(/v_pass/i);
      expect(cancel).not.toMatch(/exit when v_touched = 0/i);
      // Una sola pasada sobre las membresías.
      expect((cancel.match(/for v_row in/gi) || [])).toHaveLength(1);
    });

    test('los dos escritores de player_availability toman el lock como PRIMER lock', () => {
      for (const name of ['upsert_my_availability', 'sync_my_auto_match_location_from_profile']) {
        const body = functionBody(name);
        expect(body).toMatch(/perform public\.auto_match_lock_user\(auth\.uid\(\)\);/i);
        expect(body.indexOf('auto_match_lock_user'))
          .toBeLessThan(body.indexOf('update public.player_availability'));
      }
    });
  });

  // -------------------------------------------------------------------------
  // El núcleo de la baja.
  // -------------------------------------------------------------------------
  describe('auto_match_cancel_search()', () => {
    const cancel = functionBody('auto_match_cancel_search');

    test('(1) exige usuario autenticado', () => {
      expect(cancel).toMatch(/auth\.uid\(\)/);
      expect(cancel).toMatch(/raise exception 'not_authenticated'/i);
    });

    test('(2) toma el lock por usuario como su PRIMER lock', () => {
      expect(cancel).toMatch(/perform public\.auto_match_lock_user\(v_uid\);/i);
      expect(cancel.indexOf('auto_match_lock_user'))
        .toBeLessThan(cancel.indexOf('update public.player_availability'));
      expect(cancel.indexOf('auto_match_lock_user'))
        .toBeLessThan(cancel.indexOf('for update'));
    });

    test('(3) cancela la disponibilidad ANTES de tocar membresías', () => {
      expect(cancel).toMatch(/update public\.player_availability[\s\S]*?status = 'cancelled'[\s\S]*?status = 'active'/i);
      expect(cancel.indexOf('update public.player_availability'))
        .toBeLessThan(cancel.indexOf('update public.auto_match_proposal_members'));
    });

    test('(4) collecting/ready: pending y accepted salen como declined/user_declined', () => {
      expect(cancel).toMatch(
        /if v_proposal\.status in \('collecting', 'ready'\)\s*\n\s*and v_member\.response in \('pending', 'accepted'\) then/i,
      );
      expect(cancel).toMatch(
        /set response = 'declined',\s*\n\s*response_reason = 'user_declined'/i,
      );
      // confirmed_at en NULL: el camino de restauración de reconcile exige
      // confirmed_at not null (o motivo schedule_conflict), así que la salida
      // voluntaria es terminal.
      expect(cancel).toMatch(/response_reason = 'user_declined',[\s\S]*?confirmed_at = null/i);
    });

    test('(5) created + pending: la invitación se retira como expired/invite_expired', () => {
      expect(cancel).toMatch(
        /elsif v_proposal\.status = 'created' and v_member\.response = 'pending' then/i,
      );
      expect(cancel).toMatch(/set response = 'expired',\s*\n\s*response_reason = 'invite_expired'/i);
    });

    test('(6) created + accepted NO se toca por ninguna rama', () => {
      const branches = cancel.match(/(if|elsif) v_proposal\.status[\s\S]*?then/gi) || [];
      expect(branches).toHaveLength(2);
      expect(branches.some((branch) => /status = 'created'[\s\S]*response = 'accepted'/i.test(branch))).toBe(false);
      expect(cancel).toMatch(/select count\(\*\)\s*\n\s*into created_memberships_kept/i);
    });

    test('(7) reutiliza process_auto_match_member_exit sólo donde corresponde', () => {
      expect(cancel).toMatch(/perform public\.process_auto_match_member_exit\(v_row\.id\);/i);
      expect((cancel.match(/process_auto_match_member_exit/gi) || [])).toHaveLength(1);
      const gestationBranch = cancel.slice(
        cancel.indexOf("if v_proposal.status in ('collecting', 'ready')"),
        cancel.indexOf("elsif v_proposal.status = 'created'"),
      );
      expect(gestationBranch).toMatch(/process_auto_match_member_exit/i);
    });

    test('serializa con orden de locks determinista (ascendente por propuesta)', () => {
      expect(cancel).toMatch(/order by 1\s*\n\s*loop/i);
      expect(cancel).toMatch(/from public\.auto_match_proposals\s*\n\s*where id = v_row\.id\s*\n\s*for update;/i);
      expect(cancel).toMatch(/where proposal_id = v_row\.id and user_id = v_uid\s*\n\s*for update;/i);
    });

    test('re-lee el estado autoritativo DESPUÉS de tomar el lock', () => {
      const lockIndex = cancel.indexOf('for update;');
      expect(cancel.indexOf("if v_proposal.status in ('collecting', 'ready')")).toBeGreaterThan(lockIndex);
    });

    test('es idempotente: nada que cancelar deja todos los contadores en cero', () => {
      expect(cancel).toMatch(/availability_cancelled := 0;/);
      expect(cancel).toMatch(/gestation_memberships_released := 0;/);
      expect(cancel).toMatch(/created_invites_withdrawn := 0;/);
      expect(cancel).toMatch(/created_memberships_kept := 0;/);
      expect(cancel).toMatch(/m\.response in \('pending', 'accepted'\)/i);
    });

    test('es interna: ningún rol de cliente puede ejecutarla', () => {
      expect(sql).toMatch(
        /revoke all on function public\.auto_match_cancel_search\(\) from public, anon, authenticated;/i,
      );
      expect(sql).not.toMatch(/grant execute on function public\.auto_match_cancel_search/i);
    });
  });

  // -------------------------------------------------------------------------
  // Compatibilidad del contrato publicado.
  // -------------------------------------------------------------------------
  describe('contrato de los RPC', () => {
    test('cancel_my_availability() conserva su firma histórica: sin args, returns void', () => {
      const wrapper = functionBody('cancel_my_availability');
      expect(wrapper).toMatch(/create or replace function public\.cancel_my_availability\(\)\s*\n\s*returns void/i);
      expect(wrapper).toMatch(/perform \* from public\.auto_match_cancel_search\(\);/i);
      // Y la firma original que se conserva es la de 20260710101500.
      const original = bodyIn(
        fs.readFileSync(
          path.join(process.cwd(), 'supabase/migrations/20260710101500_availability_auto_match_mvp.sql'),
          'utf8',
        ),
        'cancel_my_availability',
      );
      expect(original).toMatch(/create or replace function public\.cancel_my_availability\(\)\s*\n\s*returns void/i);
    });

    test('los contadores viven en un RPC nuevo y aditivo', () => {
      const detailed = functionBody('cancel_my_availability_detailed');
      expect(detailed).toMatch(/returns table \(/i);
      for (const column of [
        'availability_cancelled',
        'gestation_memberships_released',
        'created_invites_withdrawn',
        'created_memberships_kept',
      ]) {
        expect(detailed).toContain(column);
      }
      expect(detailed).toMatch(/return query select \* from public\.auto_match_cancel_search\(\);/i);
    });

    test('mantiene los permisos: sólo authenticated, en los dos RPC', () => {
      expect(sql).toMatch(/revoke all on function public\.cancel_my_availability\(\) from public, anon;/i);
      expect(sql).toMatch(/grant execute on function public\.cancel_my_availability\(\) to authenticated;/i);
      expect(sql).toMatch(/revoke all on function public\.cancel_my_availability_detailed\(\) from public, anon;/i);
      expect(sql).toMatch(/grant execute on function public\.cancel_my_availability_detailed\(\) to authenticated;/i);
    });

    test('las primitivas internas no se exponen a ningún rol de cliente', () => {
      for (const fn of [
        'auto_match_user_lock_key\\(uuid\\)',
        'auto_match_lock_user\\(uuid\\)',
        'auto_match_try_lock_user\\(uuid\\)',
        'auto_match_availability_is_eligible_locked\\(bigint\\)',
        'auto_match_user_search_is_active\\(uuid\\)',
      ]) {
        expect(sql).toMatch(
          new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated;`, 'i'),
        );
        expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${fn}`, 'i'));
      }
    });
  });

  describe('get_auto_match_proposal_members()', () => {
    const roster = functionBody('get_auto_match_proposal_members');

    test('no devuelve declined, expired ni waitlisted', () => {
      expect(roster).toMatch(/m\.response not in \('declined', 'expired', 'waitlisted'\)/i);
    });

    test('quien consulta también tiene que ser miembro activo', () => {
      expect(roster).toMatch(
        /me\.user_id = auth\.uid\(\)\s*\n\s*and me\.response not in \('declined', 'expired', 'waitlisted'\)/i,
      );
    });

    test('conserva firma, columnas y permisos', () => {
      for (const column of ['user_id', 'nombre', 'avatar_url', 'response', 'can_organize', 'is_organizer', 'responded_at', 'confirmed_at', 'seat']) {
        expect(roster).toMatch(new RegExp(`\\b${column}\\b`));
      }
      expect(sql).toMatch(/grant execute on function public\.get_auto_match_proposal_members\(bigint\) to authenticated;/i);
    });
  });

  test('el chat de la gestación tampoco admite estados terminales', () => {
    expect(latestDefinition('auto_match_user_in_proposal'))
      .toMatch(/m\.response not in \('declined', 'expired', 'waitlisted'\)/i);
  });

  // -------------------------------------------------------------------------
  // Dry-run: fuera de la base, de sólo lectura.
  // -------------------------------------------------------------------------
  describe('dry-run de producción', () => {
    test('no queda ninguna función de dry-run instalada', () => {
      expect(sql).not.toMatch(/auto_match_orphan_members_dry_run/i);
      const dir = path.join(process.cwd(), 'supabase/migrations');
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
        expect(fs.readFileSync(path.join(dir, file), 'utf8'))
          .not.toMatch(/create or replace function public\.auto_match_orphan_members_dry_run/i);
      }
    });

    test('el archivo de inspección es SÓLO SELECT', () => {
      const statements = withoutComments(dryRunSql);
      expect(statements).not.toMatch(/\b(create|drop|alter|insert|update|delete|truncate|grant|revoke)\b/i);
      // Y se blinda con una transacción read only.
      expect(dryRunSql).toMatch(/^begin;\s*\nset transaction read only;/m);
      expect(dryRunSql.trim().endsWith('commit;')).toBe(true);
    });

    test('no invoca ninguna función de la aplicación (predicados inline)', () => {
      expect(withoutComments(dryRunSql)).not.toMatch(/public\.auto_match_[a-z_]+\(/i);
      expect(withoutComments(dryRunSql)).not.toMatch(/prune_ineligible/i);
    });

    test('informa todo lo pedido para decidir la limpieza', () => {
      for (const metric of [
        'memberships_total',
        'account_ineligible_total',
        'orphan_availability_total',
        'member_response',
        'proposal_status',
        'proposals_affected',
        'proposals_ready_to_collecting',
        'proposals_below_minimum',
        'proposals_created_related',
        'related_real_matches',
        'notifications_upper_bound',
      ]) {
        expect(dryRunSql).toContain(metric);
      }
      // Estado de pg_cron y del job.
      expect(dryRunSql).toMatch(/pg_extension/i);
      expect(dryRunSql).toMatch(/cron\.job\b/i);
      expect(dryRunSql).toMatch(/cron\.job_run_details/i);
    });

    test('nunca considera un accepted de una propuesta ya materializada', () => {
      expect(dryRunSql).toMatch(/p\.status = 'created' and m\.response = 'pending'/i);
      expect(dryRunSql).not.toMatch(/p\.status = 'created' and m\.response = 'accepted'/i);
    });
  });

  // -------------------------------------------------------------------------
  // Rollback.
  // -------------------------------------------------------------------------
  describe('rollback', () => {
    test('repone TODAS las funciones que la migración redefinió', () => {
      const redefined = [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)/gi)]
        .map((match) => match[1]);
      const brandNew = new Set([
        'auto_match_user_lock_key',
        'auto_match_lock_user',
        'auto_match_try_lock_user',
        'auto_match_availability_is_eligible_locked',
        'auto_match_user_search_is_active',
        'auto_match_cancel_search',
        'cancel_my_availability_detailed',
      ]);
      for (const name of redefined) {
        if (brandNew.has(name)) {
          expect(rollbackSql).toMatch(new RegExp(`drop function if exists public\\.${name}\\(`, 'i'));
        } else {
          expect(rollbackSql).toMatch(new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
        }
      }
    });

    test('deja cancel_my_availability con la firma histórica', () => {
      expect(bodyIn(rollbackSql, 'cancel_my_availability'))
        .toMatch(/returns void\s*\n\s*language sql/i);
    });

    test('es transaccional y no toca datos', () => {
      // El archivo abre con el bloque explicativo; el SQL en sí es una única
      // transacción: todo o nada.
      const statements = withoutComments(rollbackSql).trim();
      expect(statements.startsWith('begin;')).toBe(true);
      expect(statements.endsWith('commit;')).toBe(true);
      // Fuera de los cuerpos de función ($$...$$) no queda NINGUNA sentencia de
      // datos: el rollback repone definiciones, no reescribe filas.
      const topLevel = statements.replace(/\$\$[\s\S]*?\$\$/g, ' <body> ');
      expect(topLevel).not.toMatch(/\b(insert\s+into|delete\s+from|truncate|update\s+public\.)\b/i);
      expect(topLevel).not.toMatch(/alter\s+table/i);
      expect(topLevel).not.toMatch(/drop\s+(table|column|index|constraint|policy)/i);
    });
  });
});

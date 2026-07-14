import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260714030000_auto_match_backend_initial_sweep.sql'),
  'utf8',
);

describe('backend initial auto-match sweep migration', () => {
  test('reuses the canonical matcher for every active availability', () => {
    expect(sql).toMatch(/where pa\.status = 'active'/i);
    expect(sql).toMatch(/auto_match_availability_is_eligible\(pa\.id\)/i);
    expect(sql).toMatch(/set_config\('request\.jwt\.claim\.sub'/i);
    expect(sql).toMatch(/sync_my_auto_match_gestations\(\)/i);
  });

  test('isolates failures and restores the original request identity', () => {
    expect(sql).toMatch(/exception when others then[\s\S]*v_failed := v_failed \+ 1/i);
    expect(sql.match(/set_config\('request\.jwt\.claim\.sub', coalesce\(v_original_sub, ''\), true\)/gi))
      .toHaveLength(2);
  });

  test('the existing scheduled sweep invokes the backend matcher and remains private', () => {
    expect(sql).toMatch(/create or replace function public\.auto_match_scheduled_sweep\(\)[\s\S]*sync_active_auto_match_gestations\(\)/i);
    expect(sql).toMatch(/revoke all on function public\.sync_active_auto_match_gestations\(\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.auto_match_scheduled_sweep\(\) from public, anon, authenticated, service_role/i);
  });

  test('keeps existing capacity and cohort helpers instead of broadcasting', () => {
    expect(sql).toMatch(/auto_match_invitation_capacity\(p\.format\)/i);
    expect(sql).toMatch(/spawn_next_auto_match_cohort\(v_row\.id\)/i);
    expect(sql).not.toMatch(/insert into public\.notifications/i);
  });

  test('requires complete valid coordinates and never treats missing as open distance', () => {
    expect(sql).toMatch(/auto_match_has_valid_coordinates/i);
    expect(sql).toMatch(/not \(p_latitude = 0 and p_longitude = 0\)/i);
    expect(sql).toMatch(/p_latitude <> 'NaN'::double precision/i);
    expect(sql).toMatch(/auto_match_location_required/i);
    expect(sql).not.toMatch(/latitude is null or[\s\S]{0,160}longitude is null[\s\S]{0,160}or \(6371/i);
  });

  test('applies symmetric radii and pairwise proposal compatibility', () => {
    expect(sql).toMatch(/distance_km\([\s\S]*?\) <= a\.max_distance_km/i);
    expect(sql).toMatch(/distance_km\([\s\S]*?\) <= b\.max_distance_km/i);
    expect(sql).toMatch(/auto_match_availability_fits_proposal/i);
    expect(sql).toMatch(/enforce_auto_match_member_eligibility_trigger/i);
  });

  test('uses auth lifecycle instead of usuarios presence state', () => {
    expect(sql).toMatch(/from auth\.users au/i);
    expect(sql).toMatch(/au\.deleted_at is null/i);
    expect(sql).toMatch(/au\.banned_until is null or au\.banned_until <= now\(\)/i);
    expect(sql).not.toMatch(/u\.is_active\s*=\s*true/i);
  });

  test('location completion updates the existing row and immediately syncs', () => {
    expect(sql).toMatch(/sync_my_auto_match_location_from_profile\(\)[\s\S]*update public\.player_availability/i);
    expect(sql).toMatch(/sync_my_auto_match_location_from_profile\(\)[\s\S]*sync_my_auto_match_gestations\(\)/i);
  });
});

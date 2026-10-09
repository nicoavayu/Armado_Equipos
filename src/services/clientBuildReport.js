import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { supabase } from '../lib/supabaseClient';
import logger from '../utils/logger';

// Which build each account runs (20261010130000): the evidence that decides when privacy
// phase B can close the old select('*') reads without breaking an installed app.
// Once per account per app start; never blocks or retries.

const reported = new Set();

export const readClientBuild = async () => {
  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') {
    return { platform: 'web', version: null, build: null };
  }
  const info = await CapacitorApp.getInfo();
  const build = Number.parseInt(String(info?.build || ''), 10);
  return {
    platform,
    version: info?.version ? String(info.version) : null,
    build: Number.isFinite(build) ? build : null,
  };
};

export async function reportClientBuild(userId, { readBuild = readClientBuild } = {}) {
  if (!userId || reported.has(userId)) return false;
  reported.add(userId);
  try {
    const { platform, version, build } = await readBuild();
    const { error } = await supabase.rpc('report_client_build', {
      p_platform: platform,
      p_app_version: version,
      p_app_build: build,
    });
    // A backend without the migration (PGRST202) simply has no report yet.
    if (error && error.code !== 'PGRST202') throw error;
    return !error;
  } catch (error) {
    logger.warn('[CLIENT_BUILD] report skipped', { code: error?.code || null });
    return false;
  }
}

/** Mount point inside the signed-in app shell; renders nothing. */
export function ClientBuildReporter({ userId }) {
  useEffect(() => {
    if (userId) reportClientBuild(userId);
  }, [userId]);
  return null;
}

export const __resetClientBuildReportsForTests = () => reported.clear();

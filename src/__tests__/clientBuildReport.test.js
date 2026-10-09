import { __resetClientBuildReportsForTests, readClientBuild, reportClientBuild } from '../services/clientBuildReport';
import { supabase } from '../lib/supabaseClient';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

jest.mock('../lib/supabaseClient', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn() } }));
jest.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: jest.fn(() => 'web') } }));
jest.mock('@capacitor/app', () => ({ App: { getInfo: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  __resetClientBuildReportsForTests();
});

test('a native build reports its store version and build number', async () => {
  Capacitor.getPlatform.mockReturnValue('android');
  CapacitorApp.getInfo.mockResolvedValue({ version: '1.1.23', build: '45' });
  await expect(readClientBuild()).resolves.toEqual({ platform: 'android', version: '1.1.23', build: 45 });
});

test('the web reports as web (always the deployed code)', async () => {
  Capacitor.getPlatform.mockReturnValue('web');
  await expect(readClientBuild()).resolves.toEqual({ platform: 'web', version: null, build: null });
  expect(CapacitorApp.getInfo).not.toHaveBeenCalled();
});

test('once per account per app start', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  const readBuild = async () => ({ platform: 'ios', version: '1.1.23', build: 42 });
  await expect(reportClientBuild('user-1', { readBuild })).resolves.toBe(true);
  await expect(reportClientBuild('user-1', { readBuild })).resolves.toBe(false);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('report_client_build', { p_platform: 'ios', p_app_version: '1.1.23', p_app_build: 42 });
});

test('never throws: a missing backend function or a network error only skips the report', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  await expect(reportClientBuild('user-2', { readBuild: async () => ({ platform: 'web' }) })).resolves.toBe(false);
  supabase.rpc.mockRejectedValueOnce(new Error('offline'));
  await expect(reportClientBuild('user-3', { readBuild: async () => ({ platform: 'web' }) })).resolves.toBe(false);
});

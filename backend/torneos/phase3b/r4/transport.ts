// Transport adapter: network isolation remains effective even if callers bypass this adapter.
export const CORE = 'hhyvmhgpapyuzjgxfnqv.supabase.co';
export function installTransport(cert: string) {
  const original = globalThis.fetch.bind(globalThis);
  const client = Deno.createHttpClient({ caCerts: [cert] });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return original(input, { ...init, ...(url.hostname === CORE ? { client } : {}), redirect: 'error' });
  }) as typeof fetch;
  return { original, client };
}

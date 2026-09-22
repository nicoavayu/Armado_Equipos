export async function consumeCustody() {
  const stat=await Deno.stat('/custody/input');
  if(!stat.isFile||((stat.mode??0)&0o777)!==0o600)throw new Error('CUSTODY_MODE');
  let raw=await Deno.readTextFile('/custody/input');
  await Deno.remove('/custody/input');
  const doc=JSON.parse(raw);raw='';
  if(!/^[0-9a-f]{64,}$/.test(doc.secret)||doc.secret.length%2!==0)throw new Error('CUSTODY_SECRET');
  return doc;
}
export function installMemoryEnvironment(doc: any) {
  const env:Record<string,string>={
    TORNEOS_CONTRACT_SERVICE_SECRET:doc.secret,
    TORNEOS_GATEWAY_PUBLIC_URL:'http://127.0.0.1:58431/torneos-gateway',
    TORNEOS_ALLOWED_ORIGIN:'http://127.0.0.1:58431',
    CORE_AUTH_URL:'https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1',
    CORE_JWT_ISSUER:'https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1',
    CORE_CONTRACT_URL:'https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract',
    TORNEOS_REST_URL:'http://torneos-rest:3000',
    TORNEOS_DB_IDENTITY_WRITER_URL:`postgres://torneos_edge_identity_writer:${doc.writerPassword}@torneos-db:5432/postgres`,
    TORNEOS_DB_CORE_ADAPTER_URL:`postgres://torneos_edge_core_adapter:${doc.adapterPassword}@torneos-db:5432/postgres`,
    TORNEOS_BRIDGE_KEYS:JSON.stringify(doc.bridge),
    ...(doc.coreAnonKey?{CORE_ANON_KEY:doc.coreAnonKey}:{})
  };
  // Supabase main workers forbid env.set; only this isolate's JS accessor is replaced.
  // No libc setenv, Docker env, file or subprocess receives these values.
  Deno.env.toObject=()=>({...env});
  return env;
}

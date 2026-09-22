// Prepared only. R4.2 authorization is required before running this entrypoint.
import {consumeCustody,installMemoryEnvironment} from '../custody.ts';
import {installTransport} from '../transport.ts';
import {loadConfig} from '../../gateway/config.ts';
try {
  const doc=await consumeCustody();
  installTransport(doc.cert);
  const env=installMemoryEnvironment(doc);
  loadConfig(env); // fail before opening the server, not on the first request
  await import('../../gateway/index.ts');
} catch {console.error('R4_GATEWAY_FAIL_CLOSED');Deno.exit(78);}

import handler from '../../api/private-web-access.mjs';
import { adapt } from '../../server/netlifyLegacyAdapter.mjs';
export default adapt(handler);
export const config = { path: '/api/private-web-access' };

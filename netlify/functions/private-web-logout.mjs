import handler from '../../api/private-web-logout.mjs';
import { adapt } from '../../server/netlifyLegacyAdapter.mjs';
export default adapt(handler);
export const config = { path: '/api/private-web-logout' };

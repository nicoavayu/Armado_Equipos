/* eslint-env node */
/* eslint-disable no-console -- el arranque del dev-server informa por consola a propósito */
//
// CRA carga este archivo con su propio Express antes de servir la app. Es el
// único enganche del dev-server que el repo tiene sin eyectar, y alcanza: el
// puente QA queda en el mismo origen que la revisión y se apaga con ella.
//
// No se importa desde `src/`: webpack nunca lo alcanza, así que no entra en el
// bundle ni en los source maps. `npm run build` no lo ejecuta jamás.
//
const path = require('node:path');

const { mountQaRoleBridge } = require('../scripts/qa/qa-role-bridge.cjs');

module.exports = function setupDevMiddlewares(app) {
  const repoRoot = path.resolve(__dirname, '..');
  const gate = mountQaRoleBridge(app, { repoRoot, env: process.env });
  if (gate.enabled) {
    console.log('[qa:rol] puente QA LOCAL montado en /__qa/role-switcher');
  }
};

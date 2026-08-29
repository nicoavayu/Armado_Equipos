#!/usr/bin/env node

// Compatibility entrypoint. The old runner mixed inspection, linking, db push
// and bulk function deployment. The readiness CLI exposes one named stage at a
// time and blocks every remote mutation until a future authorized inspection.

import { main } from '../torneos-staging/readiness.mjs';

main(process.argv.slice(2));

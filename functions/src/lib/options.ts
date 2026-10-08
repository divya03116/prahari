/**
 * Global function options. This must be a module of its own, imported before
 * any function is defined: ES module imports (including `export … from`) are
 * evaluated before the importing module's body runs, so calling
 * setGlobalOptions() in index.ts's body would come too late and every function
 * would silently deploy to the default region, us-central1.
 */

import { setGlobalOptions } from 'firebase-functions/v2';

import { FUNCTIONS_REGION } from '../shared/constants.js';

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10 });

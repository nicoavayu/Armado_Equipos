// Deliberately contains no Core credentials. Existing bounded sync harness stays unchanged.
import {parentPort, workerData} from 'node:worker_threads';
import {runOutageHarness} from './outage.mjs';
try {
  parentPort.postMessage({ok:true,result:runOutageHarness({label:workerData.label})});
} catch (error) {
  parentPort.postMessage({ok:false,code:error.code??'OUTAGE_WORKER_FAILED',message:error.message});
  process.exitCode=1;
}

// ANDROID ORIGIN REMOTE — the two gateway sources W1 / rollback can deploy, both extracted from git at their commit (never the
// working tree) and built exactly like gateway-remote's buildAssets():
//   candidate  f7efe18f (the Android origin change)  → must be 59573b50…, 17 files;
//   live       0f049ef5 (OEC W3, revision t5vxxvzp1t9f) → must be 6c252863…, 17 files.
import { buildFromCommit, extractTree } from '../torneos-competition-v1/competition-bundle.mjs';
import { CANDIDATE, LIVE } from './android-origin-contract.mjs';

export const buildCandidate = () => buildFromCommit(CANDIDATE.head);
export const buildLive = () => buildFromCommit(LIVE.head);
export { extractTree };

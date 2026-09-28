// OFFICIALIZATION + ERROR-CONTRACT REMOTE — the two gateway sources W3 can deploy (built exactly like gateway-remote):
//   candidate  the static module graph of torneos-gateway/index.ts at HEAD (the working tree must equal HEAD for it);
//   live       the same graph extracted from git at the live commit (ee34b2a7), never from the working tree — its manifest
//              digest must equal the COMPETITION-V1 deploy pin (75e3535a…, 16 files) or nothing is deployed.
import { buildCandidate as buildAtHead, buildFromCommit, extractTree } from '../torneos-competition-v1/competition-bundle.mjs';
import { LIVE } from './oec-remote-contract.mjs';

export const buildCandidate = ({ requireClean = true } = {}) => buildAtHead({ requireClean });
export const buildLive = () => buildFromCommit(LIVE.head);
export { extractTree };

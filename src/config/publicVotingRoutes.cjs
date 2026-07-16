'use strict';

// Exact public web allowlist. Query parameters are part of the contract: the
// public guest flow requires the match code and never exposes a match by path ID.
const PUBLIC_VOTING_ROUTE_ALLOWLIST = Object.freeze([
  Object.freeze({
    pathname: '/votar-equipos',
    requiredQueryParameter: 'codigo',
  }),
]);

const PUBLIC_VOTING_PATHS = new Set(
  PUBLIC_VOTING_ROUTE_ALLOWLIST.map(({ pathname }) => pathname),
);

const hasVotingCode = (searchParams) => {
  const code = searchParams?.get?.('codigo');
  return typeof code === 'string' && code.trim().length > 0;
};

const isExactPublicVotingPath = (pathname) => PUBLIC_VOTING_PATHS.has(pathname);

const isAllowedPublicVotingRequest = (url) => (
  Boolean(url)
  && isExactPublicVotingPath(url.pathname)
  && hasVotingCode(url.searchParams)
);

// Historical shared links used /?codigo=... before /votar-equipos existed.
// This is a redirect-only alias; it must never be served as a public SPA route.
const isLegacyPublicVotingAlias = (url) => (
  Boolean(url)
  && url.pathname === '/'
  && hasVotingCode(url.searchParams)
);

module.exports = {
  PUBLIC_VOTING_ROUTE_ALLOWLIST,
  isAllowedPublicVotingRequest,
  isExactPublicVotingPath,
  isLegacyPublicVotingAlias,
};

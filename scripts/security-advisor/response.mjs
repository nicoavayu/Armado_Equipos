const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

export function parseSecurityAdvisorPayload(payload) {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error('SECURITY_ADVISOR_UNKNOWN_RESPONSE');
  }

  if (!Object.prototype.hasOwnProperty.call(payload.result, 'lints')) {
    throw new Error('SECURITY_ADVISOR_LINTS_MISSING');
  }

  if (!Array.isArray(payload.result.lints)) {
    throw new Error('SECURITY_ADVISOR_LINTS_INVALID');
  }

  for (const [index, lint] of payload.result.lints.entries()) {
    if (!isRecord(lint)) {
      throw new Error(`SECURITY_ADVISOR_LINT_INVALID:${index}`);
    }
  }

  return payload.result.lints;
}

export async function parseSecurityAdvisorHttpResponse(response) {
  if (!response || typeof response.text !== 'function') {
    throw new Error('SECURITY_ADVISOR_HTTP_RESPONSE_INVALID');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`SECURITY_ADVISOR_AUTH_ERROR:${response.status}`);
    }
    throw new Error(`SECURITY_ADVISOR_HTTP_ERROR:${response.status}`);
  }

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('SECURITY_ADVISOR_JSON_INVALID');
  }

  return parseSecurityAdvisorPayload(payload);
}

const lintCode = (lint) => {
  const explicit = typeof lint.code === 'string' ? lint.code.trim() : '';
  if (explicit) return explicit;

  const name = typeof lint.name === 'string' ? lint.name.trim() : '';
  const match = name.match(/^(\d{4})(?:_|$)/);
  return match?.[1] || null;
};

export function summarizeSecurityAdvisorLints(lints) {
  if (!Array.isArray(lints)) {
    throw new Error('SECURITY_ADVISOR_LINTS_INVALID');
  }

  const byCode = {};
  const byLevel = {};

  lints.forEach((lint, index) => {
    if (!isRecord(lint)) {
      throw new Error(`SECURITY_ADVISOR_LINT_INVALID:${index}`);
    }

    const code = lintCode(lint);
    const level = typeof lint.level === 'string'
      ? lint.level.trim().toLowerCase()
      : '';
    if (!code || !level) {
      throw new Error(`SECURITY_ADVISOR_LINT_INCOMPLETE:${index}`);
    }

    byCode[code] = (byCode[code] || 0) + 1;
    byLevel[level] = (byLevel[level] || 0) + 1;
  });

  return {
    total: lints.length,
    byCode,
    byLevel,
  };
}

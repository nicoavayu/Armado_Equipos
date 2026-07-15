export async function closePrivateWebAccess(fetchImplementation = window.fetch.bind(window)) {
  const response = await fetchImplementation('/api/private-web-logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('No pudimos cerrar el acceso web. Intentá nuevamente.');
  }
}

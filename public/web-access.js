(function initializeWebAccessPages() {
  'use strict';

  var page = document.documentElement.getAttribute('data-page');

  if (page === 'mobile-only') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(function unregisterAll(registrations) {
          return Promise.all(registrations.map(function unregister(registration) {
            return registration.unregister();
          }));
        })
        .catch(function ignoreCleanupFailure() {});
    }

    if ('caches' in window) {
      caches.keys()
        .then(function removeAllCaches(keys) {
          return Promise.all(keys.map(function removeCache(key) {
            return caches.delete(key);
          }));
        })
        .catch(function ignoreCacheCleanupFailure() {});
    }
    return;
  }

  if (page !== 'private-web-access') return;

  var parameters = new URLSearchParams(window.location.search);
  var returnTo = parameters.get('returnTo');
  var returnToInput = document.getElementById('return-to');
  var errorMessage = document.getElementById('access-error');
  var passwordInput = document.getElementById('private-password');

  if (
    returnTo
    && returnTo.charAt(0) === '/'
    && returnTo.slice(0, 2) !== '//'
    && returnTo.indexOf('\\') === -1
  ) {
    returnToInput.value = returnTo;
  }

  if (parameters.get('error') === '1') {
    errorMessage.hidden = false;
  }

  if (passwordInput) passwordInput.focus();
}());

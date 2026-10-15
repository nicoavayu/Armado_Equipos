import { isArma2NativeRuntime } from './runtimePlatform';

// Shares a link that leaves the app (always built with toShareableAppUrl, never with the WebView origin).
// - Native: the OS share sheet through @capacitor/share (the WebViews have no reliable Web Share), same plugin as
//   shareTeamsCard.js; loaded lazily so it stays off the web bundle's cold start.
// - Web: Web Share when the browser has it, otherwise the clipboard.
// Resolves 'shared' or 'copied'; a share the person cancels rejects like the platform does.
export async function shareLink({ title, text, url, isNative = isArma2NativeRuntime() }) {
  if (isNative) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text, url, dialogTitle: title });
    return 'shared';
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({ title, text, url });
    return 'shared';
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

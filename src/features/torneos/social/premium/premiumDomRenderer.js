import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toBlob } from 'html-to-image';
import { SOCIAL_FORMATS } from '../socialContracts';
import PremiumRenderer from './PremiumRenderer';

// The layout hardening (premiumLayoutHardening.js) measures the composition: computed display, flex direction, real
// heights. A browser computes none of that for a node outside the document, so the composition is laid out here, at
// its full export size, off screen and transparent, before its layout effects run. The page later moves the node into
// the preview; a render that is never shown (an Editorial page exported in the background) stays here until released.
const LAYOUT_HOST_ID = 'premium-social-layout-host';

function premiumLayoutHost() {
  let host = document.getElementById(LAYOUT_HOST_ID);
  if (host) return host;
  host = document.createElement('div');
  host.id = LAYOUT_HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '-20000px',
    width: '0',
    height: '0',
    overflow: 'visible',
    // Not `visibility: hidden`: it is inherited, and the export copies each element's computed style.
    opacity: '0',
    pointerEvents: 'none',
    contain: 'layout style',
  });
  document.body.appendChild(host);
  return host;
}

export function createPremiumDomRender({
  snapshot, content, editorial, assets, branding, theme, sponsors = [],
}) {
  if (typeof document === 'undefined') throw new Error('PREMIUM_DOM_UNAVAILABLE');
  const format = SOCIAL_FORMATS[editorial?.format] || SOCIAL_FORMATS.portrait;
  const node = document.createElement('div');
  node.dataset.premiumRenderer = 'v2';
  node.dataset.theme = theme?.id || String(theme);
  node.dataset.format = format.id;
  node.style.width = `${format.width}px`;
  node.style.height = `${format.height}px`;
  node.style.position = 'relative';
  node.style.overflow = 'hidden';
  node.style.flex = 'none';
  if (document.body) premiumLayoutHost().appendChild(node);
  const root = createRoot(node);
  flushSync(() => {
    root.render(
      <PremiumRenderer
        snapshot={snapshot}
        content={content}
        editorial={editorial}
        assets={assets}
        branding={branding}
        theme={theme}
        sponsors={sponsors}
      />,
    );
  });
  return { node, root, format };
}

export async function waitForPremiumDomAssets(node) {
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map((image) => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error('PREMIUM_IMAGE_UNAVAILABLE')), { once: true });
    });
  }));
}

export async function premiumDomToPngBlob(node, format) {
  const blob = await toBlob(node, {
    width: format.width,
    height: format.height,
    canvasWidth: format.width,
    canvasHeight: format.height,
    pixelRatio: 1,
    cacheBust: false,
    skipAutoScale: true,
    style: { transform: 'none', transformOrigin: 'top left' },
  });
  if (!blob) throw new Error('PREMIUM_EXPORT_EMPTY');
  return blob;
}

// Called from the page's effect cleanups, i.e. while the app's own tree may be committing: unmounting this
// separate root synchronously there races React ("synchronously unmount a root while React was already
// rendering"). The node leaves the document at once; its root is unmounted right after the current commit.
export function releasePremiumDomRender(prepared) {
  const root = prepared?.root;
  prepared?.node?.remove?.();
  if (root?.unmount) setTimeout(() => root.unmount(), 0);
}

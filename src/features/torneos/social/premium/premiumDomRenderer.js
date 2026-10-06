import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toBlob } from 'html-to-image';
import { SOCIAL_FORMATS } from '../socialContracts';
import PremiumRenderer from './PremiumRenderer';
import { anchorPremiumContent } from './premiumContentAnchoring';

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

// The art is composed detached, where the browser computes no layout. Its layout pass needs real geometry, so the node
// waits in an off-screen, inert container of the document until the page shows it (moving it into the preview) or an
// export of another page encodes it. Nothing in there is visible, focusable or announced.
let layoutSandbox = null;
function premiumLayoutSandbox() {
  if (layoutSandbox?.isConnected) return layoutSandbox;
  layoutSandbox = document.createElement('div');
  layoutSandbox.dataset.socialLayoutSandbox = 'premium';
  layoutSandbox.setAttribute('aria-hidden', 'true');
  layoutSandbox.inert = true;
  Object.assign(layoutSandbox.style, {
    position: 'fixed', left: '-100000px', top: '0', width: '1080px', height: '0', overflow: 'visible', pointerEvents: 'none',
  });
  document.body.appendChild(layoutSandbox);
  return layoutSandbox;
}

export function settlePremiumDomLayout(render, { snapshot, editorial = {}, themeId } = {}) {
  if (!render?.node || typeof document === 'undefined' || !document.body) return null;
  if (!render.node.isConnected) premiumLayoutSandbox().appendChild(render.node);
  return anchorPremiumContent(render.node, {
    snapshot,
    editorial,
    themeId,
    formatId: editorial?.format === 'story' ? 'story' : 'portrait',
  });
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

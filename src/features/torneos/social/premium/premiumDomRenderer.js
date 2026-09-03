import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toBlob } from 'html-to-image';
import { SOCIAL_FORMATS } from '../socialContracts';
import PremiumRenderer from './PremiumRenderer';

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

export function releasePremiumDomRender(prepared) {
  prepared?.root?.unmount?.();
  prepared?.node?.remove?.();
}

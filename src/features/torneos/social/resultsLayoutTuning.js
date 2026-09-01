/**
 * Theme-specific geometry for Results 4:5.
 *
 * These values express shared QA invariants (safe exterior space, separated
 * footer and readable secondary text) without forcing the three themes into a
 * common composition.
 */
export const RESULTS_CANVAS_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const RESULTS_MIN_SAFE_INSET = 36;

export const RESULTS_LAYOUT_TUNING = Object.freeze({
  classic: Object.freeze({
    safeInset: 56,
    identity: Object.freeze({ x: 72, y: 54, width: 620, height: 70 }),
    metadata: Object.freeze({ x: 76, y: 164, width: 920, size: 16, lineHeight: 22, maxLines: 2 }),
    title: Object.freeze({ x: 72, y: 292, width: 936, size: 136, minSize: 76 }),
    subtitle: Object.freeze({ x: 76, y: 366, width: 920, size: 32, minSize: 24 }),
    body: Object.freeze({ x: 72, y: 414, width: 936, bottom: 1096 }),
    footer: Object.freeze({
      ruleY: 1164,
      cta: Object.freeze({ x: 76, y: 1266, width: 330, size: 18, minSize: 15 }),
      lockup: Object.freeze({ x: 686, y: 1098, width: 330, height: 216 }),
    }),
  }),
  street: Object.freeze({
    safeInset: 44,
    identity: Object.freeze({ x: 58, y: 44, width: 620, height: 74 }),
    organization: Object.freeze({ x: 62, y: 148, width: 930, size: 15, minSize: 13 }),
    title: Object.freeze({ x: 48, y: 288, width: 964, size: 138, minSize: 88 }),
    gesture: Object.freeze({ top: 312, bottom: 372 }),
    instance: Object.freeze({ x: 60, y: 366, width: 850, size: 21, minSize: 16 }),
    body: Object.freeze({ x: 52, y: 414, width: 976, bottom: 1106 }),
    footer: Object.freeze({
      ruleY: 1144,
      noteY: 1180,
      cta: Object.freeze({ x: 58, y: 1278, width: 360, size: 18, minSize: 14 }),
      lockup: Object.freeze({ x: 684, y: 1110, width: 336, height: 200 }),
    }),
  }),
  editorial: Object.freeze({
    safeInset: 42,
    rail: Object.freeze({ width: 238, contentX: 38, contentWidth: 164 }),
    identity: Object.freeze({ x: 302, y: 54, width: 700, height: 70 }),
    title: Object.freeze({ x: 300, y: 278, width: 708, size: 132, minSize: 78 }),
    body: Object.freeze({ x: 300, y: 336, width: 708, bottom: 1104 }),
    footer: Object.freeze({
      lockup: Object.freeze({ x: 16, y: 1110, width: 220, height: 147 }),
      tournament: Object.freeze({ x: 1008, y: 1296, width: 650, size: 17, minSize: 13 }),
    }),
  }),
});

export function resolveResultsLayoutTuning(themeId) {
  return RESULTS_LAYOUT_TUNING[themeId] || RESULTS_LAYOUT_TUNING.classic;
}

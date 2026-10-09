import { SOCIAL_PIECES } from '../features/torneos/social/socialContracts';
import {
  BASE_FORMAT_IDS,
  BASE_PIECE_IDS,
  BASE_TOURNAMENT_LOGO_KEY,
  adaptSnapshotToBasePiece,
} from '../features/torneos/social/base/content';
import { FORMATS, rowLayout } from '../features/torneos/social/base/core';
import { PIECES } from '../features/torneos/social/base/pieces';
import { TORNEOS_URL } from '../features/torneos/social/socialProductConfig';

describe('Social Studio approved Base design system', () => {
  test('maps the complete product catalog to the 11 approved families', () => {
    expect(Object.keys(BASE_PIECE_IDS).sort()).toEqual(
      SOCIAL_PIECES.map((piece) => piece.id).sort(),
    );
    expect(Object.values(BASE_PIECE_IDS)).toEqual(PIECES.map((piece) => piece.id));
    expect(new Set(Object.values(BASE_PIECE_IDS))).toHaveProperty('size', 11);
  });

  test('keeps both export contracts exact', () => {
    expect(BASE_FORMAT_IDS).toEqual({ portrait: '4:5', story: '9:16' });
    expect(FORMATS['4:5']).toMatchObject({ W: 1080, H: 1350 });
    expect(FORMATS['9:16']).toMatchObject({ W: 1080, H: 1920 });
  });

  test('adapts official schedule, venue, team and tournament branding data', () => {
    const data = adaptSnapshotToBasePiece({
      piece: 'next_fixture',
      competition: {
        tournamentName: 'Copa Horizonte',
        categoryName: 'Primera',
        roundName: 'Fecha 9',
        timezone: 'America/Argentina/Buenos_Aires',
      },
      official: {
        matches: [{
          scheduledAt: '2026-08-29T18:30:00.000Z',
          venueName: 'Estadio Central',
          home: { participantId: 'home', name: 'Deportivo Horizonte' },
          away: { participantId: 'away', name: 'Atlético del Sur' },
          result: null,
        }],
      },
    }, { format: 'story', selection: [] }, { tournamentLogo: 'resolved-logo' });

    expect(data).toMatchObject({
      tournament: 'Copa Horizonte',
      category: 'Primera',
      round: 'Fecha 9',
      tournamentLogo: BASE_TOURNAMENT_LOGO_KEY,
      matches: [{
        home: { name: 'Deportivo Horizonte' },
        away: { name: 'Atlético del Sur' },
        venue: 'Estadio Central',
        time: '15:30 HS',
      }],
    });
    expect(data.matches[0].date).toMatch(/SÁB.*29.*AGO/);
  });

  test('uses the Torneos product landing and never the deprecated app domain', () => {
    expect(TORNEOS_URL).toBe('arma2.com.ar/torneos');
    expect(TORNEOS_URL).not.toMatch(/arma2\.app/);
  });
});

describe('Base list layouts with few entries', () => {
  const box = { x: 60, y: 300, w: 960, h: 900 };

  test('a list starts under the title instead of floating in the middle of the body', () => {
    // Two rows that reach their cap long before filling the body.
    const top = rowLayout(box, 2, { min: 76, max: 250, gap: 14, align: 'top' });
    expect(top.y).toBe(box.y);
    expect(top.h).toBe(250);
    // The old centered placement, still the default for hero compositions (a single final).
    const centered = rowLayout(box, 2, { min: 76, max: 250, gap: 14 });
    expect(centered.y).toBe(box.y + (box.h - centered.total) / 2);
  });

  test('a full list fills the body exactly as before, whatever the alignment', () => {
    const top = rowLayout(box, 8, { min: 76, max: 250, gap: 10, align: 'top' });
    const centered = rowLayout(box, 8, { min: 76, max: 250, gap: 10 });
    expect(top).toEqual(centered);
  });
});

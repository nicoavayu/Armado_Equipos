import { parseLocalDate } from './dateLocal';

const BA_TIMEZONE = 'America/Argentina/Buenos_Aires';

const safeText = (value) => String(value || '').trim();

const formatDateAndTime = (match) => {
  const startAtRaw = safeText(match?.startAt);
  if (startAtRaw) {
    const startAtDate = new Date(startAtRaw);
    if (!Number.isNaN(startAtDate.getTime())) {
      const fecha = startAtDate.toLocaleDateString('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: BA_TIMEZONE,
      });
      const hora = startAtDate.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: BA_TIMEZONE,
      });
      return { fecha, hora };
    }
  }

  const fechaRaw = safeText(match?.fecha).slice(0, 10);
  const horaRaw = safeText(match?.hora).slice(0, 5);

  let fecha = '(sin definir)';
  if (fechaRaw) {
    try {
      const fechaLocal = parseLocalDate(fechaRaw);
      if (fechaLocal) {
        fecha = fechaLocal.toLocaleDateString('es-AR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: BA_TIMEZONE,
        });
      }
    } catch (_error) {
      fecha = fechaRaw;
    }
  }

  const hora = horaRaw || '(sin definir)';
  return { fecha, hora };
};

const resolvePlayerDisplayName = (player, index) => {
  const directName = safeText(
    player?.displayName ||
    player?.nombre ||
    player?.name ||
    player?.apodo ||
    player?.nickname,
  );
  return directName || `Jugador ${index + 1}`;
};

const resolveLocation = (match) => {
  const locationName = safeText(
    match?.locationName ||
    match?.sede ||
    match?.cancha ||
    match?.nombre_cancha ||
    match?.lugar,
  );
  const address = safeText(match?.address || match?.direccion || match?.locationAddress);
  if (locationName && address) return `${locationName} - ${address}`;
  if (locationName) return locationName;
  if (address) return address;
  return '(sin definir)';
};

const normalizeCapacity = (match, playersCount) => {
  const raw = Number(match?.capacity ?? match?.cupo_jugadores ?? 0);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return playersCount > 0 ? playersCount : 0;
};

export const buildWhatsAppRosterMessage = (match, joinLink) => {
  const players = Array.isArray(match?.players) ? match.players : [];
  const capacity = normalizeCapacity(match, players.length);
  const totalSlots = Math.max(capacity, players.length);
  const missing = Math.max(0, capacity - players.length);
  const { fecha, hora } = formatDateAndTime(match);
  const location = resolveLocation(match);
  const matchTitle = safeText(match?.nombre || match?.title) || 'Partido';
  const safeJoinLink = safeText(joinLink);

  const rosterLines = [];
  for (let i = 0; i < totalSlots; i += 1) {
    const player = players[i];
    if (player) {
      rosterLines.push(`${i + 1}. ${resolvePlayerDisplayName(player, i)}`);
    } else {
      rosterLines.push(`${i + 1}.`);
    }
  }

  return [
    `Partido: ${matchTitle}`,
    `Fecha: ${fecha}`,
    `Hora: ${hora}${hora !== '(sin definir)' ? ' hs' : ''}`,
    `Lugar: ${location}`,
    '',
    `${players.length}/${capacity || totalSlots} jugadores`,
    `Faltan ${missing}`,
    '',
    ...rosterLines,
    '',
    `Sumate acá: ${safeJoinLink}`,
  ].join('\n');
};

export default buildWhatsAppRosterMessage;

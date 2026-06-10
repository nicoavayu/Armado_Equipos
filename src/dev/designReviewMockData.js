const makePlayers = (names) => names.map((name, index) => ({
  id: `mock-player-${index + 1}`,
  nombre: name,
  posicion: ['ARQ', 'DEF', 'MED', 'DEL'][index % 4],
  rating: [7.9, 8.4, 7.2, 8.8, 7.6, 8.1, 6.9, 8.6][index % 8],
}));

export const reviewBranch = {
  name: 'design/premium-full-refresh-v3',
  subtitle: 'Premium full refresh v3',
  note: 'Mock visual data — no Supabase',
};

export const mockPlayers = makePlayers([
  'Nico Avayu',
  'Santi Rojas',
  'Mora Valdez',
  'Tomas Vega',
  'Lara Silva',
  'Juli Moretti',
  'Nacho Ruiz',
  'Cami Torres',
  'Fede Luna',
  'Agus Castro',
  'Mati Paredes',
  'Rocio Arias',
]);

export const mockMatches = [
  {
    id: 'match-open-f5',
    nombre: 'F5 nocturno Palermo',
    fecha_display: 'Jueves 11 jun',
    hora: '21:00',
    sede: 'Il Capitano, Palermo',
    modalidad: 'F5',
    tipo_partido: 'Mixto',
    precio_cancha_por_persona: 5200,
    cupo_jugadores: 10,
    jugadores: mockPlayers.slice(0, 7),
    origin_badge: 'Amistoso',
  },
  {
    id: 'match-full-f7',
    nombre: 'F7 competitivo',
    fecha_display: 'Sabado 13 jun',
    hora: '18:30',
    sede: 'Complejo Costa Salguero',
    modalidad: 'F7',
    tipo_partido: 'Masculino',
    precio_cancha_por_persona: 6800,
    cupo_jugadores: 14,
    jugadores: makePlayers(Array.from({ length: 14 }, (_, index) => `Jugador ${index + 1}`)),
    origin_badge: 'Amistoso',
  },
  {
    id: 'match-challenge',
    nombre: 'Desafio: Tigres Norte vs La Banda',
    fecha_display: 'Domingo 14 jun',
    hora: '20:15',
    sede: 'Arena Sport Club',
    modalidad: 'F8',
    genero_partido: 'Mixto',
    precio_cancha_por_persona: 7400,
    cupo_jugadores: 16,
    jugadores: mockPlayers.slice(0, 12),
    source_type: 'team_match',
    origin_type: 'challenge',
    origin_badge: 'Desafio',
    team_a: { name: 'Tigres Norte' },
    team_b: { name: 'La Banda FC' },
  },
  {
    id: 'match-finished',
    nombre: 'F11 finalizado',
    fecha_display: 'Martes 09 jun',
    hora: '22:00',
    sede: 'Megafutbol, Nuñez',
    modalidad: 'F11',
    tipo_partido: 'Femenino',
    precio_cancha_por_persona: 3900,
    cupo_jugadores: 22,
    jugadores: makePlayers(Array.from({ length: 20 }, (_, index) => `Titular ${index + 1}`)),
    origin_badge: 'Amistoso',
  },
];

export const mockNotifications = [
  { id: 1, title: 'Te aceptaron en F5 nocturno Palermo', meta: 'Hace 5 min', type: 'Partido', unread: true },
  { id: 2, title: 'La Banda FC publico un desafio', meta: 'Hace 18 min', type: 'Desafio', unread: true },
  { id: 3, title: 'Mora voto tus equipos', meta: 'Ayer', type: 'Votacion', unread: false },
  { id: 4, title: 'Ya estan los resultados del ultimo partido', meta: 'Lun 22:10', type: 'Resultados', unread: false },
];

export const mockChallenges = [
  { id: 1, team: 'Tigres Norte', record: '8-2-1', level: 'Elite', status: 'Buscando rival' },
  { id: 2, team: 'La Banda FC', record: '5-4-0', level: 'Pro', status: 'Desafio recibido' },
  { id: 3, team: 'Santos del Sur', record: '3-1-3', level: 'Amateur+', status: 'Disponible' },
];

export const mockSurveyQuestions = [
  'Ausentes confirmados',
  'MVP del partido',
  'Mejor arquero',
  'Jugador violento / roja',
  'Confirmacion final',
];


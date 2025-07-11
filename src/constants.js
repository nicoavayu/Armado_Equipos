export const MODES = {
  HOME: null,
  ADMIN: "admin",
  SIMPLE: "simple", 
  VOTING: "votacion",
  PLAYER: "jugador"
};

export const STEPS = {
  IDENTIFY: 0,
  PHOTO: 1,
  VOTE: 2,
  CONFIRM: 3
};

export const ADMIN_STEPS = {
  SELECT_TYPE: 0,
  CREATE_MATCH: 1,
  SELECT_FREQUENT: 2,
  EDIT_FREQUENT: 3,
  MANAGE: 4
};

export const RATING_BUTTONS = Array.from({ length: 10 }, (_, i) => i + 1);

export const DIAS_SEMANA = {
  0: 'Domingo',
  1: 'Lunes', 
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado'
};

export const DIAS_SEMANA_CORTO = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar', 
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb'
};
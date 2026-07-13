// Primer nombre para saludos/cabeceras: toma el primer token no vacío del
// nombre, recortando espacios. No modifica el nombre almacenado ni afecta cómo
// se muestra en perfiles, partidos o chats: es solo para la presentación del
// saludo (p. ej. la bienvenida de Home), evitando que "Juanito Ferreri" se
// corte con puntos suspensivos por intentar mostrar nombre y apellido.
export const firstName = (fullName, fallback = 'Jugador') => {
  const token = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  return token || fallback;
};

export default firstName;

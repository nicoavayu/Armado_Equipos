/**
 * Convierte un valor a número entero para usar con campos bigint en la DB
 * @param {any} value - Valor a convertir
 * @returns {number|null} Número entero o null si no es convertible
 */
export function toBigIntId(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}
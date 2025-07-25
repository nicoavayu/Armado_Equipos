import React from 'react';

export default function PartidoInfoBox({ partido }) {
  if (!partido) return null;

  const fechaObj = partido.fecha
    ? new Date(partido.fecha + 'T00:00')
    : null;

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sabado'];
  const dia = fechaObj ? dias[fechaObj.getDay()] : '';

  const fechaCorta = fechaObj
    ? `${fechaObj.getDate()}/${fechaObj.getMonth() + 1}`
    : partido.fecha;

  // Sacá solo el nombre antes de la primer coma
  const descripcionCompleta = partido.sede || '';
  const nombreLugar = descripcionCompleta.split(',')[0];

  const urlMaps = partido.sedeMaps?.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${partido.sedeMaps.place_id}`
    : `https://www.google.com/maps/search/${encodeURIComponent(partido.sede)}`;

  return (
    <div
      style={{
        width: '100%',
        textAlign: 'center',
        marginBottom: 18,
        fontFamily: "'Bebas Neue', Arial, sans-serif",
        fontSize: 30,
        color: '#fff',
        letterSpacing: '0.03em',
      }}
    >
      {dia && `${dia} `}
      {fechaCorta}
      {partido.hora && ` ${partido.hora}`}
      {nombreLugar && (
        <>
          {' - '}
          <a
            href={urlMaps}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#fff',
              textDecoration: 'underline',
              fontWeight: 700,
              opacity: 0.98,
            }}
          >
            {nombreLugar}
          </a>
        </>
      )}
    </div>
  );
}

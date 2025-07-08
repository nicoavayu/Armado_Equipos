// src/DemoFlujoPartido.js
import React, { useState } from "react";
import SeleccionarTipoPartido from "./SeleccionarTipoPartido";
import FormularioNuevoPartido from "./FormularioNuevoPartido";
import PartidoInfoBox from "./PartidoInfoBox";

export default function DemoFlujoPartido() {
  const [step, setStep] = useState(0);
  const [partido, setPartido] = useState(null);

  if (step === 0)
    return (
      <SeleccionarTipoPartido
        onNuevo={() => setStep(1)}
        onExistente={() => alert("Acá iría el listado de partidos frecuentes")}
      />
    );
  if (step === 1)
    return (
      <FormularioNuevoPartido
        onConfirmar={data => {
          setPartido(data);
          setStep(2);
        }}
      />
    );
  if (step === 2)
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <PartidoInfoBox partido={partido} />
          <div style={{ color: "#fff", fontFamily: "Oswald, Arial", marginTop: 32, fontSize: 22 }}>
            Acá iría la pantalla de agregar jugadores, etc.
          </div>
        </div>
      </div>
    );
}

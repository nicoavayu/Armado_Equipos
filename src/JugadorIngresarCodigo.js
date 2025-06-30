import React, { useState } from "react";

export default function JugadorIngresarCodigo({ onIngresar }) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = e => {
    e.preventDefault();
    if (!codigo.trim()) {
      setError("Ingresá el código de partido");
      return;
    }
    setError("");
    onIngresar(codigo.trim());
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)"
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 28,
          boxShadow: "0 2px 20px #ccc",
          padding: 32,
          minWidth: 320,
          textAlign: "center"
        }}>
        <h2 style={{ color: "#DE1C49", fontWeight: 800, marginBottom: 22 }}>
          Ingresá el código de partido
        </h2>
        <input
          type="text"
          placeholder="Código"
          value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase())}
          style={{
            width: "100%",
            padding: "13px 18px",
            fontSize: 18,
            borderRadius: 16,
            border: "1.5px solid #eceaf1",
            marginBottom: 18,
            background: "#f9f9fa",
            textAlign: "center",
            letterSpacing: 2
          }}
        />
        {error && <div style={{ color: "#DE1C49", fontSize: 15, marginBottom: 10 }}>{error}</div>}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            background: "#0EA9C6",
            border: "none",
            borderRadius: 16,
            cursor: "pointer"
          }}>
          Ingresar
        </button>
      </form>
    </div>
  );
}

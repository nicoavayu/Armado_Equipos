// src/Home.js
import React from "react";
import "./Home.css";
import Logo from "./Logo.png";
import SvgPelota from "./SvgPelota";
import SvgPeople from "./SvgPeople";

export default function Home({ onModoSeleccionado }) {
  return (
    <div className="home-bg">
      <div className="logo-container">
        <img src={Logo} alt="Logo" className="logo-img" />
      </div>
      <div className="cards-container">
        {/* Modo Rápido */}
        <div className="home-card" onClick={() => onModoSeleccionado("simple")}>
          <div className="card-title">RAPIDO</div>
          <div className="card-icon">
            <SvgPelota style={{ width: "150px", height: "110px" }} />
          </div>
        </div>
        {/* Modo Participativo */}
        <div className="home-card" onClick={() => onModoSeleccionado("votacion")}>
          <div className="card-title">PARTICIPATIVO</div>
          <div className="card-icon">
            <SvgPeople style={{ width: "150px", height: "110px" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

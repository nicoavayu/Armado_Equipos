// src/Home.js
import React, { useState } from "react";
import "./HomeStyleKit.css";
import Logo from "./Logo.png";
import GoogleAuth from "./components/GoogleAuth";
import { useAuth } from "./components/AuthProvider";
import AvatarWithProgress from "./components/AvatarWithProgress";
import ProfileEditor from "./components/ProfileEditor";

export default function Home({ onModoSeleccionado }) {
  const { user, profile } = useAuth();
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  return (
    <div className="voting-bg home-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ position: 'relative' }}>
        <img
          src={Logo}
          alt="Logo"
          style={{ height: '150px', marginBottom: '20px' }}
        />
        <GoogleAuth user={user} />
      </div>
      
      {/* Profile Editor */}
      <ProfileEditor
        isOpen={showProfileEditor}
        onClose={() => setShowProfileEditor(false)}
      />
    </div>
  );
}

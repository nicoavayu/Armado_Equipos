import React, { useState, useEffect } from 'react';
import { useTimeout } from '../../hooks/useTimeout';
import ProfileCard from '../ProfileCard';

const AbsencePenaltyAnimation = ({ players }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animatedValue, setAnimatedValue] = useState(0);
  const { setTimeoutSafe } = useTimeout();

  useEffect(() => {
    if (players && players.length > 0) {
      // Animate from 0 to -0.3
      setTimeoutSafe(() => {
        setAnimatedValue(-0.3);
      }, 500);
    }
  }, [currentIndex, players, setTimeoutSafe]);

  useEffect(() => {
    if (players && players.length > 1 && currentIndex < players.length - 1) {
      setTimeoutSafe(() => {
        setCurrentIndex((prev) => prev + 1);
        setAnimatedValue(0); // Reset for next player
      }, 3000);
    }
  }, [currentIndex, players, setTimeoutSafe]);

  if (!players || players.length === 0) return null;

  const currentPlayer = players[currentIndex];
  if (!currentPlayer) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100%',
      padding: '20px',
      boxSizing: 'border-box',
    }}>
      <div className="award-container">
        <div className="award-text" style={{ marginBottom: '20px', textAlign: 'center', color: '#ff4444' }}>
          PENALIZACIÓN POR AUSENCIA
        </div>
        
        <div className="profile-card-animation" style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: '20px',
        }}>
          <ProfileCard 
            profile={currentPlayer}
            enableTilt={false}
            isVisible={true}
          />
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '10px',
        }}>
          <div className="award-icon" style={{ fontSize: '48px' }}>
            ❌
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
          fontWeight: 'bold',
          color: '#ff4444',
          transition: 'all 0.5s ease-in-out',
        }}>
          {animatedValue.toFixed(1)}
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          color: '#fff',
          marginTop: '10px',
        }}>
          RANKING
        </div>
      </div>
    </div>
  );
};

export default AbsencePenaltyAnimation;
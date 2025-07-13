import React, { useState } from 'react';
import { debugVoting, getCurrentUserId, submitVotos, debugVotingStatus, clearGuestSession } from './supabase';

const VotingDebug = ({ partidoActual }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const testVoting = async () => {
    setLoading(true);
    try {
      console.log('Testing voting system...');
      
      if (!partidoActual?.id) {
        setResult({ error: 'No partido ID available' });
        return;
      }
      
      const debugResult = await debugVoting(partidoActual.id);
      setResult(debugResult);
    } catch (error) {
      console.error('Test failed:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const checkVotingStatus = async () => {
    setLoading(true);
    try {
      if (!partidoActual?.id) {
        setResult({ error: 'No partido ID available' });
        return;
      }
      
      const statusResult = await debugVotingStatus(partidoActual.id);
      setResult(statusResult);
    } catch (error) {
      console.error('Status check failed:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const clearSession = () => {
    clearGuestSession(partidoActual?.id);
    setResult({ message: 'Guest session cleared for this match' });
  };

  const testRealVote = async () => {
    setLoading(true);
    try {
      if (!partidoActual?.id || !partidoActual?.jugadores?.length) {
        setResult({ error: 'No partido or players available' });
        return;
      }

      const testVotos = {};
      const firstPlayer = partidoActual.jugadores[0];
      if (firstPlayer) {
        testVotos[firstPlayer.uuid] = 7;
      }

      console.log('Testing real vote submission...');
      const result = await submitVotos(testVotos, firstPlayer.uuid, partidoActual.id);
      setResult({ success: true, data: result });
    } catch (error) {
      console.error('Real vote test failed:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!partidoActual) {
    return <div style={{ color: 'white', padding: 20 }}>No partido available for testing</div>;
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: 10, 
      right: 10, 
      background: 'rgba(0,0,0,0.8)', 
      color: 'white', 
      padding: 20, 
      borderRadius: 8,
      zIndex: 9999,
      maxWidth: 300
    }}>
      <h3>Voting Debug</h3>
      <p>Partido ID: {partidoActual.id}</p>
      <p>Players: {partidoActual.jugadores?.length || 0}</p>
      
      <button 
        onClick={testVoting} 
        disabled={loading}
        style={{ 
          background: '#0EA9C6', 
          color: 'white', 
          border: 'none', 
          padding: '6px 10px', 
          margin: '3px', 
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 12
        }}
      >
        {loading ? 'Testing...' : 'Test Insert'}
      </button>
      
      <button 
        onClick={checkVotingStatus} 
        disabled={loading}
        style={{ 
          background: '#27ae60', 
          color: 'white', 
          border: 'none', 
          padding: '6px 10px', 
          margin: '3px', 
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 12
        }}
      >
        {loading ? 'Checking...' : 'Check Status'}
      </button>
      
      <button 
        onClick={clearSession} 
        disabled={loading}
        style={{ 
          background: '#f39c12', 
          color: 'white', 
          border: 'none', 
          padding: '6px 10px', 
          margin: '3px', 
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 12
        }}
      >
        Clear Session
      </button>
      
      <button 
        onClick={testRealVote} 
        disabled={loading}
        style={{ 
          background: '#DE1C49', 
          color: 'white', 
          border: 'none', 
          padding: '6px 10px', 
          margin: '3px', 
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 12
        }}
      >
        {loading ? 'Testing...' : 'Test Real Vote'}
      </button>
      
      {result && (
        <div style={{ 
          marginTop: 10, 
          padding: 10, 
          background: result.error ? '#ff4444' : '#44ff44',
          color: result.error ? 'white' : 'black',
          borderRadius: 4,
          fontSize: 12
        }}>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default VotingDebug;
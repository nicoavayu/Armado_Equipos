import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/PageTitle';
import '../VotingView.css';

const ResultadosEncuestaView = () => {
  const { partidoId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!partidoId) return;
      const { data, error } = await supabase
        .from('survey_results')
        .select('*')
        .eq('partido_id', partidoId)
        .single();
      if (!error) setResults(data);
      setLoading(false);
    }
    load();
  }, [partidoId]);

  if (loading) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={() => navigate('/')}>RESULTADOS</PageTitle>
        <div className="voting-modern-card">
          <LoadingSpinner size="large" />
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={() => navigate('/')}>RESULTADOS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">SIN RESULTADOS</div>
          <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            No hay resultados disponibles para este partido.
          </div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  if (!results.results_ready) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={() => navigate('/')}>RESULTADOS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">GRACIAS POR CALIFICAR</div>
          <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            Publicaremos los resultados en ~6 horas.
          </div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg">
      <PageTitle onBack={() => navigate('/')}>RESULTADOS</PageTitle>
      <div className="voting-modern-card">
        <div className="voting-title-modern">RESULTADOS LISTOS</div>
        <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
          Los resultados de la encuesta están disponibles.
        </div>
        <button className="voting-confirm-btn" onClick={() => navigate('/')}>
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
};

export default ResultadosEncuestaView;
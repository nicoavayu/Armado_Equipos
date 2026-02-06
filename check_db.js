
const { createClient } = require('@supabase/supabase-js');

async function check() {
    const supabaseUrl = 'https://rcyuuoaqfwcembdajcss.supabase.co';
    const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjeXV1b2FxZndjZW1iZGFqY3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzMTcwNzUsImV4cCI6MjA2Njg5MzA3NX0.X0Kv_k7VA3SgxquAC1LOwzMwZuzeKtN3W4BOl_AIsRs';

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const partidoId = 268;

    console.log('--- Checking Match 268 ---');

    const { data: v } = await supabase.from('votos').select('*').eq('partido_id', partidoId);
    console.log('Votos Table count:', v?.length);
    console.log('Votos Table sample:', v?.map(x => ({ votante: x.votante_id, votado: x.votado_id, score: x.puntaje })));

    const { data: vp } = await supabase.from('votos_publicos').select('*').eq('partido_id', partidoId);
    console.log('Votos Publicos Table count:', vp?.length);
    console.log('Votos Publicos Table sample:', vp?.map(x => ({ voter: x.votante_voter_id, votado: x.votado_jugador_id, score: x.puntaje })));

    const { data: pv } = await supabase.from('public_voters').select('*').eq('partido_id', partidoId);
    console.log('Public Voters Table:', pv);

    const { data: j } = await supabase.from('jugadores').select('*').eq('partido_id', partidoId);
    console.log('Jugadores Table (Total 8):', j.map(p => ({ id: p.id, uuid: p.uuid, nombre: p.nombre, usuario_id: p.usuario_id })));
}

check();

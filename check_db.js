const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.CHECK_DB_SUPABASE_URL;
const supabaseAnonKey = process.env.CHECK_DB_SUPABASE_ANON_KEY;
const partidoId = Number(process.env.CHECK_DB_PARTIDO_ID);

if (!supabaseUrl || !supabaseAnonKey || !Number.isSafeInteger(partidoId) || partidoId <= 0) {
    throw new Error(
        'Missing CHECK_DB_SUPABASE_URL, CHECK_DB_SUPABASE_ANON_KEY, or a valid CHECK_DB_PARTIDO_ID'
    );
}

async function check() {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    console.log(`--- Checking Match ${partidoId} ---`);

    const { data: v } = await supabase.from('votos').select('*').eq('partido_id', partidoId);
    console.log('Votos Table count:', v?.length);
    console.log('Votos Table sample:', v?.map(x => ({ votante: x.votante_id, votado: x.votado_id, score: x.puntaje })));

    const { data: vp } = await supabase.from('votos_publicos').select('*').eq('partido_id', partidoId);
    console.log('Votos Publicos Table count:', vp?.length);
    console.log('Votos Publicos Table sample:', vp?.map(x => ({ voter: x.votante_voter_id, votado: x.votado_jugador_id, score: x.puntaje })));

    const { data: pv } = await supabase.from('public_voters').select('*').eq('partido_id', partidoId);
    console.log('Public Voters Table:', pv);

    const { data: j } = await supabase.from('jugadores').select('*').eq('partido_id', partidoId);
    console.log('Jugadores:', j?.map(p => ({ id: p.id, uuid: p.uuid, nombre: p.nombre, usuario_id: p.usuario_id })));
}

check();

'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

type Profile = { id: string; nombre: string; avatar_url: string | null };
type Group = { id: string; nombre: string; codigo_invitacion: string; created_by: string };
type Member = { group_id: string; user_id: string; rol: 'miembro' | 'admin'; profile?: Profile };
type Season = { id: string; group_id: string; nombre: string; fecha_inicio: string; fecha_fin: string };
type Challenge = { 
  id: string; 
  season_id: string; 
  user_id: string; 
  dias_carrera_semana: number; 
  dias_fuerza_semana: number;
  importe_dia: number;
  importe_propuesto: number | null;
  estado_importe: 'aprobado' | 'pendiente_aprobacion';
  profile?: Profile;
};
type SolicitudRevocacion = {
  id: string;
  created_at?: string;
  user_id: string;
  group_id: string;
  challenge_id: string;
  motivo: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  profile?: Profile;
};
type ManualDebt = {
  id: string;
  season_id: string;
  user_id: string;
  admin_id: string;
  importe: number;
  concepto: string;
  estado: 'pendiente' | 'aceptada' | 'rechazada';
  profile?: Profile;
};
type Workout = { id: string; season_id: string; user_id: string; tipo: string; fecha: string; duracion_minutos: number; captura_url: string; estado: 'pendiente' | 'aprobado' | 'rechazado'; motivo_rechazo: string | null; profile?: Profile };
type Debt = { season_id: string; user_id: string; semana_inicio: string; importe_deuda: number; importe_saldado: number; importe_pendiente: number; dias_totales_fallados: number };

const supabase = createClient();
const money = (n: number) => `${Number(n || 0).toFixed(2)} €`;
const formatDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

const getMondayOfCurrentWeek = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split('T')[0];
};

const getLastTuesdayCutoff = () => {
  const d = new Date();
  const day = d.getDay();
  let diffDays = day - 2;
  if (diffDays < 0) diffDays += 7;
  const tuesday = new Date(d);
  tuesday.setDate(d.getDate() - diffDays);
  tuesday.setHours(0, 0, 0, 0);
  return tuesday.toISOString().split('T')[0];
};

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [pendingChallenges, setPendingChallenges] = useState<Challenge[]>([]);
  const [pendingRevocations, setPendingRevocations] = useState<SolicitudRevocacion[]>([]);
  const [myRevocation, setMyRevocation] = useState<SolicitudRevocacion | null>(null);
  const [manualDebts, setManualDebts] = useState<ManualDebt[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [allGroupWorkouts, setAllGroupWorkouts] = useState<Workout[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [tab, setTab] = useState('inicio');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [login, setLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');

  // Formularios
  const [nuevoNombreGrupo, setNuevoNombreGrupo] = useState('');
  const [codigoUnirse, setCodigoUnirse] = useState('');
  const [diasEntreno, setDiasEntreno] = useState(0);
  const [importeDia, setImporteDia] = useState(5);
  const [motivoRevocacion, setMotivoRevocacion] = useState('');
  const [mostrarModalRevocacion, setMostrarModalRevocacion] = useState(false);
  
  const [workoutForm, setWorkoutForm] = useState({ 
    tipo: 'carrera', 
    tipoPersonalizado: '',
    fecha: new Date().toISOString().slice(0, 10), 
    duracion: 40, 
    file: null as File | null 
  });
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);

  async function loadData() {
    setLoading(true);
    setMsg('');
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      if (!currentSession) return;
      
      await supabase.from('profiles').upsert(
        { id: currentSession.user.id, nombre: currentSession.user.user_metadata?.nombre || currentSession.user.email?.split('@')[0] || 'Usuario' }, 
        { onConflict: 'id' }
      );
      const p = await supabase.from('profiles').select('*').eq('id', currentSession.user.id).single();
      setProfile(p.data);
      
      const gm = await supabase.from('group_members').select('group_id, user_id, rol').eq('user_id', currentSession.user.id);
      const gids = (gm.data || []).map(x => x.group_id);
      const gs = gids.length ? await supabase.from('groups').select('*').in('id', gids) : { data: [] };
      setGroups(gs.data || []);
      
      const g = (gs.data || [])[0] || null;
      setGroup(g);
      if (g) await loadGroup(g, currentSession.user.id);
    } catch (err: any) {
      console.error(err);
      setMsg('Error cargando los datos.');
    } finally {
      setLoading(false);
    }
  }

  async function loadGroup(g: Group, currentUserId: string) {
    const m = await supabase.from('group_members').select('group_id,user_id,rol').eq('group_id', g.id);
    const ids = (m.data || []).map(x => x.user_id);
    const ps = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [] };
    const memberList = (m.data || []).map(x => ({ ...x, profile: (ps.data || []).find(p => p.id === x.user_id) }));
    setMembers(memberList);
    
    const ss = await supabase.from('seasons').select('*').eq('group_id', g.id).order('fecha_inicio', { ascending: false });
    setSeasons(ss.data || []);
    const s = (ss.data || [])[0] || null;
    setSeason(s);

    const sIds = (ss.data || []).map(x => x.id);
    if (sIds.length) {
      const gw = await supabase.from('workouts').select('*').in('season_id', sIds).eq('estado', 'aprobado');
      setAllGroupWorkouts((gw.data || []).map(x => ({ ...x, profile: (ps.data || []).find(p => p.id === x.user_id) })));
    }

    if (s) await loadSeason(s, currentUserId, memberList, g.id);
    else { setChallenge(null); setWorkouts([]); setDebts([]); setManualDebts([]); setPendingChallenges([]); setPendingRevocations([]); setMyRevocation(null); }
  }

  async function loadSeason(s: Season, currentUserId: string, currentMembers = members, groupId?: string) {
    const uid = currentUserId || session?.user?.id;
    if (!uid) return;

    const c = await supabase.from('challenges').select('*').eq('season_id', s.id).eq('user_id', uid).maybeSingle();
    setChallenge(c.data);
    if (c.data) {
      setDiasEntreno(c.data.dias_carrera_semana + c.data.dias_fuerza_semana);
      setImporteDia(c.data.importe_propuesto || c.data.importe_dia || 5);
      
      const myRev = await supabase.from('solicitudes_revocacion')
        .select('*')
        .eq('challenge_id', c.data.id)
        .eq('user_id', uid)
        .eq('estado', 'pendiente')
        .maybeSingle();
      setMyRevocation(myRev.data);
    } else {
      setMyRevocation(null);
    }
    
    const pc = await supabase.from('challenges').select('*').eq('season_id', s.id).eq('estado_importe', 'pendiente_aprobacion');
    setPendingChallenges((pc.data || []).map(item => ({ ...item, profile: currentMembers.find(m => m.user_id === item.user_id)?.profile })));

    const activeGroupId = groupId || group?.id;
    if (activeGroupId) {
      const pr = await supabase.from('solicitudes_revocacion').select('*').eq('group_id', activeGroupId).eq('estado', 'pendiente');
      setPendingRevocations((pr.data || []).map(item => ({ ...item, profile: currentMembers.find(m => m.user_id === item.user_id)?.profile })));
    }

    const md = await supabase.from('deudas_manuales').select('*').eq('season_id', s.id);
    setManualDebts((md.data || []).map((x: any) => ({ ...x, profile: currentMembers.find(m => m.user_id === x.user_id)?.profile })));

    const w = await supabase.from('workouts').select('*').eq('season_id', s.id).order('fecha', { ascending: false });
    setWorkouts((w.data || []).map((x: any) => ({ ...x, profile: currentMembers.find(m => m.user_id === x.user_id)?.profile })));
    
    const tuesdayCutoff = getLastTuesdayCutoff();
    const d = await supabase.from('v_deuda_pendiente')
      .select('*')
      .eq('season_id', s.id)
      .lt('semana_inicio', tuesdayCutoff)
      .order('semana_inicio', { ascending: false });
      
    setDebts(d.data || []);
  }

  useEffect(() => {
    loadData();
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadData();
      else setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleAuth() {
    setMsg('');
    setLoading(true);
    if (login) {
      const r = await supabase.auth.signInWithPassword({ email, password });
      if (r.error) { setMsg(r.error.message); setLoading(false); }
    } else {
      const r = await supabase.auth.signUp({ email, password, options: { data: { nombre } } });
      if (r.error) setMsg(r.error.message);
      else setMsg('Cuenta creada. Revisa tu email.');
      setLoading(false);
    }
  }

  async function crearGrupo() {
    if (!nuevoNombreGrupo.trim()) { setMsg('Escribe un nombre para el grupo.'); return; }
    setMsg('Creando grupo...');
    
    const { data, error } = await supabase.rpc('handle_create_group', { nombre_grupo: nuevoNombreGrupo.trim() });
    
    if (error) {
      const res = await supabase.from('groups').insert({ nombre: nuevoNombreGrupo.trim(), created_by: session.user.id }).select().single();
      if (res.error) { setMsg('Error al crear grupo: ' + res.error.message); return; }
      await supabase.from('group_members').insert({ group_id: res.data.id, user_id: session.user.id, rol: 'admin' });
    }
    
    setNuevoNombreGrupo('');
    setMsg('Grupo creado con éxito.');
    await loadData();
  }

  async function unirseGrupo() {
    if (!codigoUnirse.trim()) { setMsg('Introduce un código de invitación.'); return; }
    const g = await supabase.from('groups').select('*').eq('codigo_invitacion', codigoUnirse.trim().toUpperCase()).maybeSingle();
    if (!g.data) { setMsg('Código no válido.'); return; }

    const r = await supabase.from('group_members').insert({ group_id: g.data.id, user_id: session.user.id, rol: 'miembro' });
    if (r.error) setMsg('Ya perteneces a este grupo o hubo un error.');
    else {
      setCodigoUnirse('');
      setMsg(`Te has unido a ${g.data.nombre}`);
      await loadData();
    }
  }

  async function promoteAdmin(targetUserId: string) {
    if (!group) return;
    const r = await supabase.from('group_members').update({ rol: 'admin' }).eq('group_id', group.id).eq('user_id', targetUserId);
    if (r.error) setMsg('Error: ' + r.error.message);
    else {
      setMsg('Rol actualizado a administrador.');
      await loadGroup(group, session.user.id);
    }
  }

  async function deleteWorkout(workout: Workout) {
    if (!confirm('¿Seguro que quieres eliminar este entrenamiento?')) return;
    
    setMsg('Eliminando entrenamiento...');
    try {
      if (workout.captura_url) {
        await supabase.storage.from('capturas').remove([workout.captura_url]).catch(() => null);
      }
      
      const { error } = await supabase.from('workouts').delete().eq('id', workout.id);
      if (error) {
        setMsg('Error al eliminar en base de datos: ' + error.message);
      } else {
        setMsg('Entrenamiento eliminado correctamente.');
        if (season) {
          await loadSeason(season, session.user.id);
        }
      }
    } catch (e: any) {
      setMsg('Error inesperado: ' + e.message);
    }
  }

  async function saveChallenge() {
    if (!season) { setMsg('Crea primero una temporada.'); return; }
    
    const actualImporte = challenge?.importe_dia || 5;
    const nuevoImporte = Number(importeDia);
    const cambiodImporte = nuevoImporte !== actualImporte;

    const payload: any = {
      season_id: season.id, 
      user_id: session.user.id, 
      dias_carrera_semana: Number(diasEntreno), 
      dias_fuerza_semana: 0 
    };

    if (cambiodImporte) {
      payload.importe_propuesto = nuevoImporte;
      payload.estado_importe = 'pendiente_aprobacion';
    }

    const r = await supabase.from('challenges').upsert(payload, { onConflict: 'season_id,user_id' }).select().single();
    if (r.error) setMsg(r.error.message);
    else { 
      setChallenge(r.data); 
      setMsg(cambiodImporte ? 'Reto guardado. La modificación de importe requiere aprobación del admin.' : 'Reto guardado.');
    }
  }

  async function solicitarRevocacion(e: React.FormEvent) {
    e.preventDefault();
    if (!motivoRevocacion.trim() || !challenge || !group) return;

    setMsg('Enviando solicitud de cancelación...');
    const { error } = await supabase.from('solicitudes_revocacion').insert([
      {
        user_id: session.user.id,
        group_id: group.id,
        challenge_id: challenge.id,
        motivo: motivoRevocacion.trim(),
      },
    ]);

    if (error) {
      setMsg('Error al solicitar la cancelación: ' + error.message);
    } else {
      setMsg('Solicitud de cancelación enviada al administrador.');
      setMotivoRevocacion('');
      setMostrarModalRevocacion(false);
      await loadSeason(season!, session.user.id);
    }
  }

  async function responderPropuestaImporte(c: Challenge, aprobar: boolean) {
    const payload = aprobar 
      ? { importe_dia: c.importe_propuesto, importe_propuesto: null, estado_importe: 'aprobado' }
      : { importe_propuesto: null, estado_importe: 'aprobado' };

    const r = await supabase.from('challenges').update(payload).eq('id', c.id);
    if (r.error) setMsg(r.error.message);
    else {
      setMsg(aprobar ? 'Importe aprobado.' : 'Propuesta rechazada.');
      await loadSeason(season!, session.user.id);
    }
  }

  async function responderSolicitudRevocacion(solicitud: SolicitudRevocacion, aprobar: boolean) {
    if (aprobar) {
      const { error: errChallenge } = await supabase.from('challenges').delete().eq('id', solicitud.challenge_id);
      if (errChallenge) {
        setMsg('Error al eliminar el reto: ' + errChallenge.message);
        return;
      }
      await supabase.from('solicitudes_revocacion').update({ estado: 'aprobada' }).eq('id', solicitud.id);
      setMsg('Revocación aprobada. El reto ha sido cancelado.');
    } else {
      await supabase.from('solicitudes_revocacion').update({ estado: 'rechazada' }).eq('id', solicitud.id);
      setMsg('Solicitud de revocación rechazada.');
    }
    await loadSeason(season!, session.user.id);
  }

  async function crearDeudaManual(userId: string, importe: number, concepto: string) {
    if (!season) { setMsg('No hay temporada activa.'); return; }
    if (!importe || importe <= 0) { setMsg('Introduce un importe válido.'); return; }
    if (!concepto.trim()) { setMsg('Introduce un concepto para la deuda.'); return; }

    const { error } = await supabase.from('deudas_manuales').insert({
      season_id: season.id,
      user_id: userId,
      admin_id: session.user.id,
      importe: Number(importe),
      concepto: concepto.trim(),
      estado: 'pendiente'
    });

    if (error) {
      setMsg('Error al crear deuda manual: ' + error.message);
    } else {
      setMsg('Deuda manual creada. Pendiente de validación por el usuario.');
      await loadSeason(season, session.user.id);
    }
  }

  async function responderDeudaManual(deudaId: string, aceptar: boolean) {
    const nuevoEstado = aceptar ? 'aceptada' : 'rechazada';
    const { error } = await supabase.from('deudas_manuales').update({ estado: nuevoEstado }).eq('id', deudaId);
    if (error) {
      setMsg('Error al actualizar la deuda manual: ' + error.message);
    } else {
      setMsg(aceptar ? 'Deuda aceptada correctamente.' : 'Deuda rechazada.');
      await loadSeason(season!, session.user.id);
    }
  }

  async function uploadWorkout() {
    setMsg('');
    if (!season) { setMsg('No hay una temporada activa.'); return; }
    if (!workoutForm.file) { setMsg('Debes adjuntar una captura.'); return; }

    const finalTipo = workoutForm.tipo === 'personalizado' 
      ? (workoutForm.tipoPersonalizado.trim() || 'Otro') 
      : workoutForm.tipo;

    const min = workoutForm.tipo === 'carrera' ? 40 : (workoutForm.tipo === 'fuerza' ? 50 : 15);
    if (Number(workoutForm.duracion) < min) { setMsg(`Duración mínima: ${min} min.`); return; }

    const ext = workoutForm.file.name.split('.').pop() || 'jpg';
    const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('capturas').upload(path, workoutForm.file, { upsert: false });
    if (up.error) { setMsg('Error al subir captura: ' + up.error.message); return; }

    const r = await supabase.from('workouts').insert({ 
      season_id: season.id, 
      user_id: session.user.id, 
      tipo: finalTipo, 
      fecha: workoutForm.fecha, 
      duracion_minutos: Number(workoutForm.duracion), 
      captura_url: path,
      estado: 'pendiente'
    }).select().single();

    if (r.error) { await supabase.storage.from('capturas').remove([path]); setMsg(r.error.message); return; }

    setWorkoutForm({ ...workoutForm, file: null, tipoPersonalizado: '' });
    setMsg('Entrenamiento enviado.');
    await loadSeason(season, session.user.id);
  }

  async function validateWorkout(w: Workout, status: 'aprobado' | 'rechazado', reason = '') {
    if (w.user_id === session.user.id) {
      setMsg('No puedes validar tu propio entrenamiento. Debe revisarlo otro administrador.');
      return;
    }

    const r = await supabase.from('workouts').update({ 
      estado: status, 
      motivo_rechazo: status === 'rechazado' ? reason : null, 
      validado_por: session.user.id, 
      validado_en: new Date().toISOString() 
    }).eq('id', w.id);
    
    if (r.error) setMsg(r.error.message);
    else { setReject(null); await loadSeason(season!, session.user.id); }
  }

  const isAdmin = !!members.find(m => m.user_id === session?.user?.id && m.rol === 'admin');
  
  const acceptedManualDebts = manualDebts.filter(d => d.estado === 'aceptada');
  const totalManualDebt = acceptedManualDebts.reduce((a, d) => a + Number(d.importe), 0);
  const totalGrupoDeuda = useMemo(() => debts.reduce((a, d) => a + Number(d.importe_pendiente), 0) + totalManualDebt, [debts, totalManualDebt]);

  const myWorkouts = workouts.filter(w => w.user_id === session?.user?.id);
  const pendingWorkouts = workouts.filter(w => w.estado === 'pendiente');
  const totalPendientesAdmin = pendingWorkouts.length + pendingChallenges.length + pendingRevocations.length;

  if (loading) return <div className="center"><div className="spinner" />Cargando…</div>;
  if (!session) return <AuthSection login={login} setLogin={setLogin} email={email} setEmail={setEmail} password={password} setPassword={setPassword} nombre={nombre} setNombre={setNombre} submit={handleAuth} msg={msg} me />;

  return (
    <main className="shell">
      <HeaderView profile={profile} logout={() => supabase.auth.signOut()} />
      <div className="topbar">
        <div>
          <div className="eyebrow">GRUPO</div>
          <h1>{group ? group.nombre : 'Sin grupo'}</h1>
          <div className="muted">{group ? `Invitación: ${group.codigo_invitacion} · ${season?.nombre || 'Sin temporada'}` : 'Crea o únete a un grupo para empezar'}</div>
        </div>
      </div>

      <nav className="tabs">
        {[
          ['inicio', 'Inicio'],
          ['reto', 'Mi reto'],
          ['entreno', 'Entrenamiento'],
          ['deudas', 'Deudas'],
          ['comparativa', 'Comparativas'],
          ['grupo', 'Grupo'],
          ...(isAdmin ? [['admin', `Validar (${totalPendientesAdmin})`]] : [])
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {msg && <NoticeView text={msg} />}

      {tab === 'inicio' && <InicioSection profile={profile!} season={season} challenge={challenge} total={totalGrupoDeuda} myWorkouts={myWorkouts} workouts={workouts} debts={debts} manualDebts={acceptedManualDebts} userId={session.user.id} />}
      
      {tab === 'reto' && (
        <section className="grid2">
          <CardView title="Mi compromiso semanal">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label>
                Días de entrenamiento por semana
                <input 
                  type="number" 
                  min="0" 
                  max="7" 
                  value={diasEntreno} 
                  disabled={!!challenge}
                  onChange={e => setDiasEntreno(Number(e.target.value))} 
                />
              </label>

              <label>
                Importe de penalización por día fallado (€)
                <input 
                  type="number" 
                  step="0.5" 
                  min="0" 
                  value={importeDia} 
                  disabled={!!challenge}
                  onChange={e => setImporteDia(Number(e.target.value))} 
                />
                <small style={{ color: '#888', display: 'block', marginTop: '4px' }}>
                  El importe base es de 5.00 €. Si propones un cambio, requerirá la aprobación de un administrador.
                </small>
              </label>

              {challenge?.estado_importe === 'pendiente_aprobacion' && (
                <div style={{ background: '#332700', color: '#ffcc00', padding: '8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                  ⏳ Propuesta de cambio a {money(challenge.importe_propuesto || 0)}/día pendiente de validación por el Admin.
                </div>
              )}

              <button 
                onClick={saveChallenge}
                disabled={!!challenge}
                style={{
                  opacity: !!challenge ? 0.5 : 1,
                  cursor: !!challenge ? 'not-allowed' : 'pointer'
                }}
              >
                {challenge ? 'Reto activo (No editable)' : 'Guardar reto'}
              </button>
            </div>
          </CardView>
          
          <CardView title="Estado del Reto Actual">
            <p><b>Temporada activa:</b> {season ? season.nombre : 'Ninguna'}</p>
            {season && <p><b>Período:</b> {formatDate(season.fecha_inicio)} al {formatDate(season.fecha_fin)}</p>}
            <p><b>Días fijados:</b> {challenge ? `${challenge.dias_carrera_semana + challenge.dias_fuerza_semana} días/semana` : 'Sin configurar'}</p>
            <p><b>Sanción por día fallado:</b> {money(challenge?.importe_dia || 5)}</p>

            {challenge && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
                {myRevocation ? (
                  <div style={{ background: '#332700', color: '#ffcc00', padding: '10px', borderRadius: '4px', fontSize: '0.85rem' }}>
                    ⏳ <b>Solicitud Pendiente:</b> Has pedido cancelar este reto. Motivo: <em>"{myRevocation.motivo}"</em>.
                  </div>
                ) : (
                  <button className="danger" onClick={() => setMostrarModalRevocacion(true)}>
                    Solicitar Revocación / Cancelar Reto
                  </button>
                )}
              </div>
            )}
          </CardView>

          {mostrarModalRevocacion && (
            <div className="modal">
              <div className="modalbox">
                <h2>Solicitar Revocación de Reto</h2>
                <p style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '1rem' }}>
                  Indica al administrador el motivo por el cual necesitas cancelar tu reto actual.
                </p>
                <form onSubmit={solicitarRevocacion}>
                  <textarea
                    value={motivoRevocacion}
                    onChange={e => setMotivoRevocacion(e.target.value)}
                    placeholder="Ejemplo: Lesión muscular, motivo personal..."
                    rows={4}
                    required
                    style={{ width: '100%', padding: '8px', marginBottom: '1rem' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button type="button" className="ghost" onClick={() => setMostrarModalRevocacion(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="danger">
                      Enviar Solicitud
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'entreno' && <EntrenosSection form={workoutForm} setForm={setWorkoutForm} upload={uploadWorkout} workouts={myWorkouts} onDelete={deleteWorkout} />}
      
      {tab === 'deudas' && (
        <DeudasSection 
          debts={debts} 
          manualDebts={manualDebts}
          members={members} 
          total={totalGrupoDeuda} 
          isAdmin={isAdmin} 
          currentUserId={session.user.id} 
          onCreateManualDebt={crearDeudaManual}
          onRespondManualDebt={responderDeudaManual}
        />
      )}
      
      {tab === 'comparativa' && <ComparativasSection season={season} members={members} workouts={allGroupWorkouts} currentSeasonWorkouts={workouts} />}

      {tab === 'grupo' && (
        <GrupoSection 
          group={group!} 
          members={members} 
          isAdmin={isAdmin} 
          promoteAdmin={promoteAdmin} 
          nuevoNombreGrupo={nuevoNombreGrupo}
          setNuevoNombreGrupo={setNuevoNombreGrupo}
          crearGrupo={crearGrupo}
          codigoUnirse={codigoUnirse}
          setCodigoUnirse={setCodigoUnirse}
          unirseGrupo={unirseGrupo}
        />
      )}
      
      {tab === 'admin' && isAdmin && (
        <AdminSection 
          workouts={pendingWorkouts} 
          pendingChallenges={pendingChallenges}
          pendingRevocations={pendingRevocations}
          validate={validateWorkout} 
          reject={reject} 
          setReject={setReject} 
          onDelete={deleteWorkout} 
          responderPropuesta={responderPropuestaImporte}
          responderRevocacion={responderSolicitudRevocacion}
          currentUserId={session.user.id}
        />
      )}
    </main>
  );
}

// ---------------- SUB-COMPONENTES ----------------

function InicioSection({ profile, season, challenge, total, myWorkouts, workouts, debts, manualDebts, userId }: any) {
  const currentMonday = getMondayOfCurrentWeek();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const approvedThisWeek = myWorkouts.filter((w: Workout) => w.estado === 'aprobado' && w.fecha >= currentMonday).length;
  const targetDays = challenge ? (challenge.dias_carrera_semana + challenge.dias_fuerza_semana) : 0;
  const pendingThisWeek = Math.max(0, targetDays - approvedThisWeek);
  const pendingGroupTotal = workouts.filter((w: Workout) => w.estado === 'pendiente').length;

  const myDebts = debts.filter((d: Debt) => d.user_id === userId);
  const myManualDebts = manualDebts.filter((d: ManualDebt) => d.user_id === userId && d.estado === 'aceptada');
  const myDynamicDebt = myDebts.reduce((acc: number, d: Debt) => acc + Number(d.importe_pendiente), 0);
  const myManualDebtTotal = myManualDebts.reduce((acc: number, d: ManualDebt) => acc + Number(d.importe), 0);
  const myTotalDebt = myDynamicDebt + myManualDebtTotal;

  const failedWorkoutsCount = myDebts.reduce((acc: number, d: Debt) => acc + Number(d.dias_totales_fallados || 0), 0);

  const totalThisMonth = myWorkouts.filter((w: Workout) => {
    if (w.estado !== 'aprobado') return false;
    const d = new Date(w.fecha + 'T00:00:00');
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).length;

  const totalAllTime = myWorkouts.filter((w: Workout) => w.estado === 'aprobado').length;

  const importePorDia = challenge ? Number(challenge.importe_dia || 5) : 5;
  const pendingMoneyEquivalent = pendingThisWeek * importePorDia;

  return (
    <>
      <section className="hero compact" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span className="eyebrow">HOLA, {profile?.nombre?.toUpperCase()}</span>
          <h1>{season ? season.nombre : 'Configura tu temporada'}</h1>
          <p>{challenge ? `${targetDays} días de entrenamiento a la semana (${money(challenge.importe_dia || 5)}/día fallado).` : 'Todavía no has configurado tu reto.'}</p>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          <div className="debtBig">
            <span>Tu deuda</span>
            <strong style={{ color: myTotalDebt === 0 ? '#28a745' : '#ff6b6b' }}>{money(myTotalDebt)}</strong>
          </div>
          <div className="debtBig" style={{ borderLeft: '1px solid #444', paddingLeft: '1.5rem' }}>
            <span>Deuda global</span>
            <strong style={{ color: total === 0 ? '#28a745' : '#ff6b6b' }}>{money(total)}</strong>
          </div>
        </div>
      </section>

      <div className="stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        <StatView n={approvedThisWeek} t="Aprobados esta semana" bg="#d4edda" color="#155724" />
        <StatView n={`${pendingThisWeek} (${money(pendingMoneyEquivalent)})`} t="Restantes esta semana" bg="#fff3cd" color="#856404" />
        <StatView n={pendingGroupTotal} t="Pendientes de validación" bg="#cce5ff" color="#004085" />
        <StatView n={`${failedWorkoutsCount} (${money(myTotalDebt)})`} t="Entrenamientos fallidos" bg="#f8d7da" color="#721c24" />
        <StatView n={totalThisMonth} t="Totales este mes" bg="#e2e3e5" color="#383d41" />
        <StatView n={totalAllTime} t="Totales históricos" bg="#e2e3e5" color="#383d41" />
      </div>
    </>
  );
}

function StatView({ n, t, bg, color }: { n: any; t: string; bg?: string; color?: string }) {
  return (
    <div className="stat" style={{ padding: '1rem', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', backgroundColor: bg || '#222', color: color || '#fff' }}>
      <strong style={{ fontSize: '1.8rem', display: 'block' }}>{n}</strong>
      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{t}</span>
    </div>
  );
}

function ComparativasSection({ season, members, workouts, currentSeasonWorkouts }: any) {
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(getMondayOfCurrentWeek());

  const seasonWeeks = useMemo(() => {
    if (!season) return [];
    const weeks: { label: string; start: string; end: string }[] = [];
    let current = new Date(season.fecha_inicio + 'T00:00:00');
    const endDate = new Date(season.fecha_fin + 'T00:00:00');

    while (current <= endDate) {
      const startStr = current.toISOString().split('T')[0];
      const endTemp = new Date(current);
      endTemp.setDate(endTemp.getDate() + 6);
      const endStr = endTemp.toISOString().split('T')[0];

      weeks.push({
        label: `Semana del ${formatDate(startStr)} al ${formatDate(endStr)}`,
        start: startStr,
        end: endStr
      });

      current.setDate(current.getDate() + 7);
    }
    return weeks;
  }, [season]);

  const chartData = useMemo(() => {
    const months: Record<string, any> = {};
    workouts.forEach((w: Workout) => {
      const date = new Date(w.fecha);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!months[monthKey]) {
        months[monthKey] = { month: monthKey };
        members.forEach((m: Member) => { months[monthKey][m.profile?.nombre || 'Desconocido'] = 0; });
      }
      const userName = w.profile?.nombre || 'Desconocido';
      months[monthKey][userName] = (months[monthKey][userName] || 0) + 1;
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [workouts, members]);

  const weeklyData = useMemo(() => {
    const activeWeek = seasonWeeks.find(w => w.start === selectedWeekStart) || { start: selectedWeekStart, end: selectedWeekStart };
    
    return members.map((m: Member) => {
      const userWorkouts = currentSeasonWorkouts.filter((w: Workout) => 
        w.user_id === m.user_id && 
        w.estado === 'aprobado' && 
        w.fecha >= activeWeek.start && 
        w.fecha <= activeWeek.end
      );

      const daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
      const attendance = daysOfWeek.map((dayIdx) => {
        return userWorkouts.some((w: Workout) => {
          const d = new Date(w.fecha + 'T00:00:00');
          const day = d.getDay();
          const adjustedDay = day === 0 ? 6 : day - 1;
          return adjustedDay === dayIdx;
        });
      });
      return { name: m.profile?.nombre, attendance };
    });
  }, [members, currentSeasonWorkouts, selectedWeekStart, seasonWeeks]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <CardView title="Evolución Mensual de Entrenamientos">
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              {members.map((m: Member, idx: number) => (
                <Line key={m.user_id} type="monotone" dataKey={m.profile?.nombre || 'Usuario'} stroke={`hsl(${idx * 137.5 % 360}, 70%, 50%)`} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardView>

      <CardView title="Asistencia Semanal por Día">
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Seleccionar Semana:</label>
          <select value={selectedWeekStart} onChange={e => setSelectedWeekStart(e.target.value)} style={{ width: '100%', padding: '8px' }}>
            {seasonWeeks.map(w => (
              <option key={w.start} value={w.start}>{w.label}</option>
            ))}
          </select>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Miembro</th>
              <th>L</th><th>M</th><th>X</th><th>J</th><th>V</th><th>S</th><th>D</th>
            </tr>
          </thead>
          <tbody>
            {weeklyData.map((row: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #333' }}>
                <td style={{ textAlign: 'left', padding: '8px 0' }}><b>{row.name}</b></td>
                {row.attendance.map((done: boolean, idx: number) => (
                  <td key={idx}>{done ? '✅' : '❌'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardView>
    </section>
  );
}

function GrupoSection({ group, members, isAdmin, promoteAdmin, nuevoNombreGrupo, setNuevoNombreGrupo, crearGrupo, codigoUnirse, setCodigoUnirse, unirseGrupo }: any) {
  return (
    <section className="grid2">
      {group ? (
        <CardView title="Tu grupo actual">
          <h3 style={{ margin: '0 0 10px 0' }}>{group.nombre}</h3>
          <p className="code">{group.codigo_invitacion}</p>
          <p className="muted">Código de invitación al grupo.</p>
        </CardView>
      ) : (
        <CardView title="Crear o unirse a un grupo">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h4>Crear grupo</h4>
              <input 
                type="text" 
                placeholder="Nombre del nuevo grupo" 
                value={nuevoNombreGrupo} 
                onChange={e => setNuevoNombreGrupo(e.target.value)} 
                style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
              />
              <button onClick={crearGrupo}>Crear grupo</button>
            </div>
            <hr style={{ border: '0.5px solid #333', margin: '8px 0' }} />
            <div>
              <h4>Unirme con código</h4>
              <input 
                type="text" 
                placeholder="Código de 6 caracteres" 
                value={codigoUnirse} 
                onChange={e => setCodigoUnirse(e.target.value)} 
                style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
              />
              <button onClick={unirseGrupo}>Unirme al grupo</button>
            </div>
          </div>
        </CardView>
      )}

      <CardView title="Miembros y Roles">
        <div className="list">
          {members.length ? members.map((m: Member) => (
            <div className="row" key={m.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
              <span>👤 {m.profile?.nombre} <b>({m.rol})</b></span>
              {isAdmin && m.rol !== 'admin' && (
                <button className="ghost" onClick={() => promoteAdmin(m.user_id)}>Hacer Admin</button>
              )}
            </div>
          )) : <p className="muted">No perteneces a ningún grupo activo.</p>}
        </div>
      </CardView>
    </section>
  );
}

function EntrenosSection({ form, setForm, upload, workouts, onDelete }: any) {
  const getIcon = (tipo: string) => {
    const t = tipo.toLowerCase();
    if (t.includes('carrera')) return '🏃';
    if (t.includes('fuerza')) return '💪';
    return '🏋️';
  };

  return (
    <section className="grid2">
      <CardView title="Subir entrenamiento">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Tipo de entrenamiento</label>
            <select 
              value={form.tipo} 
              onChange={e => {
                const val = e.target.value;
                setForm({ 
                  ...form, 
                  tipo: val, 
                  duracion: val === 'carrera' ? 40 : (val === 'fuerza' ? 50 : 30) 
                });
              }}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="carrera">🏃 Carrera</option>
              <option value="fuerza">💪 Fuerza</option>
              <option value="personalizado">✏️ Otro / Personalizado...</option>
            </select>
          </div>

          {form.tipo === 'personalizado' && (
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Escribe tu tipo de entrenamiento</label>
              <input 
                type="text" 
                placeholder="Ej. Body Combat, Pádel, Natación..." 
                value={form.tipoPersonalizado} 
                onChange={e => setForm({ ...form, tipoPersonalizado: e.target.value })} 
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Fecha</label>
            <input 
              type="date" 
              value={form.fecha} 
              onChange={e => setForm({ ...form, fecha: e.target.value })} 
              style={{ width: '100%', padding: '8px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Duración (minutos)</label>
            <input 
              type="number" 
              placeholder="Duración en minutos" 
              min={form.tipo === 'carrera' ? 40 : (form.tipo === 'fuerza' ? 50 : 15)} 
              value={form.duracion} 
              onChange={e => setForm({ ...form, duracion: Number(e.target.value) })} 
              style={{ width: '100%', padding: '8px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Captura / Comprobante</label>
            <label className="file" style={{ display: 'block', cursor: 'pointer', padding: '8px', border: '1px dashed #666', textAlign: 'center', borderRadius: '4px' }}>
              {form.file ? form.file.name : 'Elegir captura'}
              <input type="file" accept="image/*" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} style={{ display: 'none' }} />
            </label>
          </div>

          <button onClick={upload} style={{ marginTop: '0.5rem' }}>Enviar para validar</button>
        </div>
      </CardView>

      <CardView title="Mis entrenamientos">
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => (
            <div className="row" key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', padding: '8px 0', borderBottom: '1px solid #333' }}>
              <div>
                <b>{getIcon(w.tipo)} {w.tipo.toUpperCase()} - {w.duracion_minutos} min</b>
                <div>
                  <small>{formatDate(w.fecha)}</small>
                  <span className={'status ' + w.estado} style={{ marginLeft: '8px' }}>{w.estado}</span>
                </div>
              </div>
              <button className="danger" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => onDelete(w)}>Eliminar</button>
            </div>
          )) : <p className="muted">Aún no has subido entrenamientos.</p>}
        </div>
      </CardView>
    </section>
  );
}

function DeudasSection({ debts, manualDebts, members, total, isAdmin, currentUserId, onCreateManualDebt, onRespondManualDebt }: any) {
  const [targetUserId, setTargetUserId] = useState(members[0]?.user_id || '');
  const [importeManual, setImporteManual] = useState(5);
  const [conceptoManual, setConceptoManual] = useState('');

  const myPendingManualDebts = manualDebts.filter((d: ManualDebt) => d.user_id === currentUserId && d.estado === 'pendiente');

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateManualDebt(targetUserId, importeManual, conceptoManual);
    setConceptoManual('');
    setImporteManual(5);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="hero compact">
        <div className="debtBig">
          <span>Deuda Global del Grupo</span>
          <strong style={{ color: total === 0 ? '#28a745' : '#ff6b6b' }}>{money(total)}</strong>
        </div>
      </div>

      {myPendingManualDebts.length > 0 && (
        <CardView title="🔔 Deudas manuales pendientes de tu aprobación">
          <div className="list">
            {myPendingManualDebts.map((d: ManualDebt) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #333' }}>
                <div>
                  <b>{money(d.importe)}</b> - {d.concepto}
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>Añadida por un administrador</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => onRespondManualDebt(d.id, true)}>Aceptar</button>
                  <button className="danger" onClick={() => onRespondManualDebt(d.id, false)}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </CardView>
      )}

      {isAdmin && (
        <CardView title="Introducir deuda previa manual (Admin)">
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label>
              Seleccionar miembro
              <select value={targetUserId} onChange={e => setTargetUserId(e.target.value)} style={{ width: '100%', padding: '8px', marginTop: '4px' }}>
                {members.map((m: Member) => (
                  <option key={m.user_id} value={m.user_id}>{m.profile?.nombre || 'Usuario'}</option>
                ))}
              </select>
            </label>
            <label>
              Importe (€)
              <input type="number" step="0.5" min="0.5" value={importeManual} onChange={e => setImporteManual(Number(e.target.value))} style={{ width: '100%', padding: '8px', marginTop: '4px' }} required />
            </label>
            <label>
              Concepto o motivo
              <input type="text" placeholder="Ej. Deuda acumulada temporada anterior" value={conceptoManual} onChange={e => setConceptoManual(e.target.value)} style={{ width: '100%', padding: '8px', marginTop: '4px' }} required />
            </label>
            <button type="submit">Enviar deuda al miembro</button>
          </form>
        </CardView>
      )}

      <CardView title="Desglose por participantes">
        <div className="debtList">
          {debts.length || manualDebts.filter((d: ManualDebt) => d.estado === 'aceptada').length ? (
            <>
              {debts.map((d: Debt) => (
                <div className="debtrow" key={`${d.user_id}-${d.semana_inicio}`}>
                  <span>
                    <b>{members.find((m: Member) => m.user_id === d.user_id)?.profile?.nombre || 'Usuario'}</b>
                    <small>Semana del {formatDate(d.semana_inicio)} · {d.dias_totales_fallados} días no cumplidos</small>
                  </span>
                  <strong style={{ color: Number(d.importe_pendiente) === 0 ? '#28a745' : '#ff6b6b' }}>{money(d.importe_pendiente)}</strong>
                </div>
              ))}
              {manualDebts.filter((d: ManualDebt) => d.estado === 'aceptada').map((d: ManualDebt) => (
                <div className="debtrow" key={`manual-${d.id}`}>
                  <span>
                    <b>{d.profile?.nombre || 'Usuario'}</b>
                    <small>Deuda previa manual · <em>"{d.concepto}"</em></small>
                  </span>
                  <strong style={{ color: Number(d.importe) === 0 ? '#28a745' : '#ff6b6b' }}>{money(d.importe)}</strong>
                </div>
              ))}
            </>
          ) : <p className="muted">Sin deudas acumuladas. 🎉</p>}
        </div>
      </CardView>
    </section>
  );
}

function AdminSection({ workouts, pendingChallenges, pendingRevocations, validate, reject, setReject, onDelete, responderPropuesta, responderRevocacion, currentUserId }: any) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <CardView title={`Solicitudes de Cancelación/Revocación (${pendingRevocations?.length || 0})`}>
        <div className="list">
          {pendingRevocations?.length ? pendingRevocations.map((sol: SolicitudRevocacion) => (
            <div key={sol.id} style={{ borderBottom: '1px solid #333', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{sol.profile?.nombre || 'Usuario'}</b>
                <div><small>Motivo: <em>"{sol.motivo}"</em></small></div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => responderRevocacion(sol, true)}>Aprobar cancelación</button>
                <button className="danger" onClick={() => responderRevocacion(sol, false)}>Rechazar</button>
              </div>
            </div>
          )) : <p className="muted">No hay solicitudes de cancelación pendientes.</p>}
        </div>
      </CardView>

      <CardView title={`Propuestas de cambio de importe (${pendingChallenges.length})`}>
        <div className="list">
          {pendingChallenges.length ? pendingChallenges.map((c: Challenge) => (
            <div key={c.id} style={{ borderBottom: '1px solid #333', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{c.profile?.nombre}</b>
                <div><small>Importe actual: {money(c.importe_dia || 5)} ➔ <b>Propuesto: {money(c.importe_propuesto || 0)}/día</b></small></div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => responderPropuesta(c, true)}>Aprobar cambio</button>
                <button className="danger" onClick={() => responderPropuesta(c, false)}>Rechazar</button>
              </div>
            </div>
          )) : <p className="muted">No hay solicitudes de cambios de importe pendientes.</p>}
        </div>
      </CardView>

      <CardView title={`Entrenamientos pendientes de validación (${workouts.length})`}>
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => {
            const isOwnWorkout = w.user_id === currentUserId;
            return (
              <div className="adminrow" key={w.id} style={{ borderBottom: '1px solid #333', padding: '10px 0' }}>
                <div>
                  <b>{w.profile?.nombre} {isOwnWorkout && '(Tuyo)'}</b>
                  <div><small>{w.tipo.toUpperCase()} · {w.duracion_minutos} min · {formatDate(w.fecha)}</small></div>
                  <button 
                    className="ghost"
                    style={{ fontSize: '0.85rem', padding: '4px 8px', marginTop: '6px', cursor: 'pointer' }}
                    onClick={async () => {
                      try {
                        const publicUrl = supabase.storage.from('capturas').getPublicUrl(w.captura_url).data.publicUrl;
                        const { data } = await supabase.storage.from('capturas').createSignedUrl(w.captura_url, 600);
                        const targetUrl = data?.signedUrl || publicUrl;
                        if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');
                      } catch (err) {
                        console.error('Error al abrir la imagen:', err);
                      }
                    }}
                  >
                    🔍 Ver comprobante adjunto
                  </button>
                </div>
                <div className="actions" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  {isOwnWorkout ? (
                    <span style={{ fontSize: '0.80rem', color: '#ffcc00', alignSelf: 'center' }}>
                      ⏳ Esperando a otro admin
                    </span>
                  ) : (
                    <>
                      <button onClick={() => validate(w, 'aprobado')}>Aprobar</button>
                      <button className="danger" onClick={() => setReject({ id: w.id, reason: '' })}>Rechazar</button>
                    </>
                  )}
                  <button className="ghost" onClick={() => onDelete(w)}>Eliminar</button>
                </div>
              </div>
            );
          }) : <p className="muted">No hay publicaciones pendientes de revisión.</p>}
        </div>
      </CardView>

      {reject && (
        <div className="modal">
          <div className="modalbox">
            <h2>Motivo del rechazo</h2>
            <textarea value={reject.reason} onChange={e => setReject({ ...reject, reason: e.target.value })} placeholder="Escribe el motivo…" />
            <button onClick={() => validate(workouts.find((w: Workout) => w.id === reject.id)!, 'rechazado', reject.reason || 'No válido')}>Confirmar rechazo</button>
            <button className="ghost" onClick={() => setReject(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function HeaderView({ profile, logout }: any) {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem' }}>
      <div className="brand">🏃 <span>Retos</span></div>
      <div className="user">{profile?.nombre} <button className="ghost" onClick={logout}>Salir</button></div>
    </header>
  );
}

function AuthSection(p: any) {
  return (
    <main className="auth">
      <div className="authbox">
        <h1>{p.login ? 'Bienvenido' : 'Crea tu cuenta'}</h1>
        {!p.login && <input placeholder="Tu nombre" value={p.nombre} onChange={e => p.setNombre(e.target.value)} />}
        <input type="email" placeholder="Email" value={p.email} onChange={e => p.setEmail(e.target.value)} />
        <input type="password" placeholder="Contraseña" value={p.password} onChange={e => p.setPassword(e.target.value)} />
        <button onClick={p.submit}>{p.login ? 'Entrar' : 'Registrarme'}</button>
        <button className="link" onClick={() => p.setLogin(!p.login)}>{p.login ? 'Crear una cuenta' : 'Ya tengo cuenta'}</button>
      </div>
    </main>
  );
}

function CardView({ title, children }: any) {
  return <div className="card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid #333' }}><h2>{title}</h2>{children}</div>;
}

function NoticeView({ text }: { text: string }) {
  return <div className="notice" style={{ padding: '0.5rem', background: '#333', borderRadius: '4px', margin: '0.5rem 0' }}>{text}</div>;
}
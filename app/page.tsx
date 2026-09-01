'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

type Profile = { id: string; nombre: string; avatar_url: string | null };
type Group = { id: string; nombre: string; codigo_invitacion: string; created_by: string };
type Member = { group_id: string; user_id: string; rol: 'miembro' | 'admin'; profile?: Profile };
type Season = { id: string; group_id: string; nombre: string; fecha_inicio: string; fecha_fin: string };
type Challenge = { id: string; season_id: string; user_id: string; dias_carrera_semana: number; dias_fuerza_semana: number };
type Workout = { id: string; season_id: string; user_id: string; tipo: 'carrera' | 'fuerza'; fecha: string; duracion_minutos: number; captura_url: string; estado: 'pendiente' | 'aprobado' | 'rechazado'; motivo_rechazo: string | null; profile?: Profile };
type Debt = { season_id: string; user_id: string; semana_inicio: string; importe_deuda: number; importe_saldado: number; importe_pendiente: number; dias_totales_fallados: number };

const supabase = createClient();
const money = (n: number) => `${Number(n || 0).toFixed(2)} €`;
const formatDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Obtener el lunes de la semana actual en formato YYYY-MM-DD local
const getMondayOfCurrentWeek = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
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

  const [diasEntreno, setDiasEntreno] = useState(0);
  const [workoutForm, setWorkoutForm] = useState({ tipo: 'carrera' as 'carrera' | 'fuerza', fecha: new Date().toISOString().slice(0, 10), duracion: 40, file: null as File | null });
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

    if (s) await loadSeason(s, currentUserId, memberList);
    else { setChallenge(null); setWorkouts([]); setDebts([]); }
  }

  async function loadSeason(s: Season, currentUserId: string, currentMembers = members) {
    const uid = currentUserId || session?.user?.id;
    if (!uid) return;

    const c = await supabase.from('challenges').select('*').eq('season_id', s.id).eq('user_id', uid).maybeSingle();
    setChallenge(c.data);
    if (c.data) setDiasEntreno(c.data.dias_carrera_semana + c.data.dias_fuerza_semana);
    
    const w = await supabase.from('workouts').select('*').eq('season_id', s.id).order('fecha', { ascending: false });
    setWorkouts((w.data || []).map((x: any) => ({ ...x, profile: currentMembers.find(m => m.user_id === x.user_id)?.profile })));
    
    const currentMonday = getMondayOfCurrentWeek();
    const d = await supabase.from('v_deuda_pendiente')
      .select('*')
      .eq('season_id', s.id)
      .lt('semana_inicio', currentMonday)
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
    
    try {
      if (workout.captura_url) {
        await supabase.storage.from('capturas').remove([workout.captura_url]);
      }
      const r = await supabase.from('workouts').delete().eq('id', workout.id);
      if (r.error) {
        setMsg(r.error.message);
      } else {
        setMsg('Entrenamiento eliminado correctamente.');
        if (season) await loadSeason(season, session.user.id);
      }
    } catch (e: any) {
      setMsg('Error al eliminar: ' + e.message);
    }
  }

  async function saveChallenge() {
    if (!season) { setMsg('Crea primero una temporada.'); return; }
    const r = await supabase.from('challenges').upsert({ 
      season_id: season.id, 
      user_id: session.user.id, 
      dias_carrera_semana: Number(diasEntreno), 
      dias_fuerza_semana: 0 
    }, { onConflict: 'season_id,user_id' }).select().single();
    if (r.error) setMsg(r.error.message);
    else { setChallenge(r.data); setMsg('Reto guardado.'); }
  }

  async function uploadWorkout() {
    setMsg('');
    if (!season) { setMsg('No hay una temporada activa.'); return; }
    if (!workoutForm.file) { setMsg('Debes adjuntar una captura.'); return; }
    const min = workoutForm.tipo === 'carrera' ? 40 : 50;
    if (Number(workoutForm.duracion) < min) { setMsg(`Duración mínima: ${min} min.`); return; }

    const ext = workoutForm.file.name.split('.').pop() || 'jpg';
    const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('capturas').upload(path, workoutForm.file, { upsert: false });
    if (up.error) { setMsg('Error al subir captura: ' + up.error.message); return; }

    const r = await supabase.from('workouts').insert({ 
      season_id: season.id, 
      user_id: session.user.id, 
      tipo: workoutForm.tipo, 
      fecha: workoutForm.fecha, 
      duracion_minutos: Number(workoutForm.duracion), 
      captura_url: path,
      estado: 'pendiente'
    }).select().single();

    if (r.error) { await supabase.storage.from('capturas').remove([path]); setMsg(r.error.message); return; }

    setWorkoutForm({ ...workoutForm, file: null });
    setMsg('Entrenamiento enviado.');
    await loadSeason(season, session.user.id);
  }

  async function validateWorkout(w: Workout, status: 'aprobado' | 'rechazado', reason = '') {
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
  const totalGrupoDeuda = useMemo(() => debts.reduce((a, d) => a + Number(d.importe_pendiente), 0), [debts]);
  const myWorkouts = workouts.filter(w => w.user_id === session?.user?.id);
  const pendingWorkouts = workouts.filter(w => w.estado === 'pendiente');

  if (loading) return <div className="center"><div className="spinner" />Cargando…</div>;
  if (!session) return <AuthSection login={login} setLogin={setLogin} email={email} setEmail={setEmail} password={password} setPassword={setPassword} nombre={nombre} setNombre={setNombre} submit={handleAuth} msg={msg} me />;

  return (
    <main className="shell">
      <HeaderView profile={profile} logout={() => supabase.auth.signOut()} />
      <div className="topbar">
        <div>
          <div className="eyebrow">GRUPO</div>
          <h1>{group?.nombre}</h1>
          <div className="muted">Invitación: <b>{group?.codigo_invitacion}</b> · {season?.nombre || 'Sin temporada'}</div>
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
          ...(isAdmin ? [['admin', `Validar (${pendingWorkouts.length})`]] : [])
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {msg && <NoticeView text={msg} />}

      {tab === 'inicio' && <InicioSection profile={profile!} season={season} challenge={challenge} total={totalGrupoDeuda} myWorkouts={myWorkouts} workouts={workouts} />}
      
      {tab === 'reto' && (
        <section className="grid2">
          <CardView title="Mi compromiso semanal">
            <label>
              Días de entrenamiento por semana
              <input type="number" min="0" max="7" value={diasEntreno} onChange={e => setDiasEntreno(Number(e.target.value))} />
            </label>
            <button onClick={saveChallenge}>Guardar reto</button>
          </CardView>
          <CardView title="Estado del Reto Actual">
            <p><b>Temporada activa:</b> {season ? season.nombre : 'Ninguna'}</p>
            {season && <p><b>Período:</b> {formatDate(season.fecha_inicio)} al {formatDate(season.fecha_fin)}</p>}
            <p><b>Días fijados:</b> {challenge ? `${challenge.dias_carrera_semana + challenge.dias_fuerza_semana} días/semana` : 'Sin configurar'}</p>
          </CardView>
        </section>
      )}

      {tab === 'entreno' && <EntrenosSection form={workoutForm} setForm={setWorkoutForm} upload={uploadWorkout} workouts={myWorkouts} onDelete={deleteWorkout} />}
      
      {tab === 'deudas' && <DeudasSection debts={debts} members={members} total={totalGrupoDeuda} />}
      
      {tab === 'comparativa' && <ComparativasSection season={season} members={members} workouts={allGroupWorkouts} currentSeasonWorkouts={workouts} />}

      {tab === 'grupo' && <GrupoSection group={group!} members={members} isAdmin={isAdmin} promoteAdmin={promoteAdmin} />}
      
      {tab === 'admin' && isAdmin && <AdminSection workouts={pendingWorkouts} validate={validateWorkout} reject={reject} setReject={setReject} onDelete={deleteWorkout} />}
    </main>
  );
}

// ---------------- SUB-COMPONENTES ----------------

function InicioSection({ profile, season, challenge, total, myWorkouts, workouts }: any) {
  const currentMonday = getMondayOfCurrentWeek();
  const currentMonthStr = new Date().toISOString().slice(0, 7);

  // 1. Entrenamientos aprobados esta semana
  const approvedThisWeek = myWorkouts.filter((w: Workout) => w.estado === 'aprobado' && w.fecha >= currentMonday).length;
  
  // 2. Entrenamientos pendientes por cumplir esta semana (Reto objetivo - aprobados)
  const targetDays = challenge ? (challenge.dias_carrera_semana + challenge.dias_fuerza_semana) : 0;
  const pendingThisWeek = Math.max(0, targetDays - approvedThisWeek);
  
  // 3. Entrenamientos pendientes de validación en el grupo
  const pendingGroupTotal = workouts.filter((w: Workout) => w.estado === 'pendiente').length;

  // 4. Entrenamientos del mes actual
  const totalThisMonth = myWorkouts.filter((w: Workout) => w.estado === 'aprobado' && w.fecha.startsWith(currentMonthStr)).length;

  // 5. Entrenamientos totales aprobados
  const totalAllTime = myWorkouts.filter((w: Workout) => w.estado === 'aprobado').length;

  return (
    <>
      <section className="hero compact">
        <div>
          <span className="eyebrow">HOLA, {profile?.nombre?.toUpperCase()}</span>
          <h1>{season ? season.nombre : 'Configura tu temporada'}</h1>
          <p>{challenge ? `${targetDays} días de entrenamiento a la semana.` : 'Todavía no has configurado tu reto.'}</p>
        </div>
        <div className="debtBig"><span>Deuda global</span><strong>{money(total)}</strong></div>
      </section>

      <div className="stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        <StatView n={approvedThisWeek} t="Aprobados esta semana" />
        <StatView n={pendingThisWeek} t="Te faltan esta semana" />
        <StatView n={pendingGroupTotal} t="Pendientes de validación" />
        <StatView n={totalThisMonth} t="Totales este mes" />
        <StatView n={totalAllTime} t="Totales históricos" />
      </div>
    </>
  );
}

function StatView({ n, t }: { n: any; t: string }) {
  return <div className="stat" style={{ padding: '1rem', border: '1px solid #333', borderRadius: '8px' }}><strong>{n}</strong><span>{t}</span></div>;
}

function ComparativasSection({ season, members, workouts, currentSeasonWorkouts }: any) {
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(getMondayOfCurrentWeek());

  // Generar lista de semanas de la temporada activa
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

      const daysOfWeek = [0, 1, 2, 3, 4, 5, 6]; // L, M, X, J, V, S, D
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

function GrupoSection({ group, members, isAdmin, promoteAdmin }: any) {
  return (
    <section className="grid2">
      <CardView title="Tu grupo">
        <p className="code">{group.codigo_invitacion}</p>
        <p className="muted">Código de invitación al grupo.</p>
      </CardView>
      <CardView title="Miembros y Roles">
        <div className="list">
          {members.map((m: Member) => (
            <div className="row" key={m.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
              <span>👤 {m.profile?.nombre} <b>({m.rol})</b></span>
              {isAdmin && m.rol !== 'admin' && (
                <button className="ghost" onClick={() => promoteAdmin(m.user_id)}>Hacer Admin</button>
              )}
            </div>
          ))}
        </div>
      </CardView>
    </section>
  );
}

function EntrenosSection({ form, setForm, upload, workouts, onDelete }: any) {
  return (
    <section className="grid2">
      <CardView title="Subir entrenamiento">
        <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as any, duracion: e.target.value === 'carrera' ? 40 : 50 })}>
          <option value="carrera">🏃 Carrera</option>
          <option value="fuerza">💪 Fuerza</option>
        </select>
        <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
        <input type="number" min={form.tipo === 'carrera' ? 40 : 50} value={form.duracion} onChange={e => setForm({ ...form, duracion: Number(e.target.value) })} />
        <label className="file">{form.file ? form.file.name : 'Elegir captura'}<input type="file" accept="image/*" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} /></label>
        <button onClick={upload}>Enviar para validar</button>
      </CardView>
      <CardView title="Mis entrenamientos">
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => (
            <div className="row" key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div>
                <b>{w.tipo === 'carrera' ? '🏃' : '💪'} {w.duracion_minutos} min</b>
                <small style={{ marginLeft: '8px' }}>{formatDate(w.fecha)}</small>
                <span className={'status ' + w.estado} style={{ marginLeft: '8px' }}>{w.estado}</span>
              </div>
              <button className="danger" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => onDelete(w)}>Eliminar</button>
            </div>
          )) : <p className="muted">Aún no has subido entrenamientos.</p>}
        </div>
      </CardView>
    </section>
  );
}

function DeudasSection({ debts, members, total }: any) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="hero compact">
        <div className="debtBig">
          <span>Deuda Global del Grupo</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
      <CardView title="Desglose por participantes">
        <div className="debtList">
          {debts.length ? debts.map((d: Debt) => (
            <div className="debtrow" key={`${d.user_id}-${d.semana_inicio}`}>
              <span>
                <b>{members.find((m: Member) => m.user_id === d.user_id)?.profile?.nombre || 'Usuario'}</b>
                <small>Semana del {formatDate(d.semana_inicio)} · {d.dias_totales_fallados} días no cumplidos</small>
              </span>
              <strong>{money(d.importe_pendiente)}</strong>
            </div>
          )) : <p className="muted">Sin deudas acumuladas de semanas anteriores. 🎉</p>}
        </div>
      </CardView>
    </section>
  );
}

function AdminSection({ workouts, validate, reject, setReject, onDelete }: any) {
  return (
    <section>
      <CardView title={`Entrenamientos pendientes de validación (${workouts.length})`}>
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => (
            <div className="adminrow" key={w.id} style={{ borderBottom: '1px solid #333', padding: '10px 0' }}>
              <div>
                <b>{w.profile?.nombre}</b>
                <div><small>{w.tipo === 'carrera' ? '🏃 Carrera' : '💪 Fuerza'} · {w.duracion_minutos} min · {formatDate(w.fecha)}</small></div>
                <a 
                  href="#" 
                  onClick={async e => { 
                    e.preventDefault(); 
                    const { data } = await supabase.storage.from('capturas').createSignedUrl(w.captura_url, 600); 
                    if (data?.signedUrl) window.open(data.signedUrl, '_blank'); 
                  }}
                  style={{ color: '#0070f3', textDecoration: 'underline' }}
                >
                  🔍 Ver comprobante adjunto
                </a>
              </div>
              <div className="actions" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                <button onClick={() => validate(w, 'aprobado')}>Aprobar</button>
                <button className="danger" onClick={() => setReject({ id: w.id, reason: '' })}>Rechazar</button>
                <button className="ghost" onClick={() => onDelete(w)}>Eliminar</button>
              </div>
            </div>
          )) : <p className="muted">No hay publicaciones pendientes de revisión.</p>}
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
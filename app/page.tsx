'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  const [debts, setDebts] = useState<Debt[]>([]);
  const [tab, setTab] = useState('inicio');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [login, setLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');

  const [newGroup, setNewGroup] = useState('');
  const [invite, setInvite] = useState('');
  const [seasonForm, setSeasonForm] = useState({ nombre: 'Q3 2026', inicio: '2026-07-01', fin: '2026-09-30' });
  const [diasEntreno, setDiasEntreno] = useState(0);
  const [workoutForm, setWorkoutForm] = useState({ tipo: 'carrera' as 'carrera' | 'fuerza', fecha: new Date().toISOString().slice(0, 10), duracion: 40, file: null as File | null });
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);
  const [selectedDebt, setSelectedDebt] = useState<Record<string, boolean>>({});

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
      console.error('Error cargando datos:', err);
      setMsg('Error al cargar datos del servidor.');
    } finally {
      setLoading(false);
    }
  }

  async function loadGroup(g: Group, currentUserId: string) {
    const m = await supabase.from('group_members').select('group_id,user_id,rol').eq('group_id', g.id);
    const ids = (m.data || []).map(x => x.user_id);
    const ps = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [] };
    setMembers((m.data || []).map(x => ({ ...x, profile: (ps.data || []).find(p => p.id === x.user_id) })));
    
    const ss = await supabase.from('seasons').select('*').eq('group_id', g.id).order('fecha_inicio', { ascending: false });
    setSeasons(ss.data || []);
    const s = (ss.data || [])[0] || null;
    setSeason(s);
    if (s) await loadSeason(s, currentUserId);
    else { setChallenge(null); setWorkouts([]); setDebts([]); }
  }

  async function loadSeason(s: Season, currentUserId: string) {
    const uid = currentUserId || session?.user?.id;
    if (!uid) return;

    const c = await supabase.from('challenges').select('*').eq('season_id', s.id).eq('user_id', uid).maybeSingle();
    setChallenge(c.data);
    if (c.data) setDiasEntreno(c.data.dias_carrera_semana + c.data.dias_fuerza_semana);
    
    const w = await supabase.from('workouts').select('*, profiles(*)').eq('season_id', s.id).order('fecha', { ascending: false });
    setWorkouts((w.data || []).map((x: any) => ({ ...x, profile: x.profiles })));
    
    const d = await supabase.from('v_deuda_pendiente').select('*').eq('season_id', s.id).order('semana_inicio', { ascending: false });
    setDebts(d.data || []);
  }

  useEffect(() => {
    loadData();
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        loadData();
      } else {
        setLoading(false);
      }
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
      else setMsg('Cuenta creada. Revisa tu email si requiere confirmación.');
      setLoading(false);
    }
  }

  async function createGroup() {
    if (!newGroup.trim()) return;
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const r = await supabase.from('groups').insert({ nombre: newGroup, codigo_invitacion: code, created_by: session.user.id }).select().single();
    if (r.error) { setMsg(r.error.message); return; }
    await supabase.from('group_members').insert({ group_id: r.data.id, user_id: session.user.id, rol: 'admin' });
    setNewGroup('');
    await loadData();
  }

  async function joinGroup() {
    const r = await supabase.from('groups').select('*').eq('codigo_invitacion', invite.trim().toUpperCase()).single();
    if (r.error) { setMsg('Código no encontrado'); return; }
    const x = await supabase.from('group_members').upsert({ group_id: r.data.id, user_id: session.user.id, rol: 'miembro' });
    if (x.error) setMsg(x.error.message);
    else { setInvite(''); await loadData(); }
  }

  async function saveSeason() {
    if (!group) return;
    const r = await supabase.from('seasons').insert({ group_id: group.id, nombre: seasonForm.nombre, fecha_inicio: seasonForm.inicio, fecha_fin: seasonForm.fin }).select().single();
    if (r.error) setMsg(r.error.message);
    else { setSeason(r.data); setSeasons(x => [r.data, ...x]); setMsg('Temporada creada.'); }
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

    const r = await supabase.from('workouts').insert({ season_id: season.id, user_id: session.user.id, tipo: workoutForm.tipo, fecha: workoutForm.fecha, duracion_minutos: Number(workoutForm.duracion), captura_url: path }).select().single();
    if (r.error) { await supabase.storage.from('capturas').remove([path]); setMsg(r.error.message); return; }

    setWorkoutForm({ ...workoutForm, file: null });
    setMsg('Entrenamiento enviado.');
    await loadSeason(season, session.user.id);
  }

  async function validateWorkout(w: Workout, status: 'aprobado' | 'rechazado', reason = '') {
    const r = await supabase.from('workouts').update({ estado: status, motivo_rechazo: status === 'rechazado' ? reason : null, validado_por: session.user.id, validado_en: new Date().toISOString() }).eq('id', w.id);
    if (r.error) setMsg(r.error.message);
    else { setReject(null); await loadSeason(season!, session.user.id); }
  }

  async function settle() {
    if (!group) return;
    const rows = debts.filter(d => selectedDebt[`${d.user_id}|${d.season_id}|${d.semana_inicio}`]);
    if (!rows.length) { setMsg('Selecciona alguna deuda.'); return; }
    const st = await supabase.from('settlements').insert({ group_id: group.id, created_by: session.user.id, nota: 'Liquidación desde la app' }).select().single();
    if (st.error) { setMsg(st.error.message); return; }
    const items = rows.map(d => ({ settlement_id: st.data.id, user_id: d.user_id, season_id: d.season_id, semana_inicio: d.semana_inicio, importe: d.importe_pendiente }));
    const ir = await supabase.from('settlement_items').insert(items);
    if (ir.error) { setMsg(ir.error.message); return; }
    setSelectedDebt({});
    setMsg('Liquidación registrada.');
    await loadSeason(season!, session.user.id);
  }

  const isAdmin = !!members.find(m => m.user_id === session?.user?.id && m.rol === 'admin');
  const total = useMemo(() => debts.reduce((a, d) => a + Number(d.importe_pendiente), 0), [debts]);
  const myWorkouts = workouts.filter(w => w.user_id === session?.user?.id);
  const pending = workouts.filter(w => w.estado === 'pendiente');

  if (loading) {
    return <div className="center"><div className="spinner" />Cargando…</div>;
  }
  
  if (!session) {
    return <AuthSection login={login} setLogin={setLogin} email={email} setEmail={setEmail} password={password} setPassword={setPassword} nombre={nombre} setNombre={setNombre} submit={handleAuth} msg={msg} />;
  }
  
  if (!group) {
    return (
      <main className="shell">
        <HeaderView profile={profile} logout={() => supabase.auth.signOut()} />
        <section className="hero">
          <span className="eyebrow">RETOS & DEUDAS</span>
          <h1>Empieza tu grupo.</h1>
          <p>Crea una comunidad para entrenar, validar pruebas y llevar las deudas automáticamente.</p>
        </section>
        <div className="grid2">
          <CardView title="Crear grupo">
            <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Nombre del grupo" />
            <button onClick={createGroup}>Crear grupo</button>
          </CardView>
          <CardView title="Unirme a un grupo">
            <input value={invite} onChange={e => setInvite(e.target.value)} placeholder="Código de invitación" />
            <button onClick={joinGroup}>Unirme</button>
          </CardView>
        </div>
        {msg && <NoticeView text={msg} />}
      </main>
    );
  }

  return (
    <main className="shell">
      <HeaderView profile={profile} logout={() => supabase.auth.signOut()} />
      <div className="topbar">
        <div>
          <div className="eyebrow">GRUPO</div>
          <h1>{group.nombre}</h1>
          <div className="muted">Invitación: <b>{group.codigo_invitacion}</b> · {season?.nombre || 'Sin temporada'}</div>
        </div>
        <select value={season?.id || ''} onChange={async e => { const s = seasons.find(x => x.id === e.target.value); if (s) { setSeason(s); await loadSeason(s, session.user.id); } }}>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          <option value="">—</option>
        </select>
      </div>

      <nav className="tabs">
        {[
          ['inicio', 'Inicio'],
          ['reto', 'Mi reto'],
          ['entreno', 'Entrenamiento'],
          ['deudas', 'Deudas'],
          ['grupo', 'Grupo'],
          ...(isAdmin ? [['admin', 'Validar']] : [])
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {msg && <NoticeView text={msg} />}

      {tab === 'inicio' && <InicioSection profile={profile!} group={group} season={season} challenge={challenge} total={total} myWorkouts={myWorkouts} debts={debts} members={members} />}
      
      {tab === 'reto' && (
        <section className="grid2">
          <CardView title="Mi compromiso semanal">
            <label>
              Días de entrenamiento por semana
              <input 
                type="number" 
                min="0" 
                max="7" 
                value={diasEntreno} 
                onChange={e => setDiasEntreno(Number(e.target.value))} 
              />
            </label>
            <button onClick={saveChallenge}>Guardar reto</button>
          </CardView>
          {isAdmin && (
            <CardView title="Nueva temporada">
              <input value={seasonForm.nombre} onChange={e => setSeasonForm({ ...seasonForm, nombre: e.target.value })} />
              <label>Inicio<input type="date" value={seasonForm.inicio} onChange={e => setSeasonForm({ ...seasonForm, inicio: e.target.value })} /></label>
              <label>Fin<input type="date" value={seasonForm.fin} onChange={e => setSeasonForm({ ...seasonForm, fin: e.target.value })} /></label>
              <button onClick={saveSeason}>Crear temporada</button>
            </CardView>
          )}
        </section>
      )}

      {tab === 'entreno' && <EntrenosSection form={workoutForm} setForm={setWorkoutForm} upload={uploadWorkout} workouts={myWorkouts} />}
      {tab === 'deudas' && <DeudasSection debts={debts} members={members} selected={selectedDebt} setSelected={setSelectedDebt} settle={settle} isAdmin={isAdmin} />}
      {tab === 'grupo' && <GrupoSection group={group} members={members} newGroup={newGroup} setNewGroup={setNewGroup} invite={invite} setInvite={setInvite} createGroup={createGroup} joinGroup={joinGroup} />}
      {tab === 'admin' && isAdmin && <AdminSection workouts={pending} validate={validateWorkout} reject={reject} setReject={setReject} />}
    </main>
  );
}

function AuthSection(p: any) {
  return (
    <main className="auth">
      <div className="authbox">
        <div className="eyebrow">RETOS & DEUDAS</div>
        <h1>{p.login ? 'Bienvenido' : 'Crea tu cuenta'}</h1>
        <p className="muted">Entrena. Cumple. Saldad las cuentas.</p>
        {!p.login && <input placeholder="Tu nombre" value={p.nombre} onChange={e => p.setNombre(e.target.value)} />}
        <input type="email" placeholder="Email" value={p.email} onChange={e => p.setEmail(e.target.value)} />
        <input type="password" placeholder="Contraseña" value={p.password} onChange={e => p.setPassword(e.target.value)} />
        <button onClick={p.submit}>{p.login ? 'Entrar' : 'Registrarme'}</button>
        {p.msg && <NoticeView text={p.msg} />}
        <button className="link" onClick={() => p.setLogin(!p.login)}>{p.login ? 'Crear una cuenta' : 'Ya tengo cuenta'}</button>
      </div>
    </main>
  );
}

function HeaderView({ profile, logout }: any) {
  return (
    <header>
      <div className="brand">🏃 <span>Retos</span></div>
      <div className="user">{profile?.nombre}<button className="ghost" onClick={logout}>Salir</button></div>
    </header>
  );
}

function CardView({ title, children }: any) {
  return <div className="card"><h2>{title}</h2>{children}</div>;
}

function NoticeView({ text }: { text: string }) {
  return <div className="notice">{text}</div>;
}

function InicioSection({ profile, group, season, challenge, total, myWorkouts, debts, members }: any) {
  const approved = myWorkouts.filter((w: Workout) => w.estado === 'aprobado').length;
  const totalDias = challenge ? challenge.dias_carrera_semana + challenge.dias_fuerza_semana : 0;
  return (
    <>
      <section className="hero compact">
        <div>
          <span className="eyebrow">HOLA, {profile?.nombre?.toUpperCase()}</span>
          <h1>{season ? season.nombre : 'Configura tu temporada'}</h1>
          <p>{challenge ? `${totalDias} días de entrenamiento cada semana.` : 'Todavía no has configurado tu reto.'}</p>
        </div>
        <div className="debtBig"><span>Deuda pendiente</span><strong>{money(total)}</strong></div>
      </section>
      <div className="stats">
        <StatView n={approved} t="Entrenos aprobados" />
        <StatView n={myWorkouts.filter((w: Workout) => w.estado === 'pendiente').length} t="Pendientes" />
        <StatView n={members.length} t="Miembros" />
        <StatView n={debts.length} t="Semanas con deuda" />
      </div>
      <CardView title="Regla">
        <p className="muted">Cada día no cumplido cuesta <b>5 €</b>. Carrera: mínimo 40 min. Fuerza: mínimo 50 min.</p>
      </CardView>
    </>
  );
}

function StatView({ n, t }: { n: any; t: string }) {
  return <div className="stat"><strong>{n}</strong><span>{t}</span></div>;
}

function EntrenosSection({ form, setForm, upload, workouts }: any) {
  return (
    <section className="grid2">
      <CardView title="Subir entrenamiento">
        <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value, duracion: e.target.value === 'carrera' ? 40 : 50 })}>
          <option value="carrera">🏃 Carrera</option>
          <option value="fuerza">💪 Fuerza</option>
        </select>
        <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
        <input type="number" min={form.tipo === 'carrera' ? 40 : 50} value={form.duracion} onChange={e => setForm({ ...form, duracion: e.target.value })} />
        <label className="file">{form.file ? form.file.name : 'Elegir captura'}<input type="file" accept="image/*" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} /></label>
        <button onClick={upload}>Enviar para validar</button>
      </CardView>
      <CardView title="Mis entrenamientos">
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => (
            <div className="row" key={w.id}>
              <div><b>{w.tipo === 'carrera' ? '🏃' : '💪'} {w.duracion_minutos} min</b><small>{formatDate(w.fecha)}</small></div>
              <StatusView s={w.estado} />
            </div>
          )) : <p className="muted">Aún no has subido entrenamientos.</p>}
        </div>
      </CardView>
    </section>
  );
}

function StatusView({ s }: { s: string }) {
  return <span className={'status ' + s}>{s}</span>;
}

function DeudasSection({ debts, members, selected, setSelected, settle, isAdmin }: any) {
  return (
    <section>
      <CardView title="Deuda pendiente">
        <div className="debtList">
          {debts.length ? debts.map((d: Debt) => (
            <label className="debtrow" key={`${d.user_id}-${d.semana_inicio}`}>
              <input disabled={!isAdmin} type="checkbox" checked={!!selected[`${d.user_id}|${d.season_id}|${d.semana_inicio}`]} onChange={e => setSelected({ ...selected, [`${d.user_id}|${d.season_id}|${d.semana_inicio}`]: e.target.checked })} />
              <span><b>{members.find((m: Member) => m.user_id === d.user_id)?.profile?.nombre || 'Usuario'}</b><small>Semana del {formatDate(d.semana_inicio)} · {d.dias_totales_fallados} días</small></span>
              <strong>{money(d.importe_pendiente)}</strong>
            </label>
          )) : <p className="muted">No hay deudas pendientes. 🎉</p>}
        </div>
        {isAdmin && debts.length > 0 && <button onClick={settle}>Liquidar seleccionadas</button>}
      </CardView>
    </section>
  );
}

function GrupoSection({ group, members, newGroup, setNewGroup, invite, setInvite, createGroup, joinGroup }: any) {
  return (
    <section className="grid2">
      <CardView title="Tu grupo">
        <p className="code">{group.codigo_invitacion}</p>
        <p className="muted">Comparte este código para invitar a tus compañeros.</p>
      </CardView>
      <CardView title="Miembros">
        <div className="list">
          {members.map((m: Member) => (
            <div className="row" key={m.user_id}>
              <span>👤 {m.profile?.nombre}</span>
              <StatusView s={m.rol} />
            </div>
          ))}
        </div>
      </CardView>
      <CardView title="Crear otro grupo">
        <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Nombre" />
        <button onClick={createGroup}>Crear</button>
      </CardView>
      <CardView title="Unirme a otro">
        <input value={invite} onChange={e => setInvite(e.target.value)} placeholder="Código" />
        <button onClick={joinGroup}>Unirme</button>
      </CardView>
    </section>
  );
}

function AdminSection({ workouts, validate, reject, setReject }: any) {
  return (
    <section>
      <CardView title={`Entrenamientos pendientes · ${workouts.length}`}>
        <div className="list">
          {workouts.length ? workouts.map((w: Workout) => (
            <div className="adminrow" key={w.id}>
              <div>
                <b>{w.profile?.nombre}</b>
                <small>{w.tipo} · {w.duracion_minutos} min · {formatDate(w.fecha)}</small>
                <a href="#" onClick={async e => { e.preventDefault(); const { data } = await supabase.storage.from('capturas').createSignedUrl(w.captura_url, 600); if (data?.signedUrl) window.open(data.signedUrl, '_blank'); }}>Ver captura</a>
              </div>
              <div className="actions">
                <button onClick={() => validate(w, 'aprobado')}>Aprobar</button>
                <button className="danger" onClick={() => setReject({ id: w.id, reason: '' })}>Rechazar</button>
              </div>
            </div>
          )) : <p className="muted">Todo al día.</p>}
        </div>
      </CardView>
      {reject && (
        <div className="modal">
          <div className="modalbox">
            <h2>Motivo del rechazo</h2>
            <textarea value={reject.reason} onChange={e => setReject({ ...reject, reason: e.target.value })} placeholder="Explica qué no es válido…" />
            <button onClick={() => validate(workouts.find((w: Workout) => w.id === reject.id), 'rechazado', reject.reason || 'No cumple las condiciones')}>Rechazar entrenamiento</button>
            <button className="ghost" onClick={() => setReject(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
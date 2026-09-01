import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 

export default function GestionReto({ userId, groupId }) {
  const [retoActivo, setRetoActivo] = useState(null);
  const [solicitudPendiente, setSolicitudPendiente] = useState(null);
  const [loading, setLoading] = useState(true);

  const [mostrarModal, setMostrarModal] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [nuevoRetoNombre, setNuevoRetoNombre] = useState('');

  useEffect(() => {
    if (userId && groupId) {
      cargarEstadoReto();
    }
  }, [userId, groupId]);

  const cargarEstadoReto = async () => {
    setLoading(true);
    try {
      // Buscar reto activo
      const { data: reto } = await supabase
        .from('challenges')
        .select('*')
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .eq('estado', 'activo')
        .maybeSingle();

      if (reto) {
        setRetoActivo(reto);

        // Comprobar si hay solicitud pendiente
        const { data: sol } = await supabase
          .from('solicitudes_revocacion')
          .select('*')
          .eq('challenge_id', reto.id)
          .eq('user_id', userId)
          .eq('estado', 'pendiente')
          .maybeSingle();

        setSolicitudPendiente(sol || null);
      } else {
        setRetoActivo(null);
        setSolicitudPendiente(null);
      }
    } catch (error) {
      console.error("Error al cargar reto:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSolicitarRevocacion = async (e) => {
    e.preventDefault();
    if (!motivo.trim()) return alert("Por favor, escribe un motivo.");

    setEnviando(true);
    const { error } = await supabase
      .from('solicitudes_revocacion')
      .insert([
        {
          user_id: userId,
          group_id: groupId,
          challenge_id: retoActivo.id,
          motivo: motivo,
        }
      ]);

    setEnviando(false);

    if (error) {
      alert("Error al enviar la solicitud: " + error.message);
    } else {
      alert("Solicitud enviada al administrador correctamente.");
      setMotivo('');
      setMostrarModal(false);
      cargarEstadoReto();
    }
  };

  const handleCrearReto = async (e) => {
    e.preventDefault();
    const { error } = await supabase
      .from('challenges')
      .insert([
        {
          user_id: userId,
          group_id: groupId,
          titulo: nuevoRetoNombre,
          estado: 'activo'
        }
      ]);

    if (error) {
      alert("Error al crear el reto: " + error.message);
    } else {
      setNuevoRetoNombre('');
      cargarEstadoReto();
    }
  };

  if (loading) return <p>Cargando información del reto...</p>;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      
      {/* CASO 1: NO TIENE RETO ACTIVO -> Puede crear uno */}
      {!retoActivo && (
        <div style={{ border: '1px solid #ccc', padding: '16px', borderRadius: '8px' }}>
          <h3>Añadir Nuevo Reto</h3>
          <form onSubmit={handleCrearReto}>
            <input 
              type="text" 
              placeholder="Ej: Correr 3 veces por semana"
              value={nuevoRetoNombre}
              onChange={(e) => setNuevoRetoNombre(e.target.value)}
              required
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
            <button type="submit" style={{ padding: '8px 16px', cursor: 'pointer' }}>Asumir Reto</button>
          </form>
        </div>
      )}

      {/* CASO 2: TIENE RETO ACTIVO -> Se bloquea la creación */}
      {retoActivo && (
        <div style={{ border: '2px solid #2b8a3e', padding: '16px', borderRadius: '8px', background: '#f4fce3' }}>
          <h3>🎯 Tu Reto Actual</h3>
          <p><strong>Reto:</strong> {retoActivo.titulo}</p>
          <p style={{ color: '#666', fontSize: '0.9em' }}>
            🔒 <em>La creación de nuevos retos está bloqueada mientras tengas este reto activo.</em>
          </p>

          <hr />

          {/* Si ya envió solicitud de cancelación */}
          {solicitudPendiente ? (
            <div style={{ background: '#fff9db', padding: '10px', borderRadius: '6px', color: '#f59f00' }}>
              ⏳ <strong>Solicitud Enviada:</strong> Tu petición de cancelación está pendiente de revisión por el administrador.
            </div>
          ) : (
            /* Si aún no ha enviado solicitud */
            <button 
              onClick={() => setMostrarModal(true)}
              style={{ background: '#e03131', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '4px', cursor: 'pointer' }}
            >
              Solicitar Revocación de Reto
            </button>
          )}
        </div>
      )}

      {/* MODAL / VENTANA EMERGENTE PARA EXPONER EL MOTIVO */}
      {mostrarModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '400px' }}>
            <h4 style={{ marginTop: 0 }}>Solicitar Cancelación de Reto</h4>
            <p>Escribe el motivo por el cual no puedes continuar con tu reto actual:</p>
            
            <form onSubmit={handleSolicitarRevocacion}>
              <textarea 
                rows="4"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: Lesión en el tobillo, motivo de fuerza mayor..."
                required
                style={{ width: '100%', padding: '8px', marginBottom: '12px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setMostrarModal(false)}>Cancelar</button>
                <button type="submit" disabled={enviando} style={{ background: '#e03131', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                  {enviando ? 'Enviando...' : 'Enviar Petición'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

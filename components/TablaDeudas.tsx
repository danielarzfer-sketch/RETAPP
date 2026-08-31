"use client";

import { useState } from "react";
import type { DeudaPendiente, Profile } from "@/types/database";

interface Props {
  deudas: DeudaPendiente[];
  perfiles: Record<string, Profile>;
}

// Agrupa las filas de deuda semanal por usuario para pintar el total
// y permitir desplegar el detalle semana a semana al pulsar.
export default function TablaDeudas({ deudas, perfiles }: Props) {
  const [expandido, setExpandido] = useState<string | null>(null);

  const porUsuario = deudas.reduce<Record<string, DeudaPendiente[]>>(
    (acc, d) => {
      (acc[d.user_id] ??= []).push(d);
      return acc;
    },
    {}
  );

  const usuarios = Object.keys(porUsuario).sort(
    (a, b) =>
      totalPendiente(porUsuario[b]) - totalPendiente(porUsuario[a])
  );

  return (
    <div className="space-y-2">
      {usuarios.map((userId) => {
        const filas = porUsuario[userId].sort((a, b) =>
          a.semana_inicio.localeCompare(b.semana_inicio)
        );
        const total = totalPendiente(filas);
        const nombre = perfiles[userId]?.nombre ?? "Usuario";
        const abierto = expandido === userId;

        return (
          <div
            key={userId}
            className="bg-white rounded-xl border border-neutral-200 overflow-hidden"
          >
            <button
              onClick={() => setExpandido(abierto ? null : userId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 transition"
            >
              <span className="font-medium">{nombre}</span>
              <span
                className={
                  total > 0
                    ? "text-red-600 font-semibold"
                    : "text-green-600 font-semibold"
                }
              >
                {total.toFixed(2)} €
              </span>
            </button>

            {abierto && (
              <div className="border-t border-neutral-100 divide-y divide-neutral-100">
                {filas
                  .filter((f) => f.importe_pendiente > 0)
                  .map((f) => (
                    <div
                      key={f.semana_inicio}
                      className="flex items-center justify-between px-4 py-2 text-sm text-neutral-600"
                    >
                      <span>
                        Semana del{" "}
                        {new Date(f.semana_inicio).toLocaleDateString(
                          "es-ES"
                        )}
                      </span>
                      <span className="text-red-500">
                        {f.importe_pendiente.toFixed(2)} €
                      </span>
                    </div>
                  ))}
                {filas.every((f) => f.importe_pendiente === 0) && (
                  <p className="px-4 py-2 text-sm text-neutral-400">
                    Sin deudas pendientes esta temporada.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function totalPendiente(filas: DeudaPendiente[]) {
  return filas.reduce((sum, f) => sum + f.importe_pendiente, 0);
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Save } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { SetEntry, Variant } from "../lib/types";
import { formatEur } from "../lib/format";

export function WatchlistPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SetEntry | "new" | null>(null);

  const sets = useQuery({
    queryKey: ["sets"],
    queryFn: () => api.get<SetEntry[]>("/api/sets"),
  });

  const grouped = useMemo(() => {
    if (!sets.data) return new Map<string, SetEntry[]>();
    const map = new Map<string, SetEntry[]>();
    for (const s of sets.data) {
      const era = s.era ?? "Sonstige";
      const list = map.get(era) ?? [];
      list.push(s);
      map.set(era, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (!a.releaseDate && !b.releaseDate) return a.name.localeCompare(b.name);
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return b.releaseDate.localeCompare(a.releaseDate);
      });
    }
    return map;
  }, [sets.data]);

  const eraOrder = ["30th Anniversary", "Karmesin & Purpur", "Sonstige"];
  const eras = Array.from(grouped.keys()).sort(
    (a, b) => eraOrder.indexOf(a) - eraOrder.indexOf(b),
  );

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/sets/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sets"] }),
  });

  const totalActive = sets.data?.filter((s) => s.active).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Sets</h1>
          <div className="text-xs text-slate-500 mt-0.5">
            {sets.data?.length ?? 0} Sets gesamt • {totalActive} aktiv
          </div>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium"
        >
          <Plus size={14} /> Neues Set
        </button>
      </div>

      {sets.isLoading && <div className="text-sm text-slate-500">Lade Sets…</div>}

      {eras.map((era) => (
        <section key={era}>
          <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2 font-semibold">{era}</h2>
          <div className="grid gap-2">
            {(grouped.get(era) ?? []).map((s) => (
              <SetRow
                key={s.id}
                set={s}
                onToggle={(active) => toggle.mutate({ id: s.id, active })}
                onEdit={() => setEditing(s)}
              />
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <SetModal
          set={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["sets"] });
          }}
        />
      )}
    </div>
  );
}

function SetRow({
  set,
  onToggle,
  onEdit,
}: {
  set: SetEntry;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-3 transition flex items-center gap-3",
        set.active
          ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800/60 dark:bg-emerald-900/10"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
      )}
    >
      <input
        type="checkbox"
        checked={set.active}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 shrink-0"
        aria-label={`${set.name} aktivieren`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          {set.shortCode && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
              {set.shortCode}
            </span>
          )}
          <span className="font-medium truncate">{set.name}</span>
          {set.isPreset && (
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Preset</span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {set.releaseDate && <span>{new Date(set.releaseDate).toLocaleDateString("de-DE")}</span>}
          <span>{set.variants.length} Varianten</span>
          <span>{set.language}</span>
          {set.description && <span className="truncate flex-1 italic">· {set.description}</span>}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 p-1 shrink-0"
        aria-label="Bearbeiten"
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}

interface ModalProps {
  set: SetEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

function SetModal({ set, onClose, onSaved }: ModalProps) {
  const qc = useQueryClient();
  const isNew = set === null;

  const [form, setForm] = useState({
    id: set?.id ?? "",
    name: set?.name ?? "",
    shortCode: set?.shortCode ?? "",
    description: set?.description ?? "",
    releaseDate: set?.releaseDate?.slice(0, 10) ?? "",
    language: set?.language ?? "DE",
    era: set?.era ?? "",
    searchTerms: set?.searchTerms.join("\n") ?? "",
    negativeTerms: set?.negativeTerms.join("\n") ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...(isNew ? { id: form.id } : {}),
        name: form.name,
        shortCode: form.shortCode || null,
        description: form.description || null,
        releaseDate: form.releaseDate || null,
        language: form.language,
        era: form.era || null,
        searchTerms: form.searchTerms.split("\n").map((s) => s.trim()).filter(Boolean),
        negativeTerms: form.negativeTerms.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      return isNew
        ? api.post(`/api/sets`, payload)
        : api.patch(`/api/sets/${set!.id}`, payload);
    },
    onSuccess: onSaved,
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/sets/${set!.id}`),
    onSuccess: onSaved,
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-slate-900 w-full md:max-w-3xl rounded-t-xl md:rounded-xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center gap-2 p-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-semibold flex-1">{isNew ? "Neues Set" : `Set bearbeiten: ${set!.name}`}</h2>
          <button onClick={onClose} className="p-1 text-slate-500"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          <Field label="ID (slug)" disabled={!isNew}>
            <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} disabled={!isNew} className="input" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
              </Field>
            </div>
            <Field label="Short-Code">
              <input value={form.shortCode} onChange={(e) => setForm({ ...form, shortCode: e.target.value })} className="input" placeholder="KP9.5" />
            </Field>
          </div>
          <Field label="Beschreibung">
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Release-Datum">
              <input type="date" value={form.releaseDate} onChange={(e) => setForm({ ...form, releaseDate: e.target.value })} className="input" />
            </Field>
            <Field label="Sprache">
              <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="input" placeholder="DE" />
            </Field>
            <Field label="Era / Gruppe">
              <input value={form.era} onChange={(e) => setForm({ ...form, era: e.target.value })} className="input" placeholder="Karmesin & Purpur" />
            </Field>
          </div>
          <Field label="Suchbegriffe (eine pro Zeile)">
            <textarea rows={4} value={form.searchTerms} onChange={(e) => setForm({ ...form, searchTerms: e.target.value })} className="input font-mono text-xs" />
          </Field>
          <Field label="Negative Begriffe (eine pro Zeile)">
            <textarea rows={3} value={form.negativeTerms} onChange={(e) => setForm({ ...form, negativeTerms: e.target.value })} className="input font-mono text-xs" />
          </Field>

          {!isNew && set && (
            <VariantsEditor set={set} onChanged={() => qc.invalidateQueries({ queryKey: ["sets"] })} />
          )}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2 justify-end items-center">
          {!isNew && (
            <button
              onClick={() => { if (confirm(`Set "${set!.name}" löschen?`)) del.mutate(); }}
              className="mr-auto inline-flex items-center gap-1 px-3 py-1.5 rounded bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200 text-sm"
            >
              <Trash2 size={14} /> Löschen
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-sm">Abbrechen</button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || (!form.id && isNew) || !form.name}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            <Save size={14} /> {save.isPending ? "Speichere…" : "Speichern"}
          </button>
        </div>
        {save.error && (
          <div className="px-4 pb-3 text-xs text-rose-700 dark:text-rose-400">Fehler: {String(save.error)}</div>
        )}
      </div>
      <style>{`.input{width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid rgb(203 213 225);background:white;font-size:13px;}.dark .input{background:rgb(15 23 42);border-color:rgb(51 65 85);color:rgb(241 245 249)}`}</style>
    </div>
  );
}

function VariantsEditor({ set, onChanged }: { set: SetEntry; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Varianten ({set.variants.length})</h3>
        <button
          onClick={() => setAdding(true)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-200 dark:bg-slate-700"
        >
          <Plus size={12} /> Variante
        </button>
      </div>
      <div className="rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase">
            <tr>
              <th className="text-left px-2 py-1.5">Kind</th>
              <th className="text-left px-2 py-1.5">Anzeigename</th>
              <th className="text-right px-2 py-1.5">UVP</th>
              <th className="text-right px-2 py-1.5">Tol.</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {set.variants.map((v) => (
              <VariantRow key={v.id} setId={set.id} variant={v} onChanged={onChanged} />
            ))}
            {adding && (
              <VariantRow
                setId={set.id}
                variant={null}
                onChanged={() => { setAdding(false); onChanged(); }}
                onCancel={() => setAdding(false)}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VariantRow({
  setId,
  variant,
  onChanged,
  onCancel,
}: {
  setId: string;
  variant: Variant | null;
  onChanged: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    kind: variant?.kind ?? "display",
    displayName: variant?.displayName ?? "",
    uvpEur: variant?.uvpEur?.toString() ?? "",
    uvpToleranceEur: variant?.uvpToleranceEur?.toString() ?? "10",
  });
  const [editing, setEditing] = useState(variant === null);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        kind: form.kind,
        displayName: form.displayName,
        uvpEur: form.uvpEur ? Number(form.uvpEur) : null,
        uvpToleranceEur: Number(form.uvpToleranceEur || "10"),
      };
      return variant
        ? api.patch(`/api/sets/${setId}/variants/${variant.id}`, payload)
        : api.post(`/api/sets/${setId}/variants`, payload);
    },
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/sets/${setId}/variants/${variant!.id}`),
    onSuccess: onChanged,
  });

  if (!editing && variant) {
    return (
      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
        <td className="px-2 py-1">{variant.kind}</td>
        <td className="px-2 py-1">{variant.displayName}</td>
        <td className="px-2 py-1 text-right tabular-nums">{formatEur(variant.uvpEur)}</td>
        <td className="px-2 py-1 text-right tabular-nums">±{variant.uvpToleranceEur}€</td>
        <td className="px-2 py-1 text-right">
          <button onClick={() => setEditing(true)} className="text-slate-500 p-0.5"><Pencil size={12} /></button>
          <button onClick={() => { if (confirm(`Variante löschen?`)) del.mutate(); }} className="text-slate-400 hover:text-rose-600 p-0.5"><Trash2 size={12} /></button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-blue-50/40 dark:bg-blue-900/10">
      <td className="px-2 py-1">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="input">
          {["display","etb","booster","premium-collection","tin","blister","bundle","collection","other"].map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="input" /></td>
      <td className="px-2 py-1"><input type="number" step="0.01" value={form.uvpEur} onChange={(e) => setForm({ ...form, uvpEur: e.target.value })} className="input text-right" /></td>
      <td className="px-2 py-1"><input type="number" step="0.01" value={form.uvpToleranceEur} onChange={(e) => setForm({ ...form, uvpToleranceEur: e.target.value })} className="input text-right" /></td>
      <td className="px-2 py-1 text-right whitespace-nowrap">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50">Speichern</button>
        {variant && <button onClick={() => setEditing(false)} className="text-xs px-1 ml-1">×</button>}
        {!variant && onCancel && <button onClick={onCancel} className="text-xs px-1 ml-1">×</button>}
      </td>
    </tr>
  );
}

function Field({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="block">
      <span className={`text-xs font-medium block mb-1 ${disabled ? "text-slate-400" : "text-slate-700 dark:text-slate-300"}`}>{label}</span>
      {children}
    </label>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, X, ChevronRight, ChevronLeft } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { SetEntry, SetList, SetListDetail } from "../lib/types";

export function SetListsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const lists = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<SetList[]>("/api/lists"),
  });

  // Auto-select the first list (system Default Fast) on first load
  useEffect(() => {
    if (!selectedId && lists.data && lists.data.length > 0) {
      setSelectedId(lists.data[0].id);
    }
  }, [lists.data, selectedId]);

  const createMut = useMutation({
    mutationFn: (name: string) => api.post<SetList>("/api/lists", { name, setIds: [] }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["heartbeat"] });
      setSelectedId(created.id);
      setCreating(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/lists/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["heartbeat"] });
      setSelectedId(null);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Listen</h1>
        <div className="text-xs text-slate-500 mt-0.5">
          Eine Liste fasst Sets zusammen, die ein Shop tracken soll. Im{" "}
          <a href="/shops" className="underline">Shops-Tab</a> weist du die Liste zu.
        </div>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* Left: list of lists */}
        <aside className="space-y-2">
          <button
            onClick={() => {
              const name = window.prompt("Name der neuen Liste:");
              if (name && name.trim().length > 0) createMut.mutate(name.trim());
            }}
            disabled={creating || createMut.isPending}
            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-40"
          >
            <Plus size={14} /> Neue Liste
          </button>

          {lists.isLoading && <div className="text-sm text-slate-500">Lade…</div>}

          <div className="space-y-1">
            {lists.data?.map((l) => (
              <button
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={clsx(
                  "w-full text-left px-3 py-2 rounded border transition flex items-center gap-2",
                  selectedId === l.id
                    ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <span className="truncate">{l.name}</span>
                    {l.isSystem && (
                      <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 shrink-0">
                        System
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {l.itemCount} Sets
                    {typeof l.shopCount === "number" && l.shopCount > 0 && (
                      <span> · {l.shopCount} Shop{l.shopCount === 1 ? "" : "s"}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Right: editor */}
        <section>
          {selectedId ? (
            <ListEditor
              listId={selectedId}
              onDelete={() => {
                const list = lists.data?.find((l) => l.id === selectedId);
                if (!list) return;
                if (list.isSystem) {
                  alert("System-Listen können nicht gelöscht werden.");
                  return;
                }
                if (
                  window.confirm(
                    `Liste "${list.name}" wirklich löschen? Shops mit dieser Liste fallen auf den Family-Default zurück.`,
                  )
                ) {
                  deleteMut.mutate(selectedId);
                }
              }}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
              Wähle links eine Liste oder lege eine neue an.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ListEditor({ listId, onDelete }: { listId: string; onDelete: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["lists", listId],
    queryFn: () => api.get<SetListDetail>(`/api/lists/${listId}`),
  });
  const allSets = useQuery({
    queryKey: ["sets"],
    queryFn: () => api.get<SetEntry[]>("/api/sets"),
  });

  // Local working copy of the current setIds, so we can stage changes and
  // commit them in one PATCH instead of individually for each toggle.
  const [draftSetIds, setDraftSetIds] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (list.data) {
      setDraftSetIds(new Set(list.data.setIds));
      setDraftName(list.data.name);
      setDirty(false);
    }
  }, [list.data?.id, list.data?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: (payload: { name?: string; setIds?: string[] }) =>
      api.patch(`/api/lists/${listId}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["lists", listId] });
      qc.invalidateQueries({ queryKey: ["heartbeat"] });
      setDirty(false);
    },
  });

  const grouped = useMemo(() => {
    if (!allSets.data) return new Map<string, SetEntry[]>();
    const map = new Map<string, SetEntry[]>();
    for (const s of allSets.data) {
      const era = s.era ?? "Sonstige";
      const arr = map.get(era) ?? [];
      arr.push(s);
      map.set(era, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (!a.releaseDate && !b.releaseDate) return a.name.localeCompare(b.name);
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return b.releaseDate.localeCompare(a.releaseDate);
      });
    }
    return map;
  }, [allSets.data]);

  const eraOrder = ["30th Anniversary", "Karmesin & Purpur", "Sonstige"];
  const eras = useMemo(
    () => Array.from(grouped.keys()).sort((a, b) => eraOrder.indexOf(a) - eraOrder.indexOf(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped],
  );

  if (list.isLoading) return <div className="text-sm text-slate-500">Lade Liste…</div>;
  if (!list.data) return <div className="text-sm text-rose-500">Liste nicht gefunden</div>;

  const isSystem = list.data.isSystem;

  function toggle(setId: string) {
    setDraftSetIds((prev) => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      setDirty(true);
      return next;
    });
  }

  function save() {
    const payload: { name?: string; setIds?: string[] } = {
      setIds: Array.from(draftSetIds),
    };
    if (!isSystem && draftName !== list.data!.name) payload.name = draftName;
    saveMut.mutate(payload);
  }

  function reset() {
    if (!list.data) return;
    setDraftSetIds(new Set(list.data.setIds));
    setDraftName(list.data.name);
    setDirty(false);
  }

  const inList = draftSetIds.size;
  const total = allSets.data?.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          {isSystem ? (
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {list.data.name}
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                System
              </span>
            </h2>
          ) : (
            <input
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
                setDirty(true);
              }}
              className="text-lg font-semibold bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 w-full"
            />
          )}
          {list.data.description && (
            <div className="text-xs text-slate-500 mt-1">{list.data.description}</div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            {inList} / {total} Sets · {list.data.shopCount ?? 0} Shops nutzen diese Liste
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <>
              <button
                onClick={reset}
                disabled={saveMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <X size={14} /> Verwerfen
              </button>
              <button
                onClick={save}
                disabled={saveMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-40"
              >
                <Save size={14} /> Speichern
              </button>
            </>
          )}
          {!isSystem && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-sm hover:bg-rose-50 dark:hover:bg-rose-900/20"
            >
              <Trash2 size={14} /> Löschen
            </button>
          )}
        </div>
      </div>

      {/* Two-Column Set Selector */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Available */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-xs uppercase tracking-wide text-slate-500 font-medium border-b border-slate-200 dark:border-slate-800">
            Verfügbar ({total - inList})
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[60vh] overflow-y-auto">
            {eras.map((era) => {
              const candidates = (grouped.get(era) ?? []).filter((s) => !draftSetIds.has(s.id));
              if (candidates.length === 0) return null;
              return (
                <div key={era}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50/50 dark:bg-slate-800/30">
                    {era}
                  </div>
                  {candidates.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 group"
                    >
                      {s.shortCode && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
                          {s.shortCode}
                        </span>
                      )}
                      <span className="flex-1 truncate">{s.name}</span>
                      <ChevronRight size={14} className="text-slate-400 group-hover:text-emerald-600" />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* In list */}
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 overflow-hidden">
          <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-200 font-medium border-b border-emerald-200 dark:border-emerald-800/50">
            In Liste ({inList})
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[60vh] overflow-y-auto">
            {inList === 0 && (
              <div className="px-3 py-6 text-center text-sm text-slate-500">
                Noch keine Sets in dieser Liste.
              </div>
            )}
            {eras.map((era) => {
              const candidates = (grouped.get(era) ?? []).filter((s) => draftSetIds.has(s.id));
              if (candidates.length === 0) return null;
              return (
                <div key={era}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50/50 dark:bg-slate-800/30">
                    {era}
                  </div>
                  {candidates.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-rose-50 dark:hover:bg-rose-900/20 group"
                    >
                      <ChevronLeft size={14} className="text-slate-400 group-hover:text-rose-600" />
                      {s.shortCode && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
                          {s.shortCode}
                        </span>
                      )}
                      <span className="flex-1 truncate">{s.name}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

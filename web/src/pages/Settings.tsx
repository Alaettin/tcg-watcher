import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, RotateCcw, Plus, Trash2, Send, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";

interface NtfyChannel {
  id: string;
  name: string;
  topic: string;
  enabled: boolean;
}

interface NtfyConfig {
  server: string;
  channels: NtfyChannel[];
}

interface SettingsResponse {
  globalNegativeTerms?: string[];
  ntfyConfig?: NtfyConfig;
  [key: string]: unknown;
}

const DEFAULT_NTFY: NtfyConfig = { server: "https://ntfy.sh", channels: [] };

function randomChannelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ch-${Math.random().toString(36).slice(2, 10)}`;
}

function randomTopic(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `pokemon-watcher-${hex}`;
}

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <NtfySection />
      <NegativesSection />
    </div>
  );
}

function NtfySection() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/api/settings"),
  });

  const [draft, setDraft] = useState<NtfyConfig>(DEFAULT_NTFY);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings.data?.ntfyConfig) {
      setDraft(JSON.parse(JSON.stringify(settings.data.ntfyConfig)));
      setDirty(false);
    }
  }, [settings.data?.ntfyConfig]);

  const save = useMutation({
    mutationFn: (cfg: NtfyConfig) =>
      api.put<{ key: string; value: NtfyConfig }>("/api/settings/ntfyConfig", { value: cfg }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const updateChannel = (idx: number, patch: Partial<NtfyChannel>) => {
    setDraft((d) => ({
      ...d,
      channels: d.channels.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
    setDirty(true);
  };
  const addChannel = () => {
    setDraft((d) => ({
      ...d,
      channels: [
        ...d.channels,
        { id: randomChannelId(), name: "", topic: randomTopic(), enabled: true },
      ],
    }));
    setDirty(true);
  };
  const removeChannel = (idx: number) => {
    setDraft((d) => ({ ...d, channels: d.channels.filter((_, i) => i !== idx) }));
    setDirty(true);
  };
  const onReset = () => {
    if (settings.data?.ntfyConfig) {
      setDraft(JSON.parse(JSON.stringify(settings.data.ntfyConfig)));
      setDirty(false);
    }
  };

  const activeCount = draft.channels.filter((c) => c.enabled && c.topic).length;

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold">Push Channels (ntfy.sh)</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
            Jedes Event (NEW/RESTOCK/PRICE_DROP/OOS + Heartbeat) wird parallel an alle aktiven Channels gesendet. Lege z.B. einen Channel für dein Handy an und einen weiteren um Pushes mit Freunden zu teilen.
          </p>
        </div>
        <div className="text-xs text-slate-500 shrink-0">{activeCount} aktiv</div>
      </div>

      <label className="block mb-1">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Server</span>
        <input
          type="url"
          value={draft.server}
          onChange={(e) => { setDraft({ ...draft, server: e.target.value }); setDirty(true); }}
          className="mt-1 w-full text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
        />
      </label>
      <p className="text-[11px] text-slate-500 mb-3">
        Public-Server: <code className="font-mono">https://ntfy.sh</code> (Rate-Limit ~60/h pro IP) · Self-Host:
        eigene Domain, z.B. <code className="font-mono">https://ntfy.adogan.de</code> (kein Rate-Limit).
      </p>

      <div className="space-y-2">
        {draft.channels.map((ch, i) => (
          <ChannelRow
            key={ch.id}
            channel={ch}
            server={draft.server}
            onChange={(patch) => updateChannel(i, patch)}
            onRemove={() => removeChannel(i)}
          />
        ))}
        {draft.channels.length === 0 && (
          <div className="text-sm text-slate-500 py-3 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded">
            Noch keine Channels — füge einen hinzu, sonst gibt's keine Push-Notifications.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={addChannel}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-sm"
        >
          <Plus size={14} /> Channel
        </button>
        <button
          onClick={() => save.mutate(draft)}
          disabled={!dirty || save.isPending}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          <Save size={14} /> {save.isPending ? "Speichere…" : "Speichern"}
        </button>
        {dirty && (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-sm"
          >
            <RotateCcw size={14} /> Verwerfen
          </button>
        )}
      </div>
      {save.isSuccess && !dirty && (
        <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          Gespeichert — wirksam beim nächsten Event (max. 60 s Cache).
        </div>
      )}
      {save.error && (
        <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          Fehler: {String(save.error)}
        </div>
      )}
    </section>
  );
}

function ChannelRow({
  channel,
  server,
  onChange,
  onRemove,
}: {
  channel: NtfyChannel;
  server: string;
  onChange: (patch: Partial<NtfyChannel>) => void;
  onRemove: () => void;
}) {
  const [testState, setTestState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string>("");

  const onTest = async () => {
    if (!channel.topic || channel.topic.length < 3) return;
    setTestState("sending");
    setTestError("");
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(
        "/api/settings/ntfyConfig/test",
        { topic: channel.topic },
      );
      if (result.ok) {
        setTestState("ok");
        setTimeout(() => setTestState("idle"), 3000);
      } else {
        setTestState("fail");
        setTestError(result.error ?? "unknown error");
      }
    } catch (err) {
      setTestState("fail");
      setTestError(String(err));
    }
  };

  return (
    <div
      className={clsx(
        "rounded border p-3",
        channel.enabled
          ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800/50 dark:bg-emerald-900/10"
          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
        <div className="flex items-center gap-2 sm:items-start sm:pt-1.5">
          <input
            type="checkbox"
            checked={channel.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-4 w-4 shrink-0"
            aria-label="enabled"
          />
          <span className="text-xs font-medium sm:hidden truncate">
            {channel.name || "Channel"}
          </span>
        </div>
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[11px] text-slate-500">Name</span>
            <input
              value={channel.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="z.B. Privat"
              className="mt-0.5 w-full text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[11px] text-slate-500">Topic</span>
            <div className="flex gap-1 mt-0.5">
              <input
                value={channel.topic}
                onChange={(e) => onChange({ topic: e.target.value.trim() })}
                placeholder="pokemon-watcher-…"
                className="flex-1 min-w-0 text-sm font-mono px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <button
                onClick={() => onChange({ topic: randomTopic() })}
                title="Random Topic generieren"
                className="shrink-0 px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 break-all">
              {server.replace(/\/$/, "")}/{channel.topic || "(leer)"}
            </div>
          </label>
        </div>
        <div className="shrink-0 flex flex-row gap-1 sm:flex-col sm:self-start">
          <button
            onClick={onTest}
            disabled={!channel.topic || testState === "sending"}
            title="Test-Push senden"
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 disabled:opacity-50"
          >
            <Send size={11} /> <span className="hidden sm:inline">Test</span>
          </button>
          <button
            onClick={onRemove}
            title="Channel löschen"
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200"
          >
            <Trash2 size={11} /> <span className="hidden sm:inline">Löschen</span>
          </button>
        </div>
      </div>
      {testState === "ok" && (
        <div className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          ✓ Test-Push gesendet — Check die ntfy-App.
        </div>
      )}
      {testState === "sending" && (
        <div className="mt-1.5 text-xs text-slate-500">Sende Test-Push…</div>
      )}
      {testState === "fail" && (
        <div className="mt-1.5 text-xs text-rose-700 dark:text-rose-400">✗ {testError}</div>
      )}
    </div>
  );
}

function NegativesSection() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/api/settings"),
  });

  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings.data?.globalNegativeTerms) {
      setDraft(settings.data.globalNegativeTerms.join("\n"));
      setDirty(false);
    }
  }, [settings.data?.globalNegativeTerms]);

  const save = useMutation({
    mutationFn: (terms: string[]) =>
      api.put<{ key: string; value: string[] }>("/api/settings/globalNegativeTerms", { value: terms }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const resetToDefaults = useMutation({
    mutationFn: () => api.delete("/api/settings/globalNegativeTerms"),
    onSuccess: () => {
      // Backend hat die DB-Row gelöscht — der nächste GET liefert die in-Code Defaults
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const onSave = () => {
    const terms = draft.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    save.mutate(terms);
  };

  const onReset = () => {
    if (settings.data?.globalNegativeTerms) {
      setDraft(settings.data.globalNegativeTerms.join("\n"));
      setDirty(false);
    }
  };

  const onResetToDefaults = () => {
    if (
      window.confirm(
        "Negative-Terms auf System-Standardwerte zurücksetzen?\n\nDeine aktuellen Einträge gehen verloren.",
      )
    ) {
      resetToDefaults.mutate();
    }
  };

  const currentCount = draft.split("\n").filter((s) => s.trim().length > 0).length;

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="font-semibold">Globale Negative-Terms</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
            Listings, deren Titel einen dieser Begriffe enthält, werden vom Matcher komplett verworfen — egal welches Set. Ein Begriff pro Zeile, case-insensitive.
          </p>
        </div>
        <div className="text-xs text-slate-500 shrink-0">{currentCount} Einträge</div>
      </div>
      <textarea
        rows={10}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        spellCheck={false}
        className="w-full font-mono text-xs px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 leading-snug"
        placeholder={"Twilight Masquerade\nKalender\n..."}
      />
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          onClick={onSave}
          disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          <Save size={14} /> {save.isPending ? "Speichere…" : "Speichern"}
        </button>
        {dirty && (
          <button onClick={onReset} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-sm">
            <RotateCcw size={14} /> Verwerfen
          </button>
        )}
        {save.isSuccess && !dirty && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Gespeichert.</span>
        )}
        <button
          onClick={onResetToDefaults}
          disabled={resetToDefaults.isPending}
          title="Setzt die Liste auf die System-Standardwerte zurück (überschreibt deine Einträge)"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 ml-auto"
        >
          <RotateCcw size={14} /> {resetToDefaults.isPending ? "Setze zurück…" : "Auf Standard zurücksetzen"}
        </button>
      </div>
    </section>
  );
}


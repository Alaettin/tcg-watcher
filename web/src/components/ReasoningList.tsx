interface Props {
  lines: string[];
  title?: string;
}

export function ReasoningList({ lines, title = "Warum diese Empfehlung" }: Props) {
  if (lines.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-slate-400 select-none">•</span>
            <span className="flex-1">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

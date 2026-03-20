import { ChevronLeft, ChevronRight, Radio } from "lucide-react";

export interface CycleOption {
  index: number;
  label: string;      // e.g. "Cycle #330"
  timeAgo: string;    // e.g. "2m ago"
}

interface CycleNavProps {
  options: CycleOption[];
  selectedIndex: number;   // index into options array
  isLive: boolean;
  onSelect: (optionIndex: number) => void;
  onGoLive: () => void;
}

export default function CycleNav({ options, selectedIndex, isLive, onSelect, onGoLive }: CycleNavProps) {
  if (options.length === 0) return null;

  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex < options.length - 1;
  const current = options[selectedIndex];

  return (
    <div className="flex items-center gap-1">
      {/* Prev */}
      <button
        onClick={() => canPrev && onSelect(selectedIndex - 1)}
        disabled={!canPrev}
        className="w-5 h-5 flex items-center justify-center transition-colors disabled:opacity-20"
        style={{ color: canPrev ? "#94a3b8" : undefined }}
        title="Previous cycle"
      >
        <ChevronLeft size={12} strokeWidth={2} />
      </button>

      {/* Dropdown */}
      <div className="relative">
        <select
          value={selectedIndex}
          onChange={(e) => {
            const idx = Number(e.target.value);
            onSelect(idx);
          }}
          className="appearance-none text-[10px] font-mono pl-2 pr-5 py-0.5 cursor-pointer focus:outline-none transition-colors"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.18)",
            color: "#94a3b8",
          }}
        >
          {options.map((opt, i) => (
            <option
              key={opt.index}
              value={i}
              style={{ background: "#0c0c1f", color: "#e2e8f0" }}
            >
              {opt.label} · {opt.timeAgo}{i === options.length - 1 ? " ● LIVE" : ""}
            </option>
          ))}
        </select>
        <ChevronRight
          size={9}
          strokeWidth={2}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "#475569", transform: "translateY(-50%) rotate(90deg)" }}
        />
      </div>

      {/* Next */}
      <button
        onClick={() => canNext && onSelect(selectedIndex + 1)}
        disabled={!canNext}
        className="w-5 h-5 flex items-center justify-center transition-colors disabled:opacity-20"
        style={{ color: canNext ? "#94a3b8" : undefined }}
        title="Next cycle"
      >
        <ChevronRight size={12} strokeWidth={2} />
      </button>

      {/* LIVE badge — shown when not on latest, clicking resets to auto-follow */}
      {!isLive && (
        <button
          onClick={onGoLive}
          className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 transition-colors hover:border-accent-green/40"
          style={{
            background: "rgba(0,229,160,0.06)",
            border: "1px solid rgba(0,229,160,0.15)",
            color: "#00e5a0",
          }}
          title="Jump to latest cycle"
        >
          <Radio size={8} strokeWidth={2} />
          LIVE
        </button>
      )}

      {/* Pulse when on latest */}
      {isLive && (
        <span
          className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5"
          style={{
            background: "rgba(0,229,160,0.06)",
            border: "1px solid rgba(0,229,160,0.18)",
            color: "#00e5a0",
          }}
        >
          <div className="w-1 h-1 rounded-full bg-accent-green animate-pulse-glow" />
          LIVE
        </span>
      )}
    </div>
  );
}

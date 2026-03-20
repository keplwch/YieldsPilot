import { useState, useEffect, useRef } from "react";
import { Brain, ShieldCheck } from "lucide-react";
import CycleNav, { type CycleOption } from "./CycleNav";

interface ReasoningLine {
  prefix: string;
  text: string;
  isPrivate?: boolean;
}

interface ReasoningPanelProps {
  lines: ReasoningLine[];
  cycleOptions: CycleOption[];
  selectedCycleIndex: number;
  isLive: boolean;
  onCycleSelect: (optionIndex: number) => void;
  onGoLive: () => void;
}

export default function ReasoningPanel({
  lines,
  cycleOptions,
  selectedCycleIndex,
  isLive,
  onCycleSelect,
  onGoLive,
}: ReasoningPanelProps) {
  const [visibleLines, setVisibleLines] = useState(lines.length);
  const [lastUpdate, setLastUpdate] = useState("just now");
  const prevSerializedRef = useRef(JSON.stringify(lines));

  useEffect(() => {
    const serialized = JSON.stringify(lines);
    if (serialized !== prevSerializedRef.current && lines.length > 0) {
      prevSerializedRef.current = serialized;
      setVisibleLines(0);
      setLastUpdate("just now");
      lines.forEach((_, i) => {
        setTimeout(() => setVisibleLines(i + 1), (i + 1) * 350);
      });
    }
  }, [lines]);

  return (
    <div className="card-wrap mb-5">
      <div className="card-body">
        {/* Header */}
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.22)" }}>
              <Brain size={12} className="text-accent-purple" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Agent Reasoning</span>
            <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 font-mono font-semibold tracking-widest"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}>
              <ShieldCheck size={9} strokeWidth={2} />
              VENICE · PRIVATE
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CycleNav
              options={cycleOptions}
              selectedIndex={selectedCycleIndex}
              isLive={isLive}
              onSelect={onCycleSelect}
              onGoLive={onGoLive}
            />
            <span className="text-[10px] text-text-muted font-mono">{lastUpdate}</span>
          </div>
        </div>

        {/* Terminal output */}
        <div className="px-6 py-4 font-mono text-[12px] leading-[2] text-text-secondary h-[200px] overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.15)" }}>
          {lines.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[11px] text-text-muted">No reasoning data yet — waiting for agent cycles</span>
            </div>
          ) : (
            <>
              {lines.slice(0, visibleLines).map((line, i) => (
                <div key={`${i}-${line.prefix}`} className="flex gap-3 animate-fade-in">
                  <span className="flex-shrink-0 select-none" style={{ color: "rgba(99,102,241,0.6)" }}>{line.prefix}</span>
                  <span className={line.isPrivate ? "text-text-muted italic" : "text-text-secondary"}>
                    {line.text}
                  </span>
                </div>
              ))}
              {visibleLines < lines.length && (
                <div className="flex gap-3">
                  <span className="select-none" style={{ color: "rgba(99,102,241,0.35)" }}>[?]</span>
                  <span className="text-text-muted cursor-blink">_</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

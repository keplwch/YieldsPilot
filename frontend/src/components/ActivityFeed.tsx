import { CheckCircle, Zap, Brain, Radio, AlertTriangle } from "lucide-react";
import type { FeedItem } from "../data/transformers";
import CycleNav, { type CycleOption } from "./CycleNav";
import { NETWORK } from "@/config/network";

const phaseConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
  discover: { bg: "rgba(6,182,212,0.08)",  text: "#06b6d4", border: "rgba(6,182,212,0.22)", label: "DISCOVER" },
  plan:     { bg: "rgba(99,102,241,0.08)", text: "#818cf8", border: "rgba(99,102,241,0.22)", label: "PLAN" },
  execute:  { bg: "rgba(0,229,160,0.08)",  text: "#00e5a0", border: "rgba(0,229,160,0.22)", label: "EXECUTE" },
  verify:   { bg: "rgba(245,158,11,0.08)", text: "#f59e0b", border: "rgba(245,158,11,0.22)", label: "VERIFY" },
  alert:    { bg: "rgba(244,63,94,0.08)",  text: "#f43f5e", border: "rgba(244,63,94,0.22)", label: "ALERT" },
  error:    { bg: "rgba(244,63,94,0.06)",  text: "#f43f5e", border: "rgba(244,63,94,0.18)", label: "ERROR" },
};

const phaseIcons: Record<string, typeof CheckCircle> = {
  discover: Radio, plan: Brain, execute: Zap, verify: CheckCircle, alert: AlertTriangle, error: AlertTriangle,
};

function FeedEntry({ item, index }: { item: FeedItem; index: number }) {
  const Icon = phaseIcons[item.phase] ?? Radio;
  const cfg = phaseConfig[item.phase] ?? phaseConfig.discover;

  return (
    <div
      className="flex gap-4 px-6 py-4 border-b transition-colors animate-slide-in"
      style={{ borderColor: "rgba(99,102,241,0.07)", animationDelay: `${index * 0.04}s` }}
    >
      <div className="flex-shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center"
        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
        <Icon size={13} style={{ color: cfg.text }} strokeWidth={2} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-display font-semibold text-text-primary">{item.title}</span>
          <span className="text-[9px] px-1.5 py-0.5 font-mono font-bold tracking-widest"
            style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
        </div>
        <div className="text-[12px] text-text-secondary leading-relaxed font-body">{item.desc}</div>
        {item.tx && (
          <a href={`${NETWORK.explorerBase}/tx/${item.tx}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-mono text-text-muted hover:text-accent-purple transition-colors">
            <span className="opacity-50">tx:</span>
            <span>{item.tx.length > 12 ? `${item.tx.slice(0, 8)}...${item.tx.slice(-4)}` : item.tx}</span>
            <span className="opacity-50">↗</span>
          </a>
        )}
      </div>

      <div className="text-[10px] text-text-muted font-mono whitespace-nowrap flex-shrink-0 mt-1">{item.time}</div>
    </div>
  );
}

interface ActivityFeedProps {
  items: FeedItem[];
  cycleOptions: CycleOption[];
  selectedCycleIndex: number;
  isLive: boolean;
  onCycleSelect: (optionIndex: number) => void;
  onGoLive: () => void;
}

export default function ActivityFeed({
  items,
  cycleOptions,
  selectedCycleIndex,
  isLive,
  onCycleSelect,
  onGoLive,
}: ActivityFeedProps) {
  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.2)" }}>
              <Zap size={12} className="text-accent-green" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Agent Activity</span>
          </div>
          <div className="flex items-center gap-3">
            <CycleNav
              options={cycleOptions}
              selectedIndex={selectedCycleIndex}
              isLive={isLive}
              onSelect={onCycleSelect}
              onGoLive={onGoLive}
            />
            <span className="text-[10px] font-mono text-text-muted">{items.length} events</span>
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-[11px] font-mono text-text-muted">No activity yet - waiting for agent cycles</div>
            </div>
          ) : (
            items.map((item, i) => (
              <FeedEntry key={`${item.phase}-${item.time}-${i}`} item={item} index={i} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

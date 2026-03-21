import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEther, formatEther, isAddress } from "viem";
import { NETWORK } from "@/config/network";
import {
  Settings,
  ArrowUpFromLine,
  AlertTriangle,
  Shield,
  Plus,
  Minus,
  UserCog,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Percent,
  Target,
} from "lucide-react";

// ── Contract ABIs ─────────────────────────────────────────────

const TREASURY_ABI = [
  { name: "withdrawPrincipal", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdrawPrincipalAsWstETH", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "stETHAmount", type: "uint256" }], outputs: [] },
  { name: "emergencyWithdraw", type: "function", stateMutability: "nonpayable",
    inputs: [], outputs: [] },
  { name: "withdrawToken", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "setMaxDailySpendBps", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_bps", type: "uint256" }], outputs: [] },
  { name: "addTarget", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "target", type: "address" }], outputs: [] },
  { name: "removeTarget", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "target", type: "address" }], outputs: [] },
  { name: "transferOwnership", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }], outputs: [] },
  { name: "setPaused", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }], outputs: [] },
  { name: "owner", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { name: "principal", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "availableYield", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxDailySpendBps", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "dailySpendRemaining", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getAllowedTargets", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "address[]" }] },
  { name: "paused", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "bool" }] },
  { name: "agent", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
] as const;

// ── Styles ────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.15)",
  border: "1px solid rgba(99,102,241,0.08)",
  padding: "16px",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.22)",
  border: "1px solid rgba(99,102,241,0.14)",
  color: "#e2e8f0",
  width: "100%",
  padding: "8px 12px",
  fontSize: "12px",
  fontFamily: "monospace",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  background: "#6366f1",
  clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
};

const btnDanger: React.CSSProperties = {
  background: "rgba(244,63,94,0.12)",
  border: "1px solid rgba(244,63,94,0.25)",
  color: "#f43f5e",
};

const btnOutline: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(99,102,241,0.2)",
  color: "#94a3b8",
};

// ── Props ─────────────────────────────────────────────────────

const REGISTRY_ABI = [
  { name: "userTreasury", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "address" }] },
] as const;

interface TreasuryManagementProps {
  treasuryAddress?: string;
  registryAddress?: string;
}

// ── Sub-components ────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, color = "#6366f1" }: { icon: any; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
        <Icon size={10} style={{ color }} strokeWidth={2} />
      </div>
      <span className="text-[11px] font-display font-semibold text-text-primary uppercase tracking-wider">{label}</span>
    </div>
  );
}

function TxStatus({ hash, label }: { hash?: `0x${string}`; label: string }) {
  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  if (!hash) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      {isSuccess ? (
        <CheckCircle2 size={12} className="text-accent-green" />
      ) : (
        <Loader2 size={12} className="text-accent-purple animate-spin" />
      )}
      <span className="text-[10px] font-mono text-text-muted">{label}</span>
      <a href={`${NETWORK.explorerBase}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
        className="text-[10px] font-mono text-accent-purple hover:underline flex items-center gap-0.5">
        {hash.slice(0, 10)}... <ExternalLink size={8} />
      </a>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export default function TreasuryManagement({ treasuryAddress, registryAddress }: TreasuryManagementProps) {
  const { address, isConnected } = useAccount();
  const registryAddr = registryAddress as `0x${string}` | undefined;

  // Read the connected user's treasury directly from Registry - most reliable source
  const { data: registryTreasury } = useReadContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "userTreasury",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!registryAddr },
  });
  const registryTreasuryAddr = registryTreasury && registryTreasury !== "0x0000000000000000000000000000000000000000"
    ? (registryTreasury as `0x${string}`)
    : undefined;

  // Use registry-resolved treasury first, fall back to prop
  const treasuryAddr = registryTreasuryAddr ?? (treasuryAddress as `0x${string}` | undefined);

  // ── Expand/collapse ──
  const [expanded, setExpanded] = useState(false);

  // ── Form state ──
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAsWstETH, setWithdrawAsWstETH] = useState(false);
  const [newBps, setNewBps] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [removeTargetAddr, setRemoveTargetAddr] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [emergencyConfirm, setEmergencyConfirm] = useState(false);

  // ── Read contract state ──
  const { data: owner } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "owner",
    query: { enabled: !!treasuryAddr } });
  const { data: principalRaw } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "principal",
    query: { enabled: !!treasuryAddr } });
  const { data: yieldRaw } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "availableYield",
    query: { enabled: !!treasuryAddr } });
  const { data: maxBps } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "maxDailySpendBps",
    query: { enabled: !!treasuryAddr } });
  const { data: dailyRemaining } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "dailySpendRemaining",
    query: { enabled: !!treasuryAddr } });
  const { data: allowedTargets } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "getAllowedTargets",
    query: { enabled: !!treasuryAddr } });
  const { data: isPaused } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "paused",
    query: { enabled: !!treasuryAddr } });
  const { data: agentAddr } = useReadContract({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "agent",
    query: { enabled: !!treasuryAddr } });

  const isOwner = address && owner && address.toLowerCase() === (owner as string).toLowerCase();
  const principalFormatted = principalRaw ? parseFloat(formatEther(principalRaw)).toFixed(6) : "0";
  const yieldFormatted = yieldRaw ? parseFloat(formatEther(yieldRaw)).toFixed(6) : "0";
  const dailyRemainingFormatted = dailyRemaining ? parseFloat(formatEther(dailyRemaining)).toFixed(6) : "0";
  const currentBps = maxBps ? Number(maxBps) : 0;

  // ── Write hooks ──
  const { writeContract: writeWithdraw, data: withdrawHash, isPending: withdrawPending, error: withdrawError } = useWriteContract();
  const { writeContract: writeEmergency, data: emergencyHash, isPending: emergencyPending, error: emergencyError } = useWriteContract();
  const { writeContract: writeBps, data: bpsHash, isPending: bpsPending, error: bpsError } = useWriteContract();
  const { writeContract: writeAddTarget, data: addTargetHash, isPending: addTargetPending, error: addTargetError } = useWriteContract();
  const { writeContract: writeRemoveTarget, data: removeTargetHash, isPending: removeTargetPending, error: removeTargetError } = useWriteContract();
  const { writeContract: writeOwnership, data: ownershipHash, isPending: ownershipPending, error: ownershipError } = useWriteContract();
  const { writeContract: writePause, data: pauseHash, isPending: pausePending } = useWriteContract();

  // ── Handlers ──
  const handleWithdraw = () => {
    if (!withdrawAmount || !treasuryAddr) return;
    const fn = withdrawAsWstETH ? "withdrawPrincipalAsWstETH" : "withdrawPrincipal";
    const argName = withdrawAsWstETH ? "stETHAmount" : "amount";
    writeWithdraw({ address: treasuryAddr, abi: TREASURY_ABI, functionName: fn as any, args: [parseEther(withdrawAmount)] });
  };

  const handleEmergency = () => {
    if (!treasuryAddr || !emergencyConfirm) return;
    writeEmergency({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "emergencyWithdraw" });
  };

  const handleSetBps = () => {
    if (!newBps || !treasuryAddr) return;
    writeBps({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "setMaxDailySpendBps", args: [BigInt(newBps)] });
  };

  const handleAddTarget = () => {
    if (!newTarget || !treasuryAddr || !isAddress(newTarget)) return;
    writeAddTarget({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "addTarget", args: [newTarget as `0x${string}`] });
  };

  const handleRemoveTarget = (addr: string) => {
    if (!treasuryAddr) return;
    writeRemoveTarget({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "removeTarget", args: [addr as `0x${string}`] });
  };

  const handleTransferOwnership = () => {
    if (!newOwner || !treasuryAddr || !isAddress(newOwner)) return;
    writeOwnership({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "transferOwnership", args: [newOwner as `0x${string}`] });
  };

  const handleTogglePause = () => {
    if (!treasuryAddr) return;
    writePause({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "setPaused", args: [!isPaused] });
  };

  // ── Guard: don't show if no treasury or not owner ──
  if (!treasuryAddr || !isConnected) return null;

  return (
    <div className="card-wrap">
      <div className="card-body">
        {/* Header - always visible */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="panel-header w-full cursor-pointer hover:bg-white/[0.01] transition-colors"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Settings size={12} className="text-accent-purple" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Treasury Management</span>
          </div>
          <div className="flex items-center gap-2">
            {isPaused && (
              <span className="text-[9px] px-2 py-0.5 font-mono font-semibold tracking-widest"
                style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.2)", color: "#f43f5e" }}>
                PAUSED
              </span>
            )}
            {!isOwner && (
              <span className="text-[9px] px-2 py-0.5 font-mono text-text-muted"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                VIEW ONLY
              </span>
            )}
            {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
          </div>
        </button>

        {expanded && (
          <div className="p-4 flex flex-col gap-4">

            {/* ── Status bar ── */}
            <div className="grid grid-cols-2 gap-2">
              <div style={sectionStyle}>
                <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">Daily Limit</div>
                <div className="text-[14px] font-mono text-text-primary">{(currentBps / 100).toFixed(0)}%</div>
                <div className="text-[10px] text-text-muted font-mono mt-0.5">of yield / day</div>
              </div>
              <div style={sectionStyle}>
                <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">Remaining Today</div>
                <div className="text-[14px] font-mono text-accent-green">{dailyRemainingFormatted}</div>
                <div className="text-[10px] text-text-muted font-mono mt-0.5">stETH spendable</div>
              </div>
            </div>

            {/* ── Allowed Targets ── */}
            <div style={sectionStyle}>
              <SectionHeader icon={Target} label="Allowed Targets" />
              {allowedTargets && (allowedTargets as string[]).length > 0 ? (
                <div className="flex flex-col gap-1.5 mb-3">
                  {(allowedTargets as string[]).map((t) => (
                    <div key={t} className="flex items-center justify-between py-1.5 px-2"
                      style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(99,102,241,0.06)" }}>
                      <a href={`${NETWORK.explorerBase}/address/${t}`} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] font-mono text-accent-purple hover:underline flex items-center gap-1">
                        {t.slice(0, 8)}...{t.slice(-6)} <ExternalLink size={8} />
                      </a>
                      {isOwner && (
                        <button onClick={() => handleRemoveTarget(t)}
                          disabled={removeTargetPending}
                          className="text-[9px] font-mono px-1.5 py-0.5 cursor-pointer transition-colors hover:bg-red-500/10"
                          style={{ color: "#f43f5e", border: "1px solid rgba(244,63,94,0.15)" }}>
                          <Minus size={9} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-text-muted font-mono mb-3">No targets configured</p>
              )}
              {isOwner && (
                <div className="flex gap-1.5">
                  <input type="text" placeholder="0x..." value={newTarget} onChange={(e) => setNewTarget(e.target.value)}
                    style={{ ...inputStyle, fontSize: "10px" }} />
                  <button onClick={handleAddTarget} disabled={addTargetPending || !newTarget}
                    className="px-3 py-1.5 text-[10px] font-mono text-white transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1"
                    style={btnPrimary}>
                    <Plus size={10} /> Add
                  </button>
                </div>
              )}
              <TxStatus hash={addTargetHash} label="Adding target" />
              <TxStatus hash={removeTargetHash} label="Removing target" />
              {addTargetError && <p className="text-[10px] text-red-400 mt-1 font-mono">{addTargetError.message.split("\n")[0].slice(0, 80)}</p>}
            </div>

            {/* ── Withdraw Principal ── */}
            {isOwner && (
              <div style={sectionStyle}>
                <SectionHeader icon={ArrowUpFromLine} label="Withdraw Principal" />
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-muted font-mono">Available: {principalFormatted} stETH</span>
                  <button onClick={() => setWithdrawAmount(principalRaw ? formatEther(principalRaw) : "0")}
                    className="text-[10px] text-accent-green font-mono hover:underline cursor-pointer">MAX</button>
                </div>
                <input type="number" step="0.001" min="0" placeholder="Amount" value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)} style={inputStyle} />
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={withdrawAsWstETH} onChange={(e) => setWithdrawAsWstETH(e.target.checked)}
                    className="accent-indigo-500" />
                  <span className="text-[10px] text-text-secondary font-mono">Withdraw as wstETH (non-rebasing)</span>
                </label>
                <button onClick={handleWithdraw} disabled={withdrawPending || !withdrawAmount}
                  className="w-full mt-3 py-2 text-[11px] font-display font-semibold text-white transition-colors disabled:opacity-40 cursor-pointer"
                  style={btnPrimary}>
                  {withdrawPending ? "Confirming..." : `Withdraw ${withdrawAmount || "0"} ${withdrawAsWstETH ? "as wstETH" : "stETH"}`}
                </button>
                <TxStatus hash={withdrawHash} label="Withdrawing" />
                {withdrawError && <p className="text-[10px] text-red-400 mt-1 font-mono">{withdrawError.message.split("\n")[0].slice(0, 80)}</p>}
              </div>
            )}

            {/* ── Settings: Daily Spend BPS ── */}
            {isOwner && (
              <div style={sectionStyle}>
                <SectionHeader icon={Percent} label="Daily Spend Limit" />
                <div className="text-[10px] text-text-muted font-mono mb-2">
                  Current: {(currentBps / 100).toFixed(0)}% ({currentBps} bps)
                </div>
                <div className="flex gap-1.5">
                  <input type="number" min="0" max="10000" placeholder="BPS (e.g. 5000 = 50%)" value={newBps}
                    onChange={(e) => setNewBps(e.target.value)} style={{ ...inputStyle, fontSize: "11px" }} />
                  <button onClick={handleSetBps} disabled={bpsPending || !newBps}
                    className="px-4 py-1.5 text-[10px] font-mono text-white transition-colors disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    style={btnPrimary}>
                    Set
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1 mt-2">
                  {[1000, 2500, 5000, 10000].map((preset) => (
                    <button key={preset} onClick={() => setNewBps(String(preset))}
                      className="text-[10px] font-mono py-1 transition-all cursor-pointer text-center"
                      style={{ ...btnOutline, borderColor: currentBps === preset ? "rgba(99,102,241,0.4)" : undefined }}>
                      {preset / 100}%
                    </button>
                  ))}
                </div>
                <TxStatus hash={bpsHash} label="Updating limit" />
                {bpsError && <p className="text-[10px] text-red-400 mt-1 font-mono">{bpsError.message.split("\n")[0].slice(0, 80)}</p>}
              </div>
            )}

            {/* ── Pause / Unpause ── */}
            {isOwner && (
              <div style={sectionStyle}>
                <SectionHeader icon={Shield} label="Agent Control" color={isPaused ? "#f43f5e" : "#00e5a0"} />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-text-primary">
                      Agent: <span className="text-accent-purple">{agentAddr ? `${(agentAddr as string).slice(0, 8)}...${(agentAddr as string).slice(-4)}` : "-"}</span>
                    </div>
                    <div className="text-[10px] text-text-muted font-mono mt-0.5">
                      Status: {isPaused ? <span style={{ color: "#f43f5e" }}>Paused</span> : <span style={{ color: "#00e5a0" }}>Active</span>}
                    </div>
                  </div>
                  <button onClick={handleTogglePause} disabled={pausePending}
                    className="px-3 py-1.5 text-[10px] font-mono font-semibold transition-colors cursor-pointer"
                    style={isPaused ? { background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.25)", color: "#00e5a0" } : btnDanger}>
                    {pausePending ? "..." : isPaused ? "Resume" : "Pause"}
                  </button>
                </div>
                <TxStatus hash={pauseHash} label={isPaused ? "Resuming" : "Pausing"} />
              </div>
            )}

            {/* ── Transfer Ownership ── */}
            {isOwner && (
              <div style={sectionStyle}>
                <SectionHeader icon={UserCog} label="Transfer Ownership" />
                <p className="text-[10px] text-text-muted font-mono mb-2">This is irreversible. The new owner gains full control.</p>
                <div className="flex gap-1.5">
                  <input type="text" placeholder="New owner address (0x...)" value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)} style={{ ...inputStyle, fontSize: "10px" }} />
                  <button onClick={handleTransferOwnership} disabled={ownershipPending || !newOwner}
                    className="px-3 py-1.5 text-[10px] font-mono transition-colors disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    style={btnDanger}>
                    Transfer
                  </button>
                </div>
                <TxStatus hash={ownershipHash} label="Transferring" />
                {ownershipError && <p className="text-[10px] text-red-400 mt-1 font-mono">{ownershipError.message.split("\n")[0].slice(0, 80)}</p>}
              </div>
            )}

            {/* ── Emergency Withdraw ── */}
            {isOwner && (
              <div style={{ ...sectionStyle, borderColor: "rgba(244,63,94,0.15)" }}>
                <SectionHeader icon={AlertTriangle} label="Emergency Withdraw" color="#f43f5e" />
                <p className="text-[10px] text-text-muted font-mono mb-3">
                  Withdraws ALL funds (principal + yield + any tokens) and pauses the treasury permanently.
                </p>
                <label className="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" checked={emergencyConfirm} onChange={(e) => setEmergencyConfirm(e.target.checked)}
                    className="accent-red-500" />
                  <span className="text-[10px] font-mono" style={{ color: "#f43f5e" }}>
                    I understand this withdraws everything and pauses the treasury
                  </span>
                </label>
                <button onClick={handleEmergency} disabled={emergencyPending || !emergencyConfirm}
                  className="w-full py-2 text-[11px] font-display font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                  style={btnDanger}>
                  {emergencyPending ? "Confirming..." : "Emergency Withdraw All"}
                </button>
                <TxStatus hash={emergencyHash} label="Emergency withdraw" />
                {emergencyError && <p className="text-[10px] text-red-400 mt-1 font-mono">{emergencyError.message.split("\n")[0].slice(0, 80)}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

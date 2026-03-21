import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Layers, Lock, Loader2, CheckCircle2, ExternalLink, ArrowRight } from "lucide-react";
import { NETWORK } from "@/config/network";

const WSTETH_ADDRESS = NETWORK.wstETH;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const WSTETH_ABI = [
  ...ERC20_ABI,
  { name: "getStETHByWstETH", type: "function", stateMutability: "view",
    inputs: [{ name: "_wstETHAmount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const REGISTRY_ABI = [
  { name: "userTreasury", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "address" }] },
] as const;

const TREASURY_ABI = [
  { name: "depositWstETH", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "wstETHAmount", type: "uint256" }], outputs: [] },
] as const;

interface WstETHDepositPanelProps {
  registryAddress?: string;
}

type Step = "input" | "approving" | "depositing" | "success";

export default function WstETHDepositPanel({ registryAddress }: WstETHDepositPanelProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const { address, isConnected } = useAccount();
  const registryAddr = registryAddress as `0x${string}` | undefined;

  const { data: wstethBalance } = useReadContract({
    address: WSTETH_ADDRESS,
    abi: WSTETH_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: existingTreasury } = useReadContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "userTreasury",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!registryAddr },
  });

  const treasuryAddr = existingTreasury && existingTreasury !== "0x0000000000000000000000000000000000000000"
    ? (existingTreasury as `0x${string}`)
    : undefined;

  // Live stETH equivalent preview
  const parsedAmount = (() => {
    try { return amount ? parseEther(amount) : 0n; } catch { return 0n; }
  })();

  const { data: stethEquiv } = useReadContract({
    address: WSTETH_ADDRESS,
    abi: WSTETH_ABI,
    functionName: "getStETHByWstETH",
    args: [parsedAmount],
    query: { enabled: parsedAmount > 0n },
  });

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: WSTETH_ADDRESS,
    abi: WSTETH_ABI,
    functionName: "allowance",
    args: address && treasuryAddr ? [address, treasuryAddr] : undefined,
    query: { enabled: !!address && !!treasuryAddr },
  });

  const { writeContract: writeApprove, data: approveTxHash, isPending: isApprovePending, error: approveError, reset: resetApprove } = useWriteContract();
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { writeContract: writeDeposit, data: depositTxHash, isPending: isDepositPending, error: depositError, reset: resetDeposit } = useWriteContract();
  const { isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositTxHash });

  // Poll allowance while waiting for approval
  useEffect(() => {
    if (step !== "approving") return;
    const interval = setInterval(() => refetchAllowance(), 3000);
    return () => clearInterval(interval);
  }, [step, refetchAllowance]);

  // Proceed to deposit once allowance is sufficient
  useEffect(() => {
    if (step !== "approving" || !treasuryAddr || !amount) return;
    try {
      const amountWei = parseEther(amount);
      if (currentAllowance != null && currentAllowance >= amountWei) {
        setStep("depositing");
        writeDeposit({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "depositWstETH", args: [amountWei] });
      }
    } catch { /* ignore parse errors */ }
  }, [currentAllowance, step, amount, treasuryAddr]);

  useEffect(() => {
    if (approveConfirmed && step === "approving") refetchAllowance();
  }, [approveConfirmed, step]);

  useEffect(() => {
    if (depositConfirmed && step === "depositing") setStep("success");
  }, [depositConfirmed, step]);

  const handleDeposit = () => {
    if (!amount || parseFloat(amount) <= 0 || !treasuryAddr) return;
    const amountWei = parseEther(amount);
    if (currentAllowance && currentAllowance >= amountWei) {
      setStep("depositing");
      writeDeposit({ address: treasuryAddr, abi: TREASURY_ABI, functionName: "depositWstETH", args: [amountWei] });
    } else {
      setStep("approving");
      writeApprove({ address: WSTETH_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [treasuryAddr, amountWei] });
    }
  };

  const handleReset = () => { setStep("input"); setAmount(""); resetApprove(); resetDeposit(); };

  const balanceFormatted = wstethBalance ? parseFloat(formatEther(wstethBalance)).toFixed(6) : "0";
  const stethEquivFormatted = stethEquiv ? parseFloat(formatEther(stethEquiv)).toFixed(4) : null;
  const hasError = approveError || depositError;
  const errorMessage = (approveError || depositError)?.message?.split("\n")[0] ?? "";

  const btnBase: React.CSSProperties = {
    background: "linear-gradient(135deg, #4f46e5, #6366f1)",
    clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
  };

  // Wrap badge colours — teal/cyan to visually distinguish from stETH (purple)
  const wstBadgeStyle = { background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "#06b6d4" };

  if (!registryAddr) {
    return (
      <div className="card-wrap">
        <div className="card-body">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <Layers size={12} className="text-accent-blue" strokeWidth={2} />
              </div>
              <span className="text-[13px] font-display font-semibold text-text-primary">Deposit wstETH</span>
            </div>
          </div>
          <div className="p-6 text-center">
            <p className="text-[12px] text-text-muted font-mono">
              Registry not configured — set <span style={{ color: "#818cf8" }}>REGISTRY_CONTRACT</span> in your .env
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap">
      <div className="card-body">
        {/* Header */}
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
              <Layers size={12} className="text-accent-blue" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Deposit wstETH</span>
          </div>

          {/* Token badge */}
          <span className="text-[9px] px-2 py-0.5 font-mono font-semibold tracking-widest" style={wstBadgeStyle}>
            wstETH
          </span>
        </div>

        <div className="p-6">
          {/* Conversion info strip */}
          <div className="flex items-center gap-2 mb-4 px-3 py-2"
            style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)" }}>
            <span className="text-[10px] font-mono" style={{ color: "#06b6d4" }}>wstETH</span>
            <ArrowRight size={9} style={{ color: "#475569" }} />
            <span className="text-[10px] font-mono text-text-secondary">unwrapped to stETH internally</span>
            <span className="ml-auto text-[9px] font-mono text-text-muted">≈1.15× rate</span>
          </div>

          {!isConnected ? (
            <div className="text-center">
              <p className="text-[12px] text-text-secondary mb-4 font-body leading-relaxed">
                Connect your wallet to deposit wstETH into your Treasury.
              </p>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button onClick={openConnectModal}
                    className="w-full py-2.5 font-display font-semibold text-[12px] text-white transition-colors cursor-pointer"
                    style={btnBase}>
                    Connect Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            </div>
          ) : !treasuryAddr ? (
            /* No treasury — wstETH deposits require an existing treasury */
            <div className="text-center py-3">
              <div className="w-9 h-9 flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)" }}>
                <Lock size={16} className="text-accent-orange" strokeWidth={1.75} />
              </div>
              <p className="text-[12px] text-text-secondary mb-1 font-body leading-relaxed">
                No treasury found for this wallet.
              </p>
              <p className="text-[11px] text-text-muted font-mono">
                Deposit stETH first to create your treasury, then deposit wstETH.
              </p>
            </div>
          ) : step === "input" ? (
            <>
              {/* Balance row */}
              <div className="flex items-center justify-between mb-2 text-[11px]">
                <span className="text-text-muted font-mono">wstETH Balance</span>
                <button onClick={() => wstethBalance && setAmount(formatEther(wstethBalance))}
                  className="font-mono hover:underline cursor-pointer"
                  style={{ color: "#06b6d4" }}>
                  {balanceFormatted} wstETH
                </button>
              </div>

              {/* Amount input */}
              <div className="relative mb-2">
                <input type="number" step="0.001" min="0" placeholder="0.0" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-4 py-3 text-[14px] font-mono focus:outline-none transition-colors"
                  style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(6,182,212,0.18)", color: "#e2e8f0" }}
                  onFocus={e => e.currentTarget.style.borderColor = "rgba(6,182,212,0.42)"}
                  onBlur={e => e.currentTarget.style.borderColor = "rgba(6,182,212,0.18)"} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono" style={{ color: "#06b6d4" }}>wstETH</span>
              </div>

              {/* stETH equivalent preview */}
              {stethEquivFormatted && (
                <div className="flex items-center justify-between mb-3 px-2 py-1.5"
                  style={{ background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.1)" }}>
                  <span className="text-[10px] font-mono text-text-muted">stETH equivalent</span>
                  <span className="text-[11px] font-mono text-accent-green">≈ {stethEquivFormatted} stETH</span>
                </div>
              )}

              {/* Preset amounts */}
              <div className="grid grid-cols-4 gap-1.5 mb-4">
                {["0.01", "0.1", "1.0", "5.0"].map((preset) => (
                  <button key={preset} onClick={() => setAmount(preset)}
                    className="text-[11px] font-mono py-1.5 transition-all cursor-pointer"
                    style={{ background: "rgba(0,0,0,0.18)", border: "1px solid rgba(6,182,212,0.13)", color: "#94a3b8" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(6,182,212,0.38)"; e.currentTarget.style.color = "#e2e8f0"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(6,182,212,0.13)"; e.currentTarget.style.color = "#94a3b8"; }}>
                    {preset}
                  </button>
                ))}
              </div>

              <button onClick={handleDeposit} disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-2.5 font-display font-semibold text-[12px] text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                style={btnBase}>
                Deposit {amount || "0"} wstETH
              </button>
            </>
          ) : step === "approving" ? (
            <div className="text-center py-3">
              <div className="w-9 h-9 flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.22)" }}>
                <Lock size={16} className="text-accent-purple" strokeWidth={1.75} />
              </div>
              <div className="text-[13px] font-display font-semibold text-text-primary mb-1.5">Step 1/2 — Approving</div>
              <p className="text-[11px] text-text-muted font-body mb-3">
                {isApprovePending ? "Confirm in wallet..." : approveTxHash ? "Waiting for block..." : "Preparing..."}
              </p>
              {approveTxHash && (
                <a href={`${NETWORK.explorerBase}/tx/${approveTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-accent-purple hover:underline font-mono">
                  {approveTxHash.slice(0, 14)}... <ExternalLink size={9} />
                </a>
              )}
              <div className="mt-4 h-0.5" style={{ background: "rgba(99,102,241,0.12)" }}>
                <div className="h-full transition-all duration-1000 bg-accent-purple"
                  style={{ width: approveTxHash ? (approveConfirmed ? "50%" : "30%") : "10%" }} />
              </div>
            </div>
          ) : step === "depositing" ? (
            <div className="text-center py-3">
              <div className="w-9 h-9 flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.22)" }}>
                <Loader2 size={16} className="text-accent-blue animate-spin" strokeWidth={1.75} />
              </div>
              <div className="text-[13px] font-display font-semibold text-text-primary mb-1.5">Step 2/2 — Depositing</div>
              <p className="text-[11px] text-text-muted font-body mb-3">
                {isDepositPending ? "Confirm in wallet..." : depositTxHash ? "Unwrapping wstETH → stETH..." : "Preparing..."}
              </p>
              {depositTxHash && (
                <a href={`${NETWORK.explorerBase}/tx/${depositTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-accent-purple hover:underline font-mono">
                  {depositTxHash.slice(0, 14)}... <ExternalLink size={9} />
                </a>
              )}
              <div className="mt-4 h-0.5" style={{ background: "rgba(6,182,212,0.1)" }}>
                <div className="h-full transition-all duration-1000 bg-accent-blue"
                  style={{ width: depositTxHash ? (depositConfirmed ? "100%" : "70%") : "55%" }} />
              </div>
            </div>
          ) : step === "success" ? (
            <div className="text-center py-3">
              <div className="w-9 h-9 flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.22)" }}>
                <CheckCircle2 size={18} className="text-accent-green" strokeWidth={1.75} />
              </div>
              <div className="text-[13px] font-display font-semibold mb-1.5 text-accent-green">wstETH Deposited</div>
              <p className="text-[11px] text-text-secondary font-body mb-1 leading-relaxed">
                {amount} wstETH unwrapped and added to your Treasury principal.
              </p>
              {stethEquivFormatted && (
                <p className="text-[10px] text-text-muted font-mono mb-3">
                  ≈ {stethEquivFormatted} stETH locked as principal
                </p>
              )}
              {depositTxHash && (
                <a href={`${NETWORK.explorerBase}/tx/${depositTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mb-4 text-[10px] text-accent-purple hover:underline font-mono">
                  View transaction <ExternalLink size={9} />
                </a>
              )}
              <button onClick={handleReset}
                className="w-full py-2 text-[12px] font-body transition-all cursor-pointer"
                style={{ border: "1px solid rgba(6,182,212,0.18)", color: "#94a3b8", background: "transparent" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(6,182,212,0.4)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(6,182,212,0.18)"}>
                Done
              </button>
            </div>
          ) : null}

          {hasError && (
            <div className="mt-4 p-3" style={{ background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.18)" }}>
              <div className="text-[11px] font-mono mb-1.5" style={{ color: "#f43f5e" }}>{errorMessage.slice(0, 120)}</div>
              <button onClick={handleReset} className="text-[11px] text-accent-purple hover:underline font-mono cursor-pointer">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

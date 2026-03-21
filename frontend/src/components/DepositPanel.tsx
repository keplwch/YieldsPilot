import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowDownToLine, Lock, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

const STETH_ADDRESS = "0xB43d41AB3aD0f006b8A4d872FBA11f4858E23a87" as const;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const REGISTRY_ABI = [
  { name: "createTreasuryAndDeposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "userTreasury", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "address" }] },
] as const;

const TREASURY_DEPOSIT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

interface DepositPanelProps {
  registryAddress?: string;
  registryMode: boolean;
}

type Step = "input" | "approving" | "depositing" | "success";

export default function DepositPanel({ registryAddress, registryMode }: DepositPanelProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const { address, isConnected } = useAccount();
  const registryAddr = registryAddress as `0x${string}` | undefined;

  const { data: stethBalance } = useReadContract({ address: STETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: existingTreasury } = useReadContract({ address: registryAddr, abi: REGISTRY_ABI, functionName: "userTreasury",
    args: address ? [address] : undefined, query: { enabled: !!address && !!registryAddr } });
  const hasTreasury = existingTreasury && existingTreasury !== "0x0000000000000000000000000000000000000000";
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({ address: STETH_ADDRESS, abi: ERC20_ABI,
    functionName: "allowance", args: address && registryAddr ? [address, registryAddr] : undefined,
    query: { enabled: !!address && !!registryAddr } });

  const { writeContract: writeApprove, data: approveTxHash, isPending: isApprovePending, error: approveError, reset: resetApprove } = useWriteContract();
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { writeContract: writeDeposit, data: depositTxHash, isPending: isDepositPending, error: depositError, reset: resetDeposit } = useWriteContract();
  const { isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositTxHash });

  // For existing treasury: approve stETH to treasury directly, then call deposit()
  const { writeContract: writeApproveExisting, data: approveExistingHash, isPending: isApproveExistingPending, error: approveExistingError, reset: resetApproveExisting } = useWriteContract();
  const { isSuccess: approveExistingConfirmed } = useWaitForTransactionReceipt({ hash: approveExistingHash });
  const { writeContract: writeDepositExisting, data: depositExistingHash, isPending: isDepositExistingPending, error: depositExistingError, reset: resetDepositExisting } = useWriteContract();
  const { isSuccess: depositExistingConfirmed } = useWaitForTransactionReceipt({ hash: depositExistingHash });

  const treasuryAddr = hasTreasury ? (existingTreasury as `0x${string}`) : undefined;
  const { data: existingAllowance, refetch: refetchExistingAllowance } = useReadContract({ address: STETH_ADDRESS, abi: ERC20_ABI,
    functionName: "allowance", args: address && treasuryAddr ? [address, treasuryAddr] : undefined,
    query: { enabled: !!address && !!treasuryAddr } });

  // ── New-treasury flow (approve registry → createTreasuryAndDeposit) ──

  // Poll allowance every 3s while waiting for approval to land on-chain.
  useEffect(() => {
    if (step !== "approving") return;
    const interval = setInterval(() => {
      if (hasTreasury) refetchExistingAllowance();
      else refetchAllowance();
    }, 3000);
    return () => clearInterval(interval);
  }, [step, refetchAllowance, refetchExistingAllowance, hasTreasury]);

  // When allowance becomes sufficient (new treasury flow), proceed to deposit
  useEffect(() => {
    if (step !== "approving" || hasTreasury || !registryAddr || !amount) return;
    try {
      const amountWei = parseEther(amount);
      if (currentAllowance != null && currentAllowance >= amountWei) {
        setStep("depositing");
        writeDeposit({ address: registryAddr, abi: REGISTRY_ABI, functionName: "createTreasuryAndDeposit", args: [amountWei] });
      }
    } catch { /* ignore parse errors */ }
  }, [currentAllowance, step, amount, registryAddr, hasTreasury]);

  // When allowance becomes sufficient (existing treasury flow), proceed to deposit
  useEffect(() => {
    if (step !== "approving" || !hasTreasury || !treasuryAddr || !amount) return;
    try {
      const amountWei = parseEther(amount);
      if (existingAllowance != null && existingAllowance >= amountWei) {
        setStep("depositing");
        writeDepositExisting({ address: treasuryAddr, abi: TREASURY_DEPOSIT_ABI, functionName: "deposit", args: [amountWei] });
      }
    } catch { /* ignore parse errors */ }
  }, [existingAllowance, step, amount, treasuryAddr, hasTreasury]);

  // Fallback: receipt-based trigger in case allowance polling misses it
  useEffect(() => {
    if (approveConfirmed && step === "approving") {
      if (hasTreasury) refetchExistingAllowance();
      else if (registryAddr) refetchAllowance();
    }
  }, [approveConfirmed, step, hasTreasury]);

  useEffect(() => {
    if (approveExistingConfirmed && step === "approving") {
      refetchExistingAllowance();
    }
  }, [approveExistingConfirmed, step]);

  useEffect(() => {
    if (depositConfirmed && step === "depositing") setStep("success");
  }, [depositConfirmed, step]);

  useEffect(() => {
    if (depositExistingConfirmed && step === "depositing") setStep("success");
  }, [depositExistingConfirmed, step]);

  const handleDeposit = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    const amountWei = parseEther(amount);

    if (hasTreasury && treasuryAddr) {
      // Existing treasury: approve stETH to treasury, then call treasury.deposit()
      if (existingAllowance && existingAllowance >= amountWei) {
        setStep("depositing");
        writeDepositExisting({ address: treasuryAddr, abi: TREASURY_DEPOSIT_ABI, functionName: "deposit", args: [amountWei] });
      } else {
        setStep("approving");
        writeApproveExisting({ address: STETH_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [treasuryAddr, amountWei] });
      }
    } else if (registryAddr) {
      // New treasury: approve registry → createTreasuryAndDeposit
      if (currentAllowance && currentAllowance >= amountWei) {
        setStep("depositing");
        writeDeposit({ address: registryAddr, abi: REGISTRY_ABI, functionName: "createTreasuryAndDeposit", args: [amountWei] });
      } else {
        setStep("approving");
        writeApprove({ address: STETH_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [registryAddr, amountWei] });
      }
    }
  };

  const handleReset = () => {
    setStep("input"); setAmount("");
    resetApprove(); resetDeposit();
    resetApproveExisting(); resetDepositExisting();
  };

  if (!registryAddr) {
    return (
      <div className="card-wrap">
        <div className="card-body">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <ArrowDownToLine size={12} className="text-accent-blue" strokeWidth={2} />
              </div>
              <span className="text-[13px] font-display font-semibold text-text-primary">Deposit stETH</span>
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

  const balanceFormatted = stethBalance ? parseFloat(formatEther(stethBalance)).toFixed(6) : "0";
  const hasError = approveError || depositError || approveExistingError || depositExistingError;
  const errorMessage = (approveError || depositError || approveExistingError || depositExistingError)?.message?.split("\n")[0] ?? "";

  const btnBase: React.CSSProperties = { background: "#6366f1", clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" };

  return (
    <div className="card-wrap">
      <div className="card-body">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
            <ArrowDownToLine size={12} className="text-accent-blue" strokeWidth={2} />
          </div>
          <span className="text-[13px] font-display font-semibold text-text-primary">Deposit stETH</span>
        </div>
        {hasTreasury && (
          <span className="text-[9px] px-2 py-0.5 font-mono font-semibold tracking-widest"
            style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.2)", color: "#00e5a0" }}>
            ACTIVE
          </span>
        )}
      </div>

      <div className="p-6">
        {!isConnected ? (
          <div className="text-center">
            <p className="text-[12px] text-text-secondary mb-4 font-body leading-relaxed">
              Connect your wallet to deposit stETH and create your personal Treasury.
            </p>
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button onClick={openConnectModal}
                  className="w-full py-2.5 font-display font-semibold text-[12px] text-white hover:bg-accent-purple/90 transition-colors cursor-pointer"
                  style={btnBase}>
                  Connect Wallet
                </button>
              )}
            </ConnectButton.Custom>
          </div>
        ) : step === "input" ? (
          <>
            {hasTreasury && (
              <div className="flex items-center gap-2 mb-3 px-2 py-2"
                style={{ background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.12)" }}>
                <CheckCircle2 size={12} className="text-accent-green flex-shrink-0" strokeWidth={1.75} />
                <span className="text-[10px] text-text-secondary font-mono">
                  Treasury active —{" "}
                  <a href={`https://sepolia.etherscan.io/address/${existingTreasury}`} target="_blank" rel="noopener noreferrer"
                    className="text-accent-purple hover:underline inline-flex items-center gap-0.5">
                    {(existingTreasury as string).slice(0, 8)}...{(existingTreasury as string).slice(-4)}
                    <ExternalLink size={7} />
                  </a>
                </span>
              </div>
            )}
            <p className="text-[12px] text-text-secondary mb-4 font-body leading-relaxed">
              {hasTreasury
                ? "Add more stETH to your Treasury. New deposits increase your locked principal."
                : "Deposit stETH into YieldPilot. Principal locked — only yield is agent-spendable."}
            </p>
            <div className="flex items-center justify-between mb-2 text-[11px]">
              <span className="text-text-muted font-mono">Balance</span>
              <button onClick={() => stethBalance && setAmount(formatEther(stethBalance))}
                className="font-mono text-accent-green hover:underline cursor-pointer">
                {balanceFormatted} stETH
              </button>
            </div>
            <div className="relative mb-3">
              <input type="number" step="0.001" min="0" placeholder="0.0" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-3 text-[14px] font-mono focus:outline-none transition-colors"
                style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(99,102,241,0.14)", color: "#e2e8f0" }}
                onFocus={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.38)"}
                onBlur={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.14)"} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted font-mono">stETH</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {["0.01", "0.1", "1.0", "5.0"].map((preset) => (
                <button key={preset} onClick={() => setAmount(preset)}
                  className="text-[11px] font-mono py-1.5 transition-all cursor-pointer"
                  style={{ background: "rgba(0,0,0,0.18)", border: "1px solid rgba(99,102,241,0.13)", color: "#94a3b8" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.35)"; e.currentTarget.style.color = "#e2e8f0"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.13)"; e.currentTarget.style.color = "#94a3b8"; }}>
                  {preset}
                </button>
              ))}
            </div>
            <button onClick={handleDeposit} disabled={!amount || parseFloat(amount) <= 0}
              className="w-full py-2.5 font-display font-semibold text-[12px] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-purple/90 cursor-pointer"
              style={btnBase}>
              {hasTreasury ? `Deposit ${amount || "0"} more stETH` : `Deposit ${amount || "0"} stETH`}
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
              <a href={`https://sepolia.etherscan.io/tx/${approveTxHash}`} target="_blank" rel="noopener noreferrer"
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
            <div className="text-[13px] font-display font-semibold text-text-primary mb-1.5">
              Step 2/2 — {hasTreasury ? "Depositing" : "Deploying"}
            </div>
            <p className="text-[11px] text-text-muted font-body mb-3">
              {(isDepositPending || isDepositExistingPending) ? "Confirm in wallet..." : (depositTxHash || depositExistingHash) ? (hasTreasury ? "Depositing to Treasury..." : "Deploying Treasury contract...") : "Preparing..."}
            </p>
            {(depositTxHash || depositExistingHash) && (
              <a href={`https://sepolia.etherscan.io/tx/${depositTxHash || depositExistingHash}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-accent-purple hover:underline font-mono">
                {(depositTxHash || depositExistingHash)!.slice(0, 14)}... <ExternalLink size={9} />
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
            <div className="text-[13px] font-display font-semibold mb-1.5 text-accent-green">
              {hasTreasury ? "Deposit Complete" : "Treasury Deployed"}
            </div>
            <p className="text-[11px] text-text-secondary font-body mb-3 leading-relaxed">
              {amount} stETH deposited. {hasTreasury ? "Principal updated." : "Agent will manage yield on the next cycle."}
            </p>
            {(depositTxHash || depositExistingHash) && (
              <a href={`https://sepolia.etherscan.io/tx/${depositTxHash || depositExistingHash}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mb-4 text-[10px] text-accent-purple hover:underline font-mono">
                View transaction <ExternalLink size={9} />
              </a>
            )}
            <button onClick={handleReset}
              className="w-full py-2 text-[12px] font-body transition-all cursor-pointer"
              style={{ border: "1px solid rgba(99,102,241,0.15)", color: "#94a3b8", background: "transparent" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.35)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.15)"}>
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

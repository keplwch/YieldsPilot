// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IPermit2
 * @notice Minimal interface for Uniswap's Permit2 allowance-based approvals.
 *         The Universal Router pulls tokens via Permit2, not direct ERC20 approve.
 */
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @title IWstETH
 * @notice Minimal interface for Lido's wstETH wrapper contract
 */
interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);
    function unwrap(uint256 _wstETHAmount) external returns (uint256);
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);
    function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title YieldsPilotTreasury
 * @notice A yield-separated treasury where humans deposit stETH or wstETH, and an
 *         AI agent can ONLY spend the accrued staking yield - never the principal.
 *
 * @dev stETH is a rebasing token: balances grow daily as Lido distributes staking
 *      rewards. This contract tracks the deposited principal and lets the agent
 *      withdraw only the difference (yield).
 *
 *      wstETH deposits are automatically unwrapped to stETH on deposit so yield
 *      accrual works identically. Owners can withdraw principal as wstETH too.
 *
 * Bounty targets:
 *   - Lido "stETH Agent Treasury" ($3,000)
 *   - Protocol Labs "Let the Agent Cook" ($8,000)
 *   - Venice "Private Agents, Trusted Actions" ($11,500)
 */
contract YieldsPilotTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ══════════════════════════════════════════════════════════════════
    //                          STATE
    // ══════════════════════════════════════════════════════════════════

    IERC20 public immutable stETH;
    IWstETH public immutable wstETH;

    /// @notice Uniswap Permit2 contract (same address on all EVM chains)
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public owner;          // human depositor
    address public agent;          // AI agent address

    uint256 public principal;      // locked principal (only owner can withdraw)
    uint256 public yieldWithdrawn; // total yield already spent by agent

    // ── Configurable Permissions ──
    uint256 public maxDailySpendBps;   // max % of available yield per day (in basis points)
    uint256 public dailySpent;         // yield spent in current window
    uint256 public windowStart;        // start of current 24h window

    address[] public allowedTargets;   // addresses the agent can send yield to
    mapping(address => bool) public isAllowedTarget;

    bool public paused;

    // ══════════════════════════════════════════════════════════════════
    //                          EVENTS
    // ══════════════════════════════════════════════════════════════════

    event Deposited(address indexed depositor, uint256 amount, uint256 newPrincipal);
    event DepositedWstETH(address indexed depositor, uint256 wstETHAmount, uint256 stETHReceived, uint256 newPrincipal);
    event YieldSpent(address indexed agent, address indexed target, uint256 amount, string reason);
    event YieldSwapped(
        address indexed agent,
        address indexed router,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        string reason
    );
    event PrincipalWithdrawn(address indexed owner, uint256 amount);
    event PrincipalWithdrawnAsWstETH(address indexed owner, uint256 stETHAmount, uint256 wstETHReceived);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event PermissionsUpdated(uint256 maxDailySpendBps);
    event TargetAdded(address indexed target);
    event TargetRemoved(address indexed target);
    event Paused(bool state);

    // ══════════════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ══════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "YP: not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "YP: not agent");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "YP: paused");
        _;
    }

    // ══════════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════

    /**
     * @param _stETH          Address of the stETH token
     * @param _wstETH         Address of the wstETH wrapper token
     * @param _agent           Initial agent address
     * @param _maxDailyBps     Max yield the agent can spend per day (basis points, e.g., 5000 = 50%)
     */
    constructor(
        address _stETH,
        address _wstETH,
        address _agent,
        uint256 _maxDailyBps
    ) {
        require(_stETH != address(0), "YP: zero stETH");
        require(_wstETH != address(0), "YP: zero wstETH");
        require(_agent != address(0), "YP: zero agent");
        require(_maxDailyBps <= 10000, "YP: bps > 100%");

        stETH = IERC20(_stETH);
        wstETH = IWstETH(_wstETH);
        owner = msg.sender;
        agent = _agent;
        maxDailySpendBps = _maxDailyBps;
        windowStart = block.timestamp;
    }

    // ══════════════════════════════════════════════════════════════════
    //                     DEPOSIT (Human → Treasury)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit stETH into the treasury. Only the owner can deposit.
     *         The deposited amount is added to the locked principal.
     */
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "YP: zero amount");

        stETH.safeTransferFrom(msg.sender, address(this), amount);
        principal += amount;

        emit Deposited(msg.sender, amount, principal);
    }

    /**
     * @notice Deposit wstETH into the treasury. The wstETH is unwrapped to stETH
     *         internally so yield accrual works via rebasing. Principal is tracked
     *         in stETH terms.
     */
    function depositWstETH(uint256 wstETHAmount) external onlyOwner nonReentrant {
        require(wstETHAmount > 0, "YP: zero amount");

        // Transfer wstETH from owner to this contract
        IERC20(address(wstETH)).safeTransferFrom(msg.sender, address(this), wstETHAmount);

        // Unwrap wstETH → stETH (stETH stays in this contract)
        uint256 stETHBefore = stETH.balanceOf(address(this));
        IERC20(address(wstETH)).approve(address(wstETH), wstETHAmount);
        wstETH.unwrap(wstETHAmount);
        uint256 stETHAfter = stETH.balanceOf(address(this));

        // Use actual balance delta for safety (handles any rounding)
        uint256 actualReceived = stETHAfter - stETHBefore;
        principal += actualReceived;

        emit DepositedWstETH(msg.sender, wstETHAmount, actualReceived, principal);
    }

    // ══════════════════════════════════════════════════════════════════
    //                      YIELD ACCOUNTING
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Returns the total yield accrued (current balance - principal - already withdrawn yield).
     *         This is the spendable balance for the agent.
     */
    function availableYield() public view returns (uint256) {
        uint256 balance = stETH.balanceOf(address(this));
        uint256 locked = principal; // principal is always locked

        if (balance <= locked) return 0;
        return balance - locked;
    }

    /**
     * @notice Returns the total stETH balance held by this contract.
     */
    function totalBalance() external view returns (uint256) {
        return stETH.balanceOf(address(this));
    }

    // ══════════════════════════════════════════════════════════════════
    //                   AGENT SPEND (Yield Only)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Agent spends from available yield. Cannot touch principal.
     * @param target  Recipient address (must be in allowedTargets)
     * @param amount  Amount of stETH yield to send
     * @param reason  Human-readable reason logged onchain
     */
    function spendYield(
        address target,
        uint256 amount,
        string calldata reason
    ) external onlyAgent whenNotPaused nonReentrant {
        require(amount > 0, "YP: zero amount");
        require(isAllowedTarget[target], "YP: target not allowed");

        // Reset daily window if 24h passed
        if (block.timestamp >= windowStart + 1 days) {
            dailySpent = 0;
            windowStart = block.timestamp;
        }

        uint256 yield_ = availableYield();
        require(amount <= yield_, "YP: exceeds available yield");

        // Check daily spend limit
        uint256 maxToday = (yield_ * maxDailySpendBps) / 10000;
        require(dailySpent + amount <= maxToday, "YP: exceeds daily limit");

        dailySpent += amount;
        yieldWithdrawn += amount;

        stETH.safeTransfer(target, amount);

        emit YieldSpent(msg.sender, target, amount, reason);
    }

    // ══════════════════════════════════════════════════════════════════
    //           AGENT SWAP (Atomic - funds never leave contract)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Agent swaps yield via an on-chain DEX router (e.g., Uniswap).
     *         The swap executes atomically - stETH is approved to the router,
     *         the router is called with agent-supplied calldata, and the output
     *         token is verified. Funds NEVER pass through the agent's wallet.
     *
     * @param router      DEX router address (must be in allowedTargets)
     * @param amountIn    Amount of stETH yield to swap
     * @param swapCalldata Encoded swap calldata from the DEX API
     * @param tokenOut    Address of the expected output token (for verification)
     * @param minAmountOut Minimum output tokens expected (slippage protection)
     * @param reason      Human-readable reason logged onchain
     */
    function swapYield(
        address router,
        uint256 amountIn,
        bytes calldata swapCalldata,
        address tokenOut,
        uint256 minAmountOut,
        string calldata reason
    ) external onlyAgent whenNotPaused nonReentrant {
        require(amountIn > 0, "YP: zero amount");
        require(isAllowedTarget[router], "YP: router not allowed");
        require(tokenOut != address(0), "YP: zero tokenOut");

        // Reset daily window if 24h passed
        if (block.timestamp >= windowStart + 1 days) {
            dailySpent = 0;
            windowStart = block.timestamp;
        }

        uint256 yield_ = availableYield();
        require(amountIn <= yield_, "YP: exceeds available yield");

        // Check daily spend limit
        uint256 maxToday = (yield_ * maxDailySpendBps) / 10000;
        require(dailySpent + amountIn <= maxToday, "YP: exceeds daily limit");

        // Track spending BEFORE the external call (checks-effects-interactions)
        dailySpent += amountIn;
        yieldWithdrawn += amountIn;

        // Snapshot output token balance before swap
        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

        // Approve router directly (works for routers using standard transferFrom, e.g. MockRouter)
        stETH.safeIncreaseAllowance(router, amountIn);

        // If Permit2 is deployed, also set Permit2 approvals (Uniswap Universal Router uses Permit2)
        if (PERMIT2.code.length > 0) {
            stETH.safeIncreaseAllowance(PERMIT2, amountIn);
            IPermit2(PERMIT2).approve(address(stETH), router, uint160(amountIn), uint48(block.timestamp + 1800));
        }

        // Execute the swap - router pulls stETH (via Permit2 or direct) and sends tokenOut back
        (bool success, ) = router.call(swapCalldata);
        require(success, "YP: swap call failed");

        // Reset direct router approval (defense in depth)
        uint256 remaining = stETH.allowance(address(this), router);
        if (remaining > 0) {
            stETH.safeDecreaseAllowance(router, remaining);
        }

        // Reset Permit2 approvals if deployed
        if (PERMIT2.code.length > 0) {
            IPermit2(PERMIT2).approve(address(stETH), router, 0, 0);
            uint256 p2remaining = stETH.allowance(address(this), PERMIT2);
            if (p2remaining > 0) {
                stETH.safeDecreaseAllowance(PERMIT2, p2remaining);
            }
        }

        // Verify we received output tokens
        uint256 outAfter = IERC20(tokenOut).balanceOf(address(this));
        uint256 amountOut = outAfter - outBefore;
        require(amountOut >= minAmountOut, "YP: insufficient output (slippage)");

        emit YieldSwapped(msg.sender, router, tokenOut, amountIn, amountOut, reason);
    }

    /**
     * @notice Agent (or owner) withdraws non-stETH tokens from the treasury.
     *         After a swap, output tokens (e.g. USDC) sit in the contract.
     *         This lets the agent send them to the intended recipient.
     * @param token   ERC-20 token to withdraw (cannot be stETH)
     * @param to      Recipient address (must be in allowedTargets)
     * @param amount  Amount to send
     */
    function withdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyAgent whenNotPaused nonReentrant {
        require(token != address(stETH), "YP: use spendYield for stETH");
        require(isAllowedTarget[to], "YP: target not allowed");
        require(amount > 0, "YP: zero amount");

        IERC20(token).safeTransfer(to, amount);
    }

    // ══════════════════════════════════════════════════════════════════
    //                 OWNER CONTROLS (Human Only)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Owner withdraws principal. Agent cannot call this.
     */
    function withdrawPrincipal(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= principal, "YP: exceeds principal");

        principal -= amount;
        stETH.safeTransfer(owner, amount);

        emit PrincipalWithdrawn(owner, amount);
    }

    /**
     * @notice Owner withdraws principal as wstETH. stETH is wrapped to wstETH
     *         before sending - useful for DeFi composability or bridging.
     * @param stETHAmount  Amount of stETH principal to withdraw (wrapped to wstETH)
     */
    function withdrawPrincipalAsWstETH(uint256 stETHAmount) external onlyOwner nonReentrant {
        require(stETHAmount <= principal, "YP: exceeds principal");

        principal -= stETHAmount;

        // Approve wstETH contract to pull stETH, then wrap
        stETH.approve(address(wstETH), stETHAmount);
        uint256 wstETHReceived = wstETH.wrap(stETHAmount);

        // Send wstETH to owner
        IERC20(address(wstETH)).safeTransfer(owner, wstETHReceived);

        emit PrincipalWithdrawnAsWstETH(owner, stETHAmount, wstETHReceived);
    }

    /**
     * @notice Emergency: owner withdraws everything and shuts down.
     */
    function emergencyWithdraw() external onlyOwner nonReentrant {
        uint256 stETHBalance = stETH.balanceOf(address(this));
        uint256 wstETHBalance = wstETH.balanceOf(address(this));
        principal = 0;
        paused = true;

        if (stETHBalance > 0) {
            stETH.safeTransfer(owner, stETHBalance);
        }
        if (wstETHBalance > 0) {
            IERC20(address(wstETH)).safeTransfer(owner, wstETHBalance);
        }

        emit PrincipalWithdrawn(owner, stETHBalance);
        emit Paused(true);
    }

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "YP: zero agent");
        emit AgentUpdated(agent, _agent);
        agent = _agent;
    }

    function setMaxDailySpendBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "YP: bps > 100%");
        maxDailySpendBps = _bps;
        emit PermissionsUpdated(_bps);
    }

    function addTarget(address target) external onlyOwner {
        require(!isAllowedTarget[target], "YP: already allowed");
        isAllowedTarget[target] = true;
        allowedTargets.push(target);
        emit TargetAdded(target);
    }

    function removeTarget(address target) external onlyOwner {
        require(isAllowedTarget[target], "YP: not allowed");
        isAllowedTarget[target] = false;
        // Remove from array
        for (uint256 i = 0; i < allowedTargets.length; i++) {
            if (allowedTargets[i] == target) {
                allowedTargets[i] = allowedTargets[allowedTargets.length - 1];
                allowedTargets.pop();
                break;
            }
        }
        emit TargetRemoved(target);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    /**
     * @notice Transfer ownership of the treasury to a new address.
     *         Used by the Registry to hand off treasury to the depositor.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "YP: zero owner");
        owner = newOwner;
    }

    // ══════════════════════════════════════════════════════════════════
    //                          VIEWS
    // ══════════════════════════════════════════════════════════════════

    function getAllowedTargets() external view returns (address[] memory) {
        return allowedTargets;
    }

    function dailySpendRemaining() external view returns (uint256) {
        uint256 yield_ = availableYield();
        uint256 maxToday = (yield_ * maxDailySpendBps) / 10000;

        // Reset check
        if (block.timestamp >= windowStart + 1 days) {
            return maxToday;
        }

        if (maxToday <= dailySpent) return 0;
        return maxToday - dailySpent;
    }
}

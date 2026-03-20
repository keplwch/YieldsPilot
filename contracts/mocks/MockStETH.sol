// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockStETH
 * @notice Test token that simulates stETH for local/Sepolia testing.
 *
 * Key testing helpers:
 *   drip(to)                   — faucet: gives 10 stETH per call, no limit
 *   mint(to, amount)           — free mint any amount
 *   simulateYield(treasury, amount) — mints tokens directly into a treasury
 *                                     contract, simulating stETH rebasing so
 *                                     availableYield() grows without a deposit
 */
contract MockStETH is ERC20 {
    uint256 public constant DRIP_AMOUNT = 10 ether; // 10 stETH per drip

    event YieldSimulated(address indexed treasury, uint256 amount);

    constructor() ERC20("Mock stETH", "stETH") {
        // Mint 1000 stETH to deployer for immediate testing
        _mint(msg.sender, 1000 ether);
    }

    /// @notice Free mint — use this in scripts or tests
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Faucet: anyone can call to get 10 stETH
    function drip(address to) external {
        _mint(to, DRIP_AMOUNT);
    }

    /// @notice Simulate stETH rebasing by minting yield directly into a treasury.
    ///         The treasury's availableYield() = balance - principal, so minting
    ///         here increases the agent-spendable yield without changing principal.
    function simulateYield(address treasury, uint256 amount) external {
        require(treasury != address(0), "zero address");
        _mint(treasury, amount);
        emit YieldSimulated(treasury, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockWstETH
 * @notice Test token that simulates wstETH for local/Sepolia testing.
 *
 * Mirrors real wstETH behaviour: wrapping stETH locks it here and mints
 * wstETH; unwrapping burns wstETH and returns stETH. Uses a configurable
 * exchange rate (default 1 wstETH = 1.15 stETH) so tests can verify
 * conversion math.
 *
 * Key testing helpers:
 *   drip(to)            — faucet: gives 10 wstETH per call, no limit
 *   mint(to, amount)    — free mint any amount (no stETH backing needed)
 *   setRate(newRate)     — change the stETH/wstETH exchange rate
 *   wrap(stETHAmount)   — wrap stETH → wstETH (caller must approve stETH first)
 *   unwrap(wstETHAmount)— unwrap wstETH → stETH
 */
contract MockWstETH is ERC20 {
    IERC20 public immutable stETH;

    uint256 public constant DRIP_AMOUNT = 10 ether; // 10 wstETH per drip

    /// @dev Exchange rate scaled to 1e18.
    ///      rate = how much stETH 1 wstETH is worth.
    ///      Default: 1.15e18 (1 wstETH = 1.15 stETH), close to real mainnet rate.
    uint256 public stETHPerWstETH = 1.15e18;

    event RateUpdated(uint256 oldRate, uint256 newRate);

    constructor(address _stETH) ERC20("Mock wstETH", "wstETH") {
        require(_stETH != address(0), "zero stETH address");
        stETH = IERC20(_stETH);
        // Mint 1000 wstETH to deployer for immediate testing
        _mint(msg.sender, 1000 ether);
    }

    // ── IWstETH interface ────────────────────────────────────────

    /// @notice Wrap stETH → wstETH. Caller must approve this contract first.
    function wrap(uint256 _stETHAmount) external returns (uint256 wstETHAmount) {
        require(_stETHAmount > 0, "zero amount");
        wstETHAmount = getWstETHByStETH(_stETHAmount);
        require(wstETHAmount > 0, "amount too small");

        stETH.transferFrom(msg.sender, address(this), _stETHAmount);
        _mint(msg.sender, wstETHAmount);
    }

    /// @notice Unwrap wstETH → stETH.
    function unwrap(uint256 _wstETHAmount) external returns (uint256 stETHAmount) {
        require(_wstETHAmount > 0, "zero amount");
        stETHAmount = getStETHByWstETH(_wstETHAmount);
        require(stETHAmount > 0, "amount too small");

        _burn(msg.sender, _wstETHAmount);
        stETH.transfer(msg.sender, stETHAmount);
    }

    /// @notice How much stETH you get for `_wstETHAmount` wstETH.
    function getStETHByWstETH(uint256 _wstETHAmount) public view returns (uint256) {
        return (_wstETHAmount * stETHPerWstETH) / 1e18;
    }

    /// @notice How much wstETH you get for `_stETHAmount` stETH.
    function getWstETHByStETH(uint256 _stETHAmount) public view returns (uint256) {
        return (_stETHAmount * 1e18) / stETHPerWstETH;
    }

    // ── Testing helpers ──────────────────────────────────────────

    /// @notice Free mint — use in scripts or tests (no stETH backing)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Faucet: anyone can call to get 10 wstETH
    function drip(address to) external {
        _mint(to, DRIP_AMOUNT);
    }

    /// @notice Update the exchange rate for testing conversion math.
    ///         e.g. setRate(1.2e18) means 1 wstETH = 1.2 stETH
    function setRate(uint256 newRate) external {
        require(newRate > 0, "rate must be > 0");
        uint256 oldRate = stETHPerWstETH;
        stETHPerWstETH = newRate;
        emit RateUpdated(oldRate, newRate);
    }
}

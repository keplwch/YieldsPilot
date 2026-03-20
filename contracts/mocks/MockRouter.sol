// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Minimal ERC-20 used as the "output token" in swap tests.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/**
 * @title MockRouter
 * @notice Simulates a Uniswap-style router for testing swapYield().
 *
 * When called with `swap(address tokenIn, uint256 amountIn, address tokenOut,
 * address recipient)`, it:
 *   1. Pulls `amountIn` of `tokenIn` from msg.sender (the Treasury)
 *   2. Mints `amountIn * rate / 1e18` of `tokenOut` to `recipient`
 *
 * The exchange rate is configurable for testing slippage scenarios.
 */
contract MockRouter {
    uint256 public rate; // output per 1e18 input (e.g., 2000e6 = 2000 USDC per stETH)

    constructor(uint256 _rate) {
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    /**
     * @notice Simulated swap: pull tokenIn, mint tokenOut.
     *         The Treasury's swapYield() calls this via router.call(calldata).
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        address recipient
    ) external returns (uint256 amountOut) {
        // Pull input tokens from caller (the Treasury contract)
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output
        amountOut = (amountIn * rate) / 1e18;

        // Mint output tokens to recipient (also the Treasury)
        MockUSDC(tokenOut).mint(recipient, amountOut);

        return amountOut;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ForkSwapHelper
 * @notice Test-only helper that wraps stETH → wstETH, swaps wstETH on
 *         Uniswap V3, and returns output tokens to the caller (treasury).
 *
 *         Needed because stETH is rebasing and has virtually no direct
 *         liquidity on Uniswap V3. All V3 pools use wstETH instead.
 *
 *         In production, the Uniswap Trading API handles this routing
 *         automatically via the Universal Router + Permit2.
 */

interface IWstETHWrap {
    function wrap(uint256 _stETHAmount) external returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract ForkSwapHelper {
    IERC20 public immutable stETH;
    IWstETHWrap public immutable wstETH;
    ISwapRouter public immutable router;
    address public immutable wethAddress;

    constructor(address _stETH, address _wstETH, address _router, address _weth) {
        stETH = IERC20(_stETH);
        wstETH = IWstETHWrap(_wstETH);
        router = ISwapRouter(_router);
        wethAddress = _weth;
    }

    /**
     * @notice Swap stETH → wstETH → WETH (or any tokenOut) via Uniswap V3.
     *         The treasury approves this contract for stETH, then calls it
     *         via swapYield. Output goes back to msg.sender (the treasury).
     *
     * @param stETHAmount  Amount of stETH to pull and swap
     * @param fee          Uniswap V3 pool fee tier (e.g. 100 = 0.01%)
     * @param tokenOut     Output token address (WETH, USDC, etc.)
     * @param minOut       Minimum output for slippage protection
     */
    function swapStETHViaWstETH(
        uint256 stETHAmount,
        uint24 fee,
        address tokenOut,
        uint256 minOut
    ) external returns (uint256 amountOut) {
        // 1. Pull stETH from caller (treasury)
        stETH.transferFrom(msg.sender, address(this), stETHAmount);

        // 2. Wrap stETH → wstETH
        stETH.approve(address(wstETH), stETHAmount);
        uint256 wstETHAmount = wstETH.wrap(stETHAmount);

        // 3. Swap wstETH → tokenOut on V3
        wstETH.approve(address(router), wstETHAmount);
        amountOut = router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(wstETH),
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender, // send output back to treasury
                deadline: block.timestamp + 1800,
                amountIn: wstETHAmount,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }
}

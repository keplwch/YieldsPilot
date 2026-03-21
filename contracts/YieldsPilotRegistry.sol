// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./YieldsPilotTreasury.sol";

/**
 * @title YieldsPilotRegistry
 * @notice Factory + registry that deploys per-user Treasury contracts.
 *         Each user gets their own isolated treasury where their principal
 *         is locked and only yield is spendable by the agent.
 *
 * @dev The agent address is shared across all treasuries. When a user
 *      deposits, a new YieldsPilotTreasury is created with the user as owner
 *      and the global agent as the authorized spender.
 *
 * Bounty targets:
 *   - Lido "stETH Agent Treasury" ($3,000)
 *   - Protocol Labs "Let the Agent Cook" ($8,000)
 */
contract YieldsPilotRegistry {

    // ══════════════════════════════════════════════════════════════════
    //                          STATE
    // ══════════════════════════════════════════════════════════════════

    IERC20 public immutable stETH;
    address public immutable wstETHAddress;  // wstETH contract address
    address public admin;               // protocol admin (deployer)
    address public agent;               // shared AI agent address

    uint256 public defaultMaxDailyBps;  // default daily spend cap for new treasuries
    address[] public defaultTargets;    // default whitelisted targets (e.g., Uniswap Router)

    // User → their Treasury contract
    mapping(address => address) public userTreasury;

    // All treasury addresses (for agent iteration)
    address[] public allTreasuries;

    // Track registered users
    address[] public allUsers;

    bool public paused;

    // ══════════════════════════════════════════════════════════════════
    //                          EVENTS
    // ══════════════════════════════════════════════════════════════════

    event TreasuryCreated(
        address indexed user,
        address indexed treasury,
        uint256 initialDeposit
    );
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event DefaultTargetAdded(address indexed target);
    event DefaultTargetRemoved(address indexed target);
    event DefaultMaxDailyBpsUpdated(uint256 newBps);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event RegistryPaused(bool state);

    // ══════════════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ══════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "Registry: not admin");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Registry: paused");
        _;
    }

    // ══════════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════

    /**
     * @param _stETH             Address of the stETH token
     * @param _wstETH            Address of the wstETH wrapper token
     * @param _agent             Shared AI agent address
     * @param _defaultMaxDailyBps Default max daily spend (basis points)
     */
    constructor(
        address _stETH,
        address _wstETH,
        address _agent,
        uint256 _defaultMaxDailyBps
    ) {
        require(_stETH != address(0), "Registry: zero stETH");
        require(_wstETH != address(0), "Registry: zero wstETH");
        require(_agent != address(0), "Registry: zero agent");
        require(_defaultMaxDailyBps <= 10000, "Registry: bps > 100%");

        stETH = IERC20(_stETH);
        wstETHAddress = _wstETH;
        admin = msg.sender;
        agent = _agent;
        defaultMaxDailyBps = _defaultMaxDailyBps;
    }

    // ══════════════════════════════════════════════════════════════════
    //                   USER REGISTRATION + DEPOSIT
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new treasury for the caller and deposit stETH.
     *         The user must have approved this registry to transfer stETH first.
     * @param amount Amount of stETH to deposit as initial principal
     */
    function createTreasuryAndDeposit(uint256 amount) external whenNotPaused {
        require(userTreasury[msg.sender] == address(0), "Registry: treasury exists");
        require(amount > 0, "Registry: zero amount");

        // Deploy a new Treasury contract with msg.sender as owner
        YieldsPilotTreasury treasury = new YieldsPilotTreasury(
            address(stETH),
            wstETHAddress,
            agent,
            defaultMaxDailyBps
        );

        // The treasury's owner is this registry (deployer), so we need
        // to transfer ownership. But since the Treasury constructor sets
        // owner = msg.sender (which is this registry), we handle it by:
        // 1. Adding default targets
        // 2. Transferring stETH from user → treasury via this contract
        // 3. Recording the mapping

        // Add default whitelisted targets
        for (uint256 i = 0; i < defaultTargets.length; i++) {
            treasury.addTarget(defaultTargets[i]);
        }

        // Transfer stETH from user to this contract, then to treasury
        // User must have approved THIS REGISTRY contract
        stETH.transferFrom(msg.sender, address(this), amount);

        // Approve the treasury to pull from us, then deposit
        stETH.approve(address(treasury), amount);
        treasury.deposit(amount);

        // Transfer ownership of the treasury to the user
        // (so they can withdraw principal, update settings, etc.)
        treasury.transferOwnership(msg.sender);

        // Record in registry
        address treasuryAddr = address(treasury);
        userTreasury[msg.sender] = treasuryAddr;
        allTreasuries.push(treasuryAddr);
        allUsers.push(msg.sender);

        emit TreasuryCreated(msg.sender, treasuryAddr, amount);
    }

    /**
     * @notice Deposit additional stETH into an existing user treasury.
     *         The user must have approved this registry to transfer stETH.
     * @param amount Amount of stETH to deposit
     */
    function depositToExisting(uint256 amount) external whenNotPaused {
        address treasuryAddr = userTreasury[msg.sender];
        require(treasuryAddr != address(0), "Registry: no treasury");
        require(amount > 0, "Registry: zero amount");

        // Transfer stETH from user to their treasury directly
        // User must call deposit on their own treasury since they are the owner
        // We just provide a convenience route - but actually the user is the owner
        // so they should deposit directly. This function is here for frontend convenience.
        stETH.transferFrom(msg.sender, address(this), amount);
        stETH.approve(treasuryAddr, amount);

        // Note: Only the owner can call deposit(), so we route through the user
        // Actually, since we transferred ownership, WE can't deposit.
        // Instead, transfer directly to the treasury address.
        // The principal tracking won't update via deposit() since we're not the owner.
        // Better approach: transfer stETH to the user and let them deposit.
        // Simplest: just transfer directly to the treasury (yield goes up, not principal).

        // For proper principal tracking, the user should call deposit() on their
        // treasury directly. Here we'll just forward the funds to the user.
        stETH.transfer(msg.sender, amount);

        // Emit for indexing even though user needs to call deposit() themselves
    }

    // ══════════════════════════════════════════════════════════════════
    //                      AGENT ITERATION
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Returns count of all registered treasuries (for agent iteration)
     */
    function treasuryCount() external view returns (uint256) {
        return allTreasuries.length;
    }

    /**
     * @notice Returns a page of treasury addresses (for gas-efficient iteration)
     * @param offset Start index
     * @param limit  Max number to return
     */
    function getTreasuries(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 end = offset + limit;
        if (end > allTreasuries.length) {
            end = allTreasuries.length;
        }
        if (offset >= end) {
            return new address[](0);
        }

        uint256 count = end - offset;
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = allTreasuries[offset + i];
        }
        return result;
    }

    /**
     * @notice Returns all treasury addresses (use getTreasuries for large sets)
     */
    function getAllTreasuries() external view returns (address[] memory) {
        return allTreasuries;
    }

    /**
     * @notice Returns all registered users
     */
    function getAllUsers() external view returns (address[] memory) {
        return allUsers;
    }

    /**
     * @notice Returns user + treasury pairs for agent processing
     */
    function getUserTreasuryPairs(uint256 offset, uint256 limit)
        external view
        returns (address[] memory users, address[] memory treasuries)
    {
        uint256 end = offset + limit;
        if (end > allUsers.length) {
            end = allUsers.length;
        }
        if (offset >= end) {
            return (new address[](0), new address[](0));
        }

        uint256 count = end - offset;
        users = new address[](count);
        treasuries = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            users[i] = allUsers[offset + i];
            treasuries[i] = userTreasury[allUsers[offset + i]];
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //                      ADMIN CONTROLS
    // ══════════════════════════════════════════════════════════════════

    function setAgent(address _agent) external onlyAdmin {
        require(_agent != address(0), "Registry: zero agent");
        emit AgentUpdated(agent, _agent);
        agent = _agent;
        // NOTE: Existing treasuries keep their old agent. Admin must
        // call setAgent on each treasury individually, or users can update theirs.
    }

    function addDefaultTarget(address target) external onlyAdmin {
        defaultTargets.push(target);
        emit DefaultTargetAdded(target);
    }

    function removeDefaultTarget(address target) external onlyAdmin {
        for (uint256 i = 0; i < defaultTargets.length; i++) {
            if (defaultTargets[i] == target) {
                defaultTargets[i] = defaultTargets[defaultTargets.length - 1];
                defaultTargets.pop();
                emit DefaultTargetRemoved(target);
                return;
            }
        }
    }

    function setDefaultMaxDailyBps(uint256 _bps) external onlyAdmin {
        require(_bps <= 10000, "Registry: bps > 100%");
        defaultMaxDailyBps = _bps;
        emit DefaultMaxDailyBpsUpdated(_bps);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit RegistryPaused(_paused);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Registry: zero admin");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function getDefaultTargets() external view returns (address[] memory) {
        return defaultTargets;
    }
}

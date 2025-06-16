// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

interface ICasinoTreasury {
    // --- Events ---
    event Deposit(address indexed user, uint256 indexed casinoId, address indexed token, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, bool escrowed, uint256 escrowId);
    event Withdrawal(address indexed user, uint256 indexed casinoId, address indexed token, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, bool escrowed, uint256 escrowId);
    event WinningsPaid(address indexed user, uint256 indexed casinoId, address indexed token, uint256 amount, address fundingWallet);
    event EscrowProcessed(uint256 indexed escrowId, uint256 indexed casinoId, bool approved, address processedBy);
    event WithdrawalLimitUpdated(uint256 indexed casinoId, uint256 newLimit);
    event FeesUpdated(uint256 indexed casinoId, uint16 depositFeeBps, uint16 withdrawalFeeBps);
    event FeeRecipientUpdated(uint256 indexed casinoId, address newFeeRecipient);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);

    // --- Structs ---
    struct EscrowedFunds {
        address user;
        address token;
        uint256 amount;
        uint256 timestamp;
        bool isDeposit;
        bool processed;
        bool approved;
    }

    // --- Initialization ---
    function initialize(
        address _registryAddress,
        uint256 _casinoId,
        address _initialTreasuryOwner
    ) external;

    // --- Core Functions ---
    function deposit(
        address from,
        address user,
        address token,
        uint256 amount
    ) external;

    function withdraw(
        address from,
        address to,
        address token,
        uint256 amount
    ) external;

    function depositMultiple(
        address from,
        address user,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external;

    // --- Winnings Management ---
    function payWinnings(
        address _user,
        address _token,
        uint256 _amount,
        address _fundingWallet
    ) external;

    function batchPayWinnings(
        address[] calldata _users,
        address _token,
        uint256[] calldata _amounts,
        address _fundingWallet
    ) external;

    // --- Escrow Management ---
    function processEscrow(uint256 _escrowId, bool _approve) external;
    function batchProcessEscrow(uint256[] calldata _escrowIds, bool[] calldata _approvals) external;

    // --- Admin Functions ---
    function setWithdrawalLimit(uint256 _withdrawalLimit) external;
    function setFees(uint16 _depositFeeBps, uint16 _withdrawalFeeBps) external;
    function setFeeRecipient(address _feeRecipient) external;
    function setVault(address _vault) external;

    // --- Emergency Functions ---
    function pause() external;
    function unpause() external;

    // --- Recovery Functions ---
    function recoverERC20(address _token, address _recipient) external;
    function recoverETH(address payable _recipient) external;

    // --- View Functions ---
    function getUserStats(address _user, address _token) external view returns (
        uint256 balance,
        uint256 deposited,
        uint256 withdrawn,
        uint256 winningsCredited,
        uint256 amountInPendingEscrow
    );

    function getPendingEscrows(uint256 _limit, uint256 _offset) external view returns (
        uint256[] memory escrowIds,
        EscrowedFunds[] memory escrows
    );

    function getUserBalances(address _user, address[] calldata _tokens) external view returns (uint256[] memory balances);

    // --- Constants ---
    function MAX_FEE_BPS() external view returns (uint256);
    function MAX_WITHDRAWAL_LIMIT() external view returns (uint256);

    // --- State Variables ---
    function registry() external view returns (address);
    function casinoId() external view returns (uint256);
    function casinoFeeRecipient() external view returns (address);
    function depositFeeBps() external view returns (uint16);
    function withdrawalFeeBps() external view returns (uint16);
    function withdrawalLimit() external view returns (uint256);
    function vault() external view returns (address);
    function balances(address user, address token) external view returns (uint256);
    function escrowedFunds(uint256 escrowId) external view returns (
        address user,
        address token,
        uint256 amount,
        uint256 timestamp,
        bool isDeposit,
        bool processed,
        bool approved
    );
    function escrowCount() external view returns (uint256);
    function pendingEscrowCount() external view returns (uint256);
    function totalDeposited(address user, address token) external view returns (uint256);
    function totalWithdrawn(address user, address token) external view returns (uint256);
    function totalWinningsCredited(address user, address token) external view returns (uint256);
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";  // Updated path
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";  // Updated path
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ICasinoPaymentRegistry.sol";

contract CasinoTreasury is 
    Initializable, 
    OwnableUpgradeable, 
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable 
{
    using SafeERC20 for IERC20;
    using Address for address;

    // --- Constants ---
    uint256 public constant MAX_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_WITHDRAWAL_LIMIT = 1000000 ether;

    // --- State Variables ---
    ICasinoPaymentRegistry public registry;
    uint256 public casinoId;
    address public casinoFeeRecipient;
    uint16 public depositFeeBps;
    uint16 public withdrawalFeeBps;
    uint256 public withdrawalLimit;
    address public vault;

    // User balances: user => token => amount
    mapping(address => mapping(address => uint256)) public balances;

    // Escrowed funds awaiting approval
    struct EscrowedFunds {
        address user;
        address token;
        uint256 amount;
        uint256 timestamp;
        bool isDeposit;
        bool processed;
        bool approved;
    }
    mapping(uint256 => EscrowedFunds) public escrowedFunds;
    uint256 public escrowCount;
    uint256 public pendingEscrowCount;

    // User statistics
    mapping(address => mapping(address => uint256)) public totalDeposited;
    mapping(address => mapping(address => uint256)) public totalWithdrawn;
    mapping(address => mapping(address => uint256)) public totalWinningsCredited;

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

    // --- Modifiers ---
    modifier onlyCasinoAdmin() {
        (
            address casinoRegistryOwner,
            address treasuryAddress,
            bool active,
            uint256 registrationTimestamp
        ) = registry.getCasinoDetails(casinoId);

        address[] memory admins = registry.getCasinoAdmins(casinoId);
        bool isAdmin = false;
        if (_msgSender() == casinoRegistryOwner) {
            isAdmin = true;
        } else {
            for (uint i = 0; i < admins.length; i++) {
                if (_msgSender() == admins[i]) {
                    isAdmin = true;
                    break;
                }
            }
        }
        require(isAdmin, "Treasury: Not casino admin");
        _;
    }

    modifier casinoIsActive() {
        (
            ,  // casinoRegistryOwner
            ,  // treasuryAddress
            bool active,
            // registrationTimestamp
        ) = registry.getCasinoDetails(casinoId);
        require(active, "Treasury: Casino not active");
        _;
    }

    modifier userNotSuspended(address _user) {
        require(!registry.isUserSuspended(casinoId, _user), "Treasury: User suspended");
        _;
    }

    modifier tokenIsSupported(address _token) {
        require(registry.isTokenSupported(casinoId, _token), "Treasury: Token not supported");
        _;
    }

 
    // --- Initializer ---
    function initialize(
        address _registryAddress,
        uint256 _casinoId,
        address _initialTreasuryOwner
    ) public initializer {
        require(_registryAddress != address(0) && _registryAddress.code.length > 0, "Treasury: Invalid registry");
        require(_initialTreasuryOwner != address(0), "Treasury: Invalid owner");

        __Ownable_init(_initialTreasuryOwner);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        registry = ICasinoPaymentRegistry(_registryAddress);
        casinoId = _casinoId;
        casinoFeeRecipient = _initialTreasuryOwner;
    }

// --- UUPS Upgrade ---
function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
    require(newImplementation != address(0), "Treasury: Zero implementation");
    require(newImplementation.code.length > 0, "Treasury: Not a contract");
}

    // --- Emergency Functions ---
    function pause() external onlyOwner {
        _pause();
        emit EmergencyPaused(_msgSender());
    }

    function unpause() external onlyOwner {
        _unpause();
        emit EmergencyUnpaused(_msgSender());
    }

    // check if token is not zero
function _validateToken(address _token) internal view {
    require(_token != address(0), "Treasury: Zero token address");
    require(registry.isTokenSupported(casinoId, _token), "Treasury: Token not supported");
}

    // --- Core Functions ---
function _handleDepositFees(uint256 _amount) 
    internal 
    view 
    returns (uint256 netAmount, uint256 totalFees) 
{
    uint16 platformFeeBps = registry.platformFeeBps();
    
    uint256 casinoFee = (_amount * depositFeeBps) / 10000;
    uint256 platformFee = (_amount * platformFeeBps) / 10000;
    totalFees = casinoFee + platformFee;
    require(_amount >= totalFees, "Treasury: Amount less than fees");
    netAmount = _amount - totalFees;
}

function deposit(
    address from,
    address user,
    address token,
    uint256 amount
) external nonReentrant whenNotPaused casinoIsActive onlyCasinoAdmin {
    require(amount > 0, "Treasury: Amount must be positive");
    require(user != address(0), "Treasury: Zero user address");
    _validateToken(token);

    // Calculate fees first
(uint256 netAmount, uint256 totalFees) = _handleDepositFees(amount);    
    // Transfer full amount from user
    IERC20(token).transferFrom(from, address(this), amount);
    
    // Transfer fees to recipients
    IERC20 tokenContract = IERC20(token);
    if (casinoFeeRecipient != address(0)) {
        uint256 casinoFee = (amount * depositFeeBps) / 10000;
        if (casinoFee > 0) {
            tokenContract.transfer(casinoFeeRecipient, casinoFee);
        }
    }
    
    if (registry.platformFeeRecipient() != address(0)) {
        uint256 platformFee = (amount * registry.platformFeeBps()) / 10000;
        if (platformFee > 0) {
            tokenContract.transfer(registry.platformFeeRecipient(), platformFee);
        }
    }
    
    // Update balances with net amount
    balances[user][token] += netAmount;
    totalDeposited[user][token] += netAmount;
    
    emit Deposit(user, casinoId, token, amount, totalFees, netAmount, false, 0);
}

function _handleDepositEscrow(
    address _user,
    address _token, 
    uint256 _netAmount
) 
    internal 
    whenNotPaused 
    casinoIsActive 
     nonReentrant 
    returns (bool escrowed, uint256 escrowId) 
{
        balances[_user][_token] += _netAmount;
        totalDeposited[_user][_token] += _netAmount;
        return (false, 0);
    }

    function withdraw(
        address from,
        address to,
        address token,
        uint256 amount
) external nonReentrant whenNotPaused casinoIsActive onlyCasinoAdmin {
        require(balances[from][token] >= amount, "Insufficient balance");
        _validateToken(token);  // Add this line
        balances[from][token] -= amount;
        IERC20(token).transfer(to, amount);
        emit Withdrawal(from, casinoId, token, amount, 0, amount, false, 0);
    }

    // --- Escrow Management ---
 function processEscrow(uint256 _escrowId, bool _approve) 
    internal 
    nonReentrant 
    whenNotPaused 
    casinoIsActive 
{
    require(_escrowId < escrowCount, "Treasury: Invalid escrow ID");
    EscrowedFunds storage escrow = escrowedFunds[_escrowId];
    require(!escrow.processed, "Treasury: Escrow already processed");

    escrow.processed = true;
    escrow.approved = _approve;
    pendingEscrowCount--;

    if (_approve) {
        if (escrow.isDeposit) {
            balances[escrow.user][escrow.token] += escrow.amount;
            totalDeposited[escrow.user][escrow.token] += escrow.amount;
        } else {
            IERC20 token = IERC20(escrow.token);
            token.transfer(escrow.user, escrow.amount);
            totalWithdrawn[escrow.user][escrow.token] += escrow.amount;
        }
    } else {
        if (escrow.isDeposit) {
            IERC20 token = IERC20(escrow.token);
            token.transfer(escrow.user, escrow.amount);
        } else {
            uint256 totalFeeBps = uint256(withdrawalFeeBps) + uint256(registry.platformFeeBps());
            if (totalFeeBps < 10000) {
                uint256 originalGrossAmount = (escrow.amount * 10000) / (10000 - totalFeeBps);
                balances[escrow.user][escrow.token] += originalGrossAmount;
            } else {
                balances[escrow.user][escrow.token] += escrow.amount;
            }
        }
    }
    emit EscrowProcessed(_escrowId, casinoId, _approve, _msgSender());
}

function batchProcessEscrow(uint256[] calldata _escrowIds, bool[] calldata _approvals) 
    external 
    nonReentrant 
    whenNotPaused 
    casinoIsActive 
    onlyCasinoAdmin 
{
    require(_escrowIds.length == _approvals.length, "Treasury: Array length mismatch");
    for (uint256 i = 0; i < _escrowIds.length; i++) {
        if (!escrowedFunds[_escrowIds[i]].processed) {
            processEscrow(_escrowIds[i], _approvals[i]);
        }
    }
}

    // --- Winnings Management ---
    function payWinnings(
        address _user,
        address _token,
        uint256 _amount,
        address _fundingWallet
) external nonReentrant whenNotPaused casinoIsActive onlyCasinoAdmin {
        require(_amount > 0, "Treasury: Amount must be positive");
        require(_fundingWallet != address(0), "Treasury: Zero funding wallet");
        _validateToken(_token);  // Add this line
        
        IERC20 token = IERC20(_token);
        uint256 allowance = token.allowance(_fundingWallet, address(this));
        require(allowance >= _amount, "Treasury: Insufficient allowance");
        
        uint256 walletBalance = token.balanceOf(_fundingWallet);
        require(walletBalance >= _amount, "Treasury: Insufficient balance");

        token.transferFrom(_fundingWallet, address(this), _amount);
        balances[_user][_token] += _amount;
        totalWinningsCredited[_user][_token] += _amount;

        emit WinningsPaid(_user, casinoId, _token, _amount, _fundingWallet);
    }

    function batchPayWinnings(
        address[] calldata _users,
        address _token,
        uint256[] calldata _amounts,
        address _fundingWallet
) external nonReentrant whenNotPaused casinoIsActive onlyCasinoAdmin {
        require(_users.length == _amounts.length, "Treasury: Array length mismatch");
        require(_fundingWallet != address(0), "Treasury: Zero funding wallet");
        
        uint256 totalAmount = _calculateTotalAmount(_amounts);
        _handleBatchTokenTransfer(_token, _fundingWallet, totalAmount);
        _processBatchPayouts(_users, _token, _amounts, _fundingWallet);
    }

    function _calculateTotalAmount(uint256[] calldata _amounts) internal pure returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _amounts.length; i++) {
            total += _amounts[i];
        }
        return total;
    }

    function _handleBatchTokenTransfer(
        address _token,
        address _fundingWallet,
        uint256 _totalAmount
    ) internal 
     nonReentrant 
     {
        IERC20 token = IERC20(_token);
        uint256 allowance = token.allowance(_fundingWallet, address(this));
        require(allowance >= _totalAmount, "Treasury: Insufficient allowance");
        
        uint256 walletBalance = token.balanceOf(_fundingWallet);
        require(walletBalance >= _totalAmount, "Treasury: Insufficient balance");
        
        token.transferFrom(_fundingWallet, address(this), _totalAmount);
    }

    function _processBatchPayouts(
        address[] calldata _users,
        address _token,
        uint256[] calldata _amounts,
        address _fundingWallet
    ) internal 
     nonReentrant 
    {
        for (uint256 i = 0; i < _users.length; i++) {
            if (!registry.isUserSuspended(casinoId, _users[i]) && _amounts[i] > 0) {
                balances[_users[i]][_token] += _amounts[i];
                totalWinningsCredited[_users[i]][_token] += _amounts[i];
                emit WinningsPaid(_users[i], casinoId, _token, _amounts[i], _fundingWallet);
            }
        }
    }

    // --- Recovery Functions ---
function recoverERC20(address _token, address _recipient) external nonReentrant whenNotPaused onlyOwner {
        require(_recipient != address(0), "Treasury: Zero recipient");
        IERC20 token = IERC20(_token);
        uint256 contractBalance = token.balanceOf(address(this));
        token.transfer(_recipient, contractBalance);
    }

function recoverETH(address payable _recipient) external nonReentrant whenNotPaused onlyOwner {
        require(_recipient != address(0), "Treasury: Zero recipient");
        uint256 balance = address(this).balance;
        Address.sendValue(_recipient, balance);
    }

    // --- View Functions ---
    function getUserStats(address _user, address _token) external view returns (
        uint256 balance,
        uint256 deposited,
        uint256 withdrawn,
        uint256 winningsCredited,
        uint256 amountInPendingEscrow
    ) {
        uint256 escrowedAmount = 0;
        for (uint256 i = 0; i < escrowCount; i++) {
            EscrowedFunds storage escrow = escrowedFunds[i];
            if (!escrow.processed && escrow.user == _user && escrow.token == _token) {
                escrowedAmount += escrow.amount;
            }
        }

        return (
            balances[_user][_token],
            totalDeposited[_user][_token],
            totalWithdrawn[_user][_token],
            totalWinningsCredited[_user][_token],
            escrowedAmount
        );
    }

    function getPendingEscrows(uint256 _limit, uint256 _offset) external view returns (
        uint256[] memory escrowIds,
        EscrowedFunds[] memory escrows
    ) {
        uint256 count = 0;
        uint256[] memory tempIds = new uint256[](pendingEscrowCount);

        for (uint256 i = 0; i < escrowCount; i++) {
            if (!escrowedFunds[i].processed) {
                if (count >= _offset && count < _offset + _limit) {
                    tempIds[count - _offset] = i;
                }
                count++;
                if (count >= _offset + _limit) break;
            }
        }

        uint256 returnCount = 0;
        if (count > _offset) {
            returnCount = count - _offset;
            if (returnCount > _limit) {
                returnCount = _limit;
            }
        }

        escrowIds = new uint256[](returnCount);
        escrows = new EscrowedFunds[](returnCount);

        uint256 resultIndex = 0;
        for(uint256 i = 0; i < returnCount; i++) {
            uint256 escrowId = tempIds[i];
            if (!escrowedFunds[escrowId].processed) {
                escrowIds[resultIndex] = escrowId;
                escrows[resultIndex] = escrowedFunds[escrowId];
                resultIndex++;
            }
        }

        if(resultIndex < returnCount) {
            assembly {
                mstore(escrowIds, resultIndex)
                mstore(escrows, resultIndex)
            }
        }

        return (escrowIds, escrows);
    }

    // --- Admin Functions ---
    function setWithdrawalLimit(uint256 _withdrawalLimit) external onlyCasinoAdmin {
        require(_withdrawalLimit <= MAX_WITHDRAWAL_LIMIT, "Treasury: Limit too high");
        withdrawalLimit = _withdrawalLimit;
        emit WithdrawalLimitUpdated(casinoId, _withdrawalLimit);
    }

    function setFees(uint16 _depositFeeBps, uint16 _withdrawalFeeBps) external onlyCasinoAdmin {
        require(_depositFeeBps <= MAX_FEE_BPS, "Treasury: Deposit fee too high");
        require(_withdrawalFeeBps <= MAX_FEE_BPS, "Treasury: Withdrawal fee too high");
        require(_depositFeeBps + registry.platformFeeBps() <= 10000, "Treasury: Total deposit fee exceeds 100%");
        require(_withdrawalFeeBps + registry.platformFeeBps() <= 10000, "Treasury: Total withdrawal fee exceeds 100%");
        
        depositFeeBps = _depositFeeBps;
        withdrawalFeeBps = _withdrawalFeeBps;
        emit FeesUpdated(casinoId, _depositFeeBps, _withdrawalFeeBps);
    }

    function setFeeRecipient(address _feeRecipient) external onlyCasinoAdmin {
        require(_feeRecipient != address(0), "Treasury: Zero fee recipient");
        casinoFeeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(casinoId, _feeRecipient);
    }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Treasury: Zero vault");
        vault = _vault;
    }

  // Optimize the depositMultiple function
function depositMultiple(
    address from,
    address user,
    address[] calldata tokens,
    uint256[] calldata amounts
) external nonReentrant whenNotPaused casinoIsActive onlyCasinoAdmin {
    require(tokens.length == amounts.length, "Treasury: Length mismatch");
    require(from != address(0), "Treasury: Zero from address");
    require(user != address(0), "Treasury: Zero user address");
    
    for (uint256 i = 0; i < tokens.length; i++) {
        address token = tokens[i];
        uint256 amount = amounts[i];
        
        require(token != address(0), "Treasury: Zero token address");
        require(amount > 0, "Treasury: Zero amount");
        _validateToken(token);
        
        // Transfer full amount from user
        IERC20(token).transferFrom(from, address(this), amount);
        
        // Handle fees
(uint256 netAmount, uint256 totalFees) = _handleDepositFees(amount);        
        // Update balances with net amount
        balances[user][token] += netAmount;
        totalDeposited[user][token] += netAmount;
        
        emit Deposit(user, casinoId, token, amount, totalFees, netAmount, false, 0);
    }
}

    function getUserBalances(address _user, address[] calldata _tokens) external view returns (uint256[] memory userBalances) {
        userBalances = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            userBalances[i] = balances[_user][_tokens[i]];
        }
    }

    // Required storage gap for upgradeable contracts
    uint256[40] private __gap;
}
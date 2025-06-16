// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./CHIP.sol";
import "./interfaces/ICasinoTreasury.sol";
import "./interfaces/ISigmaVault.sol";

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract SigmaVault is ISigmaVault, Ownable, ERC165 {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Constants ---
    uint256 private constant ONE = 1e18;
    uint256 private constant PRECISION_FACTOR = 1e18;
    uint256 private constant MIN_PRECISION = 1e6;  // For USDC
    uint256 private constant MAX_PRECISION = 1e18; // For most tokens
    uint256 private constant ROUNDING_UP = 1;
    uint256 private constant ROUNDING_DOWN = 0;
    uint256 private constant MIN_DEPOSIT_AMOUNT = 0.01e6;  // 0.01 USDT/USDC
    uint256 private constant MIN_WITHDRAW_AMOUNT = 0.01e6;  // 0.01 USDT/USDC

    // --- State ---
    address public immutable usdt;
    address public immutable usdc;
    address public immutable aPolUsdt;
    address public immutable aPolUsdc;
    address public immutable aavePool;
    address public immutable chip;
    address public casinoTreasury;
    bool public initialized;
    string public name;
    string public symbol;

    // User => aToken => amount
    mapping(address => mapping(address => uint256)) public aTokenBalances;

    // --- Admins ---
    mapping(address => bool) private admins;

    modifier onlyAdmin() {
        require(admins[msg.sender], "Not admin");
        _;
    }

constructor(
    address _usdt,
    address _usdc,
    address _aPolUsdt,
    address _aPolUsdc,
    address _aavePool,
    address _chip,
    address _casinoTreasury,
    address initialOwner,
    string memory _name,
    string memory _symbol
) Ownable(initialOwner) {
    require(_usdt != address(0) && _usdc != address(0), "Zero stable");
    require(_aPolUsdt != address(0) && _aPolUsdc != address(0), "Zero aToken");
    require(_aavePool != address(0), "Zero pool");
    require(_chip != address(0), "Zero chip");
    require(_casinoTreasury != address(0), "Zero treasury");
    usdt = _usdt;
    usdc = _usdc;
    aPolUsdt = _aPolUsdt;
    aPolUsdc = _aPolUsdc;
    aavePool = _aavePool;
    chip = _chip;
    casinoTreasury = _casinoTreasury;
    name = _name;
    symbol = _symbol;
    admins[msg.sender] = true;
    // Do NOT set initialized = true here; let initializeVault set it
    emit AdminAdded(msg.sender);
}

    // --- Internal Math Functions ---
    function _validatePrecision(uint256 amount) internal pure {
        require(amount <= type(uint256).max / ONE, "Amount exceeds precision limit");
    }

    function _roundUp(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "Division by zero");
        if (a == 0) return 0;
        require(a <= type(uint256).max / ONE, "Multiplication overflow");
        return ((a * ONE) - 1) / b + 1;
    }

    function _roundDown(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "Division by zero");
        if (a == 0) return 0;
        require(a <= type(uint256).max / ONE, "Multiplication overflow");
        return (a * ONE) / b;
    }

    // --- Internal View Functions ---
    function _convertToShares(
        address[] calldata assets,
        uint256[] calldata amounts
    ) internal view returns (uint256 shares) {
        require(assets.length == amounts.length, "Length mismatch");
        require(assets.length > 0, "Empty assets array");
        require(initialized, "Vault not initialized");
        
        uint256 totalATokenAmount = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] == usdt || assets[i] == usdc, "Unsupported asset");
            require(amounts[i] > 0, "Zero amount");
            _validatePrecision(amounts[i]);
            totalATokenAmount += amounts[i];
        }
        
        shares = CHIP(chip).convertToShares(totalATokenAmount, address(this));
    }

    function _convertToAssets(
        uint256 shares,
        address[] calldata assets
    ) internal view returns (uint256[] memory amounts) {
        require(assets.length > 0, "Empty assets array");
        require(initialized, "Vault not initialized");
        amounts = new uint256[](assets.length);
        
        if (shares == 0) return amounts;
        _validatePrecision(shares);
        
        uint256 aTokenAmount = CHIP(chip).convertToATokens(shares, address(this));
        uint256 sharePerAsset = aTokenAmount / assets.length;
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] == usdt || assets[i] == usdc, "Unsupported asset");
            amounts[i] = _roundDown(sharePerAsset, ONE);
        }
    }

  // --- Public View Functions ---
function convertToShares(
    address[] calldata assets,
    uint256[] calldata amounts
) external view override returns (uint256 shares) {
    return _convertToShares(assets, amounts);
}

function convertToAssets(
    uint256 shares,
    address[] calldata assets
) external view override returns (uint256[] memory amounts) {
    return _convertToAssets(shares, assets);
}

function previewDeposit(
    address[] calldata assets,
    uint256[] calldata amounts
) external view override returns (uint256 shares) {
    return _convertToShares(assets, amounts);
}

function previewWithdraw(
    uint256 shares,
    address[] calldata assets
) external view override returns (uint256[] memory amounts) {
    return _convertToAssets(shares, assets);
}

function initializeVault(
    address asset1,
    address asset2,
    string memory _name,
    string memory _symbol
) external onlyAdmin {
    require(!initialized, "Already initialized");
    require(asset1 != address(0) && asset2 != address(0), "Zero asset");
    require(asset1 == usdt || asset1 == usdc, "Invalid asset1");
    require(asset2 == usdt || asset2 == usdc, "Invalid asset2");
    require(asset1 != asset2, "Same asset");
    
    CHIP(chip).initializeVault(asset1, asset2, _name, _symbol);
    initialized = true;
    emit VaultInitialized(0);
}

    // --- Deposit ---
    function deposit(
        address from,
        address[] calldata assets,
        uint256[] calldata amounts,
        address receiver,
        bool depositToCasino
    ) external override onlyAdmin returns (uint256 shares) {
        require(assets.length > 0 && assets.length == amounts.length, "Invalid input");
        require(receiver != address(0), "Zero receiver");
        require(initialized, "Vault not initialized");
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(amounts[i] >= MIN_DEPOSIT_AMOUNT, "Amount below minimum");
        }

        uint256 totalATokenAmount = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            _validatePrecision(amounts[i]);
            
            uint256 roundedAmount = _roundUp(amounts[i], ONE);
            require(roundedAmount >= amounts[i], "Rounding error in supply");
            
            IERC20 token = IERC20(assets[i]);
            require(token.transferFrom(from, address(this), roundedAmount), "Transfer failed");
            
            require(token.approve(aavePool, roundedAmount), "Approve failed");
            IAavePool(aavePool).supply(assets[i], roundedAmount, address(this), 0);
            require(token.approve(aavePool, 0), "Approve reset failed");
            
            address aToken = (assets[i] == usdt) ? aPolUsdt : aPolUsdc;
            uint256 aTokenReceived = IERC20(aToken).balanceOf(address(this)) - aTokenBalances[receiver][aToken];
            aTokenBalances[receiver][aToken] += aTokenReceived;
            totalATokenAmount += aTokenReceived;
        }
        
        shares = _convertToShares(assets, amounts);
        require(shares > 0, "Zero shares");
        
        CHIP(chip).mint(address(this), totalATokenAmount);
        
        if (depositToCasino) {
            require(IERC20(chip).approve(casinoTreasury, shares), "Casino approve failed");
            ICasinoTreasury(casinoTreasury).deposit(address(this), receiver, chip, shares);
            require(IERC20(chip).approve(casinoTreasury, 0), "Casino approve reset failed");
        } else {
            require(IERC20(chip).transfer(receiver, shares), "Chip transfer failed");
        }
        
        emit Deposited(from, assets, amounts, receiver, depositToCasino, shares);
    }

    // --- Withdraw ---
function _calculateWithdrawAmount(
    uint256 shares,
    uint256 numAssets
) internal pure returns (uint256) {
    if (numAssets == 1) return shares;
    return shares / numAssets;
}

function withdraw(
    address from,
    uint256 shares,
    address[] calldata recipients,
    uint256[] calldata recipientAmounts,
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata minAmounts,
    bool fromWallet
) external override onlyAdmin returns (uint256[] memory received) {
    require(recipients.length > 0 && recipients.length == recipientAmounts.length, "Invalid recipients");
    require(shares > 0, "Zero shares");
    require(
        assets.length > 0 &&
        assets.length == amounts.length &&
        assets.length == minAmounts.length,
        "Invalid input"
    );

    for (uint256 i = 0; i < assets.length; i++) {
        require(amounts[i] >= MIN_WITHDRAW_AMOUNT, "Amount below minimum");
    }

    _validatePrecision(shares);

    if (fromWallet) {
        require(IERC20(chip).transferFrom(from, address(this), shares), "Chip transfer failed");
    } else {
        ICasinoTreasury(casinoTreasury).withdraw(from, address(this), chip, shares);
    }

    CHIP(chip).burn(address(this), shares);

    received = new uint256[](assets.length);

    for (uint256 i = 0; i < assets.length; i++) {
        require(assets[i] == usdt || assets[i] == usdc, "Unsupported asset");
        address aToken = (assets[i] == usdt) ? aPolUsdt : aPolUsdc;

        uint256 amount = amounts[i];
        require(amount > 0, "Zero withdraw");
        uint256 maxWithdraw = _calculateWithdrawAmount(shares, assets.length);
        require(amount == maxWithdraw, "Amount does not match max withdraw");

        uint256 receivedAmount = _withdrawFromAave(assets[i], aToken, from, amount, minAmounts[i]);
        received[i] = receivedAmount;

        uint256 remainingAmount = receivedAmount;
        for (uint256 j = 0; j < recipients.length; j++) {
            require(recipients[j] != address(0), "Zero recipient");
            require(recipientAmounts[j] <= remainingAmount, "Amount exceeds available");
            
            if (recipientAmounts[j] > 0) {
                IERC20(assets[i]).safeTransfer(recipients[j], recipientAmounts[j]); // Changed to safeTransfer
                remainingAmount -= recipientAmounts[j];
            }
        }
        require(remainingAmount == 0, "Amount not fully distributed");
    }

    emit Withdrawn(from, shares, assets, amounts, recipients, recipientAmounts);
}

function _withdrawFromAave(
    address asset,
    address aToken,
    address user,
    uint256 amount,
    uint256 minAmount
) internal returns (uint256) {
    require(aTokenBalances[user][aToken] >= amount, "Insufficient aToken");
    aTokenBalances[user][aToken] -= amount;

    _validatePrecision(amount);

    IERC20 token = IERC20(aToken);
    require(token.approve(aavePool, amount), "Approve failed");
    uint256 received = IAavePool(aavePool).withdraw(asset, amount, address(this));
    require(received >= minAmount, "Slippage");
    require(token.approve(aavePool, 0), "Approve reset failed");

    return received;
}

    function setCasinoTreasury(address _casinoTreasury) external onlyOwner {
        require(_casinoTreasury != address(0), "Zero address");
        casinoTreasury = _casinoTreasury;
    }

    function addAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Zero address");
        require(!admins[admin], "Already admin");
        admins[admin] = true;
        emit AdminAdded(admin);
    }

    function removeAdmin(address admin) external onlyOwner {
        require(admins[admin], "Not admin");
        admins[admin] = false;
        emit AdminRemoved(admin);
    }

    function isAdmin(address admin) public view override returns (bool) {
        return admins[admin];
    }
}
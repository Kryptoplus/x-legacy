// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

contract CHIP is 
    Initializable,
    ERC20Upgradeable, 
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    ERC165Upgradeable 
{
    // --- Constants ---
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MIN_SHARE_PRICE = 1e6; // Minimum share price in wei

    // --- State Variables ---
    mapping(address => bool) public vaultInitialized;
    mapping(address => bool) public whitelistedVaults;
    mapping(address => bool) public blacklisted;
    
    // Vault share tracking
    mapping(address => uint256) public vaultATokenBalance;  // Total aToken balance per vault
    mapping(address => uint256) public vaultLastUpdateTimestamp;
    mapping(address => uint256) public vaultSharePrice;     // Share price per vault
    mapping(address => address[]) public vaultAssets;       // Assets supported by vault
    mapping(address => string) public vaultName;            // Vault token name
    mapping(address => string) public vaultSymbol;          // Vault token symbol
    mapping(address => uint256) public vaultTotalSupply;    // Total supply of shares per vault
    mapping(address => mapping(address => uint256)) public vaultShareBalance; // User shares per vault
    mapping(address => address) public vaultForAsset;       // Asset to vault mapping

    // --- Events ---
    event VaultWhitelisted(address indexed vault);
    event VaultRemoved(address indexed vault);
    event Blacklisted(address indexed account);
    event RemovedFromBlacklist(address indexed account);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    event ATokenBalanceUpdated(address indexed vault, uint256 newBalance, uint256 timestamp);
    event SharesMinted(address indexed vault, address indexed to, uint256 amount, uint256 aTokenAmount);
    event SharesBurned(address indexed vault, address indexed from, uint256 amount, uint256 aTokenAmount);
    event SharePriceUpdated(address indexed vault, uint256 oldPrice, uint256 newPrice);
    event VaultInitialized(address indexed vault, address[] assets, string name, string symbol);
    event VaultUpdate(address indexed asset, address vault);

    // --- Modifiers ---
    modifier onlyWhitelistedVault() {
        require(whitelistedVaults[msg.sender], "Not whitelisted vault");
        _;
    }

    modifier notBlacklisted(address account) {
        require(!blacklisted[account], "Account is blacklisted");
        _;
    }

    modifier isVaultInitialized() {
        require(vaultInitialized[msg.sender], "Vault not initialized");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // --- Initializer ---
    function initialize(
        string memory name,
        string memory symbol,
        address initialOwner
    ) public initializer {
        __ERC20_init(name, symbol);
        __Ownable_init(initialOwner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
    }

    // --- UUPS Upgrade ---
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        require(newImplementation != address(0), "Zero implementation");
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // --- Vault Management ---
    function whitelistVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault");
        require(!whitelistedVaults[_vault], "Vault already whitelisted");
        whitelistedVaults[_vault] = true;
        emit VaultWhitelisted(_vault);
    }

    function removeVault(address _vault) external onlyOwner {
        require(whitelistedVaults[_vault], "Vault not whitelisted");
        require(vaultTotalSupply[_vault] == 0, "Vault has outstanding shares");
        whitelistedVaults[_vault] = false;
        emit VaultRemoved(_vault);
    }

    // Initialize vault with assets, name, and symbol
    function initializeVault(
        address asset1,
        address asset2,
        string memory _name,
        string memory _symbol
    ) external onlyWhitelistedVault {
        require(!vaultInitialized[msg.sender], "Vault already initialized");
        require(asset1 != address(0) && asset2 != address(0), "Zero asset");
        
        vaultInitialized[msg.sender] = true;
        address[] memory assets = new address[](2);
        assets[0] = asset1;
        assets[1] = asset2;
        vaultAssets[msg.sender] = assets;
        vaultName[msg.sender] = _name;
        vaultSymbol[msg.sender] = _symbol;
        vaultSharePrice[msg.sender] = PRECISION; // 1:1 initial price
        vaultLastUpdateTimestamp[msg.sender] = block.timestamp;
        vaultTotalSupply[msg.sender] = 0; // Initialize vault-specific supply
        
        vaultForAsset[asset1] = msg.sender;
        vaultForAsset[asset2] = msg.sender;
        emit VaultUpdate(asset1, msg.sender);
        emit VaultUpdate(asset2, msg.sender);
        
        emit VaultInitialized(msg.sender, assets, _name, _symbol);
        emit SharePriceUpdated(msg.sender, 0, PRECISION);
    }

    // Update aToken balance
    function updateATokenBalance(uint256 newBalance) external onlyWhitelistedVault {
        require(newBalance >= vaultATokenBalance[msg.sender], "Balance cannot decrease");
        vaultATokenBalance[msg.sender] = newBalance;
        vaultLastUpdateTimestamp[msg.sender] = block.timestamp;
        emit ATokenBalanceUpdated(msg.sender, newBalance, block.timestamp);
    }

    // Mint shares based on aToken value
    function mint(address to, uint256 aTokenAmount) 
        external 
        onlyWhitelistedVault 
        nonReentrant 
        whenNotPaused 
    {
        require(vaultInitialized[msg.sender], "Vault not initialized");
        require(to != address(0), "Mint to zero address");
        require(aTokenAmount > 0, "Zero aToken amount");
        require(!blacklisted[to], "Recipient is blacklisted");
        
        uint256 shares;
        if (vaultTotalSupply[msg.sender] == 0) {
            shares = aTokenAmount; // First deposit: 1:1 ratio
        } else {
            shares = (aTokenAmount * vaultTotalSupply[msg.sender]) / vaultATokenBalance[msg.sender];
        }
        
        require(shares > 0, "Zero shares");
        
        _mint(to, shares);
        vaultATokenBalance[msg.sender] += aTokenAmount;
        vaultTotalSupply[msg.sender] += shares; // Update vault-specific supply
        vaultShareBalance[msg.sender][to] += shares; // Track shares per user per vault
        
        uint256 newSharePrice = (vaultATokenBalance[msg.sender] * PRECISION) / vaultTotalSupply[msg.sender];
        require(newSharePrice >= MIN_SHARE_PRICE, "Share price too low");
        
        emit SharePriceUpdated(msg.sender, vaultSharePrice[msg.sender], newSharePrice);
        vaultSharePrice[msg.sender] = newSharePrice;
        vaultLastUpdateTimestamp[msg.sender] = block.timestamp;
        
        emit SharesMinted(msg.sender, to, shares, aTokenAmount);
        emit ATokenBalanceUpdated(msg.sender, vaultATokenBalance[msg.sender], block.timestamp);
    }

    // Burn shares and return aToken amount
    function burn(address from, uint256 shares) 
        external 
        onlyWhitelistedVault 
        isVaultInitialized 
        nonReentrant 
        whenNotPaused 
        returns (uint256) 
    {
        require(from != address(0), "Burn from zero address");
        require(shares > 0, "Zero shares");
        require(!blacklisted[from], "Account is blacklisted");
        require(vaultShareBalance[msg.sender][from] >= shares, "Insufficient vault shares");
        
        uint256 aTokenAmount = (shares * vaultATokenBalance[msg.sender]) / vaultTotalSupply[msg.sender];
        require(aTokenAmount > 0, "Zero aToken amount");
        
        _burn(from, shares);
        vaultATokenBalance[msg.sender] -= aTokenAmount;
        vaultTotalSupply[msg.sender] -= shares; // Update vault-specific supply
        vaultShareBalance[msg.sender][from] -= shares; // Update user shares per vault
        
        uint256 newSharePrice = vaultTotalSupply[msg.sender] == 0 ? PRECISION : 
            (vaultATokenBalance[msg.sender] * PRECISION) / vaultTotalSupply[msg.sender];
        require(newSharePrice >= MIN_SHARE_PRICE, "Share price too low");
        
        emit SharePriceUpdated(msg.sender, vaultSharePrice[msg.sender], newSharePrice);
        vaultSharePrice[msg.sender] = newSharePrice;
        vaultLastUpdateTimestamp[msg.sender] = block.timestamp;
        
        emit SharesBurned(msg.sender, from, shares, aTokenAmount);
        return aTokenAmount;
    }

    // --- View Functions ---
 function getSharePrice(address _vaultAddress) external view returns (uint256) {
    require(whitelistedVaults[_vaultAddress], "Invalid vault");
    require(vaultInitialized[_vaultAddress], "Vault not initialized");
    return vaultSharePrice[_vaultAddress];
}

function convertToShares(uint256 aTokenAmount, address _vaultAddress) external view returns (uint256) {
    require(whitelistedVaults[_vaultAddress], "Invalid vault");
    require(vaultInitialized[_vaultAddress], "Vault not initialized");
    if (vaultTotalSupply[_vaultAddress] == 0) return aTokenAmount;
    return (aTokenAmount * vaultTotalSupply[_vaultAddress]) / vaultATokenBalance[_vaultAddress];
}

    function convertToATokens(uint256 shares, address _vaultAddress) external view returns (uint256) {
    require(whitelistedVaults[_vaultAddress], "Invalid vault");
    require(vaultInitialized[_vaultAddress], "Vault not initialized");
    if (vaultTotalSupply[_vaultAddress] == 0) return shares;
    return (shares * vaultATokenBalance[_vaultAddress]) / vaultTotalSupply[_vaultAddress];
}

function getVaultTotalSupply(address _vaultAddress) external view returns (uint256) {
    require(whitelistedVaults[_vaultAddress], "Invalid vault");
    return vaultTotalSupply[_vaultAddress];
}
    function share() external view returns (address) {
        return address(this);
    }

    function vault(address asset) external view returns (address) {
        require(vaultForAsset[asset] != address(0), "No vault for asset");
        return vaultForAsset[asset];
    }

    // --- Override Functions ---
    function transfer(address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        notBlacklisted(msg.sender) 
        notBlacklisted(to) 
        returns (bool) 
    {
        // Note: Transfers do not adjust vaultShareBalance; consider requiring vault context
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        notBlacklisted(from) 
        notBlacklisted(to) 
        returns (bool) 
    {
        // Note: Transfers do not adjust vaultShareBalance; consider requiring vault context
        return super.transferFrom(from, to, amount);
    }

    function approve(address spender, uint256 amount) 
        public 
        override 
        whenNotPaused 
        notBlacklisted(msg.sender) 
        notBlacklisted(spender) 
        returns (bool) 
    {
        return super.approve(spender, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == 0x2f0a18c5 || // ERC-7575 Vault
               interfaceId == 0xf815c03d || // ERC-7575 Share
               interfaceId == 0x01ffc9a7;   // ERC-165
    }

    // --- Additional View Function ---
 function getVaultShareBalance(address _vaultAddress, address user) external view returns (uint256) {
    require(whitelistedVaults[_vaultAddress], "Invalid vault");
    return vaultShareBalance[_vaultAddress][user];
}

    // Required storage gap for upgradeable contracts
    uint256[48] private __gap;
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;


import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";  // Updated path
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";  // Updated path
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ICasinoTreasury.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract CasinoPaymentRegistry is 
    Initializable, 
    OwnableUpgradeable, 
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Address for address;

    // --- Constants ---
    uint256 public constant MAX_CASINO_COUNT = 1000;
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_TOTAL_FEE_BPS = 2000; // 20%

    // --- State Variables ---
    uint16 public platformFeeBps;
    address public platformFeeRecipient;
    uint256 public lastFeeUpdate;
    uint256 public constant FEE_UPDATE_COOLDOWN = 24 hours;

    struct Casino {
        address owner;
        address treasury;
        EnumerableSet.AddressSet adminWallets;
        bool active;
        uint256 registrationTimestamp;
        uint256 lastAdminUpdate;
        uint256 lastTokenUpdate;
    }

    mapping(uint256 => Casino) internal casinos;
    mapping(uint256 => bool) public registeredCasinos;
    uint256 public casinoCount;

    mapping(uint256 => mapping(address => bool)) public supportedTokens;
    mapping(uint256 => mapping(address => bool)) public suspendedUsers;
    EnumerableSet.AddressSet private _whitelist;

    mapping(address => bytes32) public userUniversalIds;
    mapping(bytes32 => address) public universalIdToUser;

    address public casinoTreasuryImplementation;

    // --- Events ---
    event CasinoRegistered(uint256 indexed casinoId, address indexed owner, address treasury);
    event CasinoStatusChanged(uint256 indexed casinoId, bool active);
    event TokenSupportUpdated(uint256 indexed casinoId, address indexed token, bool supported);
    event UserSuspended(uint256 indexed casinoId, address indexed user, bool suspended);
    event PlatformFeeUpdated(uint16 platformFeeBps, address recipient);
    event UserLinkedAcrossChains(address indexed user, bytes32 universalId);
    event WhitelistUpdated(address indexed account, bool status);
    event AdminWalletAdded(uint256 indexed casinoId, address adminWallet);
    event AdminWalletRemoved(uint256 indexed casinoId, address adminWallet);
    event CasinoTreasuryUpdated(uint256 indexed casinoId, address newTreasury);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);

    // --- Modifiers ---
    modifier onlyWhitelisted() {
        require(_whitelist.contains(_msgSender()) || _msgSender() == owner(), "Registry: Not whitelisted");
        _;
    }

    modifier onlyCasinoOwner(uint256 _casinoId) {
        require(registeredCasinos[_casinoId], "Registry: Casino does not exist");
        require(_msgSender() == casinos[_casinoId].owner, "Registry: Not casino owner");
        _;
    }

    modifier onlyCasinoAdmin(uint256 _casinoId) {
        if (registeredCasinos[_casinoId]) {
            Casino storage casino = casinos[_casinoId];
            require(
                _msgSender() == casino.owner || 
                casino.adminWallets.contains(_msgSender()) ||
                _msgSender() == owner(),
                "Registry: Not casino admin"
            );
        }
        _;
    }

    modifier casinoExists(uint256 _casinoId) {
        require(_casinoId < casinoCount, "Registry: Casino does not exist");
        _;
    }

 
    // --- Initializer ---
    function initialize(
        address _initialOwner,
        uint16 _initialPlatformFeeBps,
        address _initialFeeRecipient
    ) public initializer {
        require(_initialPlatformFeeBps <= MAX_PLATFORM_FEE_BPS, "Registry: Fee too high");
        require(_initialFeeRecipient != address(0), "Registry: Zero fee recipient");
        require(_initialOwner != address(0), "Registry: Zero owner address");

        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        platformFeeBps = _initialPlatformFeeBps;
        platformFeeRecipient = _initialFeeRecipient;
        _whitelist.add(_initialOwner);
        emit WhitelistUpdated(_initialOwner, true);
    }

  // --- UUPS Upgrade ---
function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
    require(newImplementation != address(0), "Registry: Zero implementation");
    require(newImplementation.code.length > 0, "Registry: Not a contract");
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

    // --- Treasury Implementation Management ---
    function setTreasuryImplementation(address _implementation) external onlyOwner {
        require(_implementation != address(0), "Registry: Zero implementation");
        require(_implementation.code.length > 0, "Registry: Not a contract");
        casinoTreasuryImplementation = _implementation;
    }

    // --- Whitelist Management ---
    function updateWhitelist(address _account, bool _status) external onlyOwner {
        require(_account != address(0), "Registry: Zero address");
        if (_status) {
            _whitelist.add(_account);
        } else {
            require(_account != owner(), "Registry: Cannot remove owner");
            _whitelist.remove(_account);
        }
        emit WhitelistUpdated(_account, _status);
    }

    function isWhitelisted(address _account) external view returns (bool) {
        return _whitelist.contains(_account);
    }

    // --- Casino Management ---
    function _createNewCasinoId() private view returns (uint256) {
        require(casinoCount < MAX_CASINO_COUNT, "Registry: Max casinos reached");
        uint256 newCasinoId = casinoCount;
        require(!registeredCasinos[newCasinoId], "Registry: ID collision");
        return newCasinoId;
    }

    function _deployTreasuryProxy(
        uint256 _casinoId,
        address _treasuryInstanceOwner
    ) private returns (address) {
        require(casinoTreasuryImplementation != address(0), "Registry: No implementation");
        require(_treasuryInstanceOwner != address(0), "Registry: Zero owner");

        bytes memory initData = abi.encodeWithSelector(
            ICasinoTreasury.initialize.selector,
            address(this),
            _casinoId,
            _treasuryInstanceOwner
        );

        address treasuryProxy = address(new ERC1967Proxy(
            casinoTreasuryImplementation,
            initData
        ));

        require(treasuryProxy.code.length > 0, "Registry: Deployment failed");
        return treasuryProxy;
    }

    function canRegisterCasino(address _caller) public view returns (bool, string memory) {
        if (_caller != owner() && !_whitelist.contains(_caller)) {
            return (false, "Caller not authorized");
        }
        if (casinoTreasuryImplementation == address(0)) {
            return (false, "Treasury implementation not set");
        }
        return (true, "Registration possible");
    }

    function registerCasinoAndDeployTreasury(
        address _casinoOwner,
        address _treasuryInstanceOwner,
        address[] memory _initialAdminWallets,
        address[] memory _initialSupportedTokens
    )
        public
        nonReentrant
        whenNotPaused
        onlyWhitelisted
        returns (uint256 casinoId, address treasuryProxyAddress)
    {
        casinoId = _createNewCasinoId();
        treasuryProxyAddress = _deployTreasuryProxy(casinoId, _treasuryInstanceOwner);

        Casino storage newCasino = casinos[casinoId];
        newCasino.owner = _casinoOwner;
        newCasino.treasury = treasuryProxyAddress;
        newCasino.active = true;
        newCasino.registrationTimestamp = block.timestamp;
        newCasino.lastAdminUpdate = block.timestamp;
        newCasino.lastTokenUpdate = block.timestamp;

        registeredCasinos[casinoId] = true;

        for (uint i = 0; i < _initialAdminWallets.length; i++) {
            if (_initialAdminWallets[i] != address(0)) {
                newCasino.adminWallets.add(_initialAdminWallets[i]);
            }
        }

        for (uint i = 0; i < _initialSupportedTokens.length; i++) {
            if (_initialSupportedTokens[i] != address(0)) {
                supportedTokens[casinoId][_initialSupportedTokens[i]] = true;
                emit TokenSupportUpdated(casinoId, _initialSupportedTokens[i], true);
            }
        }

        casinoCount++;
        emit CasinoRegistered(casinoId, _casinoOwner, treasuryProxyAddress);
        return (casinoId, treasuryProxyAddress);
    }

    // --- Admin Management ---
    function addCasinoAdmin(uint256 _casinoId, address _adminWallet) 
        external 
        onlyCasinoOwner(_casinoId)
        nonReentrant
        whenNotPaused
    {
        require(_adminWallet != address(0), "Registry: Zero address");
        bool added = casinos[_casinoId].adminWallets.add(_adminWallet);
        require(added, "Registry: Admin exists");
        casinos[_casinoId].lastAdminUpdate = block.timestamp;
        emit AdminWalletAdded(_casinoId, _adminWallet);
    }

    function removeCasinoAdmin(uint256 _casinoId, address _adminWallet) 
        external 
        onlyCasinoOwner(_casinoId)
        nonReentrant
        whenNotPaused
    {
        bool removed = casinos[_casinoId].adminWallets.remove(_adminWallet);
        require(removed, "Registry: Admin not found");
        casinos[_casinoId].lastAdminUpdate = block.timestamp;
        emit AdminWalletRemoved(_casinoId, _adminWallet);
    }

    // --- Casino Operations ---
    function setCasinoStatus(uint256 _casinoId, bool _active) 
        external 
        onlyCasinoAdmin(_casinoId)
        nonReentrant
        whenNotPaused
    {
        casinos[_casinoId].active = _active;
        emit CasinoStatusChanged(_casinoId, _active);
    }

    function setTokenSupport(uint256 _casinoId, address _token, bool _supported) 
        external 
        onlyCasinoAdmin(_casinoId)
        nonReentrant
        whenNotPaused
    {
        require(_token != address(0), "Registry: Zero token address");
        supportedTokens[_casinoId][_token] = _supported;
        casinos[_casinoId].lastTokenUpdate = block.timestamp;
        emit TokenSupportUpdated(_casinoId, _token, _supported);
    }

    function setSuspendedUser(uint256 _casinoId, address _user, bool _suspended) 
        external 
        onlyCasinoAdmin(_casinoId)
        nonReentrant
        whenNotPaused
    {
        require(_user != address(0), "Registry: Zero user address");
        suspendedUsers[_casinoId][_user] = _suspended;
        emit UserSuspended(_casinoId, _user, _suspended);
    }

    function updateCasinoTreasury(uint256 _casinoId, address _newTreasury) 
        external 
        onlyCasinoOwner(_casinoId)
        nonReentrant
        whenNotPaused
    {
        require(_newTreasury != address(0), "Registry: Zero treasury address");
        require(_newTreasury.code.length > 0, "Registry: Not a contract");
        casinos[_casinoId].treasury = _newTreasury;
        emit CasinoTreasuryUpdated(_casinoId, _newTreasury);
    }

    // --- Fee Management ---
    function updatePlatformFee(uint16 _newPlatformFeeBps, address _newRecipient) 
        external 
        onlyOwner
        nonReentrant
    {
        require(_newPlatformFeeBps <= MAX_PLATFORM_FEE_BPS, "Registry: Fee too high");
        require(_newRecipient != address(0), "Registry: Zero recipient");
        require(block.timestamp >= lastFeeUpdate + FEE_UPDATE_COOLDOWN, "Registry: Too soon");

        platformFeeBps = _newPlatformFeeBps;
        platformFeeRecipient = _newRecipient;
        lastFeeUpdate = block.timestamp;
        
        emit PlatformFeeUpdated(_newPlatformFeeBps, _newRecipient);
    }

    // --- Cross-Chain Linking ---
    function linkUserAcrossChains(address _user, bytes32 _universalId) 
        external 
        onlyWhitelisted
        nonReentrant
        whenNotPaused
    {
        require(_user != address(0), "Registry: Zero user address");
        require(_universalId != bytes32(0), "Registry: Zero universal ID");
        require(universalIdToUser[_universalId] == address(0) || universalIdToUser[_universalId] == _user, "Registry: Universal ID already linked");
        require(userUniversalIds[_user] == bytes32(0) || userUniversalIds[_user] == _universalId, "Registry: User already linked");

        userUniversalIds[_user] = _universalId;
        universalIdToUser[_universalId] = _user;

        emit UserLinkedAcrossChains(_user, _universalId);
    }

    // --- View Functions ---
    function isUserSuspended(uint256 _casinoId, address _user) external view returns (bool) {
        return registeredCasinos[_casinoId] && suspendedUsers[_casinoId][_user];
    }

    function isTokenSupported(uint256 _casinoId, address _token) external view returns (bool) {
        return registeredCasinos[_casinoId] && supportedTokens[_casinoId][_token];
    }

    function getCasinoDetails(uint256 _casinoId) external view returns (
        address owner,
        address treasury,
        bool active,
        uint256 registrationTimestamp
    ) {
        if (!registeredCasinos[_casinoId]) {
            return (address(0), address(0), false, 0);
        }
        Casino storage casino = casinos[_casinoId];
        return (
            casino.owner,
            casino.treasury,
            casino.active,
            casino.registrationTimestamp
        );
    }

    function getCasinoAdmins(uint256 _casinoId) external view returns (address[] memory) {
        if (!registeredCasinos[_casinoId]) {
            return new address[](0);
        }
        return casinos[_casinoId].adminWallets.values();
    }

    function getWhitelistedAccounts() external view returns (address[] memory) {
        return _whitelist.values();
    }

    // Required storage gap for upgradeable contracts
    uint256[45] private __gap;
}
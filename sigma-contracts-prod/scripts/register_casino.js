const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const hre = require("hardhat");
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000; // Max limit for Polygon block
const MANUAL_GAS_PRICE_GWEI = "50"; // Gwei
const MANUAL_MAX_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const MANUAL_MAX_PRIORITY_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    maxFeePerGas: MANUAL_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MANUAL_MAX_PRIORITY_FEE_PER_GAS,
};

async function getRegistryAddress(network) {
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
        const networkInfo = deploymentInfo[network];
        
        if (!networkInfo || !networkInfo.CasinoPaymentRegistry || !networkInfo.CasinoPaymentRegistry.proxyAddress) {
            throw new Error(`Registry proxy address not found for network ${network}`);
        }
        
        return networkInfo.CasinoPaymentRegistry.proxyAddress;
    } catch (error) {
        console.error("Error reading deployment info:", error.message);
        process.exit(1);
    }
}

async function saveCasinoInfo(info) {
    let existingData = {};
    if (fs.existsSync(DEPLOYMENT_INFO_PATH)) {
        try {
            existingData = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH));
        } catch (error) {
            console.warn("Could not parse existing deployment-info.json:", error);
        }
    }

    const network = info.network;
    if (!existingData[network]) {
        existingData[network] = {};
    }
    if (!existingData[network].Casinos) {
        existingData[network].Casinos = {};
    }

    // Save casino info with proxy information
    existingData[network].Casinos[info.casinoId] = {
        owner: info.owner,
        treasuryAddress: info.treasuryAddress,
        registrationTimestamp: info.timestamp,
        transactionHash: info.transactionHash,
        blockNumber: info.blockNumber,
        initialAdmins: info.initialAdmins,
        initialTokens: info.initialTokens,
        proxy: {
            address: info.treasuryAddress,
            deployer: info.deployer,
            transactionHash: info.transactionHash,
            blockNumber: info.blockNumber,
            timestamp: info.timestamp,
            initializerArgs: {
                registryAddress: info.registryAddress,
                casinoId: info.casinoId,
                initialTreasuryOwner: info.treasuryOwner
            }
        }
    };

    fs.writeFileSync(DEPLOYMENT_INFO_PATH, JSON.stringify(existingData, null, 2));
}

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();
    
    const registryAddress = await getRegistryAddress(network);
    
    // Get parameters
    const casinoOwner = process.env.CASINO_OWNER_ADDRESS || deployer.address;
    const treasuryOwner = process.env.TREASURY_OWNER_ADDRESS || deployer.address;
    
    // Parse arrays from env
    let initialAdmins = [];
    try {
        if (process.env.INITIAL_ADMIN_WALLETS) {
            initialAdmins = JSON.parse(process.env.INITIAL_ADMIN_WALLETS)
                .map(addr => ethers.getAddress(addr))
                .filter(addr => addr !== ethers.ZeroAddress);
        }
    } catch (error) {
        console.warn("Warning: Could not parse INITIAL_ADMIN_WALLETS, using empty array");
    }

    let initialTokens = [];
    try {
        if (process.env.INITIAL_SUPPORTED_TOKENS) {
            initialTokens = JSON.parse(process.env.INITIAL_SUPPORTED_TOKENS)
                .map(addr => ethers.getAddress(addr))
                .filter(addr => addr !== ethers.ZeroAddress);
        }
    } catch (error) {
        console.warn("Warning: Could not parse INITIAL_SUPPORTED_TOKENS, using empty array");
    }

    // If no initial admins provided, add the casino owner as an admin
    if (initialAdmins.length === 0) {
        initialAdmins = [casinoOwner];
        console.log("No initial admins provided, using casino owner as admin");
    }

    // Log setup information
    console.log(`Registering new casino on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

    console.log("Parameters:");
    console.log(`Registry Address: ${registryAddress}`);
    console.log(`Casino Owner: ${casinoOwner}`);
    console.log(`Treasury Owner: ${treasuryOwner}`);
    console.log(`Initial Admins: ${initialAdmins.join(', ')}`);
    console.log(`Initial Tokens: ${initialTokens.length > 0 ? initialTokens.join(', ') : 'None'}\n`);

    try {
        // Get the Registry contract factory
        const Registry = await ethers.getContractFactory("CasinoPaymentRegistry");
        
        // Create contract instance **connected to the deployer**
        const registry = Registry.attach(registryAddress).connect(deployer);

        // Verify registry connection
        const owner = await registry.owner();
        console.log(`Registry owner: ${owner}`);
        
        // Check if deployer is whitelisted
        const isWhitelisted = await registry.isWhitelisted(deployer.address);
        console.log(`Deployer whitelisted: ${isWhitelisted}`);

        // Check treasury implementation
        const treasuryImpl = await registry.casinoTreasuryImplementation();
        console.log(`Treasury implementation: ${treasuryImpl}`);

        // Verify all prerequisites
        if (!isWhitelisted && owner !== deployer.address) {
            throw new Error("Deployer is not whitelisted and is not the owner");
        }
        if (treasuryImpl === ethers.ZeroAddress) {
            throw new Error("Treasury implementation not set in registry");
        }

        // Check if casino count is at max
        const casinoCount = await registry.casinoCount();
        const maxCasinoCount = await registry.MAX_CASINO_COUNT();
        if (casinoCount >= maxCasinoCount) {
            throw new Error(`Maximum casino count (${maxCasinoCount}) reached`);
        }

        // Register casino
        console.log("\nRegistering casino...");
        const tx = await registry.registerCasinoAndDeployTreasury(
            casinoOwner,
            treasuryOwner,
            initialAdmins,
            initialTokens,
            TX_OVERRIDES
        );
        
        console.log(`Transaction hash: ${tx.hash}`);
        console.log("Waiting for confirmation...");
        const receipt = await tx.wait(2);

        if (receipt.status === 0) {
            throw new Error(`Transaction failed: ${tx.hash}`);
        }

        // Parse events
        const event = receipt.logs.find(log => {
            try {
                const parsedLog = registry.interface.parseLog(log);
                return parsedLog && parsedLog.name === "CasinoRegistered";
            } catch (e) {
                return false;
            }
        });

        if (!event) {
            throw new Error("Could not find CasinoRegistered event");
        }

        const { casinoId, treasury } = event.args;
        console.log("\nRegistration successful!");
        console.log(`Casino ID: ${casinoId}`);
        console.log(`Treasury Address: ${treasury}`);

        // Save casino info with proxy information
        await saveCasinoInfo({
            network,
            casinoId: casinoId.toString(),
            owner: casinoOwner,
            treasuryAddress: treasury,
            treasuryOwner: treasuryOwner,
            registryAddress: registryAddress,
            deployer: deployer.address,
            timestamp: new Date().toISOString(),
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            initialAdmins,
            initialTokens
        });

        console.log("\nCasino info saved to deployment-info.json");
        console.log("\nNext steps:");
        console.log("1. Deploy vault for this casino:");
        console.log(`   CASINO_ID=${casinoId} npx hardhat run scripts/deploy_vault.js --network ${network}`);
        console.log("2. Set casino fees (optional):");
        console.log(`   CASINO_ID=${casinoId} npx hardhat run scripts/set_casino_fees.js --network ${network}`);
        console.log("3. Set deposit/withdrawal limits (optional):");
        console.log(`   CASINO_ID=${casinoId} npx hardhat run scripts/set_casino_limits.js --network ${network}`);

    } catch (error) {
        console.error("\nOperation failed!");
        console.error("Error details:", error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
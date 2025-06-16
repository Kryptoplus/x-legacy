const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const hre = require("hardhat");
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5_000_000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function validateAddresses(addresses) {
    for (const [name, address] of Object.entries(addresses)) {
        if (!ethers.isAddress(address)) {
            throw new Error(`Invalid ${name} address: ${address}`);
        }
    }
}

async function saveVaultInfo(network, casinoId, vaultInfo) {
    let deploymentInfo = {};
    if (fs.existsSync(DEPLOYMENT_INFO_PATH)) {
        try {
            deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH));
        } catch (error) {
            console.warn("Could not parse existing deployment-info.json:", error);
        }
    }

    if (!deploymentInfo[network]) {
        deploymentInfo[network] = {};
    }
    if (!deploymentInfo[network].Casinos) {
        deploymentInfo[network].Casinos = {};
    }
    if (!deploymentInfo[network].Casinos[casinoId]) {
        deploymentInfo[network].Casinos[casinoId] = {};
    }

    deploymentInfo[network].Casinos[casinoId].vault = {
        address: vaultInfo.address,
        deployer: vaultInfo.deployer,
        transactionHash: vaultInfo.transactionHash,
        blockNumber: vaultInfo.blockNumber,
        timestamp: vaultInfo.timestamp,
        constructorArgs: vaultInfo.constructorArgs
    };

    fs.writeFileSync(DEPLOYMENT_INFO_PATH, JSON.stringify(deploymentInfo, null, 2));
}

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();
    
    console.log(`Deploying SigmaVault on network: ${network}`);
    console.log(`Deployer account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // Get constructor arguments from environment
    const addresses = {
        usdt: process.env.USDT_ADDRESS,
        usdc: process.env.USDC_ADDRESS,
        aPolUsdt: process.env.APOLUSDT_ADDRESS,
        aPolUsdc: process.env.APOLUSDC_ADDRESS,
        aavePool: process.env.AAVEPOOL_ADDRESS,
        chip: process.env.CHIP_ADDRESS,
        casinoTreasury: process.env.CASINOTREASURY_ADDRESS,
        initialOwner: process.env.INITIAL_OWNER || deployer.address
    };

    // Get vault name and symbol from environment or use defaults
    const vaultName = process.env.VAULT_NAME || "Sigma Vault";
    const vaultSymbol = process.env.VAULT_SYMBOL || "SV";

    // Get casino ID from environment
    const casinoId = process.env.CASINO_ID;
    if (!casinoId) {
        throw new Error("CASINO_ID not set in environment");
    }

    // Validate all addresses
    await validateAddresses(addresses);

    console.log("Deployment Parameters:");
    console.log("Casino ID:", casinoId);
    console.log("Vault Name:", vaultName);
    console.log("Vault Symbol:", vaultSymbol);
    console.log("USDT:", addresses.usdt);
    console.log("USDC:", addresses.usdc);
    console.log("aPolUSDT:", addresses.aPolUsdt);
    console.log("aPolUSDC:", addresses.aPolUsdc);
    console.log("AAVE Pool:", addresses.aavePool);
    console.log("CHIP:", addresses.chip);
    console.log("Casino Treasury:", addresses.casinoTreasury);
    console.log("Initial Owner:", addresses.initialOwner);

    try {
        // Deploy SigmaVault
        console.log("\nDeploying SigmaVault...");
        const SigmaVault = await ethers.getContractFactory("SigmaVault");
        const vault = await SigmaVault.deploy(
            addresses.usdt,
            addresses.usdc,
            addresses.aPolUsdt,
            addresses.aPolUsdc,
            addresses.aavePool,
            addresses.chip,
            addresses.casinoTreasury,
            addresses.initialOwner,
            vaultName,
            vaultSymbol,
            TX_OVERRIDES
        );

        console.log("Waiting for deployment transaction...");
        await vault.waitForDeployment();
        const receipt = await vault.deploymentTransaction().wait(2);
        const vaultAddress = await vault.getAddress();

        console.log("\nDeployment successful!");
        console.log("SigmaVault deployed to:", vaultAddress);
        console.log(`Transaction Hash: ${receipt.hash}`);
        console.log(`Block Number: ${receipt.blockNumber}`);

        // Connect to CHIP contract
        console.log("\nConnecting to CHIP contract...");
        const chipContract = await ethers.getContractAt("CHIP", addresses.chip, deployer);

        // Whitelist the vault in CHIP
        console.log("Whitelisting vault in CHIP...");
        const isVaultWhitelisted = await chipContract.whitelistedVaults(vaultAddress);
        if (!isVaultWhitelisted) {
            const whitelistTx = await chipContract.whitelistVault(vaultAddress, TX_OVERRIDES);
            await whitelistTx.wait(2);
            console.log("Vault whitelisted successfully");
        } else {
            console.log("Vault already whitelisted");
        }

        // Check initialization status before
        const vaultContract = await ethers.getContractAt("SigmaVault", vaultAddress, deployer);
        console.log("Checking SigmaVault initialization status...");
        const isVaultInitialized = await vaultContract.initialized();
        console.log("SigmaVault initialized:", isVaultInitialized);
        const isChipVaultInitialized = await chipContract.vaultInitialized(vaultAddress);
        console.log("CHIP vault initialized:", isChipVaultInitialized);

        // Initialize vault in CHIP contract
        console.log("Initializing vault in CHIP contract...");
        const initTx = await vaultContract.initializeVault(
            addresses.usdt,
            addresses.usdc,
            vaultName,
            vaultSymbol,
            TX_OVERRIDES
        );
        const initReceipt = await initTx.wait(2);
        console.log("Vault initialized successfully");
        console.log(`Initialization Transaction Hash: ${initReceipt.hash}`);

        // Verify initialization
        const isVaultInitializedAfter = await vaultContract.initialized();
        console.log("SigmaVault initialized after call:", isVaultInitializedAfter);
        const isChipVaultInitializedAfter = await chipContract.vaultInitialized(vaultAddress);
        console.log("CHIP vault initialized after call:", isChipVaultInitializedAfter);

        // Save vault info
        await saveVaultInfo(network, casinoId, {
            address: vaultAddress,
            deployer: deployer.address,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            timestamp: new Date().toISOString(),
            constructorArgs: {
                ...addresses,
                name: vaultName,
                symbol: vaultSymbol
            }
        });

        console.log("\nDeployment info saved to deployment-info.json");

        // Verify contract if not on local network
        if (network !== "hardhat" && network !== "localhost" && process.env.ETHERSCAN_API_KEY) {
            console.log("\nWaiting before verification...");
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay

            console.log("Verifying contract on Etherscan...");
            try {
                await hre.run("verify:verify", {
                    address: vaultAddress,
                    constructorArguments: [
                        addresses.usdt,
                        addresses.usdc,
                        addresses.aPolUsdt,
                        addresses.aPolUsdc,
                        addresses.aavePool,
                        addresses.chip,
                        addresses.casinoTreasury,
                        addresses.initialOwner,
                        vaultName,
                        vaultSymbol
                    ]
                });
                console.log("Contract verified successfully");
            } catch (error) {
                if (error.message.includes("Already Verified")) {
                    console.log("Contract already verified");
                } else {
                    console.error("Verification failed:", error);
                }
            }
        }

        console.log("\nNext steps:");
        console.log("1. Set vault address in CasinoTreasury using setVault()");
        console.log("2. Configure initial admin permissions");
        console.log("3. Test first deposit");

    } catch (error) {
        console.error("\nDeployment failed!");
        console.error("Error details:", error);
        // Additional debugging
        if (error.receipt) {
            console.error("Transaction receipt:", JSON.stringify(error.receipt, null, 2));
        }
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
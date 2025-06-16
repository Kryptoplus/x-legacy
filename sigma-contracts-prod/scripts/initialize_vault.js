const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hre.network.name;

    console.log(`Initializing vault on network: ${network}`);
    console.log(`Deployer account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
    const networkInfo = deploymentInfo[network];
    
    if (!networkInfo) {
        throw new Error(`No deployment info found for network: ${network}`);
    }

    // Get vault info for casino 1
    const casinoInfo = networkInfo.Casinos["1"];
    if (!casinoInfo || !casinoInfo.vault) {
        throw new Error('No vault found for casino 1');
    }

    const vaultInfo = casinoInfo.vault;
    const vaultAddress = vaultInfo.address;
    const chipAddress = vaultInfo.constructorArgs.chip;
    const usdtAddress = vaultInfo.constructorArgs.usdt;
    const usdcAddress = vaultInfo.constructorArgs.usdc;
    const vaultName = vaultInfo.constructorArgs.name || "SigmaVault";
    const vaultSymbol = vaultInfo.constructorArgs.symbol || "sVUSD";

    console.log("\n=== Contract Addresses ===");
    console.log(`Vault: ${vaultAddress}`);
    console.log(`CHIP: ${chipAddress}`);
    console.log(`USDT: ${usdtAddress}`);
    console.log(`USDC: ${usdcAddress}`);
    console.log(`Vault Name: ${vaultName}`);
    console.log(`Vault Symbol: ${vaultSymbol}`);

    // Get contract instances
    const chip = await ethers.getContractAt("CHIP", chipAddress);
    const vault = await ethers.getContractAt("SigmaVault", vaultAddress);

    // Check if vault is whitelisted
    console.log("\nChecking vault whitelist status...");
    const isVaultWhitelisted = await chip.whitelistedVaults(vaultAddress);
    console.log(`Vault whitelisted: ${isVaultWhitelisted}`);

    if (!isVaultWhitelisted) {
        console.log("Whitelisting vault in CHIP...");
        const whitelistTx = await chip.whitelistVault(vaultAddress, TX_OVERRIDES);
        await whitelistTx.wait(2);
        console.log("Vault whitelisted successfully");
    }

    // Check if vault is initialized
    console.log("\nChecking vault initialization status...");
    const isVaultInitialized = await chip.vaultInitialized(vaultAddress);
    console.log(`Vault initialized: ${isVaultInitialized}`);

    if (!isVaultInitialized) {
        console.log("Initializing vault in CHIP...");
        // Call initializeVault on the CHIP contract
        const initTx = await chip.initializeVault(
            usdtAddress,
            usdcAddress,
            vaultName,
            vaultSymbol,
            TX_OVERRIDES
        );
        await initTx.wait(2);
        console.log("Vault initialized successfully");
    }

    // Verify final status
    console.log("\n=== Final Status Check ===");
    const finalWhitelistStatus = await chip.whitelistedVaults(vaultAddress);
    const finalInitStatus = await chip.vaultInitialized(vaultAddress);
    const vaultATokenBalance = await chip.vaultATokenBalance(vaultAddress);
    const vaultSharePrice = await chip.vaultSharePrice(vaultAddress);

    console.log(`Vault whitelisted: ${finalWhitelistStatus}`);
    console.log(`Vault initialized: ${finalInitStatus}`);
    console.log(`Vault aToken balance: ${ethers.formatUnits(vaultATokenBalance, 6)}`);
    console.log(`Vault share price: ${ethers.formatUnits(vaultSharePrice, 6)}`);

    if (!finalWhitelistStatus || !finalInitStatus) {
        throw new Error("Vault initialization failed");
    }

    console.log("\nVault initialization completed successfully!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
const { ethers } = require("hardhat");
const hre = require("hardhat");
require("dotenv").config();

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();

    console.log(`Setting vault addresses on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);

    const SIGMAVAULT_ADDRESS = process.env.SIGMAVAULT_ADDRESS;
    const CASINOTREASURY_ADDRESS = process.env.CASINOTREASURY_ADDRESS;
    const CHIP_ADDRESS = process.env.CHIP_ADDRESS;

    // Validate addresses
    if (!SIGMAVAULT_ADDRESS || !CASINOTREASURY_ADDRESS || !CHIP_ADDRESS) {
        throw new Error("Missing one or more required addresses in .env");
    }

    const CHIP = await ethers.getContractAt("CHIP", CHIP_ADDRESS);

    try {
        // 1. Set vault on CasinoTreasury
        console.log("\nSetting vault on CasinoTreasury...");
        const CasinoTreasury = await ethers.getContractAt("CasinoTreasury", CASINOTREASURY_ADDRESS);
        
        // Verify owner
        const treasuryOwner = await CasinoTreasury.owner();
        if (treasuryOwner !== deployer.address) {
            throw new Error("Deployer is not the treasury owner");
        }

        let tx = await CasinoTreasury.setVault(SIGMAVAULT_ADDRESS, TX_OVERRIDES);
        console.log("Transaction hash:", tx.hash);
        await tx.wait(2);
        console.log("✓ Vault set on CasinoTreasury");

        // 2. Set vault as admin
        console.log("\nSetting vault as admin...");
        const SigmaVault = await ethers.getContractAt("SigmaVault", SIGMAVAULT_ADDRESS);
        
        // Check if vault is already admin
        const isAdmin = await SigmaVault.isAdmin(SIGMAVAULT_ADDRESS);
        if (!isAdmin) {
            tx = await SigmaVault.addAdmin(SIGMAVAULT_ADDRESS, TX_OVERRIDES);
            console.log("Transaction hash:", tx.hash);
            await tx.wait(2);
            console.log("✓ Vault set as admin");
        } else {
            console.log("✓ Vault already admin");
        }

        // Verify all settings
        console.log("\nVerifying all settings...");
        const treasuryVault = await CasinoTreasury.vault();
        const isVaultWhitelisted = await CHIP.whitelistedVaults(SIGMAVAULT_ADDRESS);
        const isPaused = await CHIP.paused();
        const isVaultAdmin = await SigmaVault.isAdmin(SIGMAVAULT_ADDRESS);

        // Print verification results
        console.log("\nVerification Results:");
        console.log("1. Treasury vault:", treasuryVault);
        console.log("2. Vault whitelisted:", isVaultWhitelisted);
        console.log("3. Contract paused:", isPaused);
        console.log("4. Vault is admin:", isVaultAdmin);

        // Verify all conditions are met
        if (treasuryVault.toLowerCase() !== SIGMAVAULT_ADDRESS.toLowerCase()) {
            throw new Error("Treasury vault verification failed");
        }
        if (!isVaultWhitelisted) {
            throw new Error("CHIP vault whitelist verification failed");
        }
        if (isPaused) {
            throw new Error("CHIP contract is paused");
        }
        if (!isVaultAdmin) {
            throw new Error("Vault not set as admin");
        }

        console.log("\n✓ All verifications passed successfully");
        console.log("\nSystem is ready for first deposit!");

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
// scripts/upgrade_chip.js
const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
require("dotenv").config();

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 30000000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hre.network.name;
    
    console.log(`\nUpgrading CHIP on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

    try {
        // Get the current CHIP proxy address
        const CHIP_PROXY_ADDRESS = "0x3E09E1F55780490dFf0C2605Fa3BeeB0513ff74C";
        
        // Deploy new implementation
        console.log("\nDeploying new CHIP implementation...");
        const CHIP = await ethers.getContractFactory("CHIP");
        
        // Upgrade the proxy
        console.log("Upgrading proxy...");
        const upgradedChip = await upgrades.upgradeProxy(CHIP_PROXY_ADDRESS, CHIP, {
            ...TX_OVERRIDES
        });

        await upgradedChip.waitForDeployment();
        const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(CHIP_PROXY_ADDRESS);
        
        // Verify upgrade
        console.log("\nVerifying upgrade...");
        const name = await upgradedChip.name();
        const symbol = await upgradedChip.symbol();
        const owner = await upgradedChip.owner();
        const isPaused = await upgradedChip.paused();

        // Update deployment info
        let allDeployments = {};
        try {
            allDeployments = JSON.parse(fs.readFileSync('./deployment-info.json', 'utf8'));
        } catch (error) {
            console.log("Error reading deployment-info.json");
            throw error;
        }

        // Update the implementation address
        allDeployments[network].CHIP.implementation = newImplementationAddress;

        fs.writeFileSync(
            './deployment-info.json',
            JSON.stringify(allDeployments, null, 2)
        );

        // Print upgrade results
        console.log("\n=== Upgrade Results ===");
        console.log("Proxy Address:", CHIP_PROXY_ADDRESS);
        console.log("New Implementation Address:", newImplementationAddress);
        console.log("Name:", name);
        console.log("Symbol:", symbol);
        console.log("Owner:", owner);
        console.log("Paused:", isPaused);
        console.log("\nDeployment info updated in deployment-info.json");

        // Verify owner is set correctly
        if (owner !== deployer.address) {
            throw new Error("Owner not set correctly");
        }

        console.log("\n✓ CHIP upgraded successfully");

    } catch (error) {
        console.error("\nUpgrade failed!");
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
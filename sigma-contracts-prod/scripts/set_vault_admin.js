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

    // Get casino ID from environment first
    const casinoId = process.env.CASINO_ID || "1"; // Default to casino 1 if not specified
    console.log(`Setting vault as admin for casino ID: ${casinoId}`);

    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
    const networkInfo = deploymentInfo[network];
    
    if (!networkInfo) {
        throw new Error(`No deployment info found for network: ${network}`);
    }

    // Get registry address
    const registryAddress = networkInfo.CasinoPaymentRegistry.proxyAddress;
    if (!registryAddress) {
        throw new Error('Registry address not found in deployment-info.json');
    }

    // Get vault address for casino 1
    const casinoInfo = networkInfo.Casinos[casinoId];
    if (!casinoInfo || !casinoInfo.vault) {
        throw new Error(`No vault found for casino ${casinoId}`);
    }

    const vaultAddress = casinoInfo.vault.address;
    console.log(`Vault address: ${vaultAddress}`);

    // Get the Registry contract instance
    const Registry = await ethers.getContractFactory("CasinoPaymentRegistry");
    const registry = Registry.attach(registryAddress);

    // Check if deployer is casino owner
    const casinoDetails = await registry.getCasinoDetails(casinoId);
    if (casinoDetails.owner !== deployer.address) {
        throw new Error(`Deployer ${deployer.address} is not the owner of casino ${casinoId}`);
    }

    // Check if vault is already an admin
    const admins = await registry.getCasinoAdmins(casinoId);
    if (admins.includes(vaultAddress)) {
        console.log("Vault is already an admin");
        return;
    }

    // Add vault as admin
    console.log("Adding vault as admin...");
    const tx = await registry.addCasinoAdmin(casinoId, vaultAddress, TX_OVERRIDES);
    console.log(`Transaction hash: ${tx.hash}`);
    
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    
    if (receipt.status === 0) {
        throw new Error(`Transaction failed: ${tx.hash}`);
    }

    console.log("Successfully added vault as admin!");
    console.log(`Transaction hash: ${receipt.hash}`);
    console.log(`Block number: ${receipt.blockNumber}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
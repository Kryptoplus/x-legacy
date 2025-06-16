const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const hre = require("hardhat");
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 300000; // Max limit for Polygon block
const MANUAL_GAS_PRICE_GWEI = "200"; // Gwei
const MANUAL_MAX_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const MANUAL_MAX_PRIORITY_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    maxFeePerGas: MANUAL_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MANUAL_MAX_PRIORITY_FEE_PER_GAS,
};
// --- End Manual Gas Settings ---

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

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();

    // Get parameters
    const casinoId = process.env.CASINO_ID;
    const withdrawalLimit = process.env.CASINO_WITHDRAWAL_LIMIT;

    if (!casinoId || withdrawalLimit === undefined) {
        console.error("Please set CASINO_ID and CASINO_WITHDRAWAL_LIMIT in your .env file");
        process.exit(1);
    }

    console.log(`Setting casino withdrawal limit on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    console.log("Parameters:");
    console.log(`Casino ID: ${casinoId}`);
    console.log(`Withdrawal Limit: ${withdrawalLimit}\n`);

    // --- Log Manual Gas Settings ---
    console.log("Using Manual Gas Settings:");
    console.log(`  Gas Limit: ${MANUAL_GAS_LIMIT}`);
    console.log(`  Max Fee Per Gas: ${ethers.formatUnits(MANUAL_MAX_FEE_PER_GAS, "gwei")} Gwei`);
    console.log(`  Max Priority Fee Per Gas: ${ethers.formatUnits(MANUAL_MAX_PRIORITY_FEE_PER_GAS, "gwei")} Gwei\n`);
    // ---

    // You need to get the correct treasury address for this casino.
    // For example, from your deployment-info.json or registry if it has a getter.
    const treasuryAddress = "0x8D7D7aACf73c781B22929ccbaBaD8b4D6384410d"; // <-- Replace with actual address
    const treasury = await ethers.getContractAt("CasinoTreasury", treasuryAddress, deployer);

    console.log("Setting withdrawal limit...");
    const tx = await treasury.setWithdrawalLimit(withdrawalLimit, TX_OVERRIDES);
    const receipt = await tx.wait(2);

    console.log("\nWithdrawal limit updated successfully!");
    console.log(`Transaction Hash: ${receipt.hash}`);
    console.log(`Block Number: ${receipt.blockNumber}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
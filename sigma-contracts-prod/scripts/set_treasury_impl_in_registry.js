const { ethers } = require("hardhat");
const hre = require("hardhat"); // Add this line
const fs = require('fs');
const path = require('path');
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

async function getDeployedAddresses(network) {
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
        const networkInfo = deploymentInfo[network];
        
        if (!networkInfo) {
            throw new Error(`No deployment info found for network ${network}`);
        }

        const registryProxy = networkInfo.CasinoPaymentRegistry?.proxyAddress;
        const treasuryImpl = networkInfo.CasinoTreasury?.implementationAddress;

        if (!registryProxy) {
            throw new Error('Registry proxy address not found');
        }
        if (!treasuryImpl) {
            throw new Error('Treasury implementation address not found');
        }

        return { registryProxy, treasuryImpl };
    } catch (error) {
        console.error("Error reading deployment info:", error.message);
        process.exit(1);
    }
}

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();

    console.log(`Setting Treasury Implementation in Registry on network: ${network}`);
    console.log(`Using deployer account: ${deployer.address}`);
    
    // Get deployed addresses
    const { registryProxy, treasuryImpl } = await getDeployedAddresses(network);
    
    console.log(`\nRegistry Proxy: ${registryProxy}`);
    console.log(`Treasury Implementation: ${treasuryImpl}`);

    // Get Registry contract
    const Registry = await ethers.getContractFactory("CasinoPaymentRegistry");
    const registry = Registry.attach(registryProxy).connect(deployer);

    // Verify deployer is owner
    const owner = await registry.owner();
    console.log(`\nRegistry owner: ${owner}`);
    
    if (owner !== deployer.address) {
        throw new Error("Deployer is not the registry owner");
    }

    // Check if implementation is already set
    try {
        const currentImpl = await registry.casinoTreasuryImplementation();
        if (currentImpl !== ethers.ZeroAddress) {
            console.log(`\nTreasury implementation already set to: ${currentImpl}`);
            if (currentImpl.toLowerCase() === treasuryImpl.toLowerCase()) {
                console.log("This is the correct implementation address");
                return;
            }
            console.log("Will update to new implementation address");
        }
    } catch (error) {
        console.log("\nNo treasury implementation currently set");
    }

    // Set treasury implementation
    console.log("\nSetting treasury implementation...");
    const tx = await registry.setTreasuryImplementation(treasuryImpl);
    console.log(`Transaction hash: ${tx.hash}`);
    
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait(2);
    
    if (receipt.status === 1) {
        console.log("\nTreasury implementation set successfully!");
        
        // Verify the setting
        const verifyImpl = await registry.casinoTreasuryImplementation();
        if (verifyImpl.toLowerCase() === treasuryImpl.toLowerCase()) {
            console.log("✓ Verified: Implementation address is correctly set");
        } else {
            console.warn("Warning: Implementation address verification failed");
        }
    } else {
        throw new Error("Transaction failed");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\nOperation failed!");
        console.error("Error details:", error);
        process.exit(1);
    });
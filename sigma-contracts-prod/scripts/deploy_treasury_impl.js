const { ethers } = require("hardhat");
const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
require("dotenv").config();
const { upgrades } = require("hardhat");

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// Updated gas settings for better compatibility
const MANUAL_GAS_LIMIT = 5_000_000;
const MANUAL_GAS_PRICE_GWEI = "400";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function saveDeploymentInfo(info) {
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

    existingData[network][info.contractName] = {
        implementationAddress: info.implementationAddress,
        deployer: info.deployer,
        transactionHash: info.transactionHash,
        blockNumber: info.blockNumber,
        timestamp: new Date().toISOString(),
        initializerArgs: info.initializerArgs
    };

    fs.writeFileSync(DEPLOYMENT_INFO_PATH, JSON.stringify(existingData, null, 2));
}

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();
    
    console.log(`Deploying CasinoTreasury Implementation on network: ${network}`);
    console.log(`Deployer account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // Get registry address from .env or deployment info
    const registryAddress = process.env.REGISTRY_ADDRESS;
    if (!registryAddress) {
        throw new Error("REGISTRY_ADDRESS not set in .env");
    }

    // Deploy CasinoTreasury Implementation
    console.log("Deploying CasinoTreasury implementation...");
    const CasinoTreasury = await ethers.getContractFactory("CasinoTreasury");
    const treasuryImpl = await CasinoTreasury.deploy(TX_OVERRIDES);

    console.log("Waiting for deployment transaction...");
    await treasuryImpl.waitForDeployment();
    const receipt = await treasuryImpl.deploymentTransaction().wait(2);

    const implementationAddress = await treasuryImpl.getAddress();

    console.log("\nDeployment successful!");
    console.log("CasinoTreasury Implementation deployed to:", implementationAddress);
    console.log(`Transaction Hash: ${receipt.hash}`);
    console.log(`Block Number: ${receipt.blockNumber}\n`);

    // Save deployment info
    await saveDeploymentInfo({
        contractName: "CasinoTreasury",
        network: network,
        implementationAddress: implementationAddress,
        deployer: deployer.address,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        initializerArgs: {
            registryAddress: registryAddress,
            casinoId: 0, // This will be set when registering a casino
            initialTreasuryOwner: deployer.address
        }
    });
    console.log("Deployment info saved to deployment-info.json");

    // Verify contract if not on local network
    if (network !== "hardhat" && network !== "localhost" && process.env.ETHERSCAN_API_KEY) {
        console.log("\nWaiting before verification...");
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay

        console.log("Verifying implementation contract...");
        try {
            await hre.run("verify:verify", {
                address: implementationAddress,
                // No constructor arguments for implementation
            });
            console.log("Implementation verified successfully");
        } catch (error) {
            if (error.message.includes("Already Verified")) {
                console.log("Implementation already verified");
            } else {
                console.error("Implementation verification failed:", error);
            }
        }
    }

    console.log("\nNext steps:");
    console.log("1. Set this implementation address in the Registry using setTreasuryImplementation()");
    console.log("2. Then you can register casinos using registerCasinoAndDeployTreasury()");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
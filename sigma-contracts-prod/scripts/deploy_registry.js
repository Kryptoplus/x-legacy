const hre = require("hardhat");
const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
const path = require('path');
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000; // Max limit for Polygon block
const MANUAL_GAS_PRICE_GWEI = "200"; // Gwei
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};
// --- End Manual Gas Settings ---

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hre.network.name;

    console.log(`Deploying CasinoPaymentRegistry on network: ${network}`);
    console.log(`Deployer account: ${deployer.address}`);
    console.log(`Account balance: ${(await ethers.provider.getBalance(deployer.address)).toString()}`);

    // --- Get Initializer Args from .env ---
    const initialOwner = process.env.REGISTRY_INITIAL_OWNER || deployer.address;
    const initialPlatformFeeBps = process.env.REGISTRY_PLATFORM_FEE_BPS;
    const initialFeeRecipient = process.env.REGISTRY_FEE_RECIPIENT;

    // --- Validation ---
    if (!initialPlatformFeeBps || !initialFeeRecipient) {
        throw new Error("Missing REGISTRY_PLATFORM_FEE_BPS or REGISTRY_FEE_RECIPIENT in .env");
    }

    if (Number(initialPlatformFeeBps) > 1000) {
        throw new Error("Platform fee too high (max 1000 bps)");
    }

    if (!ethers.isAddress(initialFeeRecipient)) {
        throw new Error("Invalid fee recipient address");
    }

    if (!ethers.isAddress(initialOwner)) {
        throw new Error("Invalid owner address");
    }

    console.log("Initializer Args:");
    console.log(`  Owner: ${initialOwner}`);
    console.log(`  Platform Fee BPS: ${initialPlatformFeeBps}`);
    console.log(`  Fee Recipient: ${initialFeeRecipient}`);

    // --- Deploy ---
    const CasinoPaymentRegistry = await ethers.getContractFactory("CasinoPaymentRegistry");
    console.log("Deploying CasinoPaymentRegistry proxy...");

    try {
        const registryProxy = await upgrades.deployProxy(
            CasinoPaymentRegistry,
            [
                initialOwner,
                initialPlatformFeeBps,
                initialFeeRecipient
            ],
            {
                initializer: "initialize",
                kind: "uups",
                timeout: 0,
                ...TX_OVERRIDES
            }
        );

        console.log("Waiting for deployment transaction...");
        const deployTx = registryProxy.deploymentTransaction();
        const receipt = await deployTx.wait(2); // Wait for 2 confirmations

        const proxyAddress = await registryProxy.getAddress();
        const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

        console.log(`\nCasinoPaymentRegistry Proxy deployed to: ${proxyAddress}`);
        console.log(`CasinoPaymentRegistry Implementation deployed to: ${implementationAddress}`);
        console.log(`Transaction Hash: ${receipt.hash}`);
        console.log(`Block Number: ${receipt.blockNumber}`);

        // --- Save Deployment Info ---
        saveDeploymentInfo({
            contractName: "CasinoPaymentRegistry",
            network: network,
            deployer: deployer.address,
            proxyAddress: proxyAddress,
            implementationAddress: implementationAddress,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            initializerArgs: { initialOwner, initialPlatformFeeBps, initialFeeRecipient }
        });
        console.log("Deployment info saved.");

    } catch (error) {
        console.error("Deployment failed:", error);
        throw error;
    }

    // --- Verification ---
    if (network !== "hardhat" && network !== "localhost" && process.env.ETHERSCAN_API_KEY) {
        console.log("\nWaiting for Etherscan indexing before verification...");
        await delay(30000); // Wait 30 seconds for Etherscan

        console.log("Verifying Implementation on Etherscan...");
        try {
            await hre.run("verify:verify", {
                address: implementationAddress,
                // No constructor args for implementation if using Initializable pattern
            });
            console.log("Implementation verified successfully.");
        } catch (error) {
            console.error("Implementation verification failed:", error);
        }

        // Proxy verification often links automatically, but explicit verification can be done
        // Hardhat verify usually handles the proxy linking when it detects an ERC1967 proxy
        console.log("Attempting to verify Proxy on Etherscan (usually links automatically)...");
         try {
            await hre.run("verify:verify", {
                 address: proxyAddress,
             });
            console.log("Proxy verified (or linked) successfully.");
         } catch (error) {
            if (error.message.toLowerCase().includes("already verified")) {
                 console.log("Proxy already verified.");
            } else if (error.message.toLowerCase().includes("does not have bytecode")) {
                 console.warn("Proxy verification skipped: No bytecode found (may be linked via implementation verification).");
             }
            else {
                console.error("Proxy verification failed:", error);
             }
         }
    } else {
        console.log("\nSkipping Etherscan verification (network is hardhat/localhost or ETHERSCAN_API_KEY is missing).");
    }

    console.log("\nDeployment complete.");
}

function saveDeploymentInfo(info) {
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
        proxyAddress: info.proxyAddress,
        implementationAddress: info.implementationAddress,
        deployer: info.deployer,
        transactionHash: info.transactionHash,
        blockNumber: info.blockNumber,
        timestamp: new Date().toISOString(),
        initializerArgs: info.initializerArgs
    };

    fs.writeFileSync(DEPLOYMENT_INFO_PATH, JSON.stringify(existingData, null, 2));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
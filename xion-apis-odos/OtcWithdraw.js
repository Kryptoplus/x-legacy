const { Relayer } = require('@openzeppelin/defender-relay-client');
const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const axios = require('axios');
const ethers = require('ethers');

require('events').EventEmitter.defaultMaxListeners = 20;

const ABI = [
    "function withdrawFromAave(address from, address aTokenAddress, address asset, uint256 amount, uint256 feeAmount, address recipient) returns (uint256)"
];

const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = "0x776D1CFD21483Ef314a73900e98751AE9Ca7D10e";
const ASSET_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const ATOKEN_ADDRESS = "0x6ab707Aca953eDAeFBc4fD23bA73294241490620";
const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const RELAYER_API_SECRET = process.env.RELAYER_API_SECRET;
const AAVE_INTEREST_API = "http://localhost:3000";
const OTC_TABLE = "otcTable";
const OTC_WITHDRAW_TABLE = "otcWithdraw";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const fetchInterestData = async (relayerAddress) => {
    try {
        console.log(`Fetching interest data from /aaveInterest API for relayerAddress: ${relayerAddress}`);
        const response = await axios.post(`${AAVE_INTEREST_API}/dev/aaveInterest`, { relayerAddress });

        console.log("Response from /aaveInterest API:", response.data);

        if (!response.data || !response.data.totalBalance || !response.data.interestEarned || !response.data.detailedResults) {
            throw new Error("Invalid data received from /aaveInterest API");
        }

        const totalBalance = parseFloat(response.data.totalBalance);
        const interestEarned = parseFloat(response.data.interestEarned);
        const detailedResults = response.data.detailedResults;

        if (isNaN(totalBalance) || isNaN(interestEarned) || detailedResults.length === 0) {
            throw new Error("Invalid data format: totalBalance, interestEarned, or detailedResults is missing or invalid");
        }

        // Extract the first result for requestId and transactionHash
        const requestId = detailedResults[0]?.requestId;
        const transactionHash = detailedResults[0]?.transactionHash;

        if (!requestId || !transactionHash) {
            throw new Error("Missing requestId or transactionHash in detailedResults");
        }

        return { totalBalance, interestEarned, requestId, transactionHash };
    } catch (error) {
        console.error("Error fetching interest data from /aaveInterest API:", error.message);
        throw new Error("Failed to fetch valid interest data.");
    }
};



const calculateFeeAmount = (withdrawalAmount, totalDeposit, totalInterestEarned, feePercentage) => {
    if (isNaN(withdrawalAmount) || isNaN(totalDeposit) || isNaN(totalInterestEarned)) {
        throw new Error("Invalid input to calculateFeeAmount: withdrawalAmount, totalDeposit, or totalInterestEarned is NaN");
    }

    const proportion = withdrawalAmount / totalDeposit;
    const attributedInterest = proportion * totalInterestEarned;
    const feeAmount = attributedInterest * feePercentage;

    if (isNaN(feeAmount)) {
        throw new Error("Calculated feeAmount is NaN");
    }

    return feeAmount;
};


const updateSupplyAmount = async (transactionHash, requestId, adjustedAmount) => {
    try {
        console.log(`Updating supplyAmount in otcTable for transactionHash: ${transactionHash}, requestId: ${requestId}`);

        // Ensure parameters are valid
        if (typeof transactionHash !== "string" || typeof requestId !== "string") {
            throw new Error("Invalid transactionHash or requestId format. Both must be strings.");
        }

        if (isNaN(adjustedAmount)) {
            throw new Error("Invalid adjustedAmount. It must be a valid number.");
        }

        const params = {
            TableName: OTC_TABLE,
            Key: {
                transactionHash: { S: transactionHash },
                requestId: { S: requestId },
            },
            UpdateExpression: "SET supplyAmount = supplyAmount - :withdrawnAmount",
            ExpressionAttributeValues: {
                ":withdrawnAmount": { N: adjustedAmount.toString() },
            },
            ConditionExpression: "attribute_exists(transactionHash) AND attribute_exists(requestId)", // Ensure item exists
        };

        console.log("UpdateItem params:", params);
        await dynamoDbClient.send(new UpdateItemCommand(params));
        console.log("Successfully updated supplyAmount in otcTable.");
    } catch (error) {
        console.error("Error updating supplyAmount in otcTable:", error.message);
        throw new Error("Failed to update supplyAmount in otcTable.");
    }
};



const withdrawFromAave = async (from, amount, feeAmount, recipientAddress) => {
    console.log("Preparing to withdraw from Aave with the following parameters:");
    console.log({
        from,                 // Log the sender's address
        amount,               // Log the withdrawal amount
        feeAmount,            // Log the fee amount
        recipientAddress,     // Log the recipient's address
        aTokenAddress: ATOKEN_ADDRESS,
        assetTokenAddress: ASSET_TOKEN_ADDRESS,
        contractAddress: CONTRACT_ADDRESS,
    });

    const relayer = new Relayer({
        apiKey: RELAYER_API_KEY,
        apiSecret: RELAYER_API_SECRET,
    });

    const iface = new ethers.Interface(ABI);

    try {
        const callData = iface.encodeFunctionData("withdrawFromAave", [
            from,
            ATOKEN_ADDRESS,
            ASSET_TOKEN_ADDRESS,
            amount,
            feeAmount,
            recipientAddress,
        ]);

        const txDetails = {
            to: CONTRACT_ADDRESS,
            data: callData,
            gasLimit: "6000000",
        };

        console.log("Sending withdrawFromAave transaction with details:", txDetails);

        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction sent:", tx.hash);

        const receipt = await provider.waitForTransaction(tx.hash);
        console.log("Transaction receipt:", receipt);

        const status = receipt.status === 1 ? "Success" : "Failed";

        return { status, txHash: tx.hash, amount: ethers.formatUnits(amount, 6), feeAmount: ethers.formatUnits(feeAmount, 6) };
    } catch (error) {
        console.error("Error during withdrawFromAave:", error.message);
        throw error;
    }
};

const saveToDynamoDB = async (transactionData) => {
    console.log("Saving transaction data to DynamoDB:", transactionData);

    const params = {
        TableName: OTC_WITHDRAW_TABLE,
        Item: {
            transactionHash: { S: transactionData.txHash },
            status: { S: transactionData.status },
            amount: { N: transactionData.amount },
            feeAmount: { N: transactionData.feeAmount },
            recipient: { S: transactionData.recipient },
            from: { S: transactionData.from },
            timestamp: { S: new Date().toISOString() },
        },
    };

    try {
        console.log("DynamoDB PutItem params:", params);
        await dynamoDbClient.send(new PutItemCommand(params));
        console.log("Transaction data saved successfully to DynamoDB.");
    } catch (error) {
        console.error("Error saving transaction to DynamoDB:", error.message);
        throw error;
    }
};
exports.handler = async (event) => {
    console.log("Handler started");

    let parsedBody;
    try {
        parsedBody = JSON.parse(event.body);
    } catch (error) {
        console.error("Invalid JSON payload:", error.message);
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid JSON payload" }),
        };
    }

    const { from, amount, recipient, relayerAddress } = parsedBody;

    if (!from || !amount || !recipient || !relayerAddress) {
        console.error("Missing required parameters: from, amount, recipient, or relayerAddress");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "from, amount, recipient, and relayerAddress are required" }),
        };
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid amount provided" }),
        };
    }

    try {
        const { totalBalance, interestEarned, requestId, transactionHash } = await fetchInterestData(relayerAddress);

        console.log(`Fetched totalBalance: ${totalBalance}, interestEarned: ${interestEarned}, requestId: ${requestId}, transactionHash: ${transactionHash}`);

        const xionFeePercentage = 0.03; // 3% fee

        const feeAmount = calculateFeeAmount(parsedAmount, totalBalance, interestEarned, xionFeePercentage);
        const adjustedAmount = parsedAmount + feeAmount;

        if (isNaN(adjustedAmount) || isNaN(feeAmount)) {
            throw new Error("Calculated adjustedAmount or feeAmount is NaN");
        }

        console.log("Calling updateSupplyAmount with:");
console.log("transactionHash:", transactionHash);
console.log("requestId:", requestId);
console.log("adjustedAmount:", adjustedAmount);

        const parsedAdjustedAmount = ethers.parseUnits(adjustedAmount.toFixed(6), 6);
        const parsedFeeAmount = ethers.parseUnits(feeAmount.toFixed(6), 6);

        console.log("Adjusted amount:", adjustedAmount);
        console.log("Fee amount:", feeAmount);

        const result = await withdrawFromAave(from, parsedAdjustedAmount, parsedFeeAmount, recipient);

        await updateSupplyAmount(transactionHash, requestId, parsedAmount); // Use the original withdrawal amount to update supply

        const saveData = { ...result, from, recipient };
        await saveToDynamoDB(saveData);

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: result.status,
                txHash: result.txHash,
                amount: result.amount,
                feeAmount: result.feeAmount,
                recipient,
                from,
            }),
        };
    } catch (error) {
        console.error("Error during withdrawal:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

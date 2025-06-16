const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { Relayer } = require('@openzeppelin/defender-relay-client');
const ethers = require('ethers');

require('events').EventEmitter.defaultMaxListeners = 20;

const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = "otcTable"; // DynamoDB table name

const ABI = [
    "function triggerSupply(address usdtToken, address onBehalfOf, address from, uint256 amount)"
];

const RPC_URL = process.env.RPC_URL; // Ethereum RPC URL
const CONTRACT_ADDRESS = "0x776D1CFD21483Ef314a73900e98751AE9Ca7D10e"; // Replace with smart contract address
const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // Replace with USDT token address
const RELAYER_API_KEY = process.env.RELAYER_API_KEY; // Defender relayer API key
const RELAYER_API_SECRET = process.env.RELAYER_API_SECRET; // Defender relayer API secret

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Function to trigger the supply transaction
const triggerSupply = async (amount, safeAddress, onBehalfOfAddress) => {
    console.log("Preparing to trigger supply with the following parameters:");
    console.log({ amount, safeAddress, onBehalfOfAddress });

    const relayer = new Relayer({
        apiKey: RELAYER_API_KEY,
        apiSecret: RELAYER_API_SECRET,
    });

    const iface = new ethers.Interface(ABI);

    try {
        const callData = iface.encodeFunctionData("triggerSupply", [
            USDT_TOKEN_ADDRESS,
            onBehalfOfAddress,
            safeAddress,
            amount,
        ]);

        const txDetails = {
            to: CONTRACT_ADDRESS,
            data: callData,
            gasLimit: "6000000",
        };

        console.log("Sending triggerSupply transaction with details:", txDetails);

        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction sent:", tx.hash);

        // Wait for the transaction receipt
        const receipt = await provider.waitForTransaction(tx.hash);
        console.log("Transaction receipt:", receipt);

        // Check if the transaction was successful
        const status = receipt.status === 1 ? "Success" : "Failed";

        return { status, txHash: tx.hash, amount: ethers.formatUnits(amount, 6) };
    } catch (error) {
        console.error("Error during triggerSupply:", error.message);
        console.error("Stack trace:", error.stack);
        throw error;
    }
};

// Function to update the most recent row in DynamoDB
const updateMostRecentRow = async (supplyData) => {
    try {
        const queryParams = {
            TableName: TABLE_NAME,
            Limit: 1,
            ScanIndexForward: false, // Ensure the most recent item is retrieved
        };

        const queryResult = await dynamoDbClient.send(new ScanCommand(queryParams));
        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.error("No rows found to update.");
            throw new Error("No rows found to update.");
        }

        const mostRecentItem = queryResult.Items[0];
        const transactionHash = mostRecentItem.transactionHash.S; // Extract transactionHash
        const requestId = mostRecentItem.requestId.S; // Extract requestId

        const updateParams = {
            TableName: TABLE_NAME,
            Key: { 
                transactionHash: { S: transactionHash }, 
                requestId: { S: requestId } 
            },
            UpdateExpression: "SET supplyStatus = :status, supplyTransactionHash = :txHash, supplyAmount = :amount, supplyTimestamp = :timestamp",
            ExpressionAttributeValues: {
                ":status": { S: supplyData.status },
                ":txHash": { S: supplyData.txHash },
                ":amount": { N: supplyData.amount },
                ":timestamp": { S: new Date().toISOString() },
            },
        };

        console.log("UpdateItem params:", updateParams);
        await dynamoDbClient.send(new UpdateItemCommand(updateParams));
        console.log("Most recent row updated successfully in DynamoDB.");
    } catch (error) {
        console.error("Error updating the most recent row in DynamoDB:", error);
        throw error;
    }
};


// Lambda handler function
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

    const { safeAddress, onBehalfOfAddress } = parsedBody;

    if (!safeAddress || !onBehalfOfAddress) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Both safeAddress and onBehalfOfAddress are required" }),
        };
    }

    const apolTokenContract = new ethers.Contract(USDT_TOKEN_ADDRESS, ["function balanceOf(address owner) view returns (uint256)"], provider);

    try {
        const balance = await apolTokenContract.balanceOf(safeAddress);
        const humanReadableBalance = parseFloat(ethers.formatUnits(balance, 6));
        console.log("USDT token balance retrieved:", humanReadableBalance);

        if (humanReadableBalance < 0.01) {
            console.error("USDT token balance is below the threshold (0.01). Aborting.");
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "USDT token balance is too low to trigger supply" }),
            };
        }

        console.log("Balance is sufficient. Triggering supply...");
        const result = await triggerSupply(balance, safeAddress, onBehalfOfAddress);

        const supplyData = {
            status: result.status,
            txHash: result.txHash,
            amount: result.amount,
        };
        await updateMostRecentRow(supplyData);

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: result.status,
                txHash: result.txHash,
                amount: result.amount,
            }),
        };
    } catch (error) {
        console.error("Error triggering supply or updating the database:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to trigger supply or update the database" }),
        };
    }
};

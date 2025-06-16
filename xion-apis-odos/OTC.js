const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const axios = require('axios');
const ethers = require('ethers');
const { Relayer } = require('@openzeppelin/defender-relay-client');

require('events').EventEmitter.defaultMaxListeners = 20;

const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = "otcTable"; // DynamoDB table name

const ABI = [
    "function initiateSwap(address zarpToken, uint256 amount, uint256 feeAmount, address usdtToken, address externalBridgeContract, bytes swapCallData)"
];

const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const RELAYER_API_SECRET = process.env.RELAYER_API_SECRET;
const CONTRACT_ADDRESS = "0x776D1CFD21483Ef314a73900e98751AE9Ca7D10e";
const ZARP_TOKEN = "0xb755506531786C8aC63B756BaB1ac387bACB0C04"; // 18 decimals
const USDT_TOKEN = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // 6 decimals

const saveResponseToDynamoDB = async (transactionData) => {
    console.log("Preparing to save transaction data to DynamoDB:", transactionData);

    // Validate transactionData fields
    if (!transactionData.transactionHash) {
        console.error("Transaction hash is undefined.");
        throw new Error("Transaction hash is undefined");
    }
    if (!transactionData.amount) {
        console.error("Amount is undefined.");
        throw new Error("Amount is undefined");
    }
    if (!transactionData.feeAmount) {
        console.error("Fee amount is undefined.");
        throw new Error("Fee amount is undefined");
    }
    if (!transactionData.requestId) {
        console.error("Request ID is undefined.");
        throw new Error("Request ID is undefined");
    }
    if (!transactionData.relayerAddress) {
        console.error("Relayer address is undefined.");
        throw new Error("Relayer address is undefined");
    }

    const params = {
        TableName: TABLE_NAME,
        Item: {
            transactionHash: { S: transactionData.transactionHash },
            otcAmount: { N: String(transactionData.amount) }, // Ensure amount is a string for DynamoDB
            otcStatus: { S: transactionData.status },
            requestId: { S: transactionData.requestId },
            otcFeeAmount: { N: String(transactionData.feeAmount) }, // Ensure fee amount is a string
            otcTimestamp: { S: new Date().toISOString() },
            relayerAddress: { S: transactionData.relayerAddress }, // Save relayer address
            toAddress: { S: transactionData.toAddress }, // Save toAddress
        },
    };

    try {
        console.log("DynamoDB PutItem params:", params);
        await dynamoDbClient.send(new PutItemCommand(params));
        console.log("Transaction data saved successfully to DynamoDB.");
    } catch (error) {
        console.error("Error saving transaction to DynamoDB:", error);
        throw error;
    }
};

const initiateSwap = async (fullAmount, feeAmount, externalBridgeContract, swapCallData, requestId, relayerAddress, toAddress) => {
    console.log("Preparing to initiate swap with the following parameters:");
    console.log({ fullAmount, feeAmount, externalBridgeContract, swapCallData, relayerAddress, toAddress });

    const relayer = new Relayer({
        apiKey: RELAYER_API_KEY,
        apiSecret: RELAYER_API_SECRET,
    });

    const iface = new ethers.Interface(ABI);

    try {
        const callData = iface.encodeFunctionData("initiateSwap", [
            ZARP_TOKEN,
            fullAmount,    // Amount in 18 decimals (raw BigNumber value)
            feeAmount,     // Fee in 18 decimals
            USDT_TOKEN,
            externalBridgeContract,
            swapCallData,
        ]);

        const txDetails = {
            to: CONTRACT_ADDRESS,
            data: callData,
            value: "0",
            gasLimit: "6000000",
            speed: "fast",
        };

        console.log("Sending initiateSwap transaction with details:", txDetails);

        // Send the transaction
        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction hash:", tx.hash);

        // Wait for the transaction receipt
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const receipt = await provider.waitForTransaction(tx.hash);

        // Format fullAmount and feeAmount using 18 decimals for ZARP token
        const transactionData = {
            transactionHash: tx.hash,
            amount: ethers.formatUnits(fullAmount, 18).toString(), 
            feeAmount: ethers.formatUnits(feeAmount, 18).toString(),
            requestId,
            status: receipt.status === 1 ? "success" : "failed",
            relayerAddress,
            toAddress,
        };

        if (receipt.status === 1) {
            console.log("Transaction confirmed successfully:", receipt);
            await saveResponseToDynamoDB(transactionData);
            return {
                statusCode: 200,
                body: JSON.stringify(transactionData),
            };
        } else {
            console.error("Transaction failed:", receipt);
            return {
                statusCode: 400,
                body: JSON.stringify(transactionData),
            };
        }
    } catch (error) {
        console.error("Error during initiateSwap:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({
                status: "error",
                error: error.message,
            }),
        };
    }
};

exports.handler = async (event) => {
    console.log("Handler started");
    console.log('Incoming Event:', JSON.stringify(event));

    const body = JSON.parse(event.body);
    const relayerAddress = body.relayerAddress;
    const toAddress = body.toAddress;
    if (!relayerAddress || !toAddress) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Both relayerAddress and toAddress are required" }),
        };
    }

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const tokenContract = new ethers.Contract(
        ZARP_TOKEN,
        ["function balanceOf(address owner) view returns (uint256)"],
        provider
    );

    let fromAmount;
    try {
        const balance = await tokenContract.balanceOf(relayerAddress);
        // Use 18 decimals for ZARP token
        const humanReadableBalance = parseFloat(ethers.formatUnits(balance, 18));
        console.log("Relayer balance retrieved:", humanReadableBalance);

        if (humanReadableBalance < 0.01) {
            console.error("Relayer balance is below the threshold (0.01). Aborting.");
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Relayer balance is too low for a swap" }),
            };
        }

        fromAmount = balance; // This is a BigNumber (BigInt) in raw units (18 decimals)
    } catch (error) {
        console.error("Error retrieving relayer balance:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to retrieve relayer balance" }),
        };
    }

    // Calculate fee as 1% of full amount (both in raw units, 18 decimals)
// Set fee amount to 0 (in raw units, 18 decimals)
const feeAmount = BigInt(0);
    const fullAmount = fromAmount;

    // For the route request, if USDT values are required to be in 6 decimals, you may convert accordingly.
    // Here we assume the route uses ZARP token amounts in 18 decimals.
    const params = {
        fromChain: "137",
        toChain: "137",
        fromToken: ZARP_TOKEN,
        toToken: USDT_TOKEN,
        fromAmount: (fullAmount - feeAmount).toString(),
        fromAddress: relayerAddress,
        toAddress: toAddress,
        slippageConfig: {
            autoMode: 1,
        },
        bypassGuardrails: true,
    };

    console.log("Attempting to fetch route with parameters:", params);

    try {
        const response = await axios.post("https://apiplus.squidrouter.com/v2/route", params, {
            headers: {
                "x-integrator-id": process.env.INTEGRATOR_ID,
                "Content-Type": "application/json",
            },
        });

        const requestId = response.headers["x-request-id"];
        if (!requestId) {
            console.error("Failed to retrieve request ID from response headers.");
            throw new Error("Request ID is undefined in API response.");
        }
        console.log("Request ID retrieved successfully:", requestId);

        const paddedValue = BigInt(response.data.route.transactionRequest.value) + ethers.parseUnits("0.2", 18);

        const quoteResponse = {
            from: relayerAddress,
            externalBridgeContract: response.data.route.transactionRequest.target,
            amount: ethers.formatUnits(fromAmount, 18).toString(), // Format as ZARP token (18 decimals)
            value: paddedValue.toString(),
            feeAmount: ethers.formatUnits(feeAmount, 18).toString(), // 18 decimals for fee
            callData: response.data.route.transactionRequest.data,
            requestId,
        };

        console.log("Quote response constructed:", quoteResponse);

        console.log("Initiating swap...");
        const swapResponse = await initiateSwap(
            fullAmount.toString(),
            feeAmount.toString(),
            quoteResponse.externalBridgeContract,
            quoteResponse.callData,
            requestId,
            relayerAddress,
            toAddress
        );

        console.log("Swap response received:", swapResponse);

        return {
            statusCode: swapResponse.statusCode,
            body: swapResponse.body,
        };
    } catch (error) {
        console.error("API error during route fetching or swap initiation:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

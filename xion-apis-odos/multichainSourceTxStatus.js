const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { ethers } = require("ethers");
const multichainConfig = require("./Squid/multichainConfig.json");
const axios = require("axios");

const SQS_QUEUE_URL = process.env.MULTICHAIN_SQS_QUEUE_URL;
const MULTICHAIN_DYNAMODB_TABLE_NAME =
  process.env.MULTICHAIN_DYNAMODB_TABLE_NAME || "MultichainTransactions";
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Function to get the chain configuration based on fromChainId
function getChainConfig(fromChainId) {
  for (const chainName in multichainConfig) {
    const config = multichainConfig[chainName];
    if (config.chainId === fromChainId) {
      return config;
    }
  }
  return null;
}

// Helper function to introduce a delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));

    if (!event.Records) {
      console.error("No SQS Records found in the event");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No SQS Records found" }),
      };
    }

    for (const record of event.Records) {
      const parsedBody = JSON.parse(record.body);
      const { transactionHash, requestId, fromChainId, toChainId } = parsedBody;

      if (!transactionHash || !requestId || !fromChainId || !toChainId) {
        console.error("Missing required parameters in SQS message");
        continue;
      }

      console.log(`Processing transaction: ${transactionHash}`);
      const resultMessage = await processTransaction(parsedBody);
      console.log(`Result: ${resultMessage}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Processed successfully" }),
    };
  } catch (error) {
    console.error("Error processing SQS records:", error);
    throw new Error("Error occurred, requeuing message");
  }
};

async function processTransaction(params) {
  const {
    transactionHash,
    requestId,
    fromChainId,
    toChainId,
    merchantWebhook,
  } = params;

  console.log(
    `Checking transaction status for transactionHash: ${transactionHash}`
  );

  try {
    const status = await checkTransactionStatus(
      transactionHash,
      requestId,
      fromChainId,
      toChainId
    );

    if (status === "Success") {
      await storeTransactionInDynamoDB(params, "successful");
      await notifyMerchant(params, "successful", merchantWebhook);
      return `Transaction ${transactionHash} confirmed successful`;
    } else if (status === "Failed") {
      await storeTransactionInDynamoDB(params, "failed");
      await notifyMerchant(params, "failed", merchantWebhook);
      return `Transaction ${transactionHash} confirmed failed`;
    } else {
      console.log(`Transaction ${transactionHash} pending, requeuing...`);
      throw new Error(`Transaction ${transactionHash} not found`);
    }
  } catch (error) {
    console.error(`Error processing transaction ${transactionHash}:`, error);
    throw new Error(
      `Requeued: Error occurred while processing transaction ${transactionHash}`
    );
  }
}

// Updated function to check transaction status using ethers.js
async function checkTransactionStatus(
  transactionHash,
  requestId,
  fromChainId,
  toChainId
) {
  console.log(
    `Fetching status for Transaction ID: ${transactionHash} on Chain ID: ${fromChainId}`
  );

  try {
    const chainConfig = getChainConfig(fromChainId);
    if (!chainConfig) {
      console.error("Chain configuration not found for Chain ID:", fromChainId);
      throw new Error("Invalid fromChainId");
    }

    const rpcUrl = chainConfig.rpcUrl;
    if (!rpcUrl) {
      console.error("RPC URL not found for Chain ID:", fromChainId);
      throw new Error("RPC URL not configured for this chain");
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    let receipt = null;
    const maxRetries = 10;
    const delayMs = 500; // 0.5 seconds

    for (let i = 0; i < maxRetries; i++) {
      try {
        receipt = await provider.getTransactionReceipt(transactionHash);
        if (receipt) {
          console.log(`Transaction receipt found at attempt ${i + 1}`);
          break;
        }
        console.log(
          `Transaction receipt not found, attempt ${
            i + 1
          }. Retrying in ${delayMs} ms...`
        );
        await delay(delayMs);
      } catch (error) {
        console.error(
          `Error fetching transaction receipt at attempt ${i + 1}:`,
          error.message
        );
        // Continue retrying
        await delay(delayMs);
      }
    }

    if (!receipt) {
      console.error("Transaction receipt not found after maximum retries");
      throw new Error("Transaction receipt not found");
    }

    const status = receipt.status; // 1 for success, 0 for failure
    const statusText = status === 1 ? "Success" : "Failed";
    console.log(`Transaction ${transactionHash} status: ${statusText}`);
    return statusText;
  } catch (error) {
    console.error(
      `Error during status fetching for transaction ${transactionHash}:`,
      error.message
    );
    throw error;
  }
}

// Function to store or update transaction status in DynamoDB
async function storeTransactionInDynamoDB(params, sourceStatus) {
  const {
    transactionHash,
    fromChainId,
    toChainId,
    nativeValue,
    fromAmount,
    fromAddress,
    fromCurrency,
    fromNetwork,
    toAmount,
    toAmountMin,
    toNetwork,
    toCurrency,
    toAddress,
    feeAmount,
    requestId,
    fromTokenAddress,
    fromAmountFormatted,
    feeAmountFormatted,
    toAmountMinFormatted,
    toAmountFormatted,
    merchantAddress,
    merchantWebhook,
  } = params;

  const primaryKey = transactionHash;

  try {
    // Check if the item already exists
    const getItemParams = {
      TableName: MULTICHAIN_DYNAMODB_TABLE_NAME,
      Key: {
        transactionHash: { S: primaryKey },
      },
      ProjectionExpression: "transactionHash",
    };

    const getItemCommand = new GetItemCommand(getItemParams);
    const getItemResponse = await dynamoDbClient.send(getItemCommand);

    if (getItemResponse.Item) {
      // Item exists, update the sourceStatus field
      const updateParams = {
        TableName: MULTICHAIN_DYNAMODB_TABLE_NAME,
        Key: {
          transactionHash: { S: primaryKey },
        },
        UpdateExpression:
          "SET sourceStatus = :sourceStatus, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":sourceStatus": { S: sourceStatus },
          ":updatedAt": { S: new Date().toISOString() },
        },
        ReturnValues: "UPDATED_NEW",
      };

      const updateCommand = new UpdateItemCommand(updateParams);
      const updateResponse = await dynamoDbClient.send(updateCommand);

      console.log(
        `Updated sourceStatus for transaction ${transactionHash} in DynamoDB`,
        updateResponse.Attributes
      );
    } else {
      // Item does not exist, create it with both sourceStatus and finalStatus
      const item = {
        transactionHash: { S: transactionHash },
        requestId: { S: requestId },
        fromChainId: { N: fromChainId.toString() },
        toChainId: { N: toChainId.toString() },
        nativeValue: { N: nativeValue ? nativeValue.toString() : "0" },
        fromAmount: { N: fromAmount ? fromAmount.toString() : "0" },
        fromAddress: { S: fromAddress },
        fromCurrency: { S: fromCurrency },
        fromNetwork: { S: fromNetwork },
        toAmount: { N: toAmount ? toAmount.toString() : "0" },
        toAmountMin: { N: toAmountMin ? toAmountMin.toString() : "0" },
        toNetwork: { S: toNetwork },
        toCurrency: { S: toCurrency },
        toAddress: { S: toAddress },
        feeAmount: { N: feeAmount ? feeAmount.toString() : "0" },
        fromTokenAddress: { S: fromTokenAddress },
        fromAmountFormatted: { S: fromAmountFormatted },
        feeAmountFormatted: { S: feeAmountFormatted },
        toAmountMinFormatted: { S: toAmountMinFormatted },
        toAmountFormatted: { S: toAmountFormatted },
        sourceStatus: { S: sourceStatus },
        finalStatus: { S: "pending" },
        merchantAddress: { S: merchantAddress },
        merchantWebhook: { S: merchantWebhook || "N/A" },
        updatedAt: { S: new Date().toISOString() },
      };

      await dynamoDbClient.send(
        new PutItemCommand({
          TableName: MULTICHAIN_DYNAMODB_TABLE_NAME,
          Item: item,
        })
      );

      console.log(
        `Stored new transaction ${transactionHash} with sourceStatus ${sourceStatus} in DynamoDB`
      );
    }
  } catch (error) {
    console.error(
      `Error storing/updating transaction ${transactionHash} in DynamoDB:`,
      error
    );
    throw error;
  }
}

// Function to notify the merchant
async function notifyMerchant(params, finalStatus, webhookUrl) {
  const {
    transactionHash,
    fromAddress,
    fromCurrency,
    fromNetwork,
    toNetwork,
    toCurrency,
    toAddress,
    requestId,
    fromAmountFormatted,
    feeAmountFormatted,
    toAmountMinFormatted,
    toAmountFormatted,
    merchantAddress,
  } = params;

  const payload = {
    statusType: "source status",
    transactionHash,
    finalStatus,
    fromAddress,
    fromCurrency,
    fromNetwork,
    toNetwork,
    toCurrency,
    toAddress,
    requestId,
    fromAmountFormatted,
    feeAmountFormatted,
    toAmountMinFormatted,
    toAmountFormatted,
    merchantAddress,
  };

  try {
    const response = await axios.post(webhookUrl, payload);
    console.log(`Merchant notified: ${response.statusText}`);
  } catch (error) {
    console.error(`Failed to notify merchant: ${error.message}`);
  }
}

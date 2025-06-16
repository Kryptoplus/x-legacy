const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const axios = require("axios");

const SQS_QUEUE_URL = process.env.MULTICHAIN_SQS_QUEUE_URL;
const MULTICHAIN_DYNAMODB_TABLE_NAME =
  process.env.MULTICHAIN_DYNAMODB_TABLE_NAME || "MultichainTransactions";
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

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
    // return {
    //   statusCode: 500,
    //   body: JSON.stringify({ error: "Internal Server Error" }),
    // };
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

    if (status === "success") {
      await storeTransactionInDynamoDB(params, "successful");
      await notifyMerchant(params, "successful", merchantWebhook);
      return `Transaction ${transactionHash} confirmed successful`;
    } else if (status === "failed") {
      await storeTransactionInDynamoDB(params, "failed");
      await notifyMerchant(params, "failed", merchantWebhook);
      return `Transaction ${transactionHash} confirmed failed`;
    } else {
      console.log(`Transaction ${transactionHash} pending, requeuing...`);
      throw new Error(`Transaction ${transactionHash} not found`);
      // await requeueTransaction(params);
      // return `Transaction ${transactionHash} requeued for confirmation`;
    }
  } catch (error) {
    console.error(`Error processing transaction ${transactionHash}:`, error);
    throw new Error(
      `Requeued : Error occurred while processing transaction ${transactionHash}`
    );
    // await requeueTransaction(params);
    // return `Transaction ${transactionHash} requeued due to error`;
  }
}

// Function to check transaction status using getStatusMultichain API
async function checkTransactionStatus(
  transactionHash,
  requestId,
  fromChainId,
  toChainId
) {
  const url = `https://v2.api.squidrouter.com/v2/status?transactionId=${transactionHash}&requestId=${requestId}&fromChainId=${fromChainId}&toChainId=${toChainId}`;
  console.log(`Fetching status for transaction: ${transactionHash}`);

  try {
    const response = await axios.get(url, {
      headers: {
        "x-integrator-id": process.env.INTEGRATOR_ID,
        "Content-Type": "application/json",
      },
    });

    console.log("Status fetched successfully:", response.data);

    const latestStatus =
      response.data.routeStatus[response.data.routeStatus.length - 1].status;
    console.log(`Fetched status for ${transactionHash}: ${latestStatus}`);
    return latestStatus;
  } catch (error) {
    console.error(
      `Error fetching status for ${transactionHash}:`,
      error.message
    );
    throw error;
  }
}

// Function to store or update transaction status in DynamoDB
async function storeTransactionInDynamoDB(params, finalStatus) {
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
      // Item exists, update the finalStatus field
      const updateParams = {
        TableName: MULTICHAIN_DYNAMODB_TABLE_NAME,
        Key: {
          transactionHash: { S: primaryKey },
        },
        UpdateExpression:
          "SET finalStatus = :finalStatus, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":finalStatus": { S: finalStatus },
          ":updatedAt": { S: new Date().toISOString() },
        },
        ReturnValues: "UPDATED_NEW",
      };

      const updateCommand = new UpdateItemCommand(updateParams);
      const updateResponse = await dynamoDbClient.send(updateCommand);

      console.log(
        `Updated finalStatus for transaction ${transactionHash} in DynamoDB`,
        updateResponse.Attributes
      );
    } else {
      // Item does not exist, create it with both finalStatus and sourceStatus
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
        finalStatus: { S: finalStatus },
        sourceStatus: { S: "successful" },
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
        `Stored new transaction ${transactionHash} with finalStatus ${finalStatus} in DynamoDB`
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
    statusType: "destination status",
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

// Function to requeue the transaction with a delay
async function requeueTransaction(params) {
  const requeueParams = {
    MessageBody: JSON.stringify(params),
    QueueUrl: SQS_QUEUE_URL,
    DelaySeconds: 5,
  };

  try {
    console.log(`Requeuing transaction hash: ${params.transactionHash}`);
    const command = new SendMessageCommand(requeueParams);
    const result = await sqsClient.send(command);
    console.log(
      `Transaction requeued successfully, MessageId: ${result.MessageId}`
    );
  } catch (error) {
    console.error(
      `Error requeuing transaction hash ${params.transactionHash}:`,
      error
    );
  }
}

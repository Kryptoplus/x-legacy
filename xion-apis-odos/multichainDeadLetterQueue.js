const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const axios = require("axios");

// Initialize the DynamoDB client
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME =
  process.env.MULTICHAIN_NOTFOUND_DYNAMODB_TABLE_NAME || "MultichainNotFoundTxn";
require("events").EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));

    for (const record of event.Records) {
      const parsedBody = JSON.parse(record.body);
      const transactionHash = parsedBody.transactionHash;

      if (transactionHash) {
        console.log(`Processing transaction hash: ${transactionHash}`);
        await storeTransactionData(parsedBody);
        console.log(
          `Transaction hash ${transactionHash} stored in DynamoDB as "not found"`
        );
        await notifyMerchant(parsedBody);
        console.log(
          `Merchant notified for transaction hash ${transactionHash}`
        );
      } else {
        console.error("transactionHash not found in DLQ message body");
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "DLQ messages processed successfully" }),
    };
  } catch (error) {
    console.error("Error processing DLQ messages:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};

// Function to store the transaction data in DynamoDB with finalStatus as "not found"
async function storeTransactionData(transaction) {
  const {
    transactionHash,
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
  } = transaction;

  const params = {
    TableName: TABLE_NAME,
    Item: {
      transactionHash: { S: transactionHash },
      nativeValue: { N: nativeValue.toString() },
      fromAmount: { N: fromAmount.toString() },
      fromAddress: { S: fromAddress },
      fromCurrency: { S: fromCurrency },
      fromNetwork: { S: fromNetwork },
      toAmount: { N: toAmount.toString() },
      toAmountMin: { N: toAmountMin.toString() },
      toNetwork: { S: toNetwork },
      toCurrency: { S: toCurrency },
      toAddress: { S: toAddress },
      feeAmount: { N: feeAmount.toString() },
      requestId: { S: requestId },
      fromTokenAddress: { S: fromTokenAddress },
      fromAmountFormatted: { S: fromAmountFormatted },
      feeAmountFormatted: { S: feeAmountFormatted },
      toAmountMinFormatted: { S: toAmountMinFormatted },
      toAmountFormatted: { S: toAmountFormatted },
      finalStatus: { S: "not found" },
      merchantAddress: { S: merchantAddress },
      merchantWebhook: { S: merchantWebhook || "N/A" },
      updatedAt: { S: new Date().toISOString() },
    },
  };

  try {
    console.log(
      `Storing transaction ${transactionHash} in DynamoDB as "not found"`
    );
    await dynamoDbClient.send(new PutItemCommand(params));
    console.log(
      `Successfully stored transaction ${transactionHash} as "not found"`
    );
  } catch (error) {
    console.error(
      `Error storing transaction ${transactionHash} as "not found":`,
      error
    );
    throw error;
  }
}

// Function to notify the merchant via their webhook
async function notifyMerchant(transaction) {
  const {
    transactionHash,
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
    fromAmountFormatted,
    feeAmountFormatted,
    toAmountMinFormatted,
    toAmountFormatted,
    merchantAddress,
    merchantWebhook,
  } = transaction;

  const notificationData = {
    text:
      `Transaction notification:\n` +
      `*Transaction Hash:* ${transactionHash}\n` +
      `*Native Value:* ${nativeValue}\n` +
      `*From Amount:* ${fromAmount}\n` +
      `*From Address:* ${fromAddress}\n` +
      `*From Currency:* ${fromCurrency}\n` +
      `*From Network:* ${fromNetwork}\n` +
      `*To Amount:* ${toAmount}\n` +
      `*To Amount Min:* ${toAmountMin}\n` +
      `*To Network:* ${toNetwork}\n` +
      `*To Currency:* ${toCurrency}\n` +
      `*To Address:* ${toAddress}\n` +
      `*Fee Amount:* ${feeAmount}\n` +
      `*From Amount (Formatted):* ${fromAmountFormatted}\n` +
      `*Fee Amount (Formatted):* ${feeAmountFormatted}\n` +
      `*To Amount Min (Formatted):* ${toAmountMinFormatted}\n` +
      `*To Amount (Formatted):* ${toAmountFormatted}\n` +
      `*Merchant Address:* ${merchantAddress}\n` +
      `*Merchant Webhook:* ${merchantWebhook}\n` +
      `*Final Status:* not found`,
  };

  const hardcodedWebhook =
    "https://hooks.slack.com/services/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";

  try {
    console.log(
      `Notifying merchant via hardcoded webhook: ${hardcodedWebhook}`
    );
    const response = await axios.post(hardcodedWebhook, notificationData);
    console.log(`Merchant notified: ${response.statusText}`);
  } catch (error) {
    console.error(`Failed to notify merchant: ${error.message}`);
  }
}

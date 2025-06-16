const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const axios = require('axios'); // Import axios for making HTTP requests

// Initialize the DynamoDB client
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'NotFoundPolygonTxs';

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        for (const record of event.Records) {
            const parsedBody = JSON.parse(record.body);
            const transactionHash = parsedBody.transactionHash;

            if (transactionHash) {
                console.log(`Processing transaction hash: ${transactionHash}`);
                await storeTransactionData(parsedBody);
                console.log(`Transaction hash ${transactionHash} stored in DynamoDB as "not found"`);
                await notifyMerchant(parsedBody);
                console.log(`Merchant notified for transaction hash ${transactionHash}`);
            } else {
                console.error('transactionHash not found in DLQ message body');
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'DLQ messages processed successfully' })
        };
    } catch (error) {
        console.error('Error processing DLQ messages:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

// Function to store the transaction data in DynamoDB with finalStatus as "not found"
async function storeTransactionData(transaction) {
    const { transactionHash, amount, buyerAddress, currency, nonce, orderCode, productName, referenceId, merchantAddress, merchantWebhook } = transaction;

    const params = {
        TableName: TABLE_NAME,
        Item: {
            transactionHash: { S: transactionHash },
            amount: { N: amount.toString() },
            buyerAddress: { S: buyerAddress },
            currency: { S: currency },
            nonce: { N: nonce.toString() },
            orderCode: { S: orderCode },
            productName: { S: productName },
            referenceId: { S: referenceId },
            finalStatus: { S: 'not found' }, // Marking the status as "not found"
            merchantAddress: { S: merchantAddress },
            merchantWebhook: { S: merchantWebhook }, // Including the merchantWebhook if needed
            updatedAt: { S: new Date().toISOString() }
        }
    };

    try {
        console.log(`Storing transaction ${transactionHash} in DynamoDB as "not found"`);
        await dynamoDbClient.send(new PutItemCommand(params));
        console.log(`Successfully stored transaction ${transactionHash} as "not found"`);
    } catch (error) {
        console.error(`Error storing transaction ${transactionHash} as "not found":`, error);
        throw error;
    }
}

// Function to notify the merchant via their webhook
async function notifyMerchant(transaction) {
    const { transactionHash, amount, buyerAddress, currency, nonce, orderCode, productName, referenceId, merchantWebhook, merchantAddress  } = transaction;

      // Format the payload as expected by Slack
      const notificationData = {
        text: `Transaction notification:\n` +
              `*Transaction Hash:* ${transactionHash}\n` +
              `*Amount:* ${amount}\n` +
              `*Buyer Address:* ${buyerAddress}\n` +
              `*Currency:* ${currency}\n` +
              `*Nonce:* ${nonce}\n` +
              `*Order Code:* ${orderCode}\n` +
              `*Product Name:* ${productName}\n` +
              `*Reference ID:* ${referenceId}\n` +
              `*Merchant Address:* ${merchantAddress}\n` + // Adding merchant address
              `*Merchant Webhook:* ${merchantWebhook}\n` + // Adding merchant webhook
              `*Final Status:* not found`
    };

    const hardcodedWebhook = 'https://hooks.slack.com/services/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'; // Replace with the actual hardcoded URL

    try {
        console.log(`Notifying merchant via hardcoded webhook: ${hardcodedWebhook}`);
        const response = await axios.post(hardcodedWebhook, notificationData);
        console.log(`Merchant notified: ${response.statusText}`);
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
    }
}

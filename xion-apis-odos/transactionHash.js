const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { ethers } = require('ethers');
const axios = require('axios'); // Import axios for making HTTP requests

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'PolygonTransactions';
// Removed static MERCHANT_WEBHOOK_URL, using dynamic value from request
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Initialize ethers with the Polygon RPC provider
const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);

// Initialize the SQS client
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    let transactionHash;
    let resultMessage;

    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        // Check if event.Records exists (for SQS), otherwise assume API Gateway or local testing
        if (event.Records) {
            console.log('Processing SQS event');
            for (const record of event.Records) {
                const parsedBody = JSON.parse(record.body);
                transactionHash = parsedBody.transactionHash;
                if (transactionHash) {
                    console.log(`Found transactionHash in SQS message: ${transactionHash}`);
                    resultMessage = await processTransaction(parsedBody);
                } else {
                    console.error('transactionHash not found in SQS message body');
                }
            }
        } 
        // else {
        //     // For API Gateway (and local testing)
        //     console.log('Processing API Gateway event');
        //     const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        //     transactionHash = parsedBody ? parsedBody.transactionHash : undefined;
        //     if (transactionHash) {
        //         console.log(`Found transactionHash in API Gateway request body: ${transactionHash}`);
        //         resultMessage = await processTransaction(parsedBody);
        //     } else {
        //         console.error('transactionHash not found in API Gateway request body');
        //         return {
        //             statusCode: 400,
        //             body: JSON.stringify({ error: 'transactionHash not found in request body' })
        //         };
        //     }
        // }

        console.log(`Returning success response with message: ${resultMessage}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: resultMessage })
        };
    } catch (error) {
        console.error('Error processing transaction:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

// Function to process the transaction
async function processTransaction(params) {
    const {
        amount,
        buyerAddress,
        currency,
        nonce,
        orderCode,
        productName,
        referenceId,
        transactionHash,
        merchantAddress,
        merchantWebhook // Extracting the new parameter
    } = params;

    console.log(`Processing transaction with params: ${JSON.stringify(params)}`);

    try {
        // Check transaction status on the Polygon blockchain
        const receipt = await checkTransactionStatus(transactionHash);

        let finalStatus;
        if (receipt && receipt.status === 1) {
            finalStatus = 'successful';
            console.log(`Transaction ${transactionHash} successful`);
        } else if (receipt && receipt.status === 0) {
            finalStatus = 'failed';
            console.log(`Transaction ${transactionHash} failed`);
        } else {
            finalStatus = 'not yet successful';
            console.log(`Transaction ${transactionHash} not yet successful, requeuing...`);
            await requeueTransactionHash(params);
            console.log(`Transaction ${transactionHash} requeued successfully`);
            return `Transaction ${transactionHash} requeued`;
        }

          // Store the transaction hash and its status in DynamoDB
          console.log(`Storing transaction ${transactionHash} with finalStatus ${finalStatus} in DynamoDB`);
          await dynamoDbClient.send(new PutItemCommand({
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
                  finalStatus: { S: finalStatus },
                  merchantAddress: { S: merchantAddress },
                  merchantWebhook: { S: merchantWebhook }, // Storing the new parameter in DynamoDB
                  updatedAt: { S: new Date().toISOString() }
              }
          }));
          console.log(`Successfully stored transaction ${transactionHash} with finalStatus ${finalStatus}`);
  
          // Notify the merchant using the dynamic webhook URL
        console.log(`Notifying merchant via webhook: ${merchantWebhook}`);
        await notifyMerchant(params, finalStatus, merchantWebhook);
        console.log(`Merchant notified successfully for transaction ${transactionHash}`);

        return `Transaction ${transactionHash} ${finalStatus}`;
    } catch (error) {
        console.error(`Error processing transaction ${transactionHash}:`, error);
        console.log(`Requeuing transaction ${transactionHash} due to error...`);
        await requeueTransactionHash(params);  // Requeueing even in the case of an error
        console.log(`Transaction ${transactionHash} requeued due to processing error.`);
        throw error;  // Re-throw error if needed for further handling
    }
}

// Function to check transaction status using ethers.js
async function checkTransactionStatus(txHash) {
    try {
        console.log(`Checking transaction status for hash: ${txHash}`);
        // Get the transaction receipt
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            console.log('Transaction not yet processed or invalid transaction hash.');
            return null;
        }

        console.log(`Transaction status retrieved: ${JSON.stringify(receipt)}`);
        return receipt;
    } catch (error) {
        console.error('An error occurred while checking the transaction status:', error);
        throw error;
    }
}

// Function to notify the merchant
async function notifyMerchant(params, finalStatus, webhookUrl) {
    const {
        transactionHash,
        amount,
        buyerAddress,
        currency,
        nonce,
        orderCode,
        productName,
        referenceId
    } = params;

    try {
        const response = await axios.post(webhookUrl, {
            transactionHash,
            finalStatus,
            amount,
            buyerAddress,
            currency,
            nonce,
            orderCode,
            productName,
            referenceId
        });

        console.log(`Merchant notified: ${response.statusText}`);
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
    }
}

// Function to requeue the transaction hash with a delay of 5 seconds
async function requeueTransactionHash(params) {
    const requeueParams = {
        MessageBody: JSON.stringify(params),
        QueueUrl: SQS_QUEUE_URL,
        DelaySeconds: 5 // Requeue after 5 seconds
    };

    try {
        console.log(`Attempting to requeue transaction hash: ${params.transactionHash}`);
        const command = new SendMessageCommand(requeueParams);
        const result = await sqsClient.send(command);
        console.log(`Successfully requeued transaction hash: ${params.transactionHash}, MessageId: ${result.MessageId}`);
    } catch (error) {
        console.error(`Error requeuing transaction hash ${params.transactionHash}:`, error);
    }
}

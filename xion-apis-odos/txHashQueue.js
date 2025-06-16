const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

// Initialize the SQS client
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

// Environment variable for SQS queue URL
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        // Parse the request body from API Gateway
        const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

        // Extract the parameters from the request body
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
        } = parsedBody || {};

        // Validate required parameters
        if (!transactionHash) {
            console.error('transactionHash not found in request body');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'transactionHash not found in request body' })
            };
        }

        // Prepare message parameters
        const params = {
            MessageBody: JSON.stringify({
                amount,
                buyerAddress,
                currency,
                nonce,
                orderCode,
                productName,
                referenceId,
                transactionHash,
                merchantAddress,
                merchantWebhook // Adding the new parameter to the message body
            }),
            QueueUrl: SQS_QUEUE_URL
        };

        // Send the message to SQS
        const command = new SendMessageCommand(params);
        await sqsClient.send(command);

        console.log(`Successfully sent transaction details to SQS`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Transaction details sent to SQS' })
        };
    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

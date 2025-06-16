const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = 'xpayouts';

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Handle preflight requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
    }

    // Handle GET request to fetch data from the xpayouts table
    if (event.httpMethod === 'GET') {
        try {
            // Fetch all items from the DynamoDB table
            const params = {
                TableName: TABLE_NAME,
            };

            const data = await dynamoDbClient.send(new ScanCommand(params));

            // Format the response to include the new userId field
            const formattedResults = data.Items.map(item => ({
                orderCode: item.orderCode,
                fees: item.fees,
                token: item.token,
                updatedAt: item.updatedAt,
                status: item.status,
                wallets: item.wallets,
                createdAt: item.createdAt,
                amounts: item.amounts,
                merchantFeeAddress: item.merchantFeeAddress,
                merchantid: item.merchantid,
                transactionHash: item.transactionHash,
                userId: item.userId  // Adding userId to the response
            }));

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formattedResults)
            };
        } catch (error) {
            console.error("Error fetching data from DynamoDB:", error);

            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: error.message })
            };
        }
    }

    // Return a 405 Method Not Allowed if the method is not GET or OPTIONS
    return {
        statusCode: 405,
        headers: {
            'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Method Not Allowed' })
    };
};

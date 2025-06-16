require('events').EventEmitter.defaultMaxListeners = 20;
const mysql = require('mysql2/promise');

// MySQL client connection
async function getDBConnection() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: 3306 // Default MySQL port
    });
    return connection;
}

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Handle CORS preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true'
            }
        };
    }

    try {
        // Connect to the database
        const connection = await getDBConnection();

        // Query to fetch the latest transaction_Id
        const sql = `
            SELECT MAX(transaction_Id) AS latest_transaction_Id 
            FROM transaction_table
        `;
        const [rows] = await connection.execute(sql);

        // Extract the latest transaction_Id
        const latestTransactionId = rows[0]?.latest_transaction_Id || null;

        console.log(`Latest transaction_Id fetched from DB: ${latestTransactionId}`);

        // Close the database connection
        await connection.end();

        // Return the latest transaction_Id
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins, adjust as needed
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ latestTransactionId })
        };
    } catch (error) {
        console.error('Error fetching latest transaction_Id:', error);

        // Return error response
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Failed to fetch latest transaction_Id' })
        };
    }
};

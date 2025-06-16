require('events').EventEmitter.defaultMaxListeners = 20;
const mysql = require('mysql2/promise');

// MySQL client connection using mysql2 library
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

// Whitelisted origins
const whitelistedOrigins = [
    'https://www.xpayout.io',
    'http://localhost:3001'
];

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Check the Origin header
    const origin = event.headers.Origin || event.headers.origin; // Check both upper and lowercase
    const isOriginAllowed = whitelistedOrigins.includes(origin);
    const accessControlAllowOrigin = isOriginAllowed ? origin : 'null';

    if (!whitelistedOrigins.includes(origin)) {
        return {
            statusCode: 403,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Access denied' })
        };
    }

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Credentials': 'true'
            }
        };
    }

    // If the origin is not allowed, return an error response
if (!isOriginAllowed) {
    return {
        statusCode: 403,
        headers: {
            'Access-Control-Allow-Origin': 'null',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Origin not allowed' })
    };
}

    // Parse request body to get merchant_Id
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        console.error("Error parsing request body:", error);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }

    const { merchant_Id } = body;

    // Validate merchant_Id
    if (!merchant_Id) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Missing required parameter: merchant_Id' })
        };
    }

    try {
        const connection = await getDBConnection();

        // SQL query to group and aggregate data including customer_identifier
        const sql = `
        SELECT 
        JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']'))) AS wallet,
        JSON_UNQUOTE(JSON_EXTRACT(customer_identifier, CONCAT('$[', numbers.n, ']'))) AS customer_identifier,
        SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))) AS totalAmountPaid,
        SUM(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(merchant_fees, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))
        ) AS totalFeesPaid,        
        SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_fee, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))) AS totalTransactionFee,
        MIN(created_at) AS firstTransactionDate
    FROM 
        transaction_table
    JOIN 
        (WITH RECURSIVE numbers AS (
            SELECT 0 AS n
            UNION ALL
            SELECT n + 1 FROM numbers WHERE n < 998  -- Up to 999 elements
        ) SELECT n FROM numbers) numbers
    WHERE 
        merchant_Id = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
        AND status = 'Success'  -- Filter for successful transactions
    GROUP BY 
        wallet;
    
        `;

        const [rows] = await connection.execute(sql, [merchant_Id]);

        // Close the connection
        await connection.end();

        // Format the response
        const response = rows.map(row => ({
            wallet: row.wallet,
            userId: row.customer_identifier,
            totalAmountPaid: parseFloat(row.totalAmountPaid) / 1e6, // Convert from uint256 to readable USDT
            totalFeesPaid: parseFloat(row.totalFeesPaid) / 1e6,     // Convert from uint256 to readable USDT
            totalTransactionFee: parseFloat(row.totalTransactionFee) / 1e6, // Convert transaction_fee to readable USDT
            firstTransactionDate: new Date(row.firstTransactionDate).toISOString()
        }));

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify(response)
        };
    } catch (error) {
        console.error("Error processing request:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};
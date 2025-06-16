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

    // Extract the origin from the request headers
    const origin = event.headers.Origin || event.headers.origin;
    const isOriginAllowed = whitelistedOrigins.includes(origin);
    const accessControlAllowOrigin = isOriginAllowed ? origin : 'null';

    // If the origin is not whitelisted, deny access
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
                'Access-Control-Allow-Headers': 'Content-Type',
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
    const { merchant_Id } = JSON.parse(event.body);

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

        // Query to retrieve transaction history by merchant_Id
        const sql = `
        WITH RECURSIVE numbers AS (
            SELECT 0 AS n
            UNION ALL
            SELECT n + 1 FROM numbers WHERE n < 999  -- Max of 300 elements
        )
        SELECT 
            JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']'))) AS customer_wallet_address,
            JSON_UNQUOTE(JSON_EXTRACT(customer_identifier, CONCAT('$[', numbers.n, ']'))) AS customer_identifier,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6)) AS transaction_amount,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(merchant_fees, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6)) AS merchant_fees,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_fee, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6)) AS transaction_fee,
            created_at,
            order_code,
            status,
            transactionHash
        FROM 
            transaction_table
        JOIN 
            numbers ON JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
        WHERE 
            merchant_Id = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(customer_identifier, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(merchant_fees, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(transaction_fee, CONCAT('$[', numbers.n, ']'))) IS NOT NULL
        ORDER BY 
            created_at DESC;
        
        `;

        const [rows] = await connection.execute(sql, [merchant_Id]);

        // Close the connection
        await connection.end();

        // Format the response, filter out rows with any null values
        const response = rows
            .filter(row => row.customer_wallet_address && row.customer_identifier && row.transaction_amount && row.merchant_fees && row.transaction_fee)
            .map(row => {
                const transactionAmount = parseFloat(row.transaction_amount) / 1e6; // Convert to readable USDT
                // const merchantFeesBps = parseFloat(row.merchant_fees);
                // const merchantFees = (transactionAmount * merchantFeesBps) / 10000; // Convert basis points to USDT
                const merchantFees = parseFloat(row.merchant_fees) / 1e6; // Convert from decimals to USDT

                return {
                    customer_identifier: row.customer_identifier,
                    customer_wallet_address: row.customer_wallet_address,
                    transaction_amount: transactionAmount,           // In USDT
                    merchant_fees: merchantFees,                     // In USDT, calculated from bps
                    transaction_fee: parseFloat(row.transaction_fee) / 1e6,  // Convert to readable USDT
                    created_at: new Date(row.created_at).toISOString(),
                    order_code: row.order_code,
                    status: row.status,
                    transactionHash: row.transactionHash
                };
            });

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
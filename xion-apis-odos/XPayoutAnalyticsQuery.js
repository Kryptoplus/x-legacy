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

        // SQL query to count the number of transactions by hour
        const hourlyTransactionsSql = `
            SELECT 
                HOUR(updated_at) AS hour,
                SUM(JSON_LENGTH(transaction_amount)) AS total_transactions  -- Count the length of the transaction_amount array
            FROM 
                transaction_table
            WHERE 
                merchant_Id = ?
                AND status = 'Success'
            GROUP BY 
                HOUR(updated_at);
        `;

        // SQL query to count the number of transactions by day (removing time component)
        const dailyTransactionsSql = `
            SELECT 
                DATE(updated_at) AS day,  -- Extract only the date part
                SUM(JSON_LENGTH(transaction_amount)) AS total_transactions  -- Count the length of the transaction_amount array
            FROM 
                transaction_table
            WHERE 
                merchant_Id = ?
                AND status = 'Success'
            GROUP BY 
                DATE(updated_at);
        `;

        // SQL query for other metrics: payouts, fees, and unique customers by hour
        const hourlyMetricsSql = `
        SELECT 
        HOUR(updated_at) AS hour,
        SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))) AS total_payouts,  -- Sum of transaction amounts
        SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(merchant_fees, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6)) / 10000 *
            CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))) AS total_fees_earned,  -- Sum of merchant fees (in bps)
        COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']')))) AS total_customers  -- Count unique customers
    FROM 
        transaction_table
    JOIN 
        (WITH RECURSIVE numbers AS (
            SELECT 0 AS n
            UNION ALL
            SELECT n + 1 FROM numbers WHERE n < 998  -- Handle up to 999 elements
        ) SELECT n FROM numbers) numbers
    WHERE 
        merchant_Id = ?
        AND status = 'Success'
    GROUP BY 
        HOUR(updated_at);
        `;

        // SQL query for other metrics: payouts, fees, and unique customers by day (removing time component)
        const dailyMetricsSql = `
        SELECT 
        DATE(updated_at) AS day,  -- Extract only the date part
        SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(transaction_amount, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))) AS total_payouts,  -- Sum of transaction amounts
        SUM(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(merchant_fees, CONCAT('$[', numbers.n, ']'))) AS DECIMAL(18,6))
        ) AS total_fees_earned,  -- Sum of merchant fees
        COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(customer_wallet_address, CONCAT('$[', numbers.n, ']')))) AS total_customers  -- Count unique customers
    FROM 
        transaction_table
    JOIN 
        (WITH RECURSIVE numbers AS (
            SELECT 0 AS n
            UNION ALL
            SELECT n + 1 FROM numbers WHERE n < 998  -- Handle up to 999 elements
        ) SELECT n FROM numbers) numbers
    WHERE 
        merchant_Id = ?
        AND status = 'Success'
    GROUP BY 
        DATE(updated_at);
        `;

        // Execute queries for hourly data
        const [hourlyTransactionsRows] = await connection.execute(hourlyTransactionsSql, [merchant_Id]);
        const [hourlyMetricsRows] = await connection.execute(hourlyMetricsSql, [merchant_Id]);

        // Execute queries for daily data
        const [dailyTransactionsRows] = await connection.execute(dailyTransactionsSql, [merchant_Id]);
        const [dailyMetricsRows] = await connection.execute(dailyMetricsSql, [merchant_Id]);

        // Close the connection
        await connection.end();

        // Combine hourly data
        const hourlyResponse = hourlyTransactionsRows.map((txRow, index) => {
            const metricRow = hourlyMetricsRows[index];
            return {
                hour: txRow.hour,
                total_transactions: txRow.total_transactions,  // Total transactions based on array length
                total_payouts: (parseFloat(metricRow.total_payouts) / 1e6).toFixed(6),  // Convert from uint256 to readable USDT
                total_fees_earned: (parseFloat(metricRow.total_fees_earned) / 1e6).toFixed(6),  // Convert from uint256 to readable USDT
                total_customers: metricRow.total_customers
            };
        });

        // Combine daily data
        const dailyResponse = dailyTransactionsRows.map((txRow, index) => {
            const metricRow = dailyMetricsRows[index];
            return {
                day: txRow.day.toISOString().split('T')[0],  // Day without time
                total_transactions: txRow.total_transactions,  // Total transactions based on array length
                total_payouts: (parseFloat(metricRow.total_payouts) / 1e6).toFixed(6),  // Convert from uint256 to readable USDT
                total_fees_earned: (parseFloat(metricRow.total_fees_earned) / 1e6).toFixed(6),  // Convert from uint256 to readable USDT
                total_customers: metricRow.total_customers
            };
        });

        // Return combined hourly and daily data
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({
                hourly: hourlyResponse,
                daily: dailyResponse
            })
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
const axios = require("axios");

exports.handler = async (event) => {
  // Parsing only the needed parameters from the event body
  const { transactionId, requestId } = JSON.parse(event.body);

  const fromChainId = "137";
  const toChainId = "137";

  // Check if all required parameters are present
  if (!transactionId || !requestId) {
    console.error(
      "Missing one or more required parameters: transactionId, requestId"
    );
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-integrator-id",
      },
      body: "Missing required body parameters.",
    };
  }

  // Construct the URL with the necessary query parameters
  const url = `https://v2.api.squidrouter.com/v2/status?transactionId=${transactionId}&requestId=${requestId}&fromChainId=${fromChainId}&toChainId=${toChainId}`;
  console.log(
    `Fetching status for Transaction ID: ${transactionId} with Request ID: ${requestId}`
  );

  try {
    const response = await axios.get(url, {
      headers: {
        "x-integrator-id": process.env.INTEGRATOR_ID,
        "Content-Type": "application/json",
      },
    });

    console.log("Status fetched successfully:", response.data);

    // Create a clean response that includes requested details and the status
    const cleanedResponse = {
      transactionId: transactionId,
      requestId: requestId,
      status:
        response.data.routeStatus[response.data.routeStatus.length - 1].status,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-integrator-id",
      },
      body: JSON.stringify(cleanedResponse),
    };
  } catch (error) {
    console.error(
      "API error during status fetching:",
      error.response ? error.response.data : error.message
    );
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-integrator-id",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

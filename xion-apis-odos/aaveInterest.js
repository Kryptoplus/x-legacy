const { ethers } = require("ethers");
const { DynamoDBClient, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');

// Aave Protocol ABI
const uiPoolDataProviderAbi = [
  "function getUserReservesData(address provider, address user) external view returns (tuple(address underlyingAsset, uint256 scaledATokenBalance, bool usageAsCollateralEnabledOnUser, uint256 stableBorrowRate, uint256 scaledVariableDebt, uint256 principalStableDebt, uint256 stableBorrowLastUpdateTimestamp)[], uint8)",
  "function getReservesData(address provider) external view returns (tuple(address underlyingAsset, string name, string symbol, uint256 decimals, uint256 baseLTVasCollateral, uint256 reserveLiquidationThreshold, uint256 reserveLiquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 liquidityRate, uint128 variableBorrowRate, uint128 stableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint256 availableLiquidity, uint256 totalPrincipalStableDebt, uint256 averageStableRate, uint256 stableDebtLastUpdateTimestamp, uint256 totalScaledVariableDebt, uint256 priceInMarketReferenceCurrency, address priceOracle, uint256 variableRateSlope1, uint256 variableRateSlope2, uint256 stableRateSlope1, uint256 stableRateSlope2, uint256 baseStableBorrowRate, uint256 baseVariableBorrowRate, uint256 optimalUsageRatio, bool isPaused, bool isSiloedBorrowing, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt, bool flashLoanEnabled, uint256 debtCeiling, uint256 debtCeilingDecimals, uint8 eModeCategoryId, uint256 borrowCap, uint256 supplyCap, uint16 eModeLtv, uint16 eModeLiquidationThreshold, uint16 eModeLiquidationBonus, address eModePriceSource, string eModeLabel, bool borrowableInIsolation, bool virtualAccActive, uint128 virtualUnderlyingBalance)[], tuple(uint256 marketReferenceCurrencyUnit, int256 marketReferenceCurrencyPriceInUsd, int256 networkBaseTokenPriceInUsd, uint8 networkBaseTokenPriceDecimals))"
];

// Environment variables
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const UI_POOL_DATA_PROVIDER_ADDRESS = "0xE92cd6164CE7DC68e740765BC1f2a091B6CBc3e4";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL;
const AAVE_PROVIDER_ADDRESS = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";
const USDT_DECIMALS = 6;
const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const OTC_TABLE = "otcTable";
const OTC_INTEREST_TABLE = "otcInterest";

// Helper function to format BigInt
function formatBigIntForUSDT(value, decimals) {
  const factor = BigInt(10 ** decimals);
  const wholePart = value / factor;
  const fractionalPart = value % factor;
  return `${wholePart}.${fractionalPart.toString().padStart(decimals, "0")}`;
}

exports.handler = async (event) => {
  try {
    // Parse relayerAddress from the request body
    const { relayerAddress } = JSON.parse(event.body);

    if (!relayerAddress) {
      throw new Error("relayerAddress is required in the request body.");
    }

    const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
    const uiPoolDataProvider = new ethers.Contract(
      UI_POOL_DATA_PROVIDER_ADDRESS,
      uiPoolDataProviderAbi,
      provider
    );

    // Fetch reserves data for liquidityIndex
    const [reservesData] = await uiPoolDataProvider.getReservesData(AAVE_PROVIDER_ADDRESS);
    const usdtReserve = reservesData.find(
      (reserve) => reserve.underlyingAsset?.toLowerCase() === USDT_ADDRESS.toLowerCase()
    );

    if (!usdtReserve) {
      throw new Error("USDT reserve not found in the Aave pool.");
    }
    const liquidityIndexRaw = BigInt(usdtReserve.liquidityIndex);

    // Fetch all records from otcTable
    const depositsResult = await dynamoDbClient.send(
      new ScanCommand({
        TableName: OTC_TABLE,
      })
    );

    console.log("Fetched deposits:", depositsResult.Items);

    // Filter deposits for the specific relayerAddress
    const deposits = depositsResult.Items.filter(
      (deposit) => deposit.relayerAddress?.S === relayerAddress
    );

    if (!deposits || deposits.length === 0) {
      throw new Error(`No deposits found for the specified relayerAddress: ${relayerAddress}`);
    }

    // Calculate total scaled balance
    let totalScaledBalanceRaw = BigInt(0);
    deposits.forEach((deposit) => {
      const scaledBalance = BigInt(Math.round(parseFloat(deposit.supplyAmount?.N || "0") * 10 ** USDT_DECIMALS));
      totalScaledBalanceRaw += scaledBalance;
    });

    // Calculate total current balance
    const totalCurrentBalanceRaw = (totalScaledBalanceRaw * liquidityIndexRaw) / BigInt(10 ** 27);
    const totalCurrentBalance = parseFloat(formatBigIntForUSDT(totalCurrentBalanceRaw, USDT_DECIMALS));

    let totalInterestEarned = 0;
    const detailedResults = [];

    // Calculate attributed balances and interest for each deposit
    for (const deposit of deposits) {
      const scaledBalanceRaw = BigInt(Math.round(parseFloat(deposit.supplyAmount?.N || "0") * 10 ** USDT_DECIMALS));
      const supplyAmountRaw = scaledBalanceRaw;

      if (scaledBalanceRaw === 0) {
        console.warn("Skipping deposit due to missing or zero balances:", deposit);
        continue;
      }

      // Proportion of this deposit in the total scaled balance
      const proportion = scaledBalanceRaw / totalScaledBalanceRaw;

      // Calculate attributed current balance and interest
      const attributedBalanceRaw = totalCurrentBalanceRaw * proportion;
      const attributedBalance = parseFloat(formatBigIntForUSDT(attributedBalanceRaw, USDT_DECIMALS));

      const interestEarnedRaw = attributedBalanceRaw - supplyAmountRaw;
      const interestEarned = parseFloat(formatBigIntForUSDT(interestEarnedRaw, USDT_DECIMALS));

      totalInterestEarned += interestEarned;

      const result = {
        transactionHash: deposit.transactionHash?.S,
        requestId: deposit.requestId?.S,
        supplyAmount: parseFloat(deposit.supplyAmount?.N).toFixed(6),
        attributedBalance: attributedBalance.toFixed(6),
        interestEarned: interestEarned.toFixed(6),
        proportion: proportion.toString(),
      };

      detailedResults.push(result);

      // Save each result to the database
      const params = {
        TableName: OTC_INTEREST_TABLE,
        Item: {
          transactionHash: { S: deposit.transactionHash?.S || "unknown" },
          requestId: { S: deposit.requestId?.S || `unknown-${Date.now()}` },
          supplyAmount: { N: result.supplyAmount },
          attributedBalance: { N: result.attributedBalance },
          interestEarned: { N: result.interestEarned },
          proportion: { N: result.proportion },
          relayerAddress: { S: relayerAddress },
          createdAt: { S: new Date().toISOString() },
        },
      };

      await dynamoDbClient.send(new PutItemCommand(params));
    }

    // Return all calculated data
    return {
      statusCode: 200,
      body: JSON.stringify({
        totalBalance: totalCurrentBalance.toFixed(6),
        interestEarned: totalInterestEarned.toFixed(6),
        detailedResults,
      }),
    };
  } catch (error) {
    console.error("Error occurred:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

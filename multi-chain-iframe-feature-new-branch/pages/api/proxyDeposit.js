export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const response = await fetch("https://www.xinterchange.io/api/depositUsdtForChip", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEPOSIT_API_BEARER_TOKEN}`,
    },
    body: JSON.stringify(req.body),
  });

  const data = await response.json().catch(() => ({}));
  res.status(response.status).json(data);
}

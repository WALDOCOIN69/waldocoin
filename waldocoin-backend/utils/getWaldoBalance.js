import { Client } from 'xrpl'

const ISSUER = 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
const CURRENCY = 'WLO' // WALDO token

export default async function getWaldoBalance(wallet, node = 'wss://xrplcluster.com') {
  const client = new Client(node)

  try {
    await client.connect()

    const response = await client.request({
      command: 'account_lines',
      account: wallet
    })

    const waldoLine = response.result.lines.find(
      l => l.currency === CURRENCY && l.account === ISSUER
    )

    return waldoLine ? parseFloat(waldoLine.balance) : 0
  } catch (err) {
    console.error(`❌ Failed to fetch WALDO balance for ${wallet}:`, err.message)
    return 0
  } finally {
    await client.disconnect()
  }
}


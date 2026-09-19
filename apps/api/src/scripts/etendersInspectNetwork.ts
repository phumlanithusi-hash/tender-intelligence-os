import { chromium } from 'playwright-core'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  const jsonResponses: { url: string; snippet: string }[] = []

  page.on('response', async (response) => {
    const contentType = response.headers()['content-type'] ?? ''
    if (contentType.includes('application/json') || contentType.includes('text/json')) {
      try {
        const text = await response.text()
        jsonResponses.push({ url: response.url(), snippet: text.slice(0, 2000) })
      } catch {
        // ignore bodies we can't read (e.g. already consumed)
      }
    }
  })

  await page.goto('https://www.etenders.gov.za/Home/opportunities', { waitUntil: 'networkidle' })
  await page.waitForSelector('table tbody tr', { timeout: 20_000 }).catch(() => undefined)

  console.log(JSON.stringify(jsonResponses, null, 2))
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import { chromium } from 'playwright-core'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('https://www.etenders.gov.za/Home/opportunities', { waitUntil: 'networkidle' })
  await page.waitForSelector('table tbody tr', { timeout: 20_000 }).catch(() => undefined)

  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'))
    return rows.slice(0, 2).map((row) => {
      const links = Array.from(row.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))
      return {
        outerHTML: row.outerHTML.slice(0, 3000),
        links,
      }
    })
  })

  console.log(JSON.stringify(info, null, 2))
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

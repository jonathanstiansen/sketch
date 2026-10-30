import { chromium } from "@playwright/test"

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
const page = await browser.newPage()
void context
void page

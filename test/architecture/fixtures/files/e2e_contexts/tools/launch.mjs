import { chromium } from "@playwright/test"

const context = await chromium.launchPersistentContext("/tmp/profile")
void context

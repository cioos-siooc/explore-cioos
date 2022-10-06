import puppeteer from "puppeteer";
const errors = [];

/***
 *
 * Check that the local docker compose container loads the frontend without errors using a headless browser (Pupeteer)
 *
 */

// url of frontend
const url = "http://localhost:8098";

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg);
    }
  });

  page
    .on("pageerror", ({ message }) => errors.push(message))
    .on("requestfailed", (request) =>
      errors.push(`${request.failure().errorText} ${request.url()}`)
    );
  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });
  browser.close();
  if (errors.length) {
    console.log(errors);
    process.exit(1);
  }
  process.exit(0);
})();

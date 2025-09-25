import puppeteer from "puppeteer";
const errors = [];

/***
 *
 * Check that the local docker compose container loads the frontend without errors using a headless browser (Pupeteer)
 *
 */

// url of frontend
const url = "http://localhost:8098";

const launchArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--no-first-run'
];

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
    });
  } catch (e) {
    console.error('Failed to launch browser:', e);
    process.exit(1);
  }
  console.log("Testing frontend at", url, "with args", launchArgs.join(' '));

  console.log("Opening page");
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg);
    }
  });

  console.log("Listening for errors on the page");
  page
    .on("pageerror", ({ message }) => errors.push(message))
    .on("requestfailed", (request) =>
      errors.push(`${request.failure().errorText} ${request.url()}`)
  );
  console.log("Going to ", url);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log("Waiting for network to be idle");
  await browser.close();
  if (errors.length) {
    console.log(errors);
    process.exit(1);
  }
  console.log("No errors detected");
  process.exit(0);
})();

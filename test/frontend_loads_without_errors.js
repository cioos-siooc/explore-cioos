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
  console.log("Testing frontend at ", url);

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
  });
  console.log("Waiting for network to be idle");
  browser.close();
  if (errors.length) {
    console.log(errors);
    process.exit(1);
  }
  console.log("No errors detected");
  process.exit(0);
})();

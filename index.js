const scrape = require("website-scraper");
require("dotenv").config();
const fs = require("fs");
const website_url = process.env.website_url || "https://example.com";
const directory = "data/result";
const options = {
  urls: [website_url],
  directory,
};

const runScrape = async (options) => {
  console.log("removing old directory", directory);
  await removeDirectory();
  console.log("Scraping starts..., options:", options);
  try {
    const result = await scrape(options);
    console.log(result);
  } catch (error) {
      console.log(error);
  }
};

// removeDirectory
const removeDirectory = async () =>
  fs.rmSync(directory, { recursive: true, force: true });

runScrape(options);

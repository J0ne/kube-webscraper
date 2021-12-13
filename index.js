const scrape = require("website-scraper");
require('dotenv').config();
const fs = require('fs')

const directory = "data/result";
const options = {
  urls: [process.env.website_url],
  directory: directory,
};

const runScrape = async (options) => {
    removeDirectory();
    const result = await scrape(options);
    console.log(result);
}

// removeDirectory
const removeDirectory = () => fs.rmSync(directory, { recursive: true, force: true });

runScrape(options);
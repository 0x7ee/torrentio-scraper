require('dotenv').config();
const express = require("express");
const server = express();
const { connect } = require('./lib/repository');
const thepiratebayScraper = require('./scrapers/thepiratebay/thepiratebay_scraper');
const horribleSubsScraper = require('./scrapers/horriblesubs/horriblesubs_scraper');
const leetxScraper = require('./scrapers/1337x/1337x_scraper');
const thepiratebayDumpScraper = require('./scrapers/thepiratebay/thepiratebay_dump_scraper');
const thepiratebayUnofficialDumpScraper = require('./scrapers/thepiratebay/thepiratebay_unofficial_dump_scraper');

const providers = [thepiratebayScraper];

async function scrape() {
  providers.forEach((provider) => provider.scrape());
}

server.post('/scrape', function (req, res) {
  scrape();
  res.send(200);
});

server.listen(7000, async function () {
  await connect();
  console.log('Scraper started');
  scrape();
});
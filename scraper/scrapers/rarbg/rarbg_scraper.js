const moment = require('moment');
const Bottleneck = require('bottleneck');
const rarbg = require('rarbg-api');
const decode = require('magnet-uri');
const { Type } = require('../../lib/types');
const repository = require('../../lib/repository');
const {
  createTorrentEntry,
  getStoredTorrentEntry,
  updateTorrentSeeders
} = require('../../lib/torrentEntries');

const NAME = 'RARBG';

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 2500 });
const entryLimiter = new Bottleneck({ maxConcurrent: 40 });

async function scrape() {
  const scrapeStart = moment();
  const lastScrape = await repository.getProvider({ name: NAME });
  console.log(`[${scrapeStart}] starting ${NAME} scrape...`);

  const latestTorrents = await getLatestTorrents();
  return Promise.all(latestTorrents.map(torrent => entryLimiter.schedule(() => processTorrentRecord(torrent))))
      .then(() => {
        lastScrape.lastScraped = scrapeStart;
        lastScrape.lastScrapedId = latestTorrents.length && latestTorrents[latestTorrents.length - 1].torrentId;
        return repository.updateProvider(lastScrape);
      })
      .then(() => console.log(`[${moment()}] finished ${NAME} scrape`));
}

async function getLatestTorrents() {
  const allowedCategories = [
    rarbg.CATEGORY['4K_MOVIES_X264_4k'],
    rarbg.CATEGORY['4K_X265_4k'],
    rarbg.CATEGORY['4k_X264_4k_HDR'],
    rarbg.CATEGORY.MOVIES_XVID,
    rarbg.CATEGORY.MOVIES_XVID_720P,
    rarbg.CATEGORY.MOVIES_X264,
    rarbg.CATEGORY.MOVIES_X264_1080P,
    rarbg.CATEGORY.MOVIES_X264_720P,
    rarbg.CATEGORY.MOVIES_X264_3D,
    rarbg.CATEGORY.MOVIES_FULL_BD,
    rarbg.CATEGORY.MOVIES_BD_REMUX,
    rarbg.CATEGORY.TV_EPISODES,
    rarbg.CATEGORY.TV_UHD_EPISODES,
    rarbg.CATEGORY.TV_HD_EPISODES
  ];

  return Promise.all(allowedCategories.map(category => limiter.schedule(() => getLatestTorrentsForCategory(category))))
      .then(entries => entries.reduce((a, b) => a.concat(b), []));
}

async function getLatestTorrentsForCategory(category) {
  return rarbg.list({ category: category, limit: 100, sort: 'last', format: 'json_extended', ranked: 0 })
      .then(torrents => torrents.map(torrent => ({
        name: torrent.title,
        infoHash: decode(torrent.download).infoHash,
        magnetLink: torrent.download,
        seeders: torrent.seeders,
        leechers: torrent.leechers,
        category: torrent.category,
        size: torrent.size,
        uploadDate: new Date(torrent.pubdate),
        imdbId: torrent.episode_info && torrent.episode_info.imdb
      })))
      .catch((err) => []);
}

async function processTorrentRecord(record) {
  if (await getStoredTorrentEntry(record)) {
    return updateTorrentSeeders(record);
  }

  const torrent = {
    provider: NAME,
    infoHash: record.infoHash,
    title: record.name,
    type: getType(record.category),
    seeders: record.seeders,
    size: record.size,
    uploadDate: record.uploadDate,
    imdbId: record.imdbId
  };

  return createTorrentEntry(torrent);
}

const seriesCategories = [
  'TV Episodes',
  'Movies/TV-UHD-episodes',
  'TV HD Episodes',
];

function getType(category) {
  if (seriesCategories.includes(category)) {
    return Type.SERIES;
  }
  return Type.MOVIE;
}

module.exports = { scrape };
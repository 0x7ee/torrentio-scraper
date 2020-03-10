const moment = require('moment');
const Bottleneck = require('bottleneck');
const rarbg = require('rarbg-api');
const decode = require('magnet-uri');
const { Type } = require('../../lib/types');
const {
  createTorrentEntry,
  getStoredTorrentEntry,
  updateTorrentSeeders
} = require('../../lib/torrentEntries');

const NAME = 'RARBG';

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 2500 });
const entryLimiter = new Bottleneck({ maxConcurrent: 40 });

async function scrape() {
  console.log(`[${moment()}] starting ${NAME} dump scrape...`);
  const movieImdbIds = require('./rargb_movie_imdb_ids_2020-03-09.json');
  const seriesImdbIds = require('./rargb_series_imdb_ids_2020-03-09.json');
  const allImdbIds = [].concat(movieImdbIds).concat(seriesImdbIds);

  return Promise.all(allImdbIds.map(imdbId => limiter.schedule(() => getTorrentsForImdbId(imdbId))
      .then(torrents => Promise.all(torrents.map(t => entryLimiter.schedule(() => processTorrentRecord(t)))))))
      .then(() => console.log(`[${moment()}] finished ${NAME} dump scrape`));
}

async function getTorrentsForImdbId(imdbId) {
  return rarbg.search(imdbId, { limit: 100, sort: 'seeders', format: 'json_extended', ranked: 0 }, 'imdb')
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
const needle = require('needle');
const nameToImdb = require('name-to-imdb');
const bing = require('nodejs-bing');
const { cacheWrapImdbId, cacheWrapMetadata } = require('./cache');
const { Type } = require('./types');

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const KITSU_URL = 'https://anime-kitsu.now.sh';
const TIMEOUT = 20000;

function getMetadata(id, type = Type.SERIES) {
  const key = id.match(/^\d+$/) ? `kitsu:${id}` : id;
  const metaType = type === Type.MOVIE ? Type.MOVIE : Type.SERIES;
  return cacheWrapMetadata(key,
      () => _requestMetadata(`${KITSU_URL}/meta/${metaType}/${key}.json`)
          .catch(() => _requestMetadata(`${CINEMETA_URL}/meta/${metaType}/${key}.json`))
          .catch((error) => {
            throw new Error(`failed metadata query ${kitsuId} due: ${error.message}`);
          }));
}

function _requestMetadata(url) {
  return needle('get', url, { open_timeout: TIMEOUT })
      .then((response) => {
        const body = response.body;
        if (body && body.meta && body.meta.id) {
          return {
            kitsuId: body.meta.kitsu_id,
            imdbId: body.meta.imdb_id,
            title: body.meta.name,
            year: body.meta.year,
            country: body.meta.country,
            genres: body.meta.genres,
            videos: (body.meta.videos || [])
                .map((video) => video.imdbSeason
                    ? {
                      season: video.season,
                      episode: video.episode,
                      imdbSeason: video.imdbSeason,
                      imdbEpisode: video.imdbEpisode
                    }
                    : {
                      season: video.season,
                      episode: video.episode,
                      kitsuId: video.kitsu_id,
                      kitsuEpisode: video.kitsuEpisode,
                      released: video.released
                    }
                ),
            episodeCount: Object.values((body.meta.videos || [])
                .filter((entry) => entry.season !== 0)
                .sort((a, b) => a.season - b.season)
                .reduce((map, next) => {
                  map[next.season] = map[next.season] + 1 || 1;
                  return map;
                }, {})),
            totalCount: body.meta.videos && body.meta.videos
                .filter((entry) => entry.season !== 0).length
          };
        } else {
          throw new Error('No search results');
        }
      });
}

function escapeTitle(title, hyphenEscape = true) {
  return title.toLowerCase()
      .normalize('NFKD') // normalize non-ASCII characters
      .replace(/[\u0300-\u036F]/g, '')
      .replace(/&/g, 'and')
      .replace(hyphenEscape ? /[.,_+ -]+/g : /[.,_+ ]+/g, ' ') // replace dots, commas or underscores with spaces
      .replace(/[^\w- ()]/gi, '') // remove all non-alphanumeric chars
      .trim();
}

async function getImdbId(info) {
  const key = `${info.name}_${info.year}_${info.type}`;

  return cacheWrapImdbId(key,
      () => new Promise((resolve, reject) => {
        nameToImdb(info, function (err, res) {
          if (res) {
            resolve(res);
          } else {
            reject(err || new Error('failed imdbId search'));
          }
        });
      }).catch(() => bing.web(`${info.name} ${info.year || ''} ${info.type} imdb`)
          .then((results) => results
              .map((result) => result.link)
              .find(result => result.includes('imdb.com/title/'))
              .match(/imdb\.com\/title\/(tt\d+)/)[1])));
}

async function getKitsuId(info) {
  const title = info.season > 1 ? `${info.name} S${info.season}` : info.name;
  const query = title.replace(/[;]+/g, ' ').replace(/[,%']+/g, '');
  return cacheWrapImdbId(query,
      () => needle('get', `${KITSU_URL}/catalog/series/kitsu-anime-list/search=${query}.json`, { open_timeout: 60000 })
          .then((response) => {
            const body = response.body;
            if (body && body.metas && body.metas.length) {
              return body.metas[0].id.replace('kitsu:', '');
            } else {
              throw new Error('No search results');
            }
          }));
}

module.exports = { escapeTitle, getMetadata, getImdbId, getKitsuId };
